import { useEffect, useState, type MouseEvent } from 'react'
import type { EntryPage, EntrySummary } from '../../../shared/types'

export default function EntriesList({
  refreshKey,
  go,
}: {
  refreshKey: number
  go: (event: MouseEvent<HTMLAnchorElement>, next: string) => void
}) {
  const [items, setItems] = useState<EntrySummary[]>([])

  useEffect(() => {
    fetch('/api/entries')
      .then((r) => r.json())
      .then((data: EntryPage) => setItems(Array.isArray(data.entries) ? data.entries : []))
      .catch(() => setItems([]))
  }, [refreshKey])

  return (
    <section className="card">
      <h2>Recent recordings</h2>
      {items.length === 0 && <p className="muted">Nothing saved yet.</p>}
      <ul>
        {items.map((e) => (
          <li key={e.id}>
            <a className="nav" href={`/recordings?open=${e.id}`} onClick={(ev) => go(ev, `/recordings?open=${e.id}`)}>
              {new Date(e.startedAt).toLocaleString()}
            </a>
            <span className="muted">{e.durationS.toFixed(1)} s</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
