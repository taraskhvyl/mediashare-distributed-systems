import type { PoolClient } from 'pg'
import { pool } from '../adapters/postgres.js'

export interface SubscriptionRow {
  userId: string
  providerSubscriptionId: string
  plan: string
  status: string
  currentPeriodEnd: Date
  cancelAtPeriodEnd: boolean
}

const SELECT_COLUMNS = `user_id AS "userId", provider_subscription_id AS "providerSubscriptionId", plan,
  status, current_period_end AS "currentPeriodEnd", cancel_at_period_end AS "cancelAtPeriodEnd"`

export async function findByUserId(userId: string): Promise<SubscriptionRow | undefined> {
  const { rows } = await pool.query<SubscriptionRow>(`SELECT ${SELECT_COLUMNS} FROM subscriptions WHERE user_id = $1`, [
    userId,
  ])
  return rows[0]
}

/** Replaces the user's row with the provider's current state (idempotent: same input, same row). */
export async function upsert(client: PoolClient, row: SubscriptionRow): Promise<void> {
  await client.query(
    `INSERT INTO subscriptions
       (user_id, provider_subscription_id, plan, status, current_period_end, cancel_at_period_end)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id) DO UPDATE SET
       provider_subscription_id = EXCLUDED.provider_subscription_id,
       plan = EXCLUDED.plan,
       status = EXCLUDED.status,
       current_period_end = EXCLUDED.current_period_end,
       cancel_at_period_end = EXCLUDED.cancel_at_period_end,
       updated_at = now()`,
    [row.userId, row.providerSubscriptionId, row.plan, row.status, row.currentPeriodEnd, row.cancelAtPeriodEnd],
  )
}
