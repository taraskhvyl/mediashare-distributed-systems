import { randomUUID } from 'node:crypto'
import { AuthError, type AuthenticatedUser, type TokenVerifier } from '@mediashare/auth'
import { createMcpFastifyApp } from '@modelcontextprotocol/fastify'
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node'
import { isInitializeRequest } from '@modelcontextprotocol/server'
import { trace } from '@opentelemetry/api'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { Logger } from 'pino'
import { config } from '../config.js'
import { buildMcpServer } from '../tools/index.js'
import { SessionRegistry } from './session-registry.js'

const MCP_PATH = new URL(config.resourceUrl).pathname
const METADATA_PATH = '/.well-known/oauth-protected-resource'
// Scope named in the 401 challenge: the minimum to use the server at all (spec: least privilege).
const BASE_SCOPE = 'mcp:read'
// Not everyone in the realm may use MCP: a Keycloak realm role grants it. Enforced here because
// a Keycloak client scope cannot be tied to a role. Admins are not exempt; give the role to who needs it.
const REQUIRED_ROLE = 'mcp-user'

interface ServerDeps {
  verifyAuthorizationHeader: TokenVerifier
  log: Logger
}

export async function startMcpServer({ verifyAuthorizationHeader, log }: ServerDeps) {
  const registry = new SessionRegistry()
  // Host validation (DNS-rebinding guard) must know the public host Envoy forwards, plus the
  // loopback names the container healthcheck uses.
  const app = createMcpFastifyApp({
    host: '0.0.0.0',
    allowedHosts: [new URL(config.resourceUrl).hostname, 'localhost', '127.0.0.1'],
  })

  app.get('/healthz', async () => ({ status: 'ok' }))

  // RFC 9728: tells a client which authorization server issues tokens for this resource.
  // Served at the root path and at the path-inserted form clients derive from the resource URL.
  const metadata = {
    resource: config.resourceUrl,
    authorization_servers: [config.authIssuer],
    scopes_supported: ['mcp:read', 'mcp:write'],
    bearer_methods_supported: ['header'],
  }
  app.get(METADATA_PATH, async () => metadata)
  app.get(`${METADATA_PATH}${MCP_PATH}`, async () => metadata)

  app.all(MCP_PATH, async (req, reply) => {
    const user = await authenticate(req, reply, verifyAuthorizationHeader)
    if (!user) return
    if (!user.roles.includes(REQUIRED_ROLE)) {
      // Same stream as the tool-call audit log: a denied attempt is worth seeing too.
      log.warn(
        { event: 'mcp.access_denied', userId: user.id, username: user.username, missingRole: REQUIRED_ROLE },
        'mcp access denied',
      )
      return reply.code(403).send({ error: { code: 'forbidden', message: `Missing role ${REQUIRED_ROLE}` } })
    }
    await routeToSession(req, reply, user, registry)
  })

  await app.listen({ port: config.port, host: '0.0.0.0' })
  log.info({ port: config.port, resource: config.resourceUrl }, 'mcp server started')
  return {
    close: async () => {
      await registry.closeAll()
      await app.close()
    },
  }
}

/** The token is checked on every request: a session id is never a credential (MCP spec). */
async function authenticate(req: FastifyRequest, reply: FastifyReply, verify: TokenVerifier) {
  try {
    return await verify(req.headers.authorization)
  } catch (err) {
    if (!(err instanceof AuthError)) throw err
    const challenge = `Bearer resource_metadata="${config.resourceMetadataUrl}", scope="${BASE_SCOPE}"`
    await reply
      .code(401)
      .header('WWW-Authenticate', challenge)
      .send({ error: { code: err.code, message: err.message } })
    return undefined
  }
}

async function routeToSession(
  req: FastifyRequest,
  reply: FastifyReply,
  user: AuthenticatedUser,
  registry: SessionRegistry,
) {
  const sessionId = req.headers['mcp-session-id'] as string | undefined
  const session = sessionId ? registry.get(sessionId) : undefined
  // Handed to the SDK as the request's `auth`; tool handlers read it as ctx.http.authInfo.
  const authInfo = {
    token: user.token,
    clientId: user.id,
    scopes: user.scopes,
    expiresAt: user.expiresAt,
    extra: { username: user.username },
  }
  const rawWithAuth = Object.assign(req.raw, { auth: authInfo })

  // A session belongs to the user who created it. Same answer as "unknown id", so a leaked id
  // does not even confirm that the session exists.
  const sessionOfSomeoneElse = session !== undefined && session.ownerId !== user.id
  if (sessionOfSomeoneElse || (sessionId && !session)) {
    return reply.code(404).send(jsonRpcError(-32001, 'Session not found'))
  }

  if (session) {
    session.lastActiveAt = Date.now()
    annotateSpan(user, sessionId, session.server.server.getClientVersion())
    reply.hijack() // the transport writes the response itself
    return session.transport.handleRequest(rawWithAuth, reply.raw, req.body)
  }

  if (!isInitializeRequest(req.body)) {
    return reply.code(400).send(jsonRpcError(-32000, 'Session ID required'))
  }
  if (registry.isFull) {
    return reply.code(503).send(jsonRpcError(-32000, 'Too many open sessions'))
  }

  const server = buildMcpServer()
  const transport: NodeStreamableHTTPServerTransport = new NodeStreamableHTTPServerTransport({
    sessionIdGenerator: randomUUID,
    onsessioninitialized: (id) => registry.add(id, { transport, server, ownerId: user.id, lastActiveAt: Date.now() }),
  })
  transport.onclose = () => {
    if (transport.sessionId) registry.remove(transport.sessionId)
  }
  await server.connect(transport)
  reply.hijack()
  return transport.handleRequest(rawWithAuth, reply.raw, req.body)
}

/** Which AI app is calling, for analytics. clientInfo is self-reported: never use it for access decisions. */
function annotateSpan(
  user: AuthenticatedUser,
  sessionId: string | undefined,
  clientInfo?: { name: string; version: string },
) {
  trace.getActiveSpan()?.setAttributes({
    'enduser.id': user.id,
    'mcp.session.id': sessionId ?? '',
    'mcp.client.name': clientInfo?.name ?? 'unknown',
    'mcp.client.version': clientInfo?.version ?? 'unknown',
  })
}

function jsonRpcError(code: number, message: string) {
  return { jsonrpc: '2.0', error: { code, message }, id: null }
}
