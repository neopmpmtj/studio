import type { FastifyPluginAsync } from 'fastify'
import { getKv, setKv } from '../db/client'
import { BUILTIN_PRESETS, sanitize, type Preset, type Settings } from '../../../shared/types'

const MAX_CUSTOM = 20
const MAX_NAME = 40

interface StoredPreset {
  id: string
  name: string
  settings: Settings
}

function complete(patch: Partial<Settings> | null | undefined): Settings | null {
  const clean = sanitize(patch)
  if (clean.gain === undefined || clean.windowSeconds === undefined || clean.smoothing === undefined) return null
  return { gain: clean.gain, windowSeconds: clean.windowSeconds, smoothing: clean.smoothing }
}

function cleanStored(raw: unknown): StoredPreset[] {
  if (!Array.isArray(raw)) return []
  const builtinIds = new Set(BUILTIN_PRESETS.map((p) => p.id))
  const names = new Set(BUILTIN_PRESETS.map((p) => p.name.toLowerCase()))
  const seen = new Set<string>()
  const out: StoredPreset[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    if (typeof rec.id !== 'string' || typeof rec.name !== 'string') continue
    const name = rec.name.trim().slice(0, MAX_NAME)
    const key = name.toLowerCase()
    if (!name || builtinIds.has(rec.id) || seen.has(rec.id) || names.has(key)) continue
    const settings = complete(rec.settings as Partial<Settings>)
    if (!settings) continue
    seen.add(rec.id)
    names.add(key)
    out.push({ id: rec.id, name, settings })
    if (out.length >= MAX_CUSTOM) break
  }
  return out
}

function publish(p: StoredPreset): Preset {
  return { id: p.id, name: p.name, builtin: false, settings: p.settings }
}

export const presetsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/presets', async () => {
    const stored = cleanStored(await getKv('presets', []))
    return { presets: [...BUILTIN_PRESETS, ...stored.map(publish)] }
  })

  app.post<{ Body: { name?: unknown; settings?: Partial<Settings> } }>('/presets', async (req, reply) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, MAX_NAME) : ''
    if (!name) return reply.code(400).send({ error: 'name is required' })
    const settings = complete(req.body?.settings)
    if (!settings) return reply.code(400).send({ error: 'settings are incomplete' })

    const stored = cleanStored(await getKv('presets', []))
    const taken = new Set(
      [...BUILTIN_PRESETS.map((p) => p.name), ...stored.map((p) => p.name)].map((n) => n.toLowerCase()),
    )
    if (taken.has(name.toLowerCase())) return reply.code(400).send({ error: 'name already used' })
    if (stored.length >= MAX_CUSTOM) return reply.code(400).send({ error: 'too many presets' })

    const created: StoredPreset = { id: crypto.randomUUID(), name, settings }
    await setKv('presets', [...stored, created])
    return publish(created)
  })

  app.delete<{ Params: { id: string } }>('/presets/:id', async (req, reply) => {
    if (BUILTIN_PRESETS.some((p) => p.id === req.params.id)) {
      return reply.code(400).send({ error: 'built-in preset' })
    }
    const stored = cleanStored(await getKv('presets', []))
    const next = stored.filter((p) => p.id !== req.params.id)
    if (next.length === stored.length) return reply.code(404).send({ error: 'not found' })
    await setKv('presets', next)
    return { ok: true }
  })
}
