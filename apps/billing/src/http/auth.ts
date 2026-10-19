import { AuthError, createTokenVerifier } from '@mediashare/auth'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { config } from '../config.js'

// Two kinds of callers, two audiences, two verifiers (ADR 0010):
// users (the web app, `media-api` tokens) and services (the MCP server, `media-billing` tokens).
const verifyUserToken = createTokenVerifier({
  issuer: config.authIssuer,
  audience: config.userAudience,
  jwksUrl: config.authJwksUrl,
})
const verifyServiceToken = createTokenVerifier({
  issuer: config.authIssuer,
  audience: config.serviceAudience,
  jwksUrl: config.authJwksUrl,
})

function unauthorized(reply: FastifyReply, err: unknown, status: 401 | 403 = 401) {
  if (!(err instanceof AuthError)) throw err
  return reply.code(status).send({ error: { code: err.code, message: err.message } })
}

/** Hook for /v1/billing: a signed-in user. */
export async function authenticateUser(req: FastifyRequest, reply: FastifyReply) {
  try {
    const user = await verifyUserToken(req.headers.authorization)
    req.user = { id: user.id, username: user.username, roles: user.roles }
  } catch (err) {
    return unauthorized(reply, err)
  }
}

/** Hook for /internal: a valid service token, from the one service allowed to ask. */
export async function authenticateEntitlementCaller(req: FastifyRequest, reply: FastifyReply) {
  try {
    const caller = await verifyServiceToken(req.headers.authorization)
    // A service-account token's username is `service-account-<client id>`. Another client that
    // obtains a media-billing token must still be refused.
    if (caller.username !== config.entitlementCaller) {
      return reply.code(403).send({ error: { code: 'forbidden', message: 'Caller not allowed' } })
    }
  } catch (err) {
    return unauthorized(reply, err)
  }
}
