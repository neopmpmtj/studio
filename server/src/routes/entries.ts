import type { FastifyPluginAsync } from 'fastify'
import { pool } from '../db/client'
import type { EntrySummary, NewEntry } from '../../../shared/types'

export const entriesRoutes: FastifyPluginAsync = async (app) => {
  app.get('/entries', async (): Promise<EntrySummary[]> => {
    const r = await pool.query(
      'SELECT id, started_at, duration_s FROM entries ORDER BY id DESC LIMIT 50',
    )
    return r.rows.map((e) => ({
      id: e.id,
      startedAt: new Date(e.started_at).toISOString(),
      durationS: e.duration_s,
    }))
  })

  app.get<{ Params: { id: string } }>('/entries/:id', async (req, reply) => {
    const r = await pool.query(
      'SELECT id, started_at, duration_s, samples FROM entries WHERE id = $1',
      [Number(req.params.id)],
    )
    const e = r.rows[0]
    if (!e) return reply.code(404).send({ error: 'not found' })
    return {
      id: e.id,
      startedAt: new Date(e.started_at).toISOString(),
      durationS: e.duration_s,
      samples: e.samples,
    }
  })

  app.post<{ Body: NewEntry }>('/entries', async (req, reply) => {
    const { startedAt, durationS, samples } = req.body ?? ({} as NewEntry)
    if (!startedAt || typeof durationS !== 'number' || !Array.isArray(samples)) {
      return reply.code(400).send({ error: 'invalid entry' })
    }
    const r = await pool.query(
      'INSERT INTO entries (started_at, duration_s, samples) VALUES ($1, $2, $3) RETURNING id',
      [startedAt, durationS, JSON.stringify(samples)],
    )
    return { id: r.rows[0].id }
  })
}
