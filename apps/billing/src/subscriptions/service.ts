import { createCheckoutSession } from '../adapters/payments-client.js'
import { config } from '../config.js'
import { DomainError } from '../errors.js'
import { isEntitled } from './entitlement.js'
import { findByUserId } from './repository.js'

export interface SubscriptionView {
  plan: string
  status: string
  currentPeriodEnd: string
  cancelAtPeriodEnd: boolean
  /** Whether the plan's features (MCP) are on right now. */
  entitled: boolean
}

/** The caller's own subscription, or null if they never subscribed. */
export async function getOwnSubscription(userId: string): Promise<SubscriptionView | null> {
  const row = await findByUserId(userId)
  if (!row) return null
  return {
    plan: row.plan,
    status: row.status,
    currentPeriodEnd: row.currentPeriodEnd.toISOString(),
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    entitled: isEntitled(row.status),
  }
}

/** Starts a checkout and returns the provider's hosted page URL. */
export async function startCheckout(userId: string): Promise<{ url: string }> {
  const existing = await findByUserId(userId)
  if (existing && isEntitled(existing.status)) {
    throw new DomainError('invalid_state', 'Already subscribed')
  }
  // Both return to the Plan page; the web app polls for the webhook's result after a success.
  const url = await createCheckoutSession(userId, config.plan, {
    success: `${config.webOrigin}/`,
    cancel: `${config.webOrigin}/`,
  })
  return { url }
}
