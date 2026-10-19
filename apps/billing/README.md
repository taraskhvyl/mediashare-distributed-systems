# billing

Subscriptions and entitlements. Node 24 + TypeScript, Fastify. Design and trade-offs:
[ADR 0010](../../docs/adr/0010-billing-webhook-is-a-nudge.md).

```mermaid
flowchart LR
    browser[Browser: Plan page] -->|"/v1/billing/* (user JWT)"| envoy[Envoy]
    provider[Payments provider] -->|"signed POST /webhooks/payments"| envoy
    envoy --> billing
    mcp[mcp-server] -->|"/internal/entitlements/:userId (service JWT)"| billing
    billing -->|"GET subscription (API key)"| provider
    billing --> pg[(Postgres: subscriptions, processed_webhook_events)]
```

A webhook delivery, step by step. The event only says *what changed*; the state is re-read:

```mermaid
sequenceDiagram
    participant P as Payments provider
    participant B as billing
    participant DB as Postgres
    P->>B: POST event (id, type) + Payments-Signature
    B->>B: verify HMAC on the raw body, 5 min window
    B->>DB: event id already processed?
    alt duplicate
        B-->>P: 200 outcome=duplicate
    else first time
        B->>P: GET subscription (current state)
        B->>DB: one transaction: insert event id + upsert subscription
        B-->>P: 200 outcome=applied
    end
    Note over P,B: any 5xx or timeout, so the provider retries
```

Three doors, three kinds of credential:

| Door | Path | Credential |
|---|---|---|
| Users (the Plan page) | `GET /v1/billing/subscription`, `POST /v1/billing/checkout` | user JWT, `aud = media-api` |
| Other services | `GET /internal/entitlements/:userId` | service JWT, `aud = media-billing`, only `service-account-media-mcp-billing` |
| The payments provider | `POST /webhooks/payments` | HMAC signature on the raw body |

## Layout

| Path | Job |
|---|---|
| `src/main.ts` | composition root |
| `src/http/` | Fastify app, error mapping, the two auth hooks |
| `src/webhooks/` | `signature.ts` (verify), `service.ts` (dedupe, re-fetch, store), `repository.ts` (SQL) |
| `src/subscriptions/` | `entitlement.ts` (the access rule), own subscription + checkout |
| `src/entitlements/` | the yes/no endpoint other services call |
| `src/adapters/` | Postgres pool, the payments provider's HTTP API |

## Talks to

`edge` (Keycloak JWKS, the provider) and `data` (Postgres only, as `billing_user`: `subscriptions`
and `processed_webhook_events`). No Kafka, no Redis. The webhook dedupe is a primary key, so
it can run with several replicas.

## Try it

`make demo` (steps B1–B7), or sign in to the web app and open **Plan**. Provider levers by hand:
see [fake-payments](../fake-payments/README.md).
