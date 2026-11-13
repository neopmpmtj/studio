import { useEffect, useState } from 'react'
import type { Lists } from '../../../shared/types'

// Lists are the one place that uses an explicit Save button.
export default function ListEditor() {
  const [saved, setSaved] = useState<string[]>([])
  const [draft, setDraft] = useState<string[]>([])
  const [text, setText] = useState('')
  const [status, setStatus] = useState('')

  useEffect(() => {
    fetch('/api/lists')
      .then((r) => r.json())
      .then((l: Lists) => {
        setSaved(l.labels)
        setDraft(l.labels)
      })
      .catch(() => setStatus('Server offline'))
  }, [])

  const dirty = JSON.stringify(saved) !== JSON.stringify(draft)

  function add() {
    const t = text.trim()
    if (t && !draft.includes(t)) setDraft([...draft, t])
    setText('')
  }

  async function save() {
    const res = await fetch('/api/lists', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ labels: draft } satisfies Lists),
    })
    if (res.ok) {
      setSaved(draft)
      setStatus('Saved')
    } else {
      setStatus('Save failed')
    }
  }

  return (
    <section className="card">
      <h2>Labels</h2>
      <div className="row">
        <input
          type="text"
          value={text}
          placeholder="New label"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && add()}
        />
        <button className="small" onClick={add}>Add</button>
      </div>
      <ul>
        {draft.map((l) => (
          <li key={l}>
            {l}
            <button className="small" onClick={() => setDraft(draft.filter((x) => x !== l))}>Remove</button>
          </li>
        ))}
      </ul>
      <div className="row">
        <button onClick={save} disabled={!dirty}>Save</button>
        <span className="muted">{dirty ? 'Unsaved changes' : status}</span>
      </div>
    </section>
  )
}
