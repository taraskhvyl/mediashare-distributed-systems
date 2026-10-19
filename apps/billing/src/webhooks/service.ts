import { fetchSubscription } from '../adapters/payments-client.js'
import { DomainError } from '../errors.js'
import type { SubscriptionRow } from '../subscriptions/repository.js'
import { recordEventAndApply, type WebhookEvent, wasProcessed } from './repository.js'
import { verifyWebhookSignature } from './signature.js'

interface PaymentsEvent extends WebhookEvent {
  data: { object: { id?: string; subscription?: string } }
}

export type WebhookOutcome = 'applied' | 'duplicate' | 'ignored'

/**
 * Handles one delivery. The payload is only a nudge ("subscription X changed"): the state we store
 * comes from asking the provider now, so duplicates, delays and reordering cannot leave a stale
 * status behind (ADR 0010). Throwing makes the provider retry later.
 */
export async function handlePaymentsWebhook(
  rawBody: string,
  signatureHeader: string | undefined,
): Promise<WebhookOutcome> {
  verifyWebhookSignature(rawBody, signatureHeader)
  const event = parseEvent(rawBody)

  if (await wasProcessed(event.id)) return 'duplicate'

  const subscriptionId = subscriptionIdOf(event)
  if (!subscriptionId) {
    await recordEventAndApply(event, undefined)
    return 'ignored'
  }

  const current = await fetchSubscription(subscriptionId)
  if (!current.userId) {
    // A subscription we did not create (no user attached): acknowledge so it is not retried forever.
    await recordEventAndApply(event, undefined)
    return 'ignored'
  }

  const row: SubscriptionRow = {
    userId: current.userId,
    providerSubscriptionId: current.id,
    plan: current.plan,
    status: current.status,
    currentPeriodEnd: new Date(current.currentPeriodEnd * 1000),
    cancelAtPeriodEnd: current.cancelAtPeriodEnd,
  }
  const isFirstDelivery = await recordEventAndApply(event, row)
  return isFirstDelivery ? 'applied' : 'duplicate'
}

function parseEvent(rawBody: string): PaymentsEvent {
  try {
    const event = JSON.parse(rawBody) as PaymentsEvent
    if (typeof event.id === 'string' && typeof event.type === 'string' && event.data?.object) return event
  } catch {
    // falls through to the error below
  }
  throw new DomainError('bad_request', 'Malformed webhook event')
}

/** Subscription events carry the subscription itself; invoice events point at it. */
function subscriptionIdOf(event: PaymentsEvent): string | undefined {
  if (event.type.startsWith('customer.subscription.')) return event.data.object.id
  if (event.type.startsWith('invoice.')) return event.data.object.subscription
  return undefined
}
