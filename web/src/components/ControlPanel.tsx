import { useEffect, useRef, useState } from 'react'
import { BUILTIN_PRESETS, SETTING_LIMITS, type Preset, type Settings } from '../../../shared/types'
import { useStore } from '../store/settings'

const FIELDS: { key: keyof Settings; label: string; step: number }[] = [
  { key: 'gain', label: 'Loudness gain', step: 0.1 },
  { key: 'windowSeconds', label: 'Loudness window (s)', step: 1 },
  { key: 'smoothing', label: 'Loudness smoothing', step: 0.05 },
]

function same(a: Settings, b: Settings) {
  return (
    Math.abs(a.gain - b.gain) < 1e-6 &&
    Math.abs(a.windowSeconds - b.windowSeconds) < 1e-6 &&
    Math.abs(a.smoothing - b.smoothing) < 1e-6
  )
}

export default function ControlPanel() {
  const settings = useStore((s) => s.settings)
  const setSetting = useStore((s) => s.setSetting)
  const setSettings = useStore((s) => s.setSettings)
  const connected = useStore((s) => s.connected)
  const [presets, setPresets] = useState<Preset[]>(BUILTIN_PRESETS)
  const [selectedId, setSelectedId] = useState('monitor')
  const [name, setName] = useState('')
  const [status, setStatus] = useState('')
  const hold = useRef(false)

  useEffect(() => {
    fetch('/api/presets')
      .then((r) => r.json())
      .then((data: { presets: Preset[] }) => {
        if (Array.isArray(data.presets) && data.presets.length) setPresets(data.presets)
      })
      .catch(() => setStatus('Server offline'))
  }, [])

  useEffect(() => {
    if (hold.current || !connected) return
    const match = presets.find((p) => same(p.settings, settings))
    if (match) setSelectedId(match.id)
  }, [presets, settings, connected])

  const selected = presets.find((p) => p.id === selectedId)
  const matches = selected ? same(selected.settings, settings) : false

  function reset() {
    if (!selected) return
    hold.current = true
    setSettings(selected.settings)
    setStatus('')
  }

  async function save() {
    const trimmed = name.trim()
    if (!trimmed) return
    setStatus('')
    try {
      const res = await fetch('/api/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, settings }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setStatus(body?.error ?? 'Save failed')
        return
      }
      const created = (await res.json()) as Preset
      hold.current = true
      setPresets((list) => [...list, created])
      setSelectedId(created.id)
      setName('')
      setStatus('Saved')
    } catch {
      setStatus('Server offline')
    }
  }

  async function remove() {
    if (!selected || selected.builtin) return
    setStatus('')
    try {
      const res = await fetch(`/api/presets/${selected.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null
        setStatus(body?.error ?? 'Remove failed')
        return
      }
      const next = presets.filter((p) => p.id !== selected.id)
      const match = next.find((p) => same(p.settings, settings))
      hold.current = true
      setPresets(next)
      setSelectedId((match ?? next[0]).id)
      setStatus('')
    } catch {
      setStatus('Server offline')
    }
  }

  return (
    <section className="card wide">
      <h2>
        Controls <span className={connected ? 'dot on' : 'dot'} title={connected ? 'Synced' : 'Offline'} />
      </h2>
      {FIELDS.map((f) => {
        const lim = SETTING_LIMITS[f.key]
        return (
          <label key={f.key} className="field">
            <span>
              {f.label}: <b>{settings[f.key]}</b>
            </span>
            <input
              type="range"
              min={lim.min}
              max={lim.max}
              step={f.step}
              value={settings[f.key]}
              onChange={(e) => {
                hold.current = true
                setSetting(f.key, Number(e.target.value))
              }}
            />
          </label>
        )
      })}
      <label className="field">
        <span>Preset</span>
        <select
          value={selectedId}
          onChange={(e) => {
            hold.current = true
            setSelectedId(e.target.value)
            setStatus('')
          }}
        >
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <button onClick={reset} disabled={!selected || matches}>
          Reset
        </button>
        {selected && !selected.builtin && (
          <button className="small" onClick={remove}>
            Remove
          </button>
        )}
      </div>
      <div className="row">
        <input
          type="text"
          value={name}
          placeholder="New preset"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        <button className="small" onClick={save} disabled={!name.trim()}>
          Save
        </button>
      </div>
      {status && <p className={status === 'Saved' ? 'muted' : 'error'}>{status}</p>}
    </section>
  )
}
