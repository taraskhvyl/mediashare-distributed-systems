import type { FastifyInstance } from 'fastify'
import * as subscriptions from './service.js'

/** The signed-in user's own billing: what the Plan page in the web app calls. */
export async function subscriptionRoutes(app: FastifyInstance) {
  app.get('/subscription', async (req) => ({
    subscription: await subscriptions.getOwnSubscription(req.user!.id),
  }))

  app.post('/checkout', async (req) => subscriptions.startCheckout(req.user!.id))
}
