// State and actions for the Plan page. After paying, the provider's webhook reaches billing a
// moment later than the browser's redirect, so the page polls until the subscription shows up.
import { useCallback, useEffect, useState } from 'react'
import { reportError, reportSuccess } from '@/features/log/report'
import * as billingApi from './billing-api'

// Survives the round trip to the provider's page (JS memory does not).
const CHECKOUT_PENDING_KEY = 'checkout-pending'
const POLL_INTERVAL_MS = 1000
const POLL_ATTEMPTS = 15

export const isCheckoutPending = () => sessionStorage.getItem(CHECKOUT_PENDING_KEY) !== null

export function useBilling() {
  const [subscription, setSubscription] = useState<billingApi.Subscription | null | undefined>(undefined)
  const [isWaitingForPayment, setWaitingForPayment] = useState(isCheckoutPending())

  const refresh = useCallback(() => billingApi.getSubscription().then(setSubscription).catch(reportError), [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    if (!isWaitingForPayment) return
    let attempts = 0
    const timer = setInterval(async () => {
      attempts++
      const latest = await billingApi.getSubscription().catch(() => null)
      if (latest?.entitled) {
        setSubscription(latest)
        reportSuccess('Subscription active')
      }
      if (latest?.entitled || attempts >= POLL_ATTEMPTS) {
        sessionStorage.removeItem(CHECKOUT_PENDING_KEY)
        setWaitingForPayment(false)
        clearInterval(timer)
      }
    }, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [isWaitingForPayment])

  async function subscribe() {
    try {
      const url = await billingApi.startCheckout()
      sessionStorage.setItem(CHECKOUT_PENDING_KEY, '1')
      location.assign(url)
    } catch (err) {
      reportError(err)
    }
  }

  return { subscription, isWaitingForPayment, subscribe, refresh }
}
