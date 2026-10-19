---
status: accepted
---

# The MCP server exchanges tokens; it never forwards the user's

AI assistants (Claude, Cursor, MCP Inspector) act on a user's behalf through `apps/mcp-server`,
which calls the api. The obvious design is to forward the user's Keycloak token to the api.
The MCP authorization spec forbids it ("token passthrough"), and for a good reason: a token
that works at both services turns any bug or compromise of one into access to the other.

So every token has exactly one audience (`aud`), and every service accepts only its own:

- Clients log in through the public client `media-mcp`. Their token has
  `aud = https://mcp.localhost/mcp` (the MCP server) and the scopes `mcp:read` / `mcp:write`.
- The MCP server verifies that token (signature, issuer, **audience**), then trades it at
  Keycloak for a second token with `aud = media-api` for the same user (standard token
  exchange, RFC 8693, using its own confidential client `media-mcp-server`). The api sees the
  real user and applies its own checks, as ADR 0003 requires.
- To make that mean something, **the api, the sse-gateway and Envoy now require
  `aud = media-api`** (`audience` is a required option of `@mediashare/auth`). Before, no
  service looked at `aud`, so a token for the MCP server would have been accepted by the api.
  `media-web` and `media-cli` tokens get the `media-api` audience from a Keycloak mapper.

Tools (`whoami`, `list_feed`, `list_my_files`, `get_file`, `like_file`, `follow_user`) are
gated by scope: reads need `mcp:read`, the two writes `mcp:write`, answered with
`403 insufficient_scope` and the missing scope so a client can ask the user for more (step-up).
Sessions are stateful (`Mcp-Session-Id`), bound to the user who opened them, and the token is
still checked on every request: a session id is never a credential.

## Considered options

- **Forward the user's token.** Simplest. Spec-forbidden, and it leaves no way to tell
  whether a call came through an AI assistant or the app.
- **A service account for the MCP server, user passed as a header.** The api would have to
  trust a header from one service; the per-user checks stop being verifiable (breaks ADR 0003).
- **Dynamic client registration** (any client registers itself). Works with clients that cannot
  be configured with a client id, but opens a public registration endpoint. Left as a later
  experiment; today `media-mcp` is pre-registered.

## Consequences

- **Not offered to a model on purpose:** upload, delete, visibility. Making a file public sends
  its image to the AI provider (ADR 0008); a model following an injected instruction must not
  be able to do that. Likes and follows are idempotent and reversible.
- **Prompt injection through captions:** captions and tags come from a model reading pixels the
  uploader chose, and `list_feed` hands them to the client's model. Defense: tool results are
  plain data and cannot change scopes or permissions; descriptions say the text is untrusted.
  It reduces the risk; it does not remove it. Writes are the reason scopes exist.
- **Who may use it, what is recorded, how fast:** realm role `mcp-user` (checked by the MCP server,
  since a Keycloak scope cannot depend on a role), an audit log line per tool call, and a
  per-user Envoy limit of 5 req/s on `mcp.localhost` (SECURITY.md has the details and gaps).
- **One replica.** Sessions live in the process's memory; a request that reaches another replica
  gets `404`. Fix when needed: route by `Mcp-Session-Id` in Envoy, or a shared session store.
- **Client attribution is self-reported** (`clientInfo.name`, `User-Agent`). It is recorded on
  every request's span (`mcp.client.name`) for analytics, never used to allow or deny.
- **Everyone logs in again** once: old tokens have no `media-api` audience.
- Keycloak needs the full `KC_HOSTNAME` URL, or the issuer changes with the URL a service uses
  to reach it and the exchange rejects the subject token.
- Not covered: the MCP client's browser login (code + PKCE) is configured but not exercised by
  `make demo`, which uses the password grant like the other demo clients.
