// Delivers events to billing the way a payment provider does: signed, over the edge, at-least-once
// (retried with backoff until a 2xx). `hold` queues events instead, so a test can deliver them late
// or in another order.
import { createHmac } from 'node:crypto'
import { request } from 'node:https'
import { config } from './config.js'
import { type ProviderEvent, recordDelivery } from './state.js'

let holding = false
let heldEvents: ProviderEvent[] = []

export function startHolding() {
  holding = true
}

/** Stops holding and delivers what was queued, newest first if `reverse`. */
export function release(reverse: boolean): ProviderEvent[] {
  holding = false
  const released = reverse ? [...heldEvents].reverse() : heldEvents
  heldEvents = []
  for (const event of released) void deliverWithRetries(event)
  return released
}

export function send(event: ProviderEvent) {
  if (holding) {
    heldEvents.push(event)
    return
  }
  void deliverWithRetries(event)
}

/** Sends the exact same event again (same id), as a provider does after a timeout. */
export function resend(event: ProviderEvent) {
  void deliverWithRetries(event)
}

// Same scheme as apps/billing/src/webhooks/signature.ts (the provider's contract: both sides follow it).
function signatureHeader(body: string): string {
  const timestamp = Math.floor(Date.now() / 1000)
  const signature = createHmac('sha256', config.webhookSecret).update(`${timestamp}.${body}`).digest('hex')
  return `t=${timestamp},v1=${signature}`
}

function postOnce(body: string): Promise<{ status: number; outcome?: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: config.webhook.gatewayHost,
        port: 443,
        path: config.webhook.path,
        method: 'POST',
        // SNI and Host name the public host, while the connection goes to the gateway container.
        servername: config.webhook.publicHostName,
        headers: {
          host: config.webhook.publicHostName,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
          'payments-signature': signatureHeader(body),
        },
        // Dev only: the gateway's cert comes from our local CA, which this container doesn't trust.
        rejectUnauthorized: false,
        timeout: 5000,
      },
      (res) => {
        let responseBody = ''
        res.on('data', (chunk) => (responseBody += chunk))
        res.on('end', () => resolve({ status: res.statusCode ?? 0, outcome: parseOutcome(responseBody) }))
      },
    )
    req.on('error', reject)
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.end(body)
  })
}

function parseOutcome(responseBody: string): string | undefined {
  try {
    return (JSON.parse(responseBody) as { outcome?: string }).outcome
  } catch {
    return undefined
  }
}

async function deliverWithRetries(event: ProviderEvent) {
  const body = JSON.stringify(event)
  for (let attempt = 1; attempt <= config.webhook.maxAttempts; attempt++) {
    try {
      const { status, outcome } = await postOnce(body)
      recordDelivery(event.id, status, outcome)
      console.log(JSON.stringify({ event: event.id, type: event.type, attempt, status, outcome }))
      if (status >= 200 && status < 300) return
    } catch (err) {
      console.log(JSON.stringify({ event: event.id, type: event.type, attempt, error: String(err) }))
    }
    await new Promise((resolve) => setTimeout(resolve, config.webhook.firstRetryDelayMs * 2 ** (attempt - 1)))
  }
  console.log(JSON.stringify({ event: event.id, gaveUp: true }))
}
