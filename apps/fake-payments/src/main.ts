import Fastify from 'fastify'
import { checkoutPageRoutes } from './checkout-page.js'
import { config } from './config.js'
import { controlRoutes } from './control-api.js'
import { providerApiRoutes } from './provider-api.js'

// Composition root. DEV ONLY: a stand-in for an external payments provider (Stripe-shaped).
async function main() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' } })
  app.get('/healthz', async () => ({ ok: true }))
  await app.register(providerApiRoutes, { prefix: '/v1' })
  await app.register(controlRoutes, { prefix: '/control' })
  await app.register(checkoutPageRoutes)
  await app.listen({ port: config.port, host: '0.0.0.0' })
}

main().catch((err) => {
  console.error('fatal startup error', err)
  process.exit(1)
})
