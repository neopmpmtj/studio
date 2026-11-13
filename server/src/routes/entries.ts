import type { FastifyPluginAsync } from 'fastify'
import { pool } from '../db/client'
import { isUuid, removeClip, writeClip } from '../services/recording'
import type { EntryDetail, EntrySummary, EntryUpload } from '../../../shared/types'

function summary(e: {
  id: number
  started_at: Date | string
  duration_s: number
  audio_path: string | null
}): EntrySummary {
  return {
    id: e.id,
    startedAt: new Date(e.started_at).toISOString(),
    durationS: e.duration_s,
    audioPath: e.audio_path,
  }
}

function readMeta(raw: string): EntryUpload | null {
  let meta: EntryUpload
  try {
    meta = JSON.parse(raw) as EntryUpload
  } catch {
    return null
  }
  if (!meta || typeof meta !== 'object') return null
  if (!meta.startedAt || typeof meta.durationS !== 'number' || !Array.isArray(meta.samples)) return null
  if (typeof meta.uuid !== 'string' || !isUuid(meta.uuid)) return null
  return meta
}

export const entriesRoutes: FastifyPluginAsync = async (app) => {
  app.get('/entries', async (): Promise<EntrySummary[]> => {
    const r = await pool.query(
      'SELECT id, started_at, duration_s, audio_path FROM entries ORDER BY id DESC LIMIT 50',
    )
    return r.rows.map(summary)
  })

  app.get<{ Params: { id: string } }>('/entries/:id', async (req, reply): Promise<EntryDetail | void> => {
    const r = await pool.query(
      'SELECT id, started_at, duration_s, samples, audio_path FROM entries WHERE id = $1',
      [Number(req.params.id)],
    )
    const e = r.rows[0]
    if (!e) return reply.code(404).send({ error: 'not found' })
    return { ...summary(e), samples: e.samples }
  })

  app.post('/entries', async (req, reply) => {
    if (!req.isMultipart()) return reply.code(400).send({ error: 'invalid entry' })

    let metaRaw = ''
    let audio: Buffer | null = null
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const bytes = await part.toBuffer()
        if (part.fieldname === 'audio') audio = bytes
      } else if (part.fieldname === 'meta' && typeof part.value === 'string') {
        metaRaw = part.value
      }
    }

    const meta = readMeta(metaRaw)
    if (!meta || !audio?.length) return reply.code(400).send({ error: 'invalid entry' })

    const uuid = meta.uuid.toLowerCase()
    let wrote = false
    try {
      const audioPath = await writeClip(uuid, audio)
      wrote = true
      const r = await pool.query(
        'INSERT INTO entries (started_at, duration_s, samples, audio_path) VALUES ($1, $2, $3, $4) RETURNING id',
        [meta.startedAt, meta.durationS, JSON.stringify(meta.samples), audioPath],
      )
      return { id: r.rows[0].id, audioPath }
    } catch (err) {
      if (wrote) await removeClip(uuid)
      throw err
    }
  })
}
