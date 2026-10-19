function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

export const config = {
  port: Number(process.env.PORT ?? 3003),
  databaseUrl: required('DATABASE_URL'),
  webOrigin: required('WEB_ORIGIN'),
  authIssuer: required('AUTH_ISSUER'),
  authJwksUrl: required('AUTH_JWKS_URL'),
  /** `aud` of user tokens (the same media-api tokens the web app sends to the api). */
  userAudience: required('AUTH_AUDIENCE'),
  /** `aud` of service tokens: only the entitlement lookup accepts these (ADR 0010). */
  serviceAudience: required('SERVICE_AUDIENCE'),
  /** The one service account allowed to ask "is user X entitled?" (the MCP server's). */
  entitlementCaller: required('ENTITLEMENT_CALLER'),
  payments: {
    apiUrl: required('PAYMENTS_API_URL'),
    apiKey: required('PAYMENTS_API_KEY'),
    webhookSecret: required('PAYMENTS_WEBHOOK_SECRET'),
  },
  /** The one plan on sale. It includes MCP. */
  plan: 'pro',
  /** Webhooks older than this are refused, so a captured request cannot be replayed later. */
  webhookToleranceSeconds: 300,
  webhookBodyLimitBytes: 64 * 1024,
}
