// What happens to a subscription, and which events the provider emits for it.
import { createSubscription, newEvent, newInvoiceId, type Subscription } from './state.js'
import { send } from './webhook-sender.js'

/** A completed checkout: a new active subscription, announced like Stripe does. */
export function startSubscription(userId: string, plan: string): Subscription {
  const subscription = createSubscription(userId, plan)
  send(newEvent('customer.subscription.created', { ...subscription }))
  send(
    newEvent('invoice.paid', { id: newInvoiceId(), object: 'invoice', subscription: subscription.id, status: 'paid' }),
  )
  return subscription
}

interface Change {
  status: string
  cancelAtPeriodEnd?: boolean
  /** false = change the state but send no webhook, i.e. a lost notification. */
  announce: boolean
}

/** Changes the subscription at the provider and (normally) announces it. */
export function changeSubscription(subscription: Subscription, { status, cancelAtPeriodEnd, announce }: Change) {
  subscription.status = status
  if (cancelAtPeriodEnd !== undefined) subscription.cancel_at_period_end = cancelAtPeriodEnd
  if (!announce) return

  if (status === 'canceled') {
    send(newEvent('customer.subscription.deleted', { ...subscription }))
  } else if (status === 'past_due') {
    send(
      newEvent('invoice.payment_failed', {
        id: newInvoiceId(),
        object: 'invoice',
        subscription: subscription.id,
        status: 'open',
      }),
    )
  } else {
    send(newEvent('customer.subscription.updated', { ...subscription }))
  }
}
