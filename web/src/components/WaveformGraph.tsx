import { useEffect, useRef, useState } from 'react'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { useStore } from '../store/settings'
import {
  getWaveform,
  isListening,
  setWindowMs,
  startListening,
  stopListening,
} from '../audio/useMicrophone'

const HEIGHT = 320
const DEFAULT_MS = 20
const DEFAULT_AMP = 0.05
const MIN_MS = 2
const MAX_MS = 680
const MIN_AMP = 0.001
const MAX_AMP = 1

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

function formatMs(ms: number) {
  const text = ms >= 10 ? String(Math.round(ms)) : String(Math.round(ms * 10) / 10)
  return `${text} ms`
}

function formatAmp(amp: number) {
  const text = amp >= 0.1 ? amp.toFixed(2) : amp >= 0.01 ? amp.toFixed(3) : amp.toFixed(4)
  return `±${text}`
}

// One min and one max per pixel when the buffer is wider than the plot.
function decimate(samples: Float32Array, width: number, windowMs: number): [number[], number[]] {
  const n = samples.length
  if (n === 0) return [[], []]
  const pixels = Math.max(1, Math.floor(width))
  if (n <= pixels) {
    const xs = new Array<number>(n)
    const ys = new Array<number>(n)
    const denom = Math.max(1, n - 1)
    for (let i = 0; i < n; i++) {
      xs[i] = (i / denom) * windowMs
      ys[i] = samples[i]
    }
    return [xs, ys]
  }
  const xs: number[] = []
  const ys: number[] = []
  const bucket = n / pixels
  for (let p = 0; p < pixels; p++) {
    const start = Math.floor(p * bucket)
    const end = Math.max(start + 1, Math.min(n, Math.floor((p + 1) * bucket)))
    let lo = Infinity
    let hi = -Infinity
    for (let i = start; i < end; i++) {
      const v = samples[i]
      if (v < lo) lo = v
      if (v > hi) hi = v
    }
    const x = ((start + end) / 2 / n) * windowMs
    xs.push(x, x)
    ys.push(lo, hi)
  }
  return [xs, ys]
}

export default function WaveformGraph() {
  const box = useRef<HTMLDivElement>(null)
  const plotRef = useRef<uPlot | null>(null)
  const zoom = useRef({ windowMs: DEFAULT_MS, amp: DEFAULT_AMP })
  const listeningNow = useRef(false)
  const [windowMs, setWindow] = useState(DEFAULT_MS)
  const [amp, setAmp] = useState(DEFAULT_AMP)
  const [listening, setListening] = useState(false)
  const [error, setError] = useState('')
  const recording = useStore((s) => s.recording)

  useEffect(() => {
    zoom.current = { windowMs, amp }
    setWindowMs(windowMs)
    const plot = plotRef.current
    if (!plot) return
    plot.setScale('x', { min: 0, max: windowMs })
    plot.setScale('y', { min: -amp, max: amp })
  }, [windowMs, amp])

  useEffect(() => {
    const el = box.current!
    const plot = new uPlot(
      {
        width: el.clientWidth,
        height: HEIGHT,
        legend: { show: false },
        cursor: { show: false },
        scales: {
          // Functions, not fixed ranges: with no samples yet, uPlot would otherwise
          // ignore setScale and keep the range from the first render.
          x: { time: false, auto: false, range: () => [0, zoom.current.windowMs] },
          y: { auto: false, range: () => [-zoom.current.amp, zoom.current.amp] },
        },
        axes: [
          { stroke: '#9aa4b2', grid: { stroke: '#222a35' }, label: 'milliseconds' },
          { stroke: '#9aa4b2', grid: { stroke: '#222a35' } },
        ],
        series: [{}, { stroke: '#7dd3fc', width: 1, auto: false }],
      },
      [[], []],
      el,
    )
    plotRef.current = plot

    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const factor = e.deltaY < 0 ? 0.5 : 2
      if (e.shiftKey) setAmp((a) => clamp(a * factor, MIN_AMP, MAX_AMP))
      else setWindow((ms) => clamp(ms * factor, MIN_MS, MAX_MS))
    }
    el.addEventListener('wheel', onWheel, { passive: false })

    let raf = 0
    const draw = () => {
      const on = isListening()
      if (on !== listeningNow.current) {
        listeningNow.current = on
        setListening(on)
      }
      const samples = getWaveform()
      const width = plot.bbox.width || plot.width
      const [xs, ys] = decimate(samples, width, zoom.current.windowMs)
      plot.setData([xs, ys], false)
      plot.redraw()
      raf = requestAnimationFrame(draw)
    }
    draw()

    const ro = new ResizeObserver(() => plot.setSize({ width: el.clientWidth, height: HEIGHT }))
    ro.observe(el)

    return () => {
      cancelAnimationFrame(raf)
      el.removeEventListener('wheel', onWheel)
      ro.disconnect()
      plot.destroy()
      plotRef.current = null
    }
  }, [])

  async function toggleListen() {
    setError('')
    if (listening) {
      if (recording) return
      stopListening()
      setListening(false)
      return
    }
    try {
      await startListening()
      setWindowMs(zoom.current.windowMs)
      setListening(true)
    } catch {
      setError('Microphone access was denied or is unavailable.')
    }
  }

  return (
    <div className="wave">
      <h2>Waveform</h2>
      <div ref={box} className="graph" />
      <div className="row">
        <button
          className="small"
          onClick={toggleListen}
          disabled={listening && recording}
          title={listening && recording ? 'Stop the recording before releasing the mic' : undefined}
        >
          {listening ? 'Stop listening' : 'Listen'}
        </button>
        <button className="small" onClick={() => setWindow((ms) => clamp(ms * 0.5, MIN_MS, MAX_MS))} title="Zoom in">
          Time −
        </button>
        <span className="muted">{formatMs(windowMs)}</span>
        <button className="small" onClick={() => setWindow((ms) => clamp(ms * 2, MIN_MS, MAX_MS))} title="Zoom out">
          Time +
        </button>
        <button className="small" onClick={() => setAmp((a) => clamp(a * 2, MIN_AMP, MAX_AMP))} title="Zoom out">
          Amp −
        </button>
        <span className="muted">{formatAmp(amp)}</span>
        <button className="small" onClick={() => setAmp((a) => clamp(a * 0.5, MIN_AMP, MAX_AMP))} title="Zoom in">
          Amp +
        </button>
        <button
          className="small"
          onClick={() => {
            setWindow(DEFAULT_MS)
            setAmp(DEFAULT_AMP)
          }}
        >
          Reset
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
