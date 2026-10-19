import cors from '@fastify/cors'
import { FastifyOtelInstrumentation } from '@fastify/otel'
import Fastify, { type FastifyError, type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { postgresPing } from '../adapters/postgres.js'
import { config } from '../config.js'
import { entitlementRoutes } from '../entitlements/routes.js'
import { DomainError, type DomainErrorCode } from '../errors.js'
import { subscriptionRoutes } from '../subscriptions/routes.js'
import { webhookRoutes } from '../webhooks/routes.js'
import { authenticateEntitlementCaller, authenticateUser } from './auth.js'

// The one place that knows how a domain failure looks in HTTP.
const STATUS_BY_ERROR_CODE: Record<DomainErrorCode, number> = {
  bad_request: 400,
  bad_signature: 400,
  invalid_state: 409,
  // 503 makes the payments provider retry the webhook later.
  provider_unavailable: 503,
}

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info', redact: ['req.headers.authorization'] },
  })
  await app.register(new FastifyOtelInstrumentation().plugin())

  registerHealthChecks(app)
  app.setErrorHandler(handleError)

  // CORS for the web app's calls to /v1/billing. The webhook and /internal are not for browsers.
  await app.register(cors, {
    origin: config.webOrigin,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Authorization', 'Content-Type', 'traceparent'],
    maxAge: 600,
  })

  await app.register(userBillingRoutes, { prefix: '/v1/billing' })
  await app.register(internalRoutes, { prefix: '/internal' })
  await app.register(webhookRoutes, { prefix: '/webhooks' })
  return app
}

async function userBillingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticateUser)
  await app.register(subscriptionRoutes)
}

async function internalRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticateEntitlementCaller)
  await app.register(entitlementRoutes)
}

function registerHealthChecks(app: FastifyInstance) {
  app.get('/healthz', async () => ({ ok: true }))
  app.get('/readyz', async (_req, reply) => {
    try {
      await postgresPing()
      return { ok: true }
    } catch {
      return reply.code(503).send({ ok: false })
    }
  })
}

function handleError(err: FastifyError, req: FastifyRequest, reply: FastifyReply) {
  if (err instanceof DomainError) {
    return reply.code(STATUS_BY_ERROR_CODE[err.code]).send({ error: { code: err.code, message: err.message } })
  }
  const isClientError = err.statusCode !== undefined && err.statusCode >= 400 && err.statusCode < 500
  if (isClientError) {
    return reply.code(err.statusCode!).send({ error: { code: 'bad_request', message: err.message } })
  }
  req.log.error({ err }, 'unhandled error')
  return reply.code(500).send({ error: { code: 'internal', message: 'Internal server error' } })
}
