// Used by BOTH server and web, so a mismatch becomes a type error immediately.

export interface Settings {
  gain: number
  windowSeconds: number
  smoothing: number
}

export const DEFAULT_SETTINGS: Settings = {
  gain: 3,
  windowSeconds: 15,
  smoothing: 0.6,
}

export const SETTING_LIMITS: Record<keyof Settings, { min: number; max: number }> = {
  gain: { min: 0.5, max: 10 },
  windowSeconds: { min: 5, max: 60 },
  smoothing: { min: 0, max: 0.95 },
}

export interface Preset {
  id: string
  name: string
  builtin: boolean
  settings: Settings
}

export const BUILTIN_PRESETS: Preset[] = [
  { id: 'peaks', name: 'Peaks', builtin: true, settings: { gain: 2.5, windowSeconds: 5, smoothing: 0 } },
  { id: 'speech', name: 'Speech', builtin: true, settings: { gain: 5, windowSeconds: 15, smoothing: 0.85 } },
  { id: 'music', name: 'Music', builtin: true, settings: { gain: 2, windowSeconds: 30, smoothing: 0.75 } },
  { id: 'room', name: 'Room', builtin: true, settings: { gain: 8, windowSeconds: 60, smoothing: 0.95 } },
  { id: 'monitor', name: 'Monitor', builtin: true, settings: { gain: 3, windowSeconds: 21, smoothing: 0.6 } },
]

// Keeps only known keys and clamps values into their allowed range.
export function sanitize(patch: Partial<Settings> | null | undefined): Partial<Settings> {
  const out: Partial<Settings> = {}
  if (!patch || typeof patch !== 'object') return out
  for (const key of Object.keys(SETTING_LIMITS) as (keyof Settings)[]) {
    const v = patch[key]
    if (typeof v === 'number' && Number.isFinite(v)) {
      const { min, max } = SETTING_LIMITS[key]
      out[key] = Math.min(max, Math.max(min, v))
    }
  }
  return out
}

export type ClientMsg = { type: 'patch'; patch: Partial<Settings> }
export type ServerMsg =
  | { type: 'init'; settings: Settings }
  | { type: 'patch'; patch: Partial<Settings> }

export interface Lists {
  labels: string[]
}

export interface NewEntry {
  startedAt: string
  durationS: number
  samples: number[]
  waveform: number[]
}

export interface EntryUpload extends NewEntry {
  uuid: string
}

export interface EntrySummary {
  id: number
  startedAt: string
  durationS: number
  audioPath: string | null
}

export interface EntryDetail extends EntrySummary {
  samples: number[]
  waveform: number[] | null
}

export interface EntryPage {
  entries: EntrySummary[]
  total: number
}

export interface KeepSpan {
  start: number
  end: number
}

export interface CropRequest {
  mode: 'overwrite' | 'copy'
  keep: KeepSpan[]
}

// Trim plus middle cuts, in original-timeline seconds. Cuts may overlap.
export function keptSpans(trimStart: number, trimEnd: number, cuts: KeepSpan[]): KeepSpan[] {
  const start = Math.min(trimStart, trimEnd)
  const end = Math.max(trimStart, trimEnd)
  if (!(end > start)) return []
  const sorted = cuts
    .map((cut) => ({ start: Math.max(cut.start, start), end: Math.min(cut.end, end) }))
    .filter((cut) => cut.end > cut.start)
    .sort((a, b) => a.start - b.start)
  const out: KeepSpan[] = []
  let cursor = start
  for (const cut of sorted) {
    if (cut.start > cursor) out.push({ start: cursor, end: Math.min(cut.start, end) })
    cursor = Math.max(cursor, cut.end)
    if (cursor >= end) break
  }
  if (cursor < end) out.push({ start: cursor, end })
  return out
}
