import { McpServer } from '@modelcontextprotocol/server'
import { registerReadTools } from './read-tools.js'
import { registerWriteTools } from './write-tools.js'

/** One McpServer per client session; the tool set is the same for everyone, scopes decide who may call what. */
export function buildMcpServer() {
  const server = new McpServer({ name: 'mediashare', version: '1.0.0' })
  registerReadTools(server)
  registerWriteTools(server)
  return server
}
