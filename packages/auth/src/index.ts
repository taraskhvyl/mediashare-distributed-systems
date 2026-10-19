import { createRemoteJWKSet, jwtVerify } from 'jose'

const JWKS_CACHE_MS = 10 * 60 * 1000
const JWKS_REFETCH_COOLDOWN_MS = 30 * 1000
const CLOCK_TOLERANCE_S = 5
const BEARER_PREFIX = 'Bearer '

export interface TokenVerifierOptions {
  /** External issuer, must equal the token's `iss` claim. */
  issuer: string
  /**
   * The `aud` this service accepts. Required, so a service cannot forget it: without it a token
   * issued for another service (e.g. the MCP server) would be accepted here (ADR 0009).
   */
  audience: string
  /** Internal URL of the realm's public keys. */
  jwksUrl: string
}

export interface AuthenticatedUser {
  id: string
  /** Keycloak `preferred_username`; the api mirrors it into its `users` table. */
  username: string
  roles: string[]
  /** OAuth scopes granted to the client (the space-separated `scope` claim), e.g. `mcp:read`. */
  scopes: string[]
  /** The verified bearer token itself, for services that must act on the user's behalf (token exchange). */
  token: string
  /** Token expiry, epoch seconds. Long-lived connections must end by then. */
  expiresAt: number
}

export type AuthErrorCode = 'unauthorized' | 'invalid_token'

export class AuthError extends Error {
  constructor(
    readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message)
  }
}

/**
 * Verifies Keycloak access tokens locally: signature against the cached JWKS plus claims.
 * No call to Keycloak per request; unknown key ids trigger a JWKS refetch (key rotation).
 */
export function createTokenVerifier({ issuer, audience, jwksUrl }: TokenVerifierOptions) {
  const jwks = createRemoteJWKSet(new URL(jwksUrl), {
    cacheMaxAge: JWKS_CACHE_MS,
    cooldownDuration: JWKS_REFETCH_COOLDOWN_MS,
  })

  return async function verifyAuthorizationHeader(header: string | undefined): Promise<AuthenticatedUser> {
    if (!header?.startsWith(BEARER_PREFIX)) {
      throw new AuthError('unauthorized', 'Missing bearer token')
    }
    const token = header.slice(BEARER_PREFIX.length)

    try {
      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience,
        requiredClaims: ['exp', 'iat', 'iss', 'sub', 'preferred_username'],
        clockTolerance: CLOCK_TOLERANCE_S,
      })
      const realmAccess = payload.realm_access as { roles?: string[] } | undefined
      return {
        id: payload.sub as string,
        username: payload.preferred_username as string,
        roles: realmAccess?.roles ?? [],
        scopes: typeof payload.scope === 'string' ? payload.scope.split(' ') : [],
        token,
        expiresAt: payload.exp as number,
      }
    } catch {
      throw new AuthError('invalid_token', 'Token validation failed')
    }
  }
}

export type TokenVerifier = ReturnType<typeof createTokenVerifier>
