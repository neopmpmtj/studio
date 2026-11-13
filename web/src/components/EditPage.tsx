import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type MouseEvent, type RefObject } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { cropPcm, parseWavPcm, sliceSeries } from '../../../shared/crop'
import { keptSpans, type EntryDetail, type KeepSpan } from '../../../shared/types'
import { useStore } from '../store/settings'

const HEIGHT = 240
const MIN_CUT = 0.02
const MIN_ZOOM = 0.05

type ChartHandle = {
  reveal: (start: number, end: number) => void
  zoomTo: (start: number, end: number) => void
}

type EditorMode = 'normal' | 'fast'
type FastTool = 'delete' | 'play' | 'select' | 'zoom'

type SelectionMark = { index: number; start: number; end: number }

type Snap = {
  trim: { start: number; end: number }
  applied: KeepSpan[]
  pending: KeepSpan[]
}

type Drawn = {
  xs: number[]
  ys: number[]
  yMin: number
  yMax: number
  title: string
  stroke: string
  width: number
  fill?: string
}

type WavPcm = { pcm: Uint8Array; sampleRate: number }

const EMPTY: Snap = { trim: { start: 0, end: 0 }, applied: [], pending: [] }

function formatSec(seconds: number) {
  return `${seconds.toFixed(2)} s`
}

function when(iso: string) {
  return new Date(iso).toLocaleString()
}

function saveAsTarget(audioPath: string) {
  return audioPath.toLowerCase().startsWith('modified/') ? audioPath : `modified/${audioPath}`
}

function mergeCuts(cuts: KeepSpan[]): KeepSpan[] {
  const sorted = [...cuts].sort((a, b) => a.start - b.start)
  const out: KeepSpan[] = []
  for (const cut of sorted) {
    const last = out[out.length - 1]
    if (last && cut.start <= last.end) last.end = Math.max(last.end, cut.end)
    else out.push({ start: cut.start, end: cut.end })
  }
  return out
}

function clampCuts(cuts: KeepSpan[], start: number, end: number): KeepSpan[] {
  const next = cuts
    .map((cut) => ({ start: Math.max(cut.start, start), end: Math.min(cut.end, end) }))
    .filter((cut) => cut.end - cut.start >= MIN_CUT)
  if (next.length === cuts.length && next.every((cut, i) => cut.start === cuts[i].start && cut.end === cuts[i].end)) {
    return cuts
  }
  return next
}

function sameSpans(a: KeepSpan[], b: KeepSpan[]) {
  return a.length === b.length && a.every((span, i) => span.start === b[i].start && span.end === b[i].end)
}

function sameSnap(a: Snap, b: Snap) {
  return a.trim.start === b.trim.start && a.trim.end === b.trim.end && sameSpans(a.applied, b.applied) && sameSpans(a.pending, b.pending)
}

function originalAt(previewT: number, keep: KeepSpan[]) {
  if (keep.length === 0) return 0
  let cursor = 0
  for (let i = 0; i < keep.length; i++) {
    const span = keep[i]
    const len = span.end - span.start
    if (i === keep.length - 1 || previewT < cursor + len) {
      return Math.min(span.end, Math.max(span.start, span.start + (previewT - cursor)))
    }
    cursor += len
  }
  return keep[keep.length - 1].end
}

function previewAt(originalT: number, keep: KeepSpan[]) {
  let cursor = 0
  for (const span of keep) {
    if (originalT <= span.start) return cursor
    if (originalT <= span.end) return cursor + (originalT - span.start)
    cursor += span.end - span.start
  }
  return cursor
}

function isEdited(snap: Snap, duration: number) {
  return snap.applied.length > 0 || snap.trim.start > 1e-6 || snap.trim.end < duration - 1e-3
}

function wavBlob(pcm: Uint8Array, sampleRate: number) {
  const out = new ArrayBuffer(44 + pcm.length)
  const view = new DataView(out)
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i))
  }
  write(0, 'RIFF')
  view.setUint32(4, 36 + pcm.length, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, pcm.length, true)
  new Uint8Array(out, 44).set(pcm)
  return new Blob([out], { type: 'audio/wav' })
}

function flatSeries(maxT: number, title: string, stroke: string): Drawn {
  return { xs: [0, maxT], ys: [0, 0], yMin: title === 'Loudness' ? 0 : -1, yMax: 1, title, stroke, width: title === 'Loudness' ? 2 : 1 }
}

function seriesFor(detail: EntryDetail, gain: number, keep: KeepSpan[], keptS: number): Drawn {
  const maxT = Math.max(keptS, 0.001)
  const wave = detail.waveform
  if (wave && wave.length >= 2) {
    const sliced = sliceSeries(wave, detail.durationS, keep, true)
    const pairs = sliced.length / 2
    if (pairs >= 1) {
      const step = maxT / pairs
      const xs: number[] = []
      const ys: number[] = []
      let peak = 0
      for (let i = 0; i < pairs; i++) {
        const lo = sliced[i * 2]
        const hi = sliced[i * 2 + 1]
        xs.push((i + 0.5) * step, (i + 0.5) * step)
        ys.push(lo, hi)
        peak = Math.max(peak, Math.abs(lo), Math.abs(hi))
      }
      const amp = Math.max(0.05, peak)
      return { xs, ys, yMin: -amp, yMax: amp, title: 'Waveform', stroke: '#7dd3fc', width: 1 }
    }
    return flatSeries(maxT, 'Waveform', '#7dd3fc')
  }
  if (detail.samples.length > 0) {
    const sliced = sliceSeries(detail.samples, detail.durationS, keep, false)
    const yOf = (v: number) => Math.min(1, Math.max(0, v * gain))
    if (sliced.length === 1) {
      const y = yOf(sliced[0])
      return { xs: [0, maxT], ys: [y, y], yMin: 0, yMax: 1, title: 'Loudness', stroke: '#4ade80', width: 2, fill: 'rgba(74,222,128,0.12)' }
    }
    if (sliced.length > 1) {
      const step = maxT / sliced.length
      return {
        xs: sliced.map((_, i) => i * step),
        ys: sliced.map(yOf),
        yMin: 0,
        yMax: 1,
        title: 'Loudness',
        stroke: '#4ade80',
        width: 2,
        fill: 'rgba(74,222,128,0.12)',
      }
    }
    return flatSeries(maxT, 'Loudness', '#4ade80')
  }
  return flatSeries(maxT, 'Waveform', '#7dd3fc')
}

const CropChart = forwardRef<
  ChartHandle,
  {
    audioRef: RefObject<HTMLAudioElement | null>
    series: Drawn
    maxT: number
    selections: SelectionMark[]
    onTrim: (start: number, end: number) => void
    onSelect: (start: number, end: number) => void
    onResize: (index: number, start: number, end: number) => void
  }
>(function CropChart({ audioRef, series, maxT, selections, onTrim, onSelect, onResize }, ref) {
  const box = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const seriesRef = useRef(series)
  const maxTRef = useRef(maxT)
  const selectionsRef = useRef(selections)
  const cb = useRef({ onTrim, onSelect, onResize })
  const viewRef = useRef({ start: 0, end: maxT })
  const [ready, setReady] = useState(0)
  const [view, setView] = useState({ start: 0, end: maxT })
  const [dragTrim, setDragTrim] = useState<{ start: number; end: number } | null>(null)
  const [dragSel, setDragSel] = useState<SelectionMark | null>(null)
  seriesRef.current = series
  maxTRef.current = maxT
  selectionsRef.current = selections
  cb.current = { onTrim, onSelect, onResize }
  const look = `${series.stroke}|${series.width}|${series.fill ?? ''}`

  const applyView = (next: { start: number; end: number }) => {
    viewRef.current = next
    const plot = plotRef.current
    if (plot) {
      plot.setScale('x', { min: next.start, max: next.end })
      plot.over.dispatchEvent(new Event('crop-resize'))
    }
    setView(next)
  }
  const applyViewRef = useRef(applyView)
  applyViewRef.current = applyView

  useImperativeHandle(ref, () => ({
    reveal(start: number, end: number) {
      const limit = Math.max(maxTRef.current, 0.001)
      const cur = viewRef.current
      const width = Math.max(cur.end - cur.start, 0.001)
      const a = Math.max(0, Math.min(start, limit))
      const b = Math.max(a, Math.min(end, limit))
      if (a >= cur.start - 1e-4 && b <= cur.end + 1e-4) return
      const span = Math.max(b - a, 0.001)
      if (span <= width) {
        let left = a
        let right = a + width
        if (right > limit) {
          right = limit
          left = Math.max(0, limit - width)
        }
        applyViewRef.current({ start: left, end: right })
        return
      }
      applyViewRef.current({ start: a, end: Math.min(limit, b) })
    },
    zoomTo(start: number, end: number) {
      const limit = Math.max(maxTRef.current, 0.001)
      const lo = Math.max(0, Math.min(Math.min(start, end), limit))
      const hi = Math.max(0, Math.min(Math.max(start, end), limit))
      const width = Math.min(limit, Math.max(hi - lo, Math.min(MIN_ZOOM, limit)))
      const mid = (lo + hi) / 2
      let left = mid - width / 2
      let right = left + width
      if (left < 0) {
        left = 0
        right = width
      }
      if (right > limit) {
        right = limit
        left = Math.max(0, right - width)
      }
      applyViewRef.current({ start: left, end: right })
    },
  }))

  useEffect(() => {
    const el = box.current
    if (!el) return
    const drawn = seriesRef.current
    const plot = new uPlot(
      {
        width: el.clientWidth || 600,
        height: HEIGHT,
        legend: { show: false },
        cursor: { y: false, points: { show: false }, drag: { x: false, y: false, setScale: false } },
        scales: {
          x: { time: false, min: 0, max: Math.max(maxTRef.current, 0.001) },
          y: { min: drawn.yMin, max: drawn.yMax },
        },
        axes: [
          { stroke: '#9aa4b2', grid: { stroke: '#222a35' }, label: 'seconds' },
          { stroke: '#9aa4b2', grid: { stroke: '#222a35' } },
        ],
        series: [{}, { stroke: drawn.stroke, width: drawn.width, fill: drawn.fill }],
      },
      [drawn.xs, drawn.ys],
      el,
    )
    plotRef.current = plot
    const over = plot.over
    const draft = document.createElement('div')
    draft.className = 'crop-select draft'
    draft.style.width = '0px'
    over.appendChild(draft)
    const head = document.createElement('div')
    head.className = 'playhead'
    over.appendChild(head)

    const placeHead = () => {
      const audio = audioRef.current
      if (!audio) return
      const t = Math.min(maxTRef.current, Math.max(0, audio.currentTime || 0))
      head.style.transform = `translateX(${plot.valToPos(t, 'x')}px)`
    }
    const audio = audioRef.current
    audio?.addEventListener('timeupdate', placeHead)
    audio?.addEventListener('seeked', placeHead)
    audio?.addEventListener('loadedmetadata', placeHead)
    placeHead()

    const timeAt = (clientX: number) => {
      const t = plot.posToVal(clientX - over.getBoundingClientRect().left, 'x')
      if (!Number.isFinite(t)) return 0
      return Math.min(maxTRef.current, Math.max(0, t))
    }
    let drag: {
      kind: 'start' | 'end' | 'cut' | 'sel-start' | 'sel-end'
      t0: number
      x0: number
      moved: boolean
      start: number
      end: number
      index: number
    } | null = null
    const down = (e: PointerEvent) => {
      const target = e.target as HTMLElement
      const handle = target.dataset.crop
      const t = timeAt(e.clientX)
      const end = maxTRef.current
      if (handle === 'start' || handle === 'end') drag = { kind: handle, t0: t, x0: e.clientX, moved: false, start: 0, end, index: -1 }
      else if (handle === 'sel-start' || handle === 'sel-end') {
        const index = Number(target.dataset.index)
        const sel = selectionsRef.current.find((item) => item.index === index)
        if (!sel) return
        drag = { kind: handle, t0: t, x0: e.clientX, moved: false, start: sel.start, end: sel.end, index }
      } else drag = { kind: 'cut', t0: t, x0: e.clientX, moved: false, start: t, end: t, index: -1 }
      over.setPointerCapture(e.pointerId)
    }
    const move = (e: PointerEvent) => {
      if (!drag) return
      const t = timeAt(e.clientX)
      if (Math.abs(e.clientX - drag.x0) > 4) drag.moved = true
      if (!drag.moved) return
      if (drag.kind === 'start' || drag.kind === 'end') {
        const minKeep = Math.min(0.05, maxTRef.current / 2)
        if (drag.kind === 'start') drag.start = Math.min(Math.max(0, t), drag.end - minKeep)
        else drag.end = Math.max(drag.start + minKeep, Math.min(maxTRef.current, t))
        setDragTrim({ start: drag.start, end: drag.end })
      } else if (drag.kind === 'sel-start' || drag.kind === 'sel-end') {
        if (drag.kind === 'sel-start') drag.start = Math.min(Math.max(0, t), drag.end - MIN_CUT)
        else drag.end = Math.max(drag.start + MIN_CUT, Math.min(maxTRef.current, t))
        setDragSel({ index: drag.index, start: drag.start, end: drag.end })
      } else {
        const a = Math.min(drag.t0, t)
        const b = Math.max(drag.t0, t)
        const x0 = plot.valToPos(a, 'x')
        const x1 = plot.valToPos(b, 'x')
        draft.style.transform = `translateX(${x0}px)`
        draft.style.width = `${Math.max(0, x1 - x0)}px`
      }
    }
    const up = (e: PointerEvent) => {
      if (!drag) return
      const t = timeAt(e.clientX)
      if (drag.kind === 'start' || drag.kind === 'end') {
        if (drag.moved) cb.current.onTrim(drag.start, drag.end)
        setDragTrim(null)
      } else if (drag.kind === 'sel-start' || drag.kind === 'sel-end') {
        if (drag.moved) cb.current.onResize(drag.index, drag.start, drag.end)
        setDragSel(null)
      } else if (drag.moved) {
        cb.current.onSelect(Math.min(drag.t0, t), Math.max(drag.t0, t))
      } else if (audioRef.current?.src) {
        audioRef.current.currentTime = t
        placeHead()
      }
      draft.style.width = '0px'
      drag = null
    }
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const limit = Math.max(maxTRef.current, 0.001)
      const cur = viewRef.current
      const span = Math.max(cur.end - cur.start, 0.001)
      const minSpan = Math.min(MIN_ZOOM, limit)
      const width = Math.min(limit, Math.max(minSpan, span * (e.deltaY < 0 ? 0.5 : 2)))
      const ratio = (timeAt(e.clientX) - cur.start) / span
      let start = timeAt(e.clientX) - ratio * width
      let end = start + width
      if (start < 0) {
        start = 0
        end = width
      }
      if (end > limit) {
        end = limit
        start = Math.max(0, end - width)
      }
      if (Math.abs(start - cur.start) < 1e-4 && Math.abs(end - cur.end) < 1e-4) return
      applyViewRef.current({ start, end })
    }
    over.addEventListener('pointerdown', down)
    over.addEventListener('pointermove', move)
    over.addEventListener('pointerup', up)
    over.addEventListener('pointercancel', up)
    el.addEventListener('wheel', onWheel, { passive: false })

    const ro = new ResizeObserver(() => {
      plot.setSize({ width: el.clientWidth || 600, height: HEIGHT })
      placeHead()
      over.dispatchEvent(new Event('crop-resize'))
    })
    ro.observe(el)
    setReady((n) => n + 1)

    return () => {
      audio?.removeEventListener('timeupdate', placeHead)
      audio?.removeEventListener('seeked', placeHead)
      audio?.removeEventListener('loadedmetadata', placeHead)
      over.removeEventListener('pointerdown', down)
      over.removeEventListener('pointermove', move)
      over.removeEventListener('pointerup', up)
      over.removeEventListener('pointercancel', up)
      el.removeEventListener('wheel', onWheel)
      ro.disconnect()
      plotRef.current = null
      plot.destroy()
    }
  }, [look, audioRef])

  const seenMax = useRef<number | null>(null)
  useEffect(() => {
    if (seenMax.current === maxT) return
    seenMax.current = maxT
    applyViewRef.current({ start: 0, end: maxT })
  }, [maxT])

  useEffect(() => {
    const plot = plotRef.current
    if (!plot) return
    const shown = viewRef.current
    plot.batch(() => {
      plot.setData([series.xs, series.ys], false)
      plot.setScale('x', { min: shown.start, max: shown.end })
      plot.setScale('y', { min: series.yMin, max: series.yMax })
    })
  }, [ready, series, maxT])

  useEffect(() => {
    const plot = plotRef.current
    const over = plot?.over
    if (!plot || !over) return
    const place = () => {
      over.querySelectorAll('.crop-dim:not(.draft), .crop-select:not(.draft), .crop-handle').forEach((node) => node.remove())
      const start = dragTrim?.start ?? 0
      const end = dragTrim?.end ?? maxT
      for (const [a, b] of [
        [0, start],
        [end, maxT],
      ] as [number, number][]) {
        if (b <= a + 0.0001) continue
        const dim = document.createElement('div')
        dim.className = 'crop-dim'
        const x0 = plot.valToPos(a, 'x')
        const x1 = plot.valToPos(b, 'x')
        dim.style.transform = `translateX(${x0}px)`
        dim.style.width = `${Math.max(0, x1 - x0)}px`
        over.appendChild(dim)
      }
      const shownSelections = selections.map((sel) =>
        dragSel && dragSel.index === sel.index ? { ...sel, start: dragSel.start, end: dragSel.end } : sel,
      )
      for (const sel of shownSelections) {
        if (sel.end <= sel.start) continue
        const mark = document.createElement('div')
        mark.className = 'crop-select'
        const x0 = plot.valToPos(sel.start, 'x')
        const x1 = plot.valToPos(sel.end, 'x')
        mark.style.transform = `translateX(${x0}px)`
        mark.style.width = `${Math.max(0, x1 - x0)}px`
        over.appendChild(mark)
        for (const edge of ['sel-start', 'sel-end'] as const) {
          const handle = document.createElement('div')
          handle.className = 'crop-handle'
          handle.dataset.crop = edge
          handle.dataset.index = String(sel.index)
          handle.style.transform = `translateX(${plot.valToPos(edge === 'sel-start' ? sel.start : sel.end, 'x')}px)`
          over.appendChild(handle)
        }
      }
      for (const name of ['start', 'end'] as const) {
        const handle = document.createElement('div')
        handle.className = 'crop-handle'
        handle.dataset.crop = name
        handle.style.transform = `translateX(${plot.valToPos(name === 'start' ? start : end, 'x')}px)`
        over.appendChild(handle)
      }
    }
    place()
    over.addEventListener('crop-resize', place)
    return () => {
      over.removeEventListener('crop-resize', place)
      over.querySelectorAll('.crop-dim:not(.draft), .crop-select:not(.draft), .crop-handle').forEach((node) => node.remove())
    }
  }, [ready, dragTrim, dragSel, selections, maxT, view])

  return (
    <div className="crop">
      <h2>{series.title}</h2>
      <div ref={box} className="graph" />
    </div>
  )
})

export default function EditPage({
  search,
  go,
}: {
  search: string
  go: (event: MouseEvent<HTMLAnchorElement> | null, next: string) => void
}) {
  const id = Number(new URLSearchParams(search).get('id'))
  const valid = Number.isInteger(id) && id >= 1
  const gain = useStore((s) => s.settings.gain)
  const [detail, setDetail] = useState<EntryDetail | null>(null)
  const [missing, setMissing] = useState(false)
  const [fileMissing, setFileMissing] = useState(false)
  const [snap, setSnap] = useState<Snap>(EMPTY)
  const [past, setPast] = useState<Snap[]>([])
  const [wav, setWav] = useState<WavPcm | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editorMode, setEditorMode] = useState<EditorMode>('normal')
  const [fastTool, setFastTool] = useState<FastTool>('select')
  const audioRef = useRef<HTMLAudioElement>(null)
  const chartRef = useRef<ChartHandle>(null)
  const playUntil = useRef<number | null>(null)
  const playTimer = useRef(0)
  const ignoreSeek = useRef(false)
  const armingPlay = useRef(false)
  const snapRef = useRef(snap)
  const pastRef = useRef(past)
  const detailRef = useRef(detail)
  const previewUrl = useRef<string | null>(null)
  snapRef.current = snap
  pastRef.current = past
  detailRef.current = detail

  useEffect(() => {
    if (!valid) return
    const ac = new AbortController()
    setDetail(null)
    setMissing(false)
    setFileMissing(false)
    setError('')
    setWav(null)
    snapRef.current = EMPTY
    pastRef.current = []
    setSnap(EMPTY)
    setPast([])
    setEditorMode('normal')
    setFastTool('select')
    fetch(`/api/entries/${id}`, { signal: ac.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error('missing')
        return (await r.json()) as EntryDetail
      })
      .then((row) => {
        const initial = { trim: { start: 0, end: row.durationS }, applied: [], pending: [] }
        snapRef.current = initial
        pastRef.current = []
        setSnap(initial)
        setPast([])
        setDetail(row)
        if (!row.audioPath) setFileMissing(true)
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        if (typeof err === 'object' && err && 'name' in err && err.name === 'AbortError') return
        setMissing(true)
      })
    return () => ac.abort()
  }, [id, valid])

  useEffect(() => {
    if (!detail?.audioPath) return
    const ac = new AbortController()
    let cancelled = false
    fetch(`/api/entries/${detail.id}/audio`, { signal: ac.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error('missing')
        return new Uint8Array(await res.arrayBuffer())
      })
      .then((bytes) => {
        if (!cancelled) setWav(parseWavPcm(bytes))
      })
      .catch((err) => {
        if (cancelled) return
        if (err instanceof DOMException && err.name === 'AbortError') return
        if (typeof err === 'object' && err && 'name' in err && err.name === 'AbortError') return
        setWav(null)
      })
    return () => {
      cancelled = true
      ac.abort()
    }
  }, [detail])

  const keep = useMemo(
    () => (detail ? keptSpans(snap.trim.start, snap.trim.end, snap.applied) : []),
    [detail, snap.trim.start, snap.trim.end, snap.applied],
  )
  const keptS = keep.reduce((sum, span) => sum + (span.end - span.start), 0)
  const series = useMemo(() => (detail ? seriesFor(detail, gain, keep, keptS) : null), [detail, gain, keep, keptS])
  const selections = useMemo(() => {
    if (!detail) return []
    return snap.pending.map((cut, index) => ({
      index,
      start: previewAt(cut.start, keep),
      end: previewAt(cut.end, keep),
      blocked: keptSpans(snap.trim.start, snap.trim.end, mergeCuts([...snap.applied, cut])).length === 0,
    }))
  }, [detail, snap.pending, snap.applied, snap.trim.start, snap.trim.end, keep])
  const edited = detail ? isEdited(snap, detail.durationS) : false
  const back = `/recordings?open=${id}`
  const shownSrc = useRef('')

  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !detail) return
    const api = detail.audioPath && !fileMissing ? `/api/entries/${detail.id}/audio` : ''
    let next = api
    let created: string | null = null
    if (api && edited && wav && keep.length > 0) {
      const pcm = cropPcm(wav.pcm, wav.sampleRate, keep)
      if (pcm.length >= 2) {
        created = URL.createObjectURL(wavBlob(pcm, wav.sampleRate))
        next = created
      }
    }
    if (shownSrc.current !== next || !audio.getAttribute('src')) {
      shownSrc.current = next
      playUntil.current = null
      window.clearTimeout(playTimer.current)
      if (next) audio.src = next
      else audio.removeAttribute('src')
    }
    const previous = previewUrl.current
    previewUrl.current = created
    if (previous && previous !== created) URL.revokeObjectURL(previous)
  }, [detail, fileMissing, wav, keep, edited])

  useEffect(() => {
    return () => {
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current)
    }
  }, [])

  function push(next: Snap) {
    const cur = snapRef.current
    if (sameSnap(cur, next)) return
    pastRef.current = [...pastRef.current, cur]
    snapRef.current = next
    setPast(pastRef.current)
    setSnap(next)
  }

  function undo() {
    const stack = pastRef.current
    if (stack.length === 0) return
    const prev = stack[stack.length - 1]
    pastRef.current = stack.slice(0, -1)
    snapRef.current = prev
    setPast(pastRef.current)
    setSnap(prev)
  }

  function onTrim(previewStart: number, previewEnd: number) {
    const row = detailRef.current
    const cur = snapRef.current
    if (!row) return
    const base = keptSpans(cur.trim.start, cur.trim.end, cur.applied)
    const start = originalAt(Math.min(previewStart, previewEnd), base)
    const end = originalAt(Math.max(previewStart, previewEnd), base)
    const minKeep = Math.min(0.05, row.durationS / 2)
    if (!(end - start >= minKeep)) return
    const applied = clampCuts(cur.applied, start, end)
    const pending = clampCuts(cur.pending, start, end)
    const nextKeep = keptSpans(start, end, applied)
    if (sameSpans(nextKeep, base) && sameSpans(pending, cur.pending)) return
    push({ trim: { start, end }, applied, pending })
  }

  function onSelect(previewStart: number, previewEnd: number) {
    const start = Math.min(previewStart, previewEnd)
    const end = Math.max(previewStart, previewEnd)
    if (editorMode === 'fast' && fastTool === 'zoom') {
      chartRef.current?.zoomTo(start, end)
      return
    }
    if (end - start < MIN_CUT) return
    if (editorMode === 'fast' && fastTool === 'play') {
      playSpan(start, end)
      return
    }
    const cur = snapRef.current
    const base = keptSpans(cur.trim.start, cur.trim.end, cur.applied)
    const a = originalAt(start, base)
    const b = originalAt(end, base)
    if (b - a < MIN_CUT) return
    if (editorMode === 'fast' && fastTool === 'delete') {
      const applied = mergeCuts([...cur.applied, { start: a, end: b }])
      if (keptSpans(cur.trim.start, cur.trim.end, applied).length === 0) return
      push({ trim: cur.trim, applied, pending: cur.pending })
      return
    }
    const pending = mergeCuts([...cur.pending, { start: a, end: b }])
    if (sameSpans(pending, cur.pending)) return
    push({ trim: cur.trim, applied: cur.applied, pending })
  }

  function onResize(index: number, previewStart: number, previewEnd: number) {
    const cur = snapRef.current
    const base = keptSpans(cur.trim.start, cur.trim.end, cur.applied)
    const start = originalAt(Math.min(previewStart, previewEnd), base)
    const end = originalAt(Math.max(previewStart, previewEnd), base)
    if (end - start < MIN_CUT) return
    const pending = mergeCuts(cur.pending.map((span, i) => (i === index ? { start, end } : span)))
    if (sameSpans(pending, cur.pending)) return
    push({ trim: cur.trim, applied: cur.applied, pending })
  }

  function stopSpanPlay() {
    playUntil.current = null
    window.clearTimeout(playTimer.current)
  }

  function scheduleStop() {
    const audio = audioRef.current
    const end = playUntil.current
    if (!audio || end == null) return
    const remain = end - audio.currentTime
    if (remain <= 0) {
      playUntil.current = null
      window.clearTimeout(playTimer.current)
      audio.pause()
      return
    }
    window.clearTimeout(playTimer.current)
    playTimer.current = window.setTimeout(() => {
      const el = audioRef.current
      const limit = playUntil.current
      if (!el || limit == null) return
      if (el.currentTime >= limit - 0.03) {
        playUntil.current = null
        el.pause()
        return
      }
      scheduleStop()
    }, remain * 1000)
  }

  function playSpan(start: number, end: number) {
    const audio = audioRef.current
    if (!audio?.getAttribute('src') || !(end > start)) return
    chartRef.current?.reveal(start, end)
    const begin = () => {
      armingPlay.current = true
      playUntil.current = end
      const started = () => {
        armingPlay.current = false
        scheduleStop()
      }
      if (Math.abs(audio.currentTime - start) > 0.01) {
        ignoreSeek.current = true
        audio.addEventListener('seeked', started, { once: true })
        audio.currentTime = start
        window.setTimeout(() => {
          if (armingPlay.current && Math.abs(audio.currentTime - start) <= 0.05) started()
        }, 200)
      } else started()
      void audio.play()
    }
    if (audio.readyState >= 1) begin()
    else audio.addEventListener('loadedmetadata', begin, { once: true })
  }

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onSeeked = () => {
      if (ignoreSeek.current) {
        ignoreSeek.current = false
        return
      }
      stopSpanPlay()
    }
    const onPause = () => {
      if (ignoreSeek.current || armingPlay.current) return
      stopSpanPlay()
    }
    const onTime = () => {
      if (armingPlay.current) return
      const end = playUntil.current
      if (end == null || audio.currentTime < end) return
      playUntil.current = null
      window.clearTimeout(playTimer.current)
      audio.pause()
    }
    audio.addEventListener('seeked', onSeeked)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('timeupdate', onTime)
    return () => {
      audio.removeEventListener('seeked', onSeeked)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('timeupdate', onTime)
      window.clearTimeout(playTimer.current)
    }
  }, [detail])

  function removeAt(index: number) {
    const cur = snapRef.current
    const cut = cur.pending[index]
    if (!cut) return
    const applied = mergeCuts([...cur.applied, cut])
    const pending = cur.pending.filter((_, i) => i !== index)
    if (keptSpans(cur.trim.start, cur.trim.end, applied).length === 0) return
    push({ trim: cur.trim, applied, pending })
  }

  async function save(mode: 'overwrite' | 'copy') {
    if (!detail || keep.length === 0) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/entries/${detail.id}/crop`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode, keep }),
      })
      if (!res.ok) throw new Error('save failed')
      const body = (await res.json()) as { id: number }
      go(null, `/recordings?open=${body.id}`)
    } catch {
      setError('Could not save the crop.')
    } finally {
      setBusy(false)
    }
  }

  if (!valid || missing) {
    return (
      <section className="card wide">
        <p className="error">Recording not found.</p>
      </section>
    )
  }

  return (
    <section className="card wide">
      <a className="nav" href={back} onClick={(e) => go(e, back)}>
        Back
      </a>
      {!detail && <p className="muted">Loading…</p>}
      {detail && series && (
        <>
          <h2>{when(detail.startedAt)}</h2>
          <p className="muted">{detail.durationS.toFixed(1)} s</p>
          {fileMissing && <p className="error">Audio file is missing.</p>}
          <div className="row">
            <button type="button" className="small" aria-pressed={editorMode === 'normal'} onClick={() => setEditorMode('normal')}>
              Normal
            </button>
            <button type="button" className="small" aria-pressed={editorMode === 'fast'} onClick={() => setEditorMode('fast')}>
              Move fast
            </button>
          </div>
          {editorMode === 'fast' && (
            <div className="row">
              <button type="button" className="small" aria-pressed={fastTool === 'delete'} onClick={() => setFastTool('delete')}>
                Delete
              </button>
              <button type="button" className="small" aria-pressed={fastTool === 'play'} onClick={() => setFastTool('play')}>
                Play
              </button>
              <button type="button" className="small" aria-pressed={fastTool === 'select'} onClick={() => setFastTool('select')}>
                Select
              </button>
              <button type="button" className="small" aria-pressed={fastTool === 'zoom'} onClick={() => setFastTool('zoom')}>
                Zoom
              </button>
            </div>
          )}
          <CropChart
            ref={chartRef}
            audioRef={audioRef}
            series={series}
            maxT={Math.max(keptS, 0.001)}
            selections={selections}
            onTrim={onTrim}
            onSelect={onSelect}
            onResize={onResize}
          />
          {selections.length > 0 ? (
            <ul>
              {selections.map((sel) => (
                <li key={`${sel.index}-${sel.start}-${sel.end}`}>
                  <span>
                    Selected {formatSec(sel.start)} – {formatSec(sel.end)}
                  </span>
                  <span className="row">
                    <button type="button" className="small" disabled={fileMissing || busy} onClick={() => playSpan(sel.start, sel.end)}>
                      Play
                    </button>
                    <button type="button" className="small" disabled={sel.blocked || busy} onClick={() => removeAt(sel.index)}>
                      Remove
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">
              {editorMode === 'fast' && fastTool === 'delete'
                ? 'Drag across the chart. The section is removed when you release.'
                : editorMode === 'fast' && fastTool === 'play'
                  ? 'Drag across the chart. The section plays when you release, then the selection clears.'
                  : editorMode === 'fast' && fastTool === 'zoom'
                    ? 'Drag across the chart. The view fits that span when you release.'
                    : 'Drag across the chart to select a section. Remove drops it from the wave and the player. Drag the edges to trim.'}
            </p>
          )}
          <p className="muted">Kept {formatSec(keptS)}</p>
          <div className="row">
            <button type="button" className="small" disabled={past.length === 0 || busy} onClick={undo}>
              Undo
            </button>
            <button type="button" className="small" disabled={busy} onClick={() => go(null, back)}>
              Cancel
            </button>
            <button type="button" disabled={busy || fileMissing || keep.length === 0} onClick={() => void save('overwrite')}>
              Save
            </button>
            <button type="button" className="small" disabled={busy || fileMissing || keep.length === 0} onClick={() => void save('copy')}>
              Save as
            </button>
          </div>
          {detail.audioPath && <p className="muted">Save as: {saveAsTarget(detail.audioPath)}</p>}
          {error && <p className="error">{error}</p>}
          <audio
            ref={audioRef}
            className="clip"
            controls
            onError={() => {
              const src = audioRef.current?.getAttribute('src') ?? ''
              if (src.startsWith('blob:')) return
              setFileMissing(true)
            }}
          />
        </>
      )}
    </section>
  )
}
