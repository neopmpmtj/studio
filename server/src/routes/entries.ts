import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import { pool } from '../db/client'
import { cropPcm, readWav, sliceSeries, writeWav } from '../services/crop'
import {
  clipFileUrl,
  isUuid,
  modifiedCopyPath,
  removeClip,
  removeStored,
  writeClip,
  writeStored,
} from '../services/recording'
import type { CropRequest, EntryDetail, EntryPage, EntrySummary, EntryUpload, KeepSpan } from '../../../shared/types'

function summary(e: {
  id: number
  started_at: Date | string
  duration_s: number
  audio_path: string | null
}): EntrySummary {
  return {
    id: Number(e.id),
    startedAt: new Date(e.started_at).toISOString(),
    durationS: Number(e.duration_s),
    audioPath: e.audio_path,
  }
}

function clampInt(raw: unknown, fallback: number, min: number, max: number) {
  if (typeof raw !== 'string' || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isInteger(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function parseId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null
  const n = Number(raw)
  if (!Number.isSafeInteger(n) || n < 1 || n > 2147483647) return null
  return n
}

function asSamples(value: unknown): number[] {
  if (!Array.isArray(value)) return []
  return value.filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
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
  if (!Array.isArray(meta.waveform) || meta.waveform.length % 2 !== 0) return null
  if (meta.waveform.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null
  if (typeof meta.uuid !== 'string' || !isUuid(meta.uuid)) return null
  return meta
}

function readKeep(raw: unknown, duration: number): KeepSpan[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 100) return null
  const spans: KeepSpan[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') return null
    const start = (item as KeepSpan).start
    const end = (item as KeepSpan).end
    if (typeof start !== 'number' || typeof end !== 'number') return null
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
    if (start < -1e-6 || end > duration + 1e-3) return null
    spans.push({ start: Math.max(0, start), end: Math.min(duration, end) })
  }
  spans.sort((a, b) => a.start - b.start)
  for (let i = 1; i < spans.length; i++) {
    if (spans[i].start < spans[i - 1].end - 1e-6) return null
  }
  return spans
}

function isEnoent(err: unknown) {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT'
}

async function deleteEntries(ids: number[]) {
  const unique = [...new Set(ids)]
  const r = await pool.query<{ audio_path: string | null }>(
    'DELETE FROM entries WHERE id = ANY($1::int[]) RETURNING audio_path',
    [unique],
  )
  for (const row of r.rows) await removeStored(row.audio_path)
  return { deleted: r.rows.length }
}

function rejectRange(reply: FastifyReply, size: number) {
  reply.header('Content-Range', `bytes */${size}`)
  return reply.code(416).send()
}

async function sendAudio(req: FastifyRequest, reply: FastifyReply, audioPath: string | null) {
  const fileUrl = clipFileUrl(audioPath)
  if (!fileUrl) return reply.code(404).send({ error: 'not found' })
  const path = fileURLToPath(fileUrl)
  let size: number
  try {
    size = (await stat(path)).size
  } catch (err) {
    if (isEnoent(err)) return reply.code(404).send({ error: 'not found' })
    throw err
  }

  reply.header('Accept-Ranges', 'bytes')
  reply.type('audio/wav')
  const range = req.headers.range
  if (!range) {
    reply.header('Content-Length', size)
    return reply.send(createReadStream(path))
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(range)
  if (!match || size === 0) return rejectRange(reply, size)

  let start: number
  let end: number
  if (match[1] === '') {
    const suffix = Number(match[2])
    if (!Number.isInteger(suffix) || suffix <= 0) return rejectRange(reply, size)
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] === '' ? size - 1 : Number(match[2])
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) {
      return rejectRange(reply, size)
    }
    end = Math.min(end, size - 1)
  }

  reply.code(206)
  reply.header('Content-Range', `bytes ${start}-${end}/${size}`)
  reply.header('Content-Length', end - start + 1)
  return reply.send(createReadStream(path, { start, end }))
}

export const entriesRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: { limit?: string; offset?: string } }>('/entries', async (req): Promise<EntryPage> => {
    const limit = clampInt(req.query.limit, 50, 1, 500)
    const offset = clampInt(req.query.offset, 0, 0, 1_000_000)
    const [count, page] = await Promise.all([
      pool.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM entries'),
      pool.query(
        'SELECT id, started_at, duration_s, audio_path FROM entries ORDER BY id DESC LIMIT $1 OFFSET $2',
        [limit, offset],
      ),
    ])
    return { entries: page.rows.map(summary), total: Number(count.rows[0].n) }
  })

  app.post<{ Body: { ids?: unknown } }>('/entries/delete', async (req, reply) => {
    const ids = req.body?.ids
    if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100) {
      return reply.code(400).send({ error: 'ids must be 1 to 100 integers' })
    }
    const parsed: number[] = []
    for (const id of ids) {
      if (typeof id !== 'number' || !Number.isInteger(id) || id < 1 || id > 2147483647) {
        return reply.code(400).send({ error: 'ids must be 1 to 100 integers' })
      }
      parsed.push(id)
    }
    return deleteEntries(parsed)
  })

  app.get<{ Params: { id: string } }>('/entries/:id/audio', async (req, reply) => {
    const id = parseId(req.params.id)
    if (id == null) return reply.code(404).send({ error: 'not found' })
    const r = await pool.query<{ audio_path: string | null }>(
      'SELECT audio_path FROM entries WHERE id = $1',
      [id],
    )
    if (!r.rows[0]) return reply.code(404).send({ error: 'not found' })
    return sendAudio(req, reply, r.rows[0].audio_path)
  })

  app.delete<{ Params: { id: string } }>('/entries/:id', async (req, reply) => {
    const id = parseId(req.params.id)
    if (id == null) return reply.code(404).send({ error: 'not found' })
    const result = await deleteEntries([id])
    if (result.deleted === 0) return reply.code(404).send({ error: 'not found' })
    return result
  })

  app.get<{ Params: { id: string } }>('/entries/:id', async (req, reply): Promise<EntryDetail | void> => {
    const id = parseId(req.params.id)
    if (id == null) return reply.code(404).send({ error: 'not found' })
    const r = await pool.query(
      'SELECT id, started_at, duration_s, samples, waveform, audio_path FROM entries WHERE id = $1',
      [id],
    )
    const e = r.rows[0]
    if (!e) return reply.code(404).send({ error: 'not found' })
    return {
      ...summary(e),
      samples: asSamples(e.samples),
      waveform: e.waveform == null ? null : asSamples(e.waveform),
    }
  })

  app.post<{ Params: { id: string }; Body: CropRequest }>('/entries/:id/crop', async (req, reply) => {
    const id = parseId(req.params.id)
    if (id == null) return reply.code(404).send({ error: 'not found' })
    const mode = req.body?.mode
    if (mode !== 'overwrite' && mode !== 'copy') return reply.code(400).send({ error: 'invalid crop' })

    const found = await pool.query(
      'SELECT id, duration_s, samples, waveform, audio_path FROM entries WHERE id = $1',
      [id],
    )
    const row = found.rows[0]
    if (!row) return reply.code(404).send({ error: 'not found' })
    const duration = Number(row.duration_s)
    const keep = readKeep(req.body?.keep, duration)
    const fileUrl = clipFileUrl(row.audio_path)
    if (!keep || !fileUrl) return reply.code(400).send({ error: 'invalid crop' })

    let bytes: Buffer
    try {
      bytes = await readFile(fileUrl)
    } catch (err) {
      if (isEnoent(err)) return reply.code(404).send({ error: 'not found' })
      throw err
    }

    let wav: { pcm: Buffer; sampleRate: number }
    try {
      wav = readWav(bytes)
    } catch {
      return reply.code(400).send({ error: 'invalid crop' })
    }
    const pcm = cropPcm(wav.pcm, wav.sampleRate, keep)
    if (pcm.length < 2) return reply.code(400).send({ error: 'invalid crop' })
    const nextWav = writeWav(pcm, wav.sampleRate)
    const durationS = pcm.length / 2 / wav.sampleRate
    const samples = sliceSeries(asSamples(row.samples), duration, keep, false)
    const waveform = row.waveform == null ? null : sliceSeries(asSamples(row.waveform), duration, keep, true)
    const waveformJson = waveform == null ? null : JSON.stringify(waveform)

    if (mode === 'overwrite') {
      await writeStored(row.audio_path, nextWav)
      await pool.query('UPDATE entries SET duration_s = $2, samples = $3, waveform = $4 WHERE id = $1', [
        id,
        durationS,
        JSON.stringify(samples),
        waveformJson,
      ])
      return { id, audioPath: row.audio_path }
    }

    const dest = modifiedCopyPath(row.audio_path)
    if (!dest) return reply.code(400).send({ error: 'invalid crop' })
    const existing = await pool.query<{ id: number }>('SELECT id FROM entries WHERE audio_path = $1', [dest])
    await writeStored(dest, nextWav)
    const startedAt = new Date().toISOString()
    if (existing.rows[0]) {
      const copyId = Number(existing.rows[0].id)
      await pool.query(
        'UPDATE entries SET started_at = $2, duration_s = $3, samples = $4, waveform = $5 WHERE id = $1',
        [copyId, startedAt, durationS, JSON.stringify(samples), waveformJson],
      )
      return { id: copyId, audioPath: dest }
    }
    try {
      const inserted = await pool.query(
        'INSERT INTO entries (started_at, duration_s, samples, waveform, audio_path) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [startedAt, durationS, JSON.stringify(samples), waveformJson, dest],
      )
      return { id: Number(inserted.rows[0].id), audioPath: dest }
    } catch (err) {
      await removeStored(dest)
      throw err
    }
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
        'INSERT INTO entries (started_at, duration_s, samples, waveform, audio_path) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [meta.startedAt, meta.durationS, JSON.stringify(meta.samples), JSON.stringify(meta.waveform), audioPath],
      )
      return { id: r.rows[0].id, audioPath }
    } catch (err) {
      if (wrote) await removeClip(uuid)
      throw err
    }
  })
}
