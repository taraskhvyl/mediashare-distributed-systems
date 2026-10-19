// The billing service's endpoints, behind the api origin (/v1/billing). HTTP only.
import { request } from '@/adapters/http'

export interface Subscription {
  plan: string
  status: string
  currentPeriodEnd: string
  cancelAtPeriodEnd: boolean
  /** Whether MCP (the plan's feature) is on right now. */
  entitled: boolean
}

/** null = this user never subscribed. */
export async function getSubscription() {
  const { subscription } = await request<{ subscription: Subscription | null }>('GET', '/billing/subscription')
  return subscription
}

/** The provider's hosted checkout page; the browser is sent there. */
export async function startCheckout() {
  const { url } = await request<{ url: string }>('POST', '/billing/checkout')
  return url
}
