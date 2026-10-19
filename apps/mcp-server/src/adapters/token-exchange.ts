// Adapter around Keycloak's standard token exchange (RFC 8693).
// Trades the user's MCP token (aud = this server) for a media-api token for the same user, so the
// MCP token is never sent to the api and the api token is never handed to the MCP client.
import { config } from '../config.js'

const SUBJECT_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token'
const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange'
// Drop a cached token this long before it expires, so a request never starts with a dying one.
const EXPIRY_MARGIN_MS = 30_000

export interface ExchangeSubject {
  /** Keycloak `sub`: the cache key. */
  userId: string
  /** The verified MCP access token to exchange. */
  token: string
}

interface CachedToken {
  apiToken: string
  validUntilMs: number
}

// Scalability: per-process cache. Each replica exchanges once per user per token lifetime;
// nothing breaks with more replicas, it only costs one extra Keycloak call each.
// Never evicted except by expiry: fine for a dev stack, bound it (LRU) before many users.
const cache = new Map<string, CachedToken>()

export async function exchangeForApiToken(subject: ExchangeSubject): Promise<string> {
  const cached = cache.get(subject.userId)
  if (cached && cached.validUntilMs > Date.now()) return cached.apiToken

  const response = await fetch(config.keycloakTokenUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${Buffer.from(`${config.keycloakClientId}:${config.keycloakClientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: TOKEN_EXCHANGE_GRANT,
      subject_token: subject.token,
      subject_token_type: SUBJECT_TOKEN_TYPE,
      requested_token_type: SUBJECT_TOKEN_TYPE,
      audience: config.apiAudience,
    }),
  })
  if (!response.ok) throw new Error(`Token exchange failed: HTTP ${response.status}`)

  const body = (await response.json()) as { access_token: string; expires_in: number }
  cache.set(subject.userId, {
    apiToken: body.access_token,
    validUntilMs: Date.now() + body.expires_in * 1000 - EXPIRY_MARGIN_MS,
  })
  return body.access_token
}
