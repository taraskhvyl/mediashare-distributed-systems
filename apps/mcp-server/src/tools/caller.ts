// Reads the verified caller that http/server.ts attached to the request (ctx.http.authInfo).
import type { Caller } from './tool-support.js'

export interface ToolContext {
  http?: { authInfo?: { token: string; clientId: string; extra?: Record<string, unknown> } }
}

export function callerOf(ctx: ToolContext): Caller {
  const authInfo = ctx.http?.authInfo
  if (!authInfo) throw new Error('Tool called without a verified caller')
  return { userId: authInfo.clientId, token: authInfo.token, username: String(authInfo.extra?.username) }
}
