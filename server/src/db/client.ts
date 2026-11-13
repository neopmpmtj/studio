import { readFileSync } from 'node:fs'
import pg from 'pg'

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

export async function initDb() {
  const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8')
  await pool.query(schema)
}

export async function getKv<T>(key: string, fallback: T): Promise<T> {
  const r = await pool.query('SELECT value FROM kv WHERE key = $1', [key])
  return r.rows[0] ? (r.rows[0].value as T) : fallback
}

export async function setKv(key: string, value: unknown) {
  await pool.query(
    `INSERT INTO kv (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)],
  )
}
