# fake-payments

**Dev only.** A stand-in for an external payments provider (Stripe-shaped), so billing can be built
and tested without an account. In memory: a restart forgets its subscriptions. Never deploy it.

| What | Where |
|---|---|
| Hosted checkout page | `https://pay.localhost/checkout/:id` (through Envoy; only this path is exposed) |
| Provider API billing calls | `POST /v1/checkout/sessions`, `GET /v1/subscriptions/:id` (Bearer `PAYMENTS_API_KEY`, internal) |
| Webhook sender | signs and POSTs events to `https://billing.localhost/webhooks/payments` through the gateway, retrying with backoff until a 2xx |
| Levers | `http://127.0.0.1:3010/control/*` (header `X-Control-Key`, loopback only) |

Levers (used by `tools/demo/billing_demo.py`):

```bash
K='X-Control-Key: dev-payments-control-key'; C=http://127.0.0.1:3010/control
curl -s -H "$K" $C/events                                         # events + how billing answered each delivery
curl -s -H "$K" -XPOST $C/events/<evt_id>/replay                  # same event id again (at-least-once)
curl -s -H "$K" -XPOST $C/hold                                    # queue events instead of sending
curl -s -H "$K" -H 'content-type: application/json' -XPOST $C/release -d '{"reverse":true}'  # newest first
curl -s -H "$K" -H 'content-type: application/json' -XPOST $C/users/<keycloak-sub>/subscription \
  -d '{"status":"past_due"}'                                      # add "announce": false to lose the webhook
```

Layout: `config.ts`, `state.ts` (the data), `provider-api.ts`, `checkout-page.ts`, `lifecycle.ts`
(which events a change emits), `webhook-sender.ts`, `control-api.ts`, `main.ts`.
