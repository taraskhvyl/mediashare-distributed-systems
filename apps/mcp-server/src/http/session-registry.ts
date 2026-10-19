import type { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node'
import type { McpServer } from '@modelcontextprotocol/server'

const MAX_SESSIONS = 100
const IDLE_TIMEOUT_MS = 30 * 60 * 1000
const SWEEP_INTERVAL_MS = 60 * 1000

export interface McpSession {
  transport: NodeStreamableHTTPServerTransport
  server: McpServer
  /** Keycloak `sub` of the user who initialized the session: only they may use it. */
  ownerId: string
  lastActiveAt: number
}

/**
 * Registry of live MCP sessions (Mcp-Session-Id -> transport + the user it belongs to).
 *
 * Scalability limit: sessions live in this process's memory. With more than one replica a request
 * can land on a replica that has no such session and gets a 404. Fix: route by Mcp-Session-Id
 * (consistent-hash load balancing in Envoy), or move session state to a shared store. ADR 0009.
 */
export class SessionRegistry {
  private readonly sessions = new Map<string, McpSession>()
  private readonly sweeper = setInterval(() => this.closeIdleSessions(), SWEEP_INTERVAL_MS)

  constructor() {
    this.sweeper.unref()
  }

  get isFull() {
    return this.sessions.size >= MAX_SESSIONS
  }

  get(sessionId: string) {
    return this.sessions.get(sessionId)
  }

  add(sessionId: string, session: McpSession) {
    this.sessions.set(sessionId, session)
  }

  remove(sessionId: string) {
    this.sessions.delete(sessionId)
  }

  async closeAll() {
    clearInterval(this.sweeper)
    await Promise.all([...this.sessions.values()].map((s) => s.transport.close()))
  }

  private closeIdleSessions() {
    const cutoff = Date.now() - IDLE_TIMEOUT_MS
    for (const session of this.sessions.values()) {
      if (session.lastActiveAt < cutoff) void session.transport.close()
    }
  }
}
