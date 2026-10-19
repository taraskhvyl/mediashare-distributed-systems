import type { FastifyInstance } from 'fastify'
import { config } from '../config.js'
import { handlePaymentsWebhook } from './service.js'

/**
 * Public endpoint the payments provider calls. No user token: the signature is the credential.
 * The body must stay a raw string, because the signature covers the exact bytes sent.
 */
export async function webhookRoutes(app: FastifyInstance) {
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_req, body, done) => done(null, body))

  app.post('/payments', { bodyLimit: config.webhookBodyLimitBytes }, async (req) => {
    const signature = req.headers['payments-signature'] as string | undefined
    const outcome = await handlePaymentsWebhook(req.body as string, signature)
    req.log.info({ outcome }, 'payments webhook handled')
    return { received: true, outcome }
  })
}
