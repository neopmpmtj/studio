import { useEffect, useMemo, useRef, useState, type MouseEvent, type RefObject } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import type { EntryDetail, EntryPage, EntrySummary } from '../../../shared/types'
import { useStore } from '../store/settings'

const HEIGHT = 240
const PAGE_SIZES = [20, 50, 100] as const

function isAbort(err: unknown) {
  return typeof err === 'object' && err !== null && 'name' in err && err.name === 'AbortError'
}

function formatDuration(seconds: number) {
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  if (s < 60) return `${s.toFixed(1)} s`
  const m = Math.floor(s / 60)
  const sec = Math.round(s - m * 60)
  return `${m}m ${sec.toString().padStart(2, '0')}s`
}

function when(iso: string) {
  return new Date(iso).toLocaleString()
}

function bindPlayback(plot: uPlot, audioRef: RefObject<HTMLAudioElement | null>, maxT: number) {
  const head = document.createElement('div')
  head.className = 'playhead'
  plot.over.appendChild(head)

  const place = () => {
    const audio = audioRef.current
    if (!audio) return
    head.style.transform = `translateX(${plot.valToPos(audio.currentTime || 0, 'x')}px)`
  }
  const seek = () => {
    const audio = audioRef.current
    const left = plot.cursor.left
    if (!audio || left == null || !audio.src) return
    const t = plot.posToVal(left, 'x')
    if (!Number.isFinite(t)) return
    audio.currentTime = Math.min(Math.max(0, t), maxT)
    place()
  }
  plot.over.addEventListener('click', seek)
  const audio = audioRef.current
  audio?.addEventListener('timeupdate', place)
  audio?.addEventListener('seeked', place)
  place()

  return {
    place,
    unbind() {
      audio?.removeEventListener('timeupdate', place)
      audio?.removeEventListener('seeked', place)
      plot.over.removeEventListener('click', seek)
    },
  }
}

function LoudnessPlot({
  samples,
  durationS,
  gain,
  audioRef,
}: {
  samples: number[]
  durationS: number
  gain: number
  audioRef: RefObject<HTMLAudioElement | null>
}) {
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = box.current
    if (!el || samples.length === 0) return
    const maxT = Math.max(durationS, 0.001)
    const yOf = (v: number) => Math.min(1, Math.max(0, v * gain))
    let xs: number[]
    let ys: number[]
    if (samples.length === 1) {
      xs = [0, maxT]
      ys = [yOf(samples[0]), yOf(samples[0])]
    } else {
      const step = durationS / samples.length
      xs = samples.map((_, i) => i * step)
      ys = samples.map(yOf)
    }

    const plot = new uPlot(
      {
        width: el.clientWidth || 600,
        height: HEIGHT,
        legend: { show: false },
        cursor: {
          y: false,
          points: { show: false },
          drag: { x: false, y: false, setScale: false },
        },
        scales: {
          x: { time: false, range: [0, maxT] },
          y: { range: [0, 1] },
        },
        axes: [
          { stroke: '#9aa4b2', grid: { stroke: '#222a35' }, label: 'seconds' },
          { stroke: '#9aa4b2', grid: { stroke: '#222a35' } },
        ],
        series: [{}, { stroke: '#4ade80', width: 2, fill: 'rgba(74,222,128,0.12)' }],
      },
      [xs, ys],
      el,
    )

    const playback = bindPlayback(plot, audioRef, maxT)
    const ro = new ResizeObserver(() => {
      plot.setSize({ width: el.clientWidth || 600, height: HEIGHT })
      playback.place()
    })
    ro.observe(el)

    return () => {
      playback.unbind()
      ro.disconnect()
      plot.destroy()
    }
  }, [samples, durationS, gain, audioRef])

  return (
    <div>
      <h2>Loudness</h2>
      <div ref={box} className="graph" />
    </div>
  )
}

function WaveformPlot({
  peaks,
  durationS,
  audioRef,
}: {
  peaks: number[]
  durationS: number
  audioRef: RefObject<HTMLAudioElement | null>
}) {
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = box.current
    if (!el || peaks.length < 2) return
    const maxT = Math.max(durationS, 0.001)
    const pairs = peaks.length / 2
    const step = maxT / pairs
    const xs: number[] = []
    const ys: number[] = []
    let peak = 0
    for (let i = 0; i < pairs; i++) {
      const lo = peaks[i * 2]
      const hi = peaks[i * 2 + 1]
      const x = (i + 0.5) * step
      xs.push(x, x)
      ys.push(lo, hi)
      peak = Math.max(peak, Math.abs(lo), Math.abs(hi))
    }
    const amp = Math.max(0.05, peak)

    const plot = new uPlot(
      {
        width: el.clientWidth || 600,
        height: HEIGHT,
        legend: { show: false },
        cursor: {
          y: false,
          points: { show: false },
          drag: { x: false, y: false, setScale: false },
        },
        scales: {
          x: { time: false, range: [0, maxT] },
          y: { range: [-amp, amp] },
        },
        axes: [
          { stroke: '#9aa4b2', grid: { stroke: '#222a35' }, label: 'seconds' },
          { stroke: '#9aa4b2', grid: { stroke: '#222a35' } },
        ],
        series: [{}, { stroke: '#7dd3fc', width: 1 }],
      },
      [xs, ys],
      el,
    )

    const playback = bindPlayback(plot, audioRef, maxT)
    const ro = new ResizeObserver(() => {
      plot.setSize({ width: el.clientWidth || 600, height: HEIGHT })
      playback.place()
    })
    ro.observe(el)

    return () => {
      playback.unbind()
      ro.disconnect()
      plot.destroy()
    }
  }, [peaks, durationS, audioRef])

  return (
    <div>
      <h2>Waveform</h2>
      <div ref={box} className="graph" />
    </div>
  )
}

export default function RecordingsPage({
  search,
  go,
}: {
  search: string
  go: (event: MouseEvent<HTMLAnchorElement> | null, next: string) => void
}) {
  const gain = useStore((s) => s.settings.gain)
  const [mode, setMode] = useState<'last' | 'paged'>('last')
  const [sizeChoice, setSizeChoice] = useState<'20' | '50' | '100' | 'custom'>('50')
  const [custom, setCustom] = useState('25')
  const [size, setSize] = useState(50)
  const [offset, setOffset] = useState(0)
  const [entries, setEntries] = useState<EntrySummary[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [openId, setOpenId] = useState<number | null>(null)
  const [detail, setDetail] = useState<EntryDetail | null>(null)
  const [detailError, setDetailError] = useState('')
  const [fileMissing, setFileMissing] = useState(false)
  const [queue, setQueue] = useState<number[] | null>(null)
  const [queueAt, setQueueAt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const anchorRef = useRef<number | null>(null)
  const shiftRef = useRef(false)
  const queueRef = useRef<number[] | null>(null)
  const queueAtRef = useRef(0)
  const audioRef = useRef<HTMLAudioElement>(null)
  const allRef = useRef<HTMLInputElement>(null)

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entries
    return entries.filter((e) => when(e.startedAt).toLowerCase().includes(q))
  }, [entries, query])

  const selectedIds = shown.filter((e) => selected.has(e.id)).map((e) => e.id)
  const shownDuration = shown.reduce((sum, e) => sum + e.durationS, 0)
  const allSelected = shown.length > 0 && selectedIds.length === shown.length

  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = selectedIds.length > 0 && !allSelected
  }, [selectedIds.length, allSelected])

  useEffect(() => {
    const visible = new Set(shown.map((e) => e.id))
    setSelected((prev) => {
      let changed = false
      const next = new Set<number>()
      for (const id of prev) {
        if (visible.has(id)) next.add(id)
        else changed = true
      }
      return changed ? next : prev
    })
  }, [shown])

  useEffect(() => {
    const ac = new AbortController()
    const off = mode === 'last' ? 0 : offset
    setLoading(true)
    fetch(`/api/entries?limit=${size}&offset=${off}`, { signal: ac.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error('load')
        return (await r.json()) as EntryPage
      })
      .then((data) => {
        if (!Array.isArray(data.entries) || typeof data.total !== 'number') throw new Error('load')
        setEntries(data.entries)
        setTotal(data.total)
        setListError('')
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (isAbort(err)) return
        setEntries([])
        setTotal(0)
        setLoading(false)
        setListError('Could not load recordings.')
      })
    return () => ac.abort()
  }, [mode, size, offset, reload])

  useEffect(() => {
    const raw = new URLSearchParams(search).get('open')
    if (raw == null) return
    const id = Number(raw)
    setOpenId(Number.isInteger(id) && id > 0 ? id : null)
  }, [search])

  useEffect(() => {
    if (openId == null) {
      setDetail(null)
      setDetailError('')
      return
    }
    const ac = new AbortController()
    fetch(`/api/entries/${openId}`, { signal: ac.signal })
      .then(async (r) => {
        if (r.status === 404) throw new Error('missing')
        if (!r.ok) throw new Error('load')
        return (await r.json()) as EntryDetail
      })
      .then((row) => {
        setDetail(row)
        setDetailError('')
        setFileMissing(!row.audioPath)
      })
      .catch((err: unknown) => {
        if (isAbort(err)) return
        setDetail(null)
        const missing = err instanceof Error && err.message === 'missing'
        setDetailError(missing ? 'Recording not found.' : 'Could not open the recording.')
      })
    return () => ac.abort()
  }, [openId])

  useEffect(() => {
    const el = audioRef.current
    if (!el || !detail) return
    if (!detail.audioPath) {
      el.pause()
      el.removeAttribute('src')
      void el.load()
      return
    }
    const next = `/api/entries/${detail.id}/audio`
    if (!el.src.endsWith(next)) el.src = next
  }, [detail])

  function resetSelection() {
    setSelected(new Set())
    anchorRef.current = null
  }

  function rememberQueue(ids: number[] | null, at: number) {
    queueRef.current = ids
    queueAtRef.current = at
    setQueue(ids)
    setQueueAt(at)
  }

  function pointAudio(id: number, play: boolean) {
    const el = audioRef.current
    if (!el) return
    const row = entries.find((e) => e.id === id)
    if (row && !row.audioPath) {
      el.pause()
      el.removeAttribute('src')
      void el.load()
      setFileMissing(true)
      return
    }
    setFileMissing(false)
    const next = `/api/entries/${id}/audio`
    if (!el.src.endsWith(next)) el.src = next
    if (play) {
      el.currentTime = 0
      void el.play().catch(() => {})
    } else {
      el.pause()
    }
  }

  function choose(id: number, shift: boolean) {
    if (shift) {
      extend(id)
      return
    }
    openTake(id)
    pointAudio(id, false)
  }

  function openTake(id: number, keepQueue = false) {
    anchorRef.current = id
    if (openId !== id) {
      setDetail(null)
      setDetailError('')
      setFileMissing(false)
    }
    setOpenId(id)
    if (!keepQueue) rememberQueue(null, 0)
    const next = `/recordings?open=${id}`
    if (window.location.pathname + window.location.search !== next) {
      window.history.replaceState(null, '', next)
    }
  }

  function toggleOne(id: number) {
    anchorRef.current = id
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function extend(id: number) {
    const ids = shown.map((e) => e.id)
    const anchor = anchorRef.current
    if (anchor == null || !ids.includes(anchor)) {
      toggleOne(id)
      return
    }
    const a = ids.indexOf(anchor)
    const b = ids.indexOf(id)
    const [from, to] = a < b ? [a, b] : [b, a]
    setSelected((prev) => {
      const next = new Set(prev)
      for (let i = from; i <= to; i++) next.add(ids[i])
      return next
    })
  }

  function toggleAll() {
    if (allSelected) resetSelection()
    else {
      setSelected(new Set(shown.map((e) => e.id)))
      anchorRef.current = shown.length ? shown[shown.length - 1].id : null
    }
  }

  function applySize(n: number) {
    const next = Math.min(500, Math.max(1, Math.round(n)))
    if (!Number.isFinite(next)) return
    setSize(next)
    setOffset(0)
    resetSelection()
  }

  function onChoice(choice: '20' | '50' | '100' | 'custom') {
    setSizeChoice(choice)
    if (choice === 'custom') {
      const n = Number(custom)
      if (Number.isInteger(n) && n >= 1) applySize(n)
      return
    }
    applySize(Number(choice))
  }

  function onMode(next: 'last' | 'paged') {
    setMode(next)
    setOffset(0)
    resetSelection()
  }

  function goPage(nextOffset: number) {
    setOffset(nextOffset)
    resetSelection()
  }

  function playIds(ids: number[], at: number) {
    rememberQueue(ids, at)
    openTake(ids[at], true)
    pointAudio(ids[at], true)
  }

  function playSelection() {
    if (!selectedIds.length) return
    playIds(selectedIds, 0)
  }

  function step(delta: number) {
    const q = queueRef.current
    if (!q) return
    const next = queueAtRef.current + delta
    if (next < 0 || next >= q.length) return
    playIds(q, next)
  }

  function onEnded() {
    const q = queueRef.current
    if (!q) return
    const next = queueAtRef.current + 1
    if (next >= q.length) return
    playIds(q, next)
  }

  async function removeIds(ids: number[]) {
    if (!ids.length || busy) return
    const noun = ids.length === 1 ? 'recording' : 'recordings'
    if (!window.confirm(`Delete ${ids.length} ${noun}? This removes the audio files.`)) return
    setBusy(true)
    setListError('')
    try {
      let deleted = 0
      for (let i = 0; i < ids.length; i += 100) {
        const chunk = ids.slice(i, i + 100)
        const res =
          chunk.length === 1
            ? await fetch(`/api/entries/${chunk[0]}`, { method: 'DELETE' })
            : await fetch('/api/entries/delete', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ ids: chunk }),
              })
        if (!res.ok) throw new Error('delete failed')
        const body = (await res.json()) as { deleted: number }
        deleted += body.deleted
      }
      const removed = new Set(ids)
      if (openId != null && removed.has(openId)) {
        setOpenId(null)
        setDetail(null)
        const el = audioRef.current
        if (el) {
          el.pause()
          el.removeAttribute('src')
          void el.load()
        }
        if (window.location.search) window.history.replaceState(null, '', '/recordings')
      }
      rememberQueue(null, 0)
      resetSelection()
      const nextTotal = Math.max(0, total - deleted)
      if (mode === 'paged' && offset > 0 && offset >= nextTotal) setOffset(Math.max(0, offset - size))
      else setReload((n) => n + 1)
    } catch {
      setListError('Could not delete the recording.')
    } finally {
      setBusy(false)
    }
  }

  const from = total === 0 ? 0 : mode === 'last' ? 1 : offset + 1
  const to = mode === 'last' ? entries.length : Math.min(total, offset + entries.length)

  return (
    <div className="recordings">
      <section className="card">
        <h2>Recordings</h2>
        <div className="row">
          <input
            type="text"
            value={query}
            placeholder="Search date"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="row">
          <select value={mode} onChange={(e) => onMode(e.target.value as 'last' | 'paged')}>
            <option value="last">Last</option>
            <option value="paged">Paged</option>
          </select>
          <select value={sizeChoice} onChange={(e) => onChoice(e.target.value as '20' | '50' | '100' | 'custom')}>
            {PAGE_SIZES.map((n) => (
              <option key={n} value={String(n)}>
                {n}
              </option>
            ))}
            <option value="custom">Custom</option>
          </select>
          {sizeChoice === 'custom' && (
            <input
              className="n"
              type="number"
              min={1}
              max={500}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onBlur={() => {
                const n = Number(custom)
                if (Number.isInteger(n) && n >= 1) applySize(n)
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return
                const n = Number(custom)
                if (Number.isInteger(n) && n >= 1) applySize(n)
              }}
            />
          )}
        </div>
        <p className="muted">
          {shown.length} shown · {formatDuration(shownDuration)}
          {selectedIds.length > 0 ? ` · ${selectedIds.length} selected` : ''}
        </p>
        <div className="row">
          <button type="button" className="small" disabled={!selectedIds.length || busy} onClick={playSelection}>
            Play selection
          </button>
          <button
            type="button"
            className="small stop"
            disabled={!selectedIds.length || busy}
            onClick={() => void removeIds(selectedIds)}
          >
            Delete selection
          </button>
        </div>
        {listError && <p className="error">{listError}</p>}
        {!listError && loading && entries.length === 0 && <p className="muted">Loading…</p>}
        {!listError && !loading && entries.length === 0 && <p className="muted">Nothing saved yet.</p>}
        {!listError && entries.length > 0 && shown.length === 0 && <p className="muted">No recordings match.</p>}
        {shown.length > 0 && (
          <ul className="rec-list">
            <li>
              <label>
                <input ref={allRef} type="checkbox" checked={allSelected} onChange={toggleAll} />
                <span className="muted">All</span>
              </label>
            </li>
            {shown.map((e) => (
              <li key={e.id} className={e.id === openId ? 'open' : ''}>
                <input
                  type="checkbox"
                  checked={selected.has(e.id)}
                  aria-label={`Select ${when(e.startedAt)}`}
                  onMouseDown={(ev) => {
                    shiftRef.current = ev.shiftKey
                  }}
                  onChange={() => {
                    if (shiftRef.current) extend(e.id)
                    else toggleOne(e.id)
                    shiftRef.current = false
                  }}
                />
                <button
                  type="button"
                  className="text"
                  onClick={(ev) => choose(e.id, ev.shiftKey)}
                >
                  <span>{when(e.startedAt)}</span>
                  <span className="muted">{e.durationS.toFixed(1)} s</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {mode === 'last' && !loading && <p className="muted">Newest {entries.length} of {total}</p>}
        {mode === 'paged' && (
          <div className="row pager">
            <button type="button" className="small" disabled={offset === 0 || busy} onClick={() => goPage(Math.max(0, offset - size))}>
              Previous
            </button>
            <span className="muted">
              {from}–{to} of {total}
            </span>
            <button
              type="button"
              className="small"
              disabled={offset + size >= total || busy}
              onClick={() => goPage(offset + size)}
            >
              Next
            </button>
          </div>
        )}
      </section>

      <section className="card">
        {!detail && !detailError && <p className="muted">Select a recording.</p>}
        {detailError && <p className="error">{detailError}</p>}
        {detail && (
          <>
            <h2>{when(detail.startedAt)}</h2>
            <p className="muted">{detail.durationS.toFixed(1)} s</p>
            {queue && (
              <div className="row">
                <button type="button" className="small" disabled={queueAt <= 0} onClick={() => step(-1)}>
                  Previous
                </button>
                <span className="muted">
                  {queueAt + 1} of {queue.length}
                </span>
                <button type="button" className="small" disabled={queueAt >= queue.length - 1} onClick={() => step(1)}>
                  Next
                </button>
              </div>
            )}
            {detail.audioPath && !fileMissing && (
              <div className="row">
                <a className="nav" href={`/api/entries/${detail.id}/audio`} download={`${detail.id}.wav`}>
                  Download
                </a>
                <a
                  className="nav"
                  href={`/recordings/edit?id=${detail.id}`}
                  onClick={(e) => go(e, `/recordings/edit?id=${detail.id}`)}
                >
                  Edit
                </a>
              </div>
            )}
            {(fileMissing || !detail.audioPath) && <p className="error">Audio file is missing.</p>}
            {detail.waveform != null && detail.waveform.length > 0 ? (
              <WaveformPlot peaks={detail.waveform} durationS={detail.durationS} audioRef={audioRef} />
            ) : detail.waveform == null && detail.samples.length > 0 ? (
              <LoudnessPlot samples={detail.samples} durationS={detail.durationS} gain={gain} audioRef={audioRef} />
            ) : (
              <p className="muted">{detail.waveform == null ? 'No loudness samples.' : 'No waveform samples.'}</p>
            )}
          </>
        )}
        <audio
          ref={audioRef}
          className="clip"
          controls
          hidden={!detail?.audioPath || fileMissing}
          onEnded={onEnded}
          onError={() => {
            const el = audioRef.current
            if (!detail?.audioPath || !el?.src.endsWith(`/api/entries/${detail.id}/audio`)) return
            setFileMissing(true)
          }}
        />
      </section>
    </div>
  )
}
