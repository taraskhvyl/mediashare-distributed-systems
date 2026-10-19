// Verifies a webhook's signature, Stripe-style: header `t=<unix seconds>,v1=<hex>[,v1=<hex>]`,
// where v1 = HMAC-SHA256(secret, `${t}.${rawBody}`). Mirrors the provider's published scheme; the
// provider owns this contract, so it is implemented here and in apps/fake-payments separately.
import { createHmac, timingSafeEqual } from 'node:crypto'
import { config } from '../config.js'
import { DomainError } from '../errors.js'

const badSignature = () => new DomainError('bad_signature', 'Invalid webhook signature')

/** Throws unless `rawBody` was signed with our secret, recently. Must run before parsing the body. */
export function verifyWebhookSignature(rawBody: string, header: string | undefined, nowSeconds = Date.now() / 1000) {
  if (!header) throw badSignature()

  const parts = header.split(',').map((part) => part.split('=') as [string, string])
  const timestamp = Number(parts.find(([key]) => key === 't')?.[1])
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value)
  if (!Number.isFinite(timestamp) || signatures.length === 0) throw badSignature()

  // Replay protection: a valid but old request (captured on the wire, say) is refused.
  if (Math.abs(nowSeconds - timestamp) > config.webhookToleranceSeconds) throw badSignature()

  const expected = createHmac('sha256', config.payments.webhookSecret).update(`${timestamp}.${rawBody}`).digest()
  const matches = signatures.some((signature) => {
    const candidate = Buffer.from(signature, 'hex')
    // timingSafeEqual throws on unequal lengths; unequal lengths are simply a mismatch.
    return candidate.length === expected.length && timingSafeEqual(candidate, expected)
  })
  if (!matches) throw badSignature()
}
