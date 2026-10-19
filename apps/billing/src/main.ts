import { pool } from './adapters/postgres.js'
import { config } from './config.js'
import { buildApp } from './http/app.js'

// Composition root: builds the app, starts it, stops it. No logic.
async function main() {
  const app = await buildApp()
  await app.listen({ port: config.port, host: '0.0.0.0' })

  const shutdown = async () => {
    await app.close()
    await pool.end()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch((err) => {
  console.error('fatal startup error', err)
  process.exit(1)
})
