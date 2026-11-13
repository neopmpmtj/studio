import { create } from 'zustand'
import { DEFAULT_SETTINGS, sanitize, type Settings } from '../../../shared/types'
import { sendPatch } from '../lib/socket'

interface Store {
  settings: Settings
  connected: boolean
  recording: boolean
  /** Change a setting: applies instantly here and syncs to the server. */
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  /** Apply several settings at once and sync them in one patch. */
  setSettings: (patch: Partial<Settings>) => void
  /** Apply a change that came from the server (no echo back). */
  applyRemote: (patch: Partial<Settings>) => void
  setConnected: (c: boolean) => void
  setRecording: (r: boolean) => void
}

export const useStore = create<Store>((set) => ({
  settings: DEFAULT_SETTINGS,
  connected: false,
  recording: false,
  setSetting: (key, value) => {
    set((s) => ({ settings: { ...s.settings, [key]: value } }))
    sendPatch({ [key]: value } as Partial<Settings>)
  },
  setSettings: (patch) => {
    const next = sanitize(patch)
    if (Object.keys(next).length === 0) return
    set((s) => ({ settings: { ...s.settings, ...next } }))
    sendPatch(next)
  },
  applyRemote: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
  setConnected: (connected) => set({ connected }),
  setRecording: (recording) => set({ recording }),
}))
