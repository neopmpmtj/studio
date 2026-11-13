import { useStore } from '../store/settings'

// Microphone engine. Lives outside React so audio never re-renders the UI.
// Listening keeps the stream open for the waveform. Capturing also stores loudness.

interface Point { t: number; v: number }

let ctx: AudioContext | null = null
let stream: MediaStream | null = null
let source: MediaStreamAudioSourceNode | null = null
let analyser: AnalyserNode | null = null
let captureNode: AudioWorkletNode | null = null
let mute: GainNode | null = null
let buf = new Float32Array(0)
let pcmChunks: Float32Array[] = []
let workletReady = false
let raf = 0
let startMs = 0
let level = 0
let live: Point[] = []
let session: number[] = []
let lastSessionT = -1
let capturing = false
let windowMs = 20
let generation = 0
let starting: Promise<void> | null = null

const KEEP_SECONDS = 65 // a bit more than the max window setting
const RMS_SAMPLES = 1024 // loudness stays on a fixed window when the waveform zooms
const EMPTY = new Float32Array(0)

export const elapsed = () => (performance.now() - startMs) / 1000
export const getLive = () => live
export const isListening = () => ctx !== null

function fftSizeFor(ms: number, sampleRate: number) {
  const needed = Math.ceil((sampleRate * ms) / 1000)
  let size = 32
  while (size < needed) size *= 2
  return Math.min(32768, size)
}

function applyFftSize() {
  if (!analyser || !ctx) return
  const size = fftSizeFor(windowMs, ctx.sampleRate)
  if (analyser.fftSize !== size) {
    analyser.fftSize = size
    buf = new Float32Array(size)
  }
}

export function setWindowMs(ms: number) {
  windowMs = ms
  applyFftSize()
}

// Newest samples covering the visible window. Valid until the next animation frame.
export function getWaveform(): Float32Array {
  if (!analyser || !ctx || buf.length === 0) return EMPTY
  const count = Math.min(buf.length, Math.max(1, Math.round((ctx.sampleRate * windowMs) / 1000)))
  return buf.subarray(buf.length - count)
}

function concatPcm(chunks: Float32Array[]) {
  let n = 0
  for (const c of chunks) n += c.length
  const out = new Float32Array(n)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

async function ensureWorklet() {
  if (!ctx || workletReady) return
  await ctx.audioWorklet.addModule('/capture-worklet.js')
  workletReady = true
}

function connectCapture() {
  if (!ctx || !source) return
  captureNode = new AudioWorkletNode(ctx, 'capture')
  mute = ctx.createGain()
  mute.gain.value = 0
  captureNode.port.onmessage = (e: MessageEvent<Float32Array>) => {
    if (capturing) pcmChunks.push(e.data)
  }
  source.connect(captureNode)
  captureNode.connect(mute)
  mute.connect(ctx.destination)
}

function disconnectCapture() {
  if (source && captureNode) source.disconnect(captureNode)
  captureNode?.disconnect()
  mute?.disconnect()
  captureNode = null
  mute = null
}

function loop() {
  analyser!.getFloatTimeDomainData(buf)

  if (capturing) {
    const n = Math.min(RMS_SAMPLES, buf.length)
    const offset = buf.length - n
    let sum = 0
    for (let i = offset; i < buf.length; i++) sum += buf[i] * buf[i]
    const rms = Math.sqrt(sum / n)

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
  }

  raf = requestAnimationFrame(loop)
}

export function startListening(): Promise<void> {
  if (ctx) return Promise.resolve()
  if (starting) return starting
  const gen = generation
  starting = (async () => {
    const media = await navigator.mediaDevices.getUserMedia({ audio: true })
    if (gen !== generation) {
      media.getTracks().forEach((t) => t.stop())
      return
    }
    try {
      stream = media
      ctx = new AudioContext()
      if (ctx.state === 'suspended') await ctx.resume()
      if (gen !== generation) {
        media.getTracks().forEach((t) => t.stop())
        void ctx.close()
        stream = null
        ctx = null
        return
      }
      source = ctx.createMediaStreamSource(stream)
      analyser = ctx.createAnalyser()
      source.connect(analyser)
      buf = new Float32Array(analyser.fftSize)
      applyFftSize()
      await ensureWorklet()
      if (gen !== generation) {
        media.getTracks().forEach((t) => t.stop())
        void ctx.close()
        stream = null
        ctx = null
        source = null
        analyser = null
        workletReady = false
        return
      }
      loop()
    } catch (err) {
      media.getTracks().forEach((t) => t.stop())
      void ctx?.close()
      stream = null
      ctx = null
      source = null
      analyser = null
      buf = EMPTY
      workletReady = false
      throw err
    }
  })()
  starting.finally(() => {
    starting = null
  })
  return starting
}

export async function startCapture() {
  await startListening()
  if (!ctx || !source) throw new Error('Microphone did not start.')
  await ensureWorklet()
  live = []
  session = []
  pcmChunks = []
  level = 0
  lastSessionT = -1
  startMs = performance.now()
  connectCapture()
  capturing = true
}

export function stopCapture() {
  capturing = false
  disconnectCapture()
  const pcm = concatPcm(pcmChunks)
  pcmChunks = []
  const result = { samples: session, durationS: elapsed(), pcm, sampleRate: ctx?.sampleRate ?? 48000 }
  session = []
  return result
}

export function stopListening() {
  generation++
  capturing = false
  cancelAnimationFrame(raf)
  disconnectCapture()
  stream?.getTracks().forEach((t) => t.stop())
  void ctx?.close()
  stream = null
  ctx = null
  source = null
  analyser = null
  buf = EMPTY
  workletReady = false
  pcmChunks = []
  live = []
  session = []
}
