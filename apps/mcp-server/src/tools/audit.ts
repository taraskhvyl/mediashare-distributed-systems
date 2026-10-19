// Audit trail of tool calls: who ran what, with which arguments (hashed), and how it ended.
// Goes to the structured log, so it lands in Loki next to the trace of the same request.
import { createHash } from 'node:crypto'
import { logger } from '../log.js'
import { callerOf, type ToolContext } from './caller.js'

/**
 * Runs a tool call and records it. Arguments are logged as a SHA-256 only: enough to tell
 * "the same call again" or to match a suspect call to a known one, without copying user
 * input into the log.
 */
export async function audited<Result extends object>(
  tool: string,
  ctx: ToolContext,
  toolArguments: unknown,
  run: () => Promise<Result>,
): Promise<Result> {
  const caller = callerOf(ctx)
  const startedAt = Date.now()
  const entry = {
    event: 'mcp.tool_call',
    tool,
    userId: caller.userId,
    username: caller.username,
    argsSha256: createHash('sha256').update(JSON.stringify(toolArguments)).digest('hex'),
  }
  try {
    const result = await run()
    const outcome = 'isError' in result && result.isError ? 'tool_error' : 'ok'
    logger.info({ ...entry, outcome, durationMs: Date.now() - startedAt }, 'mcp tool call')
    return result
  } catch (err) {
    logger.warn({ ...entry, outcome: 'failed', durationMs: Date.now() - startedAt }, 'mcp tool call')
    throw err
  }
}
