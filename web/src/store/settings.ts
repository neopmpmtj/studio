import { create } from 'zustand'
import { DEFAULT_SETTINGS, type Settings } from '../../../shared/types'
import { sendPatch } from '../lib/socket'

interface Store {
  settings: Settings
  connected: boolean
  recording: boolean
  /** Change a setting: applies instantly here and syncs to the server. */
  setSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void
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
  applyRemote: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
  setConnected: (connected) => set({ connected }),
  setRecording: (recording) => set({ recording }),
}))
