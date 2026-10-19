// The API billing calls (like api.stripe.com): create a checkout session, read a subscription.
import type { FastifyInstance } from 'fastify'
import { config } from './config.js'
import { createCheckoutSession, findSubscription } from './state.js'

interface CheckoutBody {
  user_id: string
  plan: string
  success_url: string
  cancel_url: string
}

export async function providerApiRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req, reply) => {
    if (req.headers.authorization !== `Bearer ${config.apiKey}`) {
      return reply.code(401).send({ error: 'invalid api key' })
    }
  })

  app.post('/checkout/sessions', async (req) => {
    const body = req.body as CheckoutBody
    const session = createCheckoutSession({
      userId: body.user_id,
      plan: body.plan,
      successUrl: body.success_url,
      cancelUrl: body.cancel_url,
    })
    return { id: session.id, url: `${config.publicUrl}/checkout/${session.id}` }
  })

  app.get('/subscriptions/:id', async (req, reply) => {
    const subscription = findSubscription((req.params as { id: string }).id)
    if (!subscription) return reply.code(404).send({ error: 'no such subscription' })
    return subscription
  })
}
