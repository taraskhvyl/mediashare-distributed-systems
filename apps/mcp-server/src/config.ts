function required(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

// For this service AUTH_AUDIENCE is the public URL of the MCP endpoint: the one `aud` it accepts
// (RFC 8707 "resource"). The api's `media-api` token is a different audience (ADR 0009).
const resourceUrl = required('AUTH_AUDIENCE')

export const config = {
  port: Number(process.env.PORT ?? 3002),
  authIssuer: required('AUTH_ISSUER'),
  authAudience: resourceUrl,
  authJwksUrl: required('AUTH_JWKS_URL'),
  /** Where clients fetch RFC 9728 metadata; advertised in the 401 challenge. */
  resourceMetadataUrl: `${new URL(resourceUrl).origin}/.well-known/oauth-protected-resource${new URL(resourceUrl).pathname}`,
  resourceUrl,
  keycloakTokenUrl: required('KEYCLOAK_TOKEN_URL'),
  keycloakClientId: required('MCP_CLIENT_ID'),
  keycloakClientSecret: required('MCP_CLIENT_SECRET'),
  /** Keycloak client name of the api, the target audience of the token exchange. */
  apiAudience: required('API_AUDIENCE'),
  apiUrl: required('API_URL'),
}
