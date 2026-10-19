import type { FastifyInstance } from 'fastify'
import { isEntitled } from '../subscriptions/entitlement.js'
import { findByUserId } from '../subscriptions/repository.js'

const USER_ID_PARAMS = {
  type: 'object',
  properties: { userId: { type: 'string', minLength: 1, maxLength: 64 } },
  required: ['userId'],
} as const

/** "May this user use the plan's features?" Asked by other services (the MCP server), never by browsers. */
export async function entitlementRoutes(app: FastifyInstance) {
  app.get('/entitlements/:userId', { schema: { params: USER_ID_PARAMS } }, async (req) => {
    const { userId } = req.params as { userId: string }
    const row = await findByUserId(userId)
    return { entitled: row !== undefined && isEntitled(row.status) }
  })
}
