import { useRef, useState } from 'react'
import { useStore } from '../store/settings'
import { startMic, stopMic } from '../audio/useMicrophone'
import type { NewEntry } from '../../../shared/types'

export default function RecordButton({ onSaved }: { onSaved: () => void }) {
  const recording = useStore((s) => s.recording)
  const setRecording = useStore((s) => s.setRecording)
  const [error, setError] = useState('')
  const startedAt = useRef('')

  async function toggle() {
    setError('')
    if (!recording) {
      try {
        await startMic()
        startedAt.current = new Date().toISOString()
        setRecording(true)
      } catch {
        setError('Microphone access was denied or is unavailable.')
      }
      return
    }

    const { samples, durationS } = stopMic()
    setRecording(false)
    try {
      const body: NewEntry = { startedAt: startedAt.current, durationS, samples }
      const res = await fetch('/api/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('save failed')
      onSaved()
    } catch {
      setError('Could not save the recording.')
    }
  }

  return (
    <div>
      <button className={recording ? 'stop' : ''} onClick={toggle}>
        {recording ? '■ Stop recording' : '● Start recording'}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  )
}
