import { pool, withTransaction } from '../adapters/postgres.js'
import { type SubscriptionRow, upsert } from '../subscriptions/repository.js'

export interface WebhookEvent {
  id: string
  type: string
}

export async function wasProcessed(eventId: string): Promise<boolean> {
  const { rowCount } = await pool.query('SELECT 1 FROM processed_webhook_events WHERE event_id = $1', [eventId])
  return rowCount === 1
}

/**
 * Marks the event processed and, in the same transaction, stores the subscription state.
 * If two copies of one event run at once, the primary key lets exactly one insert win;
 * the other sees `false` and writes nothing. `subscription` is undefined for events that
 * change no state (ignored types).
 */
export async function recordEventAndApply(event: WebhookEvent, subscription: SubscriptionRow | undefined) {
  return withTransaction(async (client) => {
    const { rowCount } = await client.query(
      `INSERT INTO processed_webhook_events (event_id, event_type) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [event.id, event.type],
    )
    const isFirstDelivery = rowCount === 1
    if (isFirstDelivery && subscription) await upsert(client, subscription)
    return isFirstDelivery
  })
}
