import type { KeepSpan } from '../../../shared/types'
import { assembleSeries, cropPcm as cutPcm, parseWavPcm, sliceSeries } from '../../../shared/crop'

export { assembleSeries, sliceSeries }

export function readWav(bytes: Buffer): { pcm: Buffer; sampleRate: number } {
  const parsed = parseWavPcm(bytes)
  const start = parsed.pcm.byteOffset - bytes.byteOffset
  return { pcm: bytes.subarray(start, start + parsed.pcm.byteLength), sampleRate: parsed.sampleRate }
}

export function writeWav(pcm: Buffer, sampleRate: number): Buffer {
  const out = Buffer.alloc(44 + pcm.length)
  out.write('RIFF', 0)
  out.writeUInt32LE(36 + pcm.length, 4)
  out.write('WAVE', 8)
  out.write('fmt ', 12)
  out.writeUInt32LE(16, 16)
  out.writeUInt16LE(1, 20)
  out.writeUInt16LE(1, 22)
  out.writeUInt32LE(sampleRate, 24)
  out.writeUInt32LE(sampleRate * 2, 28)
  out.writeUInt16LE(2, 32)
  out.writeUInt16LE(16, 34)
  out.write('data', 36)
  out.writeUInt32LE(pcm.length, 40)
  pcm.copy(out, 44)
  return out
}

export function cropPcm(pcm: Buffer, sampleRate: number, keep: KeepSpan[]): Buffer {
  return Buffer.from(cutPcm(pcm, sampleRate, keep))
}
