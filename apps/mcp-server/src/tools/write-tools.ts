import { type McpServer, requireScopes } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import { apiClient } from '../adapters/api-client.js'
import { audited } from './audit.js'
import { callerOf } from './caller.js'
import { toToolResult } from './tool-support.js'

// Likes and follows are states (PUT again = no change) and can be undone in the app, which is why
// they are the only writes offered. Upload, delete and visibility are left out on purpose: a
// model could publish a private file, which sends it to the AI provider (ADR 0009, ADR 0008).
const REVERSIBLE_WRITE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const
const needsWriteScope = requireScopes('mcp:write')

export function registerWriteTools(server: McpServer) {
  server.registerTool(
    'like_file',
    {
      description: 'Like a published file. Repeating it changes nothing.',
      inputSchema: z.object({ fileId: z.uuid() }),
      annotations: REVERSIBLE_WRITE,
      scopeChallenge: needsWriteScope,
    },
    async ({ fileId }, ctx) =>
      audited('like_file', ctx, { fileId }, () =>
        toToolResult(() => apiClient.put(callerOf(ctx), `/files/${fileId}/like`)),
      ),
  )

  server.registerTool(
    'follow_user',
    {
      description: 'Follow a user by username. Repeating it changes nothing.',
      inputSchema: z.object({ username: z.string().min(1).max(64) }),
      annotations: REVERSIBLE_WRITE,
      scopeChallenge: needsWriteScope,
    },
    async ({ username }, ctx) =>
      audited('follow_user', ctx, { username }, () =>
        toToolResult(() => apiClient.put(callerOf(ctx), `/users/${encodeURIComponent(username)}/follow`)),
      ),
  )
}
