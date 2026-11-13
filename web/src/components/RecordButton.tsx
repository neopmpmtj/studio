import { useRef, useState } from 'react'
import { useStore } from '../store/settings'
import { startCapture, stopCapture } from '../audio/useMicrophone'
import { encodeWav } from '../audio/wav'
import type { EntryUpload } from '../../../shared/types'

export default function RecordButton({ onSaved }: { onSaved: () => void }) {
  const recording = useStore((s) => s.recording)
  const setRecording = useStore((s) => s.setRecording)
  const [error, setError] = useState('')
  const startedAt = useRef('')
  const clipId = useRef('')

  async function toggle() {
    setError('')
    if (!recording) {
      try {
        await startCapture()
        clipId.current = crypto.randomUUID()
        startedAt.current = new Date().toISOString()
        setRecording(true)
      } catch {
        setError('Microphone access was denied or is unavailable.')
      }
      return
    }

    const { samples, durationS, pcm, sampleRate } = stopCapture()
    setRecording(false)
    try {
      const meta: EntryUpload = {
        startedAt: startedAt.current,
        durationS,
        samples,
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
