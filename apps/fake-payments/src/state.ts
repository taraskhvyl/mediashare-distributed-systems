// The provider's data, in memory (this is a stand-in for an external SaaS, not a design to copy).
// A restart forgets every subscription: billing's own table keeps the last state it saw.
import { randomUUID } from 'node:crypto'
import { config } from './config.js'

export interface CheckoutSession {
  id: string
  userId: string
  plan: string
  successUrl: string
  cancelUrl: string
}

export interface Subscription {
  id: string
  object: 'subscription'
  status: string
  plan: string
  current_period_end: number
  cancel_at_period_end: boolean
  metadata: { user_id: string }
}

export interface ProviderEvent {
  id: string
  type: string
  created: number
  data: { object: Record<string, unknown> }
}

const checkoutSessions = new Map<string, CheckoutSession>()
const subscriptions = new Map<string, Subscription>()
const sentEvents = new Map<string, ProviderEvent>()
/** How billing answered each delivery attempt of an event (status + the `outcome` it reports). */
const deliveries = new Map<string, { status: number; outcome?: string }[]>()

const newId = (prefix: string) => `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 20)}`
const nowSeconds = () => Math.floor(Date.now() / 1000)

export function createCheckoutSession(input: Omit<CheckoutSession, 'id'>): CheckoutSession {
  const session = { id: newId('cs'), ...input }
  checkoutSessions.set(session.id, session)
  return session
}

export const findCheckoutSession = (id: string) => checkoutSessions.get(id)

export function createSubscription(userId: string, plan: string): Subscription {
  const subscription: Subscription = {
    id: newId('sub'),
    object: 'subscription',
    status: 'active',
    plan,
    current_period_end: nowSeconds() + config.periodSeconds,
    cancel_at_period_end: false,
    metadata: { user_id: userId },
  }
  subscriptions.set(subscription.id, subscription)
  return subscription
}

export const findSubscription = (id: string) => subscriptions.get(id)

export const findSubscriptionByUser = (userId: string) =>
  [...subscriptions.values()].find((subscription) => subscription.metadata.user_id === userId)

export function newEvent(type: string, object: Record<string, unknown>): ProviderEvent {
  const event = { id: newId('evt'), type, created: nowSeconds(), data: { object } }
  sentEvents.set(event.id, event)
  return event
}

export function recordDelivery(eventId: string, status: number, outcome?: string) {
  deliveries.set(eventId, [...(deliveries.get(eventId) ?? []), { status, outcome }])
}

export const deliveriesOf = (eventId: string) => deliveries.get(eventId) ?? []
export const findEvent = (id: string) => sentEvents.get(id)
export const listEvents = () => [...sentEvents.values()]
export const newInvoiceId = () => newId('in')
