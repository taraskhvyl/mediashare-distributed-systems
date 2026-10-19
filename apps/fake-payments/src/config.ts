function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

export const config = {
  port: Number(process.env.PORT ?? 3010),
  /** What billing authenticates with when it calls this provider's API. */
  apiKey: required('PAYMENTS_API_KEY'),
  /** Guards the /control API (dev only: it forges events and state). */
  controlKey: required('PAYMENTS_CONTROL_KEY'),
  webhookSecret: required('PAYMENTS_WEBHOOK_SECRET'),
  /** Where the browser sees this service's checkout page. */
  publicUrl: required('PAYMENTS_PUBLIC_URL'),
  /** Webhooks go through the real edge (Envoy), like a provider calling over the internet. */
  webhook: {
    gatewayHost: required('WEBHOOK_GATEWAY_HOST'),
    publicHostName: required('WEBHOOK_PUBLIC_HOST'),
    path: '/webhooks/payments',
    maxAttempts: 5,
    firstRetryDelayMs: 1000,
  },
  periodSeconds: 30 * 24 * 3600,
}
