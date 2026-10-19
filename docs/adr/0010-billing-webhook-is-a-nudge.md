---
status: accepted
---

# Billing: the webhook is a nudge, and the provider is the source of truth

MCP (ADR 0009) is a paid feature. `apps/billing` records who has a subscription, and the MCP
server asks it before letting anyone in. The payments provider is outside our system (in this repo
a stand-in, `apps/fake-payments`, shaped like Stripe), so we learn about payments only when it
**calls us**: a webhook. That call is delivered at least once, may arrive twice, late, or in a
different order than the events happened, and anyone on the internet can POST to the URL.

Decisions:

- **A webhook only says "subscription X changed".** Billing verifies the signature, then asks the
  provider for X's *current* state and stores that. The event's own payload is never trusted for
  state. Duplicates, delays and reordering then cannot leave an old status behind: each event
  makes billing read the latest truth. (Stripe's own advice for ordering.)
- **Deduplicate by event id, in the same transaction as the write.** `processed_webhook_events`
  has `event_id` as its primary key; the insert and the subscription upsert commit together, so
  a crash between them replays the event cleanly, and two copies running at once cannot both win.
- **The signature is the credential on the webhook.** `Payments-Signature: t=<unix>,v1=<HMAC-SHA256
  of "t.body">`, checked on the raw bytes with a constant-time compare and a 5-minute window
  against replay. The endpoint is public (`billing.localhost`, no JWT), so it gets a per-IP limit
  at Envoy and a 64 KB body limit in the service.
- **Access rule: `active`, `trialing` and `past_due` grant MCP; `canceled` and `unpaid` revoke.**
  `past_due` means the provider is still retrying a failed payment; it decides when that becomes
  `unpaid`. We keep no clock of our own, so there is one source of truth for "is this customer
  paying". A subscription set to end at the period's end stays `active` until it really ends.
- **The MCP server asks billing with a service token, fail closed.** Client credentials from
  `media-mcp-billing`, a client whose tokens carry `aud = media-billing` only (not the api's, so
  the token is useless anywhere else), and billing accepts that one caller. A "yes" is cached for
  30 s; a "no" is not, so someone who just paid gets in on the next request. If billing is down,
  nobody gets in. This replaced the `mcp-user` Keycloak role: a role is a second place that
  would have to be kept in step with the payment state (a dual write, with no transaction
  spanning Keycloak and our database), so the entitlement lives in one place and is looked up.

## Considered options

- **Trust the event payload** (apply what the event says). Simple, wrong under reordering: an old
  `past_due` arriving after `active` would revoke a paying customer.
- **Order events by timestamp or sequence.** Providers do not promise ordering, and clocks lie.
- **Sync the status into a Keycloak role/claim.** The token would carry the entitlement, but it
  goes stale until refresh, and updating Keycloak is a write we could lose after saving ours.
- **A shared secret header between MCP server and billing.** No expiry, no audience, no identity.
- **Token exchange on behalf of the user for billing too.** Purer, but it pulls a second audience
  into the user path for a yes/no about a user id the service already holds.

## Consequences

- **Lost webhooks are not healed yet.** If the provider gives up (Stripe: up to 3 days in live
  mode), billing keeps the last state it saw. The fix is a periodic reconcile job that re-reads
  every non-final subscription; it is a roadmap item.
- **A user can keep MCP for up to 30 s after a cancellation** is processed (the "yes" cache),
  and for as long as the provider keeps a failing card `past_due`.
- **The provider is a hard dependency of the webhook path:** if it is unreachable, billing answers
  503 and the provider retries, which is the behaviour we want.
- **The fake provider is in memory** and forgets subscriptions on restart; billing's table keeps
  the last state. It exposes `/control` on a loopback-only port for the demo (duplicate, hold and
  reorder, status changes). Never deploy it.
- The Plan page learns about a payment by polling `GET /v1/billing/subscription` after the
  redirect. Pushing it over live events through an outbox is a roadmap experiment.
