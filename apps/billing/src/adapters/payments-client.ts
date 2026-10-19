// Adapter around the payments provider's HTTP API (in this repo: apps/fake-payments, shaped like
// Stripe's). Billing never trusts a webhook's payload for state: it asks the provider.
import { config } from '../config.js'
import { DomainError } from '../errors.js'

export interface ProviderSubscription {
  id: string
  status: string
  plan: string
  /** Unix seconds, like Stripe. */
  currentPeriodEnd: number
  cancelAtPeriodEnd: boolean
  /** Who the subscription belongs to: set by us when the checkout session was created. */
  userId: string | undefined
}

interface ProviderSubscriptionResponse {
  id: string
  status: string
  plan: string
  current_period_end: number
  cancel_at_period_end: boolean
  metadata: { user_id?: string }
}

async function callProvider(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> {
  try {
    return await fetch(`${config.payments.apiUrl}${path}`, {
      method,
      headers: { authorization: `Bearer ${config.payments.apiKey}`, 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    })
  } catch {
    // The provider retries the webhook on a 5xx, so an outage here heals itself.
    throw new DomainError('provider_unavailable', 'Payments provider unreachable')
  }
}

export async function fetchSubscription(subscriptionId: string): Promise<ProviderSubscription> {
  const response = await callProvider('GET', `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`)
  if (!response.ok) throw new DomainError('provider_unavailable', `Provider answered HTTP ${response.status}`)
  const body = (await response.json()) as ProviderSubscriptionResponse
  return {
    id: body.id,
    status: body.status,
    plan: body.plan,
    currentPeriodEnd: body.current_period_end,
    cancelAtPeriodEnd: body.cancel_at_period_end,
    userId: body.metadata.user_id,
  }
}

/** Starts a hosted checkout for the user; the browser is sent to the returned URL. */
export async function createCheckoutSession(
  userId: string,
  plan: string,
  urls: { success: string; cancel: string },
): Promise<string> {
  const response = await callProvider('POST', '/v1/checkout/sessions', {
    user_id: userId,
    plan,
    success_url: urls.success,
    cancel_url: urls.cancel,
  })
  if (!response.ok) throw new DomainError('provider_unavailable', `Provider answered HTTP ${response.status}`)
  return ((await response.json()) as { url: string }).url
}
