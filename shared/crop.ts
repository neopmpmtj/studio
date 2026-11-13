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

const JOIN = 1e-6

function mergeNeighbors(pieces: KeepSpan[]): KeepSpan[] {
  const out: KeepSpan[] = []
  for (const piece of pieces) {
    if (!(piece.end - piece.start > 1e-9)) continue
    const last = out[out.length - 1]
    if (last && Math.abs(last.end - piece.start) <= JOIN) last.end = Math.max(last.end, piece.end)
    else out.push({ start: piece.start, end: piece.end })
  }
  return out
}

export function piecesDuration(pieces: KeepSpan[]) {
  return pieces.reduce((sum, piece) => sum + Math.max(0, piece.end - piece.start), 0)
}

export function cutPieces(pieces: KeepSpan[], start: number, end: number): KeepSpan[] {
  const a = Math.min(start, end)
  const b = Math.max(start, end)
  if (!(b > a)) return pieces.map((piece) => ({ start: piece.start, end: piece.end }))
  const out: KeepSpan[] = []
  let cursor = 0
  for (const piece of pieces) {
    const len = piece.end - piece.start
    const ps = cursor
    const pe = cursor + len
    cursor = pe
    if (pe <= a || ps >= b) {
      out.push({ start: piece.start, end: piece.end })
      continue
    }
    if (ps < a) out.push({ start: piece.start, end: piece.start + (a - ps) })
    if (pe > b) out.push({ start: piece.start + (b - ps), end: piece.end })
  }
  return mergeNeighbors(out)
}

export function takePieces(pieces: KeepSpan[], start: number, end: number): KeepSpan[] {
  const a = Math.min(start, end)
  const b = Math.max(start, end)
  const out: KeepSpan[] = []
  let cursor = 0
  for (const piece of pieces) {
    const len = piece.end - piece.start
    const ps = cursor
    const pe = cursor + len
    cursor = pe
    const lo = Math.max(ps, a)
    const hi = Math.min(pe, b)
    if (!(hi > lo)) continue
    out.push({ start: piece.start + (lo - ps), end: piece.start + (hi - ps) })
  }
  return mergeNeighbors(out)
}

export function insertPieces(pieces: KeepSpan[], at: number, clip: KeepSpan[]): KeepSpan[] {
  const copied = clip
    .filter((piece) => piece.end - piece.start > 1e-9)
    .map((piece) => ({ start: piece.start, end: piece.end }))
  if (copied.length === 0) return pieces.map((piece) => ({ start: piece.start, end: piece.end }))
  const total = piecesDuration(pieces)
  const t = Math.min(total, Math.max(0, at))
  if (pieces.length === 0 || t >= total - 1e-9) {
    return mergeNeighbors([...pieces.map((piece) => ({ start: piece.start, end: piece.end })), ...copied])
  }
  const out: KeepSpan[] = []
  let cursor = 0
  let placed = false
  for (const piece of pieces) {
    const len = piece.end - piece.start
    const ps = cursor
    cursor += len
    if (placed || t >= cursor) {
      out.push({ start: piece.start, end: piece.end })
      continue
    }
    const split = t - ps
    if (split > 1e-9) out.push({ start: piece.start, end: piece.start + split })
    out.push(...copied.map((part) => ({ start: part.start, end: part.end })))
    if (len - split > 1e-9) out.push({ start: piece.start + split, end: piece.end })
    placed = true
  }
  return mergeNeighbors(out)
}

// Buckets are appended in piece order, so a repeated source range appears twice.
export function assembleSeries(values: number[], duration: number, pieces: KeepSpan[], pair: boolean): number[] {
  if (values.length === 0 || duration <= 0 || pieces.length === 0) return []
  const count = pair ? values.length / 2 : values.length
  if (!Number.isInteger(count) || count < 1) return []
  const step = duration / count
  const out: number[] = []
  for (const piece of pieces) {
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) * step
      if (t < piece.start || t >= piece.end) continue
      if (pair) out.push(values[i * 2], values[i * 2 + 1])
      else out.push(values[i])
    }
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
