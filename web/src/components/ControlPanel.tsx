import { SETTING_LIMITS, type Settings } from '../../../shared/types'
import { useStore } from '../store/settings'

const FIELDS: { key: keyof Settings; label: string; step: number }[] = [
  { key: 'gain', label: 'Gain', step: 0.1 },
  { key: 'windowSeconds', label: 'Time window (s)', step: 1 },
  { key: 'smoothing', label: 'Smoothing', step: 0.05 },
]

export default function ControlPanel() {
  const settings = useStore((s) => s.settings)
  const setSetting = useStore((s) => s.setSetting)
  const connected = useStore((s) => s.connected)

  return (
    <section className="card">
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
              onChange={(e) => setSetting(f.key, Number(e.target.value))}
            />
          </label>
        )
      })}
    </section>
  )
}
