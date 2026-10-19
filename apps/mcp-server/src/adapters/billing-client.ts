// Adapter around the billing service: "may this user use MCP?" (ADR 0010).
// Billing is asked as a service: a client-credentials token (aud = media-billing) names the caller,
// the user id comes from the already verified MCP token.
import { config } from '../config.js'

// Drop a cached token this long before it expires, so a request never starts with a dying one.
const EXPIRY_MARGIN_MS = 30_000
// How long a "yes" is reused: the delay between a cancellation (once billing has processed it)
// and MCP access ending. Short on purpose. A "no" is never cached, so a user who has just paid
// gets in on the next request instead of waiting out the TTL.
const ENTITLEMENT_TTL_MS = 30_000

let serviceToken: { value: string; validUntilMs: number } | undefined
// Scalability: both caches are per process; more replicas only cost extra calls. The entitlement
// map is never evicted except by expiry: bound it (LRU) before many users.
const entitledUntilMs = new Map<string, number>()

async function getServiceToken(): Promise<string> {
  if (serviceToken && serviceToken.validUntilMs > Date.now()) return serviceToken.value

  const credentials = Buffer.from(`${config.billingClientId}:${config.billingClientSecret}`).toString('base64')
  const response = await fetch(config.keycloakTokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${credentials}` },
    body: new URLSearchParams({ grant_type: 'client_credentials' }),
    signal: AbortSignal.timeout(5000),
  })
  if (!response.ok) throw new Error(`Billing service token failed: HTTP ${response.status}`)
  const body = (await response.json()) as { access_token: string; expires_in: number }
  serviceToken = { value: body.access_token, validUntilMs: Date.now() + body.expires_in * 1000 - EXPIRY_MARGIN_MS }
  return body.access_token
}

/**
 * Fails closed: if billing or Keycloak cannot be reached, nobody gets in. Not cached, so the
 * next request tries again. A paying user briefly locked out beats a free user let in.
 */
export async function isEntitled(userId: string): Promise<boolean> {
  if ((entitledUntilMs.get(userId) ?? 0) > Date.now()) return true

  try {
    const response = await fetch(`${config.billingUrl}/internal/entitlements/${encodeURIComponent(userId)}`, {
      headers: { authorization: `Bearer ${await getServiceToken()}` },
      signal: AbortSignal.timeout(3000),
    })
    if (!response.ok) return false
    const { entitled } = (await response.json()) as { entitled: boolean }
    if (entitled) entitledUntilMs.set(userId, Date.now() + ENTITLEMENT_TTL_MS)
    else entitledUntilMs.delete(userId)
    return entitled
  } catch {
    return false
  }
}
