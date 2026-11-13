import { useEffect, useState, type RefObject } from 'react'

const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2]

export const nativeControlsList = 'nodownload noplaybackrate'

export function PlaybackRate({ audioRef }: { audioRef: RefObject<HTMLAudioElement | null> }) {
  const [rate, setRate] = useState(1)

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    const apply = () => {
      if (el.playbackRate !== rate) el.playbackRate = rate
    }
    apply()
    el.addEventListener('loadedmetadata', apply)
    el.addEventListener('ratechange', apply)
    return () => {
      el.removeEventListener('loadedmetadata', apply)
      el.removeEventListener('ratechange', apply)
    }
  }, [audioRef, rate])

  return (
    <label className="speed">
      Speed
      <select value={rate} onChange={(e) => setRate(Number(e.target.value))}>
        {RATES.map((value) => (
          <option key={value} value={value}>
            {value === 1 ? 'Normal' : `${value}x`}
          </option>
        ))}
      </select>
    </label>
  )
}
