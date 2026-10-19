// Dev-only levers to provoke what a real provider does on a bad day. Used by the demo and by hand.
import type { FastifyInstance } from 'fastify'
import { config } from './config.js'
import { changeSubscription } from './lifecycle.js'
import { deliveriesOf, findEvent, findSubscriptionByUser, listEvents } from './state.js'
import { release, resend, startHolding } from './webhook-sender.js'

interface ChangeBody {
  status: string
  cancel_at_period_end?: boolean
  announce?: boolean
}

export async function controlRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req, reply) => {
    if (req.headers['x-control-key'] !== config.controlKey)
      return reply.code(401).send({ error: 'invalid control key' })
  })

  // Change a user's subscription. `announce: false` = the provider changed state but the webhook is lost.
  app.post('/users/:userId/subscription', async (req, reply) => {
    const subscription = findSubscriptionByUser((req.params as { userId: string }).userId)
    if (!subscription) return reply.code(404).send({ error: 'no subscription for user' })
    const body = req.body as ChangeBody
    changeSubscription(subscription, {
      status: body.status,
      cancelAtPeriodEnd: body.cancel_at_period_end,
      announce: body.announce ?? true,
    })
    return subscription
  })

  // Send an event again with the same id: at-least-once delivery.
  app.post('/events/:id/replay', async (req, reply) => {
    const event = findEvent((req.params as { id: string }).id)
    if (!event) return reply.code(404).send({ error: 'no such event' })
    resend(event)
    return { replayed: event.id }
  })

  // Queue events instead of sending, then release them (optionally newest first): reordering.
  app.post('/hold', async () => {
    startHolding()
    return { holding: true }
  })
  app.post('/release', async (req) => {
    const reverse = (req.body as { reverse?: boolean } | undefined)?.reverse ?? false
    return { released: release(reverse).map((event) => event.id) }
  })

  app.get('/events', async () => ({
    events: listEvents().map(({ id, type, created }) => ({ id, type, created, deliveries: deliveriesOf(id) })),
  }))
}
