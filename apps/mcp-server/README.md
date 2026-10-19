# mcp-server

Lets AI assistants use mediashare as the signed-in user, over MCP (Model Context Protocol,
Streamable HTTP) at `https://mcp.localhost/mcp`. Node 24 + TypeScript, Fastify, the official
`@modelcontextprotocol/server` SDK. Design and trade-offs: [ADR 0009](../../docs/adr/0009-mcp-server-exchanges-tokens.md).

```
MCP client ──(token aud=mcp, scopes)──▶ Envoy ──▶ mcp-server ──(token exchange)──▶ Keycloak
                                                       └──(token aud=media-api)──▶ api
```

It is an OAuth *resource server*: it publishes `/.well-known/oauth-protected-resource[/mcp]`,
answers `401` with a `WWW-Authenticate` that points there, and accepts only tokens whose `aud`
is its own URL. It never forwards the client's token; it exchanges it.

## Layout

| Path | Job |
|---|---|
| `src/main.ts` | composition root |
| `src/http/server.ts` | Fastify: auth on every request, session routing, metadata |
| `src/http/session-registry.ts` | live sessions, owner binding, idle cleanup (**one replica only**) |
| `src/tools/` | the tools: `read-tools.ts` (`mcp:read`), `write-tools.ts` (`mcp:write`), `audit.ts` (one log line per call) |
| `src/adapters/token-exchange.ts` | Keycloak RFC 8693 exchange + per-user cache |
| `src/adapters/api-client.ts` | HTTP to the api with the exchanged token |

Tools call the adapters directly: there is no domain logic of their own to put in a `service/`.

## Talks to

`edge` network only: Keycloak (JWKS, token endpoint) and the api. No Kafka, Postgres or Redis.
Needs `MCP_CLIENT_SECRET` (shared with the Keycloak realm import).

## Try it

`make demo` (steps 18b–18e), or MCP Inspector:
`npx @modelcontextprotocol/inspector` → URL `https://mcp.localhost/mcp`, OAuth client id
`media-mcp` (users `demo` / `demo-pass`). Your machine must trust `infra/gateway/certs/ca.crt`.

Browser-based MCP clients that call the server directly are not supported (no CORS on the host).
