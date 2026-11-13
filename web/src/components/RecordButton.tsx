import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/settings'
import { elapsed, startCapture, stopCapture } from '../audio/useMicrophone'
import { encodeWav } from '../audio/wav'
import type { EntryUpload } from '../../../shared/types'

export default function RecordButton({ onSaved }: { onSaved: () => void }) {
  const recording = useStore((s) => s.recording)
  const setRecording = useStore((s) => s.setRecording)
  const [error, setError] = useState('')
  const [length, setLength] = useState(0)
  const [shown, setShown] = useState(0)
  const startedAt = useRef('')
  const clipId = useRef('')
  const lengthRef = useRef(length)
  const finishing = useRef(false)
  const take = useRef(0)
  lengthRef.current = length

  useEffect(() => {
    if (!recording) return
    const tick = () => {
      const cap = lengthRef.current
      const t = elapsed()
      setShown(cap > 0 ? Math.min(t, cap) : t)
    }
    tick()
    const id = window.setInterval(tick, 100)
    return () => window.clearInterval(id)
  }, [recording])

  async function finish() {
    if (finishing.current) return
    const id = take.current
    finishing.current = true
    const { samples, durationS, pcm, sampleRate, waveform } = stopCapture()
    setRecording(false)
    setShown(0)
    try {
      const meta: EntryUpload = {
        startedAt: startedAt.current,
        durationS,
        samples,
        waveform,
        uuid: clipId.current,
      }
      const body = new FormData()
      body.append('meta', JSON.stringify(meta))
      body.append('audio', encodeWav(pcm, sampleRate), `${clipId.current}.wav`)
      const res = await fetch('/api/entries', { method: 'POST', body })
      if (!res.ok) throw new Error('save failed')
      onSaved()
    } catch {
      setError('Could not save the recording.')
    } finally {
      if (take.current === id) finishing.current = false
    }
  }

  async function toggle() {
    setError('')
    if (!recording) {
      take.current += 1
      finishing.current = false
      clipId.current = crypto.randomUUID()
      startedAt.current = new Date().toISOString()
      try {
        const seconds = lengthRef.current
        await startCapture(seconds, () => {
          void finish()
        })
        setRecording(true)
      } catch {
        setError('Microphone access was denied or is unavailable.')
      }
      return
    }
    void finish()
  }

  function onLength(value: string) {
    const n = Math.floor(Number(value))
    setLength(Number.isFinite(n) && n > 0 ? n : 0)
  }

  return (
    <div>
      <div className="row">
        <button className={recording ? 'stop' : ''} onClick={() => void toggle()}>
          {recording ? '■ Stop recording' : '● Start recording'}
        </button>
        <span className="muted">{shown.toFixed(1)} s</span>
        <label className="muted" htmlFor="rec-length">
          Length
        </label>
        <input
          id="rec-length"
          className="n"
          type="number"
          min={0}
          step={1}
          value={length}
          disabled={recording}
          title="0 records until Stop"
          onChange={(e) => onLength(e.target.value)}
        />
        <span className="muted">s</span>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
