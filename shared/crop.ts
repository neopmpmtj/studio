import type { KeepSpan } from './types'

// A point is kept when the middle of its bucket sits inside a kept span.
export function sliceSeries(values: number[], duration: number, keep: KeepSpan[], pair: boolean): number[] {
  if (values.length === 0 || duration <= 0) return []
  const count = pair ? values.length / 2 : values.length
  if (!Number.isInteger(count) || count < 1) return []
  const step = duration / count
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    const t = (i + 0.5) * step
    if (!keep.some((span) => t >= span.start && t <= span.end)) continue
    if (pair) out.push(values[i * 2], values[i * 2 + 1])
    else out.push(values[i])
  }
  return out
}

export function cropPcm(pcm: Uint8Array, sampleRate: number, keep: KeepSpan[]): Uint8Array {
  const n = Math.floor(pcm.length / 2)
  const parts: Uint8Array[] = []
  for (const span of keep) {
    const a = Math.min(n, Math.max(0, Math.floor(span.start * sampleRate)))
    const b = Math.min(n, Math.max(0, Math.floor(span.end * sampleRate)))
    if (b > a) parts.push(pcm.subarray(a * 2, b * 2))
  }
  const len = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(len)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

export function parseWavPcm(bytes: Uint8Array): { pcm: Uint8Array; sampleRate: number } {
  if (bytes.length < 44) throw new Error('bad wav')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const ascii = (at: number, n: number) => String.fromCharCode(...bytes.subarray(at, at + n))
  if (ascii(0, 4) !== 'RIFF' || ascii(8, 4) !== 'WAVE') throw new Error('bad wav')
  if (ascii(12, 4) !== 'fmt ' || view.getUint32(16, true) !== 16) throw new Error('bad wav')
  if (view.getUint16(20, true) !== 1 || view.getUint16(22, true) !== 1 || view.getUint16(34, true) !== 16) {
    throw new Error('bad wav')
  }
  const sampleRate = view.getUint32(24, true)
  if (ascii(36, 4) !== 'data') throw new Error('bad wav')
  const dataSize = view.getUint32(40, true)
  if (sampleRate < 1 || dataSize < 2 || dataSize % 2 !== 0 || 44 + dataSize > bytes.length) throw new Error('bad wav')
  return { pcm: bytes.subarray(44, 44 + dataSize), sampleRate }
}
