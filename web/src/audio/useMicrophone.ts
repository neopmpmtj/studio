import { useStore } from '../store/settings'

// Microphone engine. Lives outside React so audio never re-renders the UI.
// Each animation frame it measures loudness (RMS) from the Web Audio AnalyserNode.

interface Point { t: number; v: number }

let ctx: AudioContext | null = null
let stream: MediaStream | null = null
let analyser: AnalyserNode | null = null
let buf: Float32Array<ArrayBuffer>
let raf = 0
let startMs = 0
let level = 0
let live: Point[] = []
let session: number[] = []
let lastSessionT = -1

const KEEP_SECONDS = 65 // a bit more than the max window setting

export const elapsed = () => (performance.now() - startMs) / 1000
export const getLive = () => live

export async function startMic() {
  stream = await navigator.mediaDevices.getUserMedia({ audio: true })
  ctx = new AudioContext()
  const source = ctx.createMediaStreamSource(stream)
  analyser = ctx.createAnalyser()
  analyser.fftSize = 1024
  source.connect(analyser)
  buf = new Float32Array(analyser.fftSize)

  live = []
  session = []
  level = 0
  lastSessionT = -1
  startMs = performance.now()

  const loop = () => {
    analyser!.getFloatTimeDomainData(buf)
    let sum = 0
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
    const rms = Math.sqrt(sum / buf.length)

    // Smoothing is read live from the store, so slider changes apply instantly.
    const s = useStore.getState().settings.smoothing
    level = level * s + rms * (1 - s)

    const t = elapsed()
    live.push({ t, v: level })
    while (live.length && live[0].t < t - KEEP_SECONDS) live.shift()

    // Store ~20 samples per second for saving later.
    if (t - lastSessionT >= 0.05) {
      session.push(Math.round(level * 10000) / 10000)
      lastSessionT = t
    }
    raf = requestAnimationFrame(loop)
  }
  loop()
}

export function stopMic() {
  cancelAnimationFrame(raf)
  stream?.getTracks().forEach((t) => t.stop())
  void ctx?.close()
  stream = null
  ctx = null
  analyser = null
  return { samples: session, durationS: elapsed() }
}
