import { useEffect, useState } from 'react'
import type { EntrySummary } from '../../../shared/types'

export default function EntriesList({ refreshKey }: { refreshKey: number }) {
  const [items, setItems] = useState<EntrySummary[]>([])

  useEffect(() => {
    fetch('/api/entries')
      .then((r) => r.json())
      .then(setItems)
      .catch(() => setItems([]))
  }, [refreshKey])

  return (
    <section className="card">
      <h2>Recent recordings</h2>
      {items.length === 0 && <p className="muted">Nothing saved yet.</p>}
      <ul>
        {items.map((e) => (
          <li key={e.id}>
            <span>{new Date(e.startedAt).toLocaleString()}</span>
            <span className="muted">{e.durationS.toFixed(1)} s</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
