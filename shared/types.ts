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
}

export interface EntrySummary {
  id: number
  startedAt: string
  durationS: number
}
