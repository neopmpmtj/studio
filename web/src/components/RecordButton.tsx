import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/settings'
import { elapsed, snapshotCapture, startCapture, stopCapture } from '../audio/useMicrophone'
import { encodeWav } from '../audio/wav'
import type { EntryUpload } from '../../../shared/types'

type Snap = {
  samples: number[]
  durationS: number
  pcm: Float32Array
  sampleRate: number
  waveform: number[]
}

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
  const entryIds = useRef(new Map<string, number>())
  const saveTail = useRef(Promise.resolve())
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

  function queueSave(task: () => Promise<void>) {
    const run = saveTail.current.then(task, task)
    saveTail.current = run.then(
      () => {},
      () => {},
    )
    return run
  }

  function persist(uuid: string, started: string, snap: Snap) {
    return queueSave(async () => {
      let known = entryIds.current.get(uuid) ?? null
      const send = async (id: number | null) => {
        const meta: EntryUpload = {
          startedAt: started,
          durationS: snap.durationS,
          samples: snap.samples,
          waveform: snap.waveform,
          uuid,
        }
        const body = new FormData()
        body.append('meta', JSON.stringify(meta))
        body.append('audio', encodeWav(snap.pcm, snap.sampleRate), `${uuid}.wav`)
        const res = await fetch(id == null ? '/api/entries' : `/api/entries/${id}`, {
          method: id == null ? 'POST' : 'PUT',
          body,
        })
        if (res.status === 404 && id != null) {
          entryIds.current.delete(uuid)
          return send(null)
        }
        if (!res.ok) throw new Error('save failed')
        if (id == null) {
          const saved = (await res.json()) as { id: number }
          entryIds.current.set(uuid, saved.id)
        }
      }
      await send(known)
      onSaved()
    })
  }

  function checkpoint() {
    if (finishing.current) return
    const snap = snapshotCapture()
    if (!snap) return
    const uuid = clipId.current
    const started = startedAt.current
    void persist(uuid, started, snap).then(
      () => {
        if (clipId.current === uuid) setError('')
      },
      () => {
        if (clipId.current === uuid) setError('Could not save the recording so far.')
      },
    )
  }

  async function finish() {
    if (finishing.current) return
    const id = take.current
    finishing.current = true
    const snap = stopCapture()
    const uuid = clipId.current
    const started = startedAt.current
    setRecording(false)
    setShown(0)
    try {
      await persist(uuid, started, snap)
      if (clipId.current === uuid) setError('')
    } catch {
      if (clipId.current === uuid) setError('Could not save the recording.')
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
        await startCapture(
          seconds,
          () => {
            void finish()
          },
          () => checkpoint(),
        )
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
