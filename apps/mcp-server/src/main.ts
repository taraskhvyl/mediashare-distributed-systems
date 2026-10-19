import { createTokenVerifier } from '@mediashare/auth'
import { config } from './config.js'
import { startMcpServer } from './http/server.js'
import { logger } from './log.js'

// Composition root: builds the parts and connects them. No logic of its own.
async function main() {
  const server = await startMcpServer({
    verifyAuthorizationHeader: createTokenVerifier({
      issuer: config.authIssuer,
      audience: config.authAudience,
      jwksUrl: config.authJwksUrl,
    }),
    log: logger,
  })

  const shutdown = async () => {
    await server.close()
    process.exit(0)
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

main().catch((err) => {
  logger.error({ err }, 'fatal startup error')
  process.exit(1)
})
