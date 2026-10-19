import { Pool, type PoolClient } from 'pg'
import { config } from '../config.js'

// Adapter: the process's one Postgres pool. Repositories import it; nothing else talks SQL.
// Same shape as apps/api/src/adapters/postgres.ts, copied on purpose: each service may change its
// pool settings without touching the other. Scalability: `max` is per replica.
export const pool = new Pool({ connectionString: config.databaseUrl, max: 5 })

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

export async function postgresPing(): Promise<void> {
  await pool.query('SELECT 1')
}
