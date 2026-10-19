import { type McpServer, requireScopes } from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import { apiClient } from '../adapters/api-client.js'
import { audited } from './audit.js'
import { callerOf } from './caller.js'
import { jsonResult, MAX_PAGE_SIZE, toToolResult, UNTRUSTED_TEXT_NOTE } from './tool-support.js'

const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const
const needsReadScope = requireScopes('mcp:read')

export function registerReadTools(server: McpServer) {
  server.registerTool(
    'whoami',
    { description: 'The signed-in user this session acts as.', annotations: READ_ONLY, scopeChallenge: needsReadScope },
    async (ctx) =>
      audited('whoami', ctx, {}, async () => {
        const caller = callerOf(ctx)
        return jsonResult({ userId: caller.userId, username: caller.username })
      }),
  )

  server.registerTool(
    'list_feed',
    {
      description: `Newest published files from users you follow. ${UNTRUSTED_TEXT_NOTE}`,
      inputSchema: z.object({
        limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(10),
        cursor: z.string().max(200).optional().describe('nextCursor from the previous page'),
      }),
      annotations: READ_ONLY,
      scopeChallenge: needsReadScope,
    },
    async ({ limit, cursor }, ctx) =>
      audited('list_feed', ctx, { limit, cursor }, async () => {
        const query = new URLSearchParams({ limit: String(limit) })
        if (cursor) query.set('cursor', cursor)
        return toToolResult(() => apiClient.get(callerOf(ctx), `/feed?${query}`))
      }),
  )

  server.registerTool(
    'list_my_files',
    {
      description: `Your own files, any visibility. ${UNTRUSTED_TEXT_NOTE}`,
      annotations: READ_ONLY,
      scopeChallenge: needsReadScope,
    },
    async (ctx) => audited('list_my_files', ctx, {}, () => toToolResult(() => apiClient.get(callerOf(ctx), '/files'))),
  )

  server.registerTool(
    'get_file',
    {
      description: `One file you may read (your own, or a published one). ${UNTRUSTED_TEXT_NOTE}`,
      inputSchema: z.object({ fileId: z.uuid() }),
      annotations: READ_ONLY,
      scopeChallenge: needsReadScope,
    },
    async ({ fileId }, ctx) =>
      audited('get_file', ctx, { fileId }, () => toToolResult(() => apiClient.get(callerOf(ctx), `/files/${fileId}`))),
  )
}
