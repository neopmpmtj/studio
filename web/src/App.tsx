import { useEffect, useState, type MouseEvent } from 'react'
import { useStore } from './store/settings'
import WaveformGraph from './components/WaveformGraph'
import LiveGraph from './components/LiveGraph'
import RecordButton from './components/RecordButton'
import ControlPanel from './components/ControlPanel'
import EntriesList from './components/EntriesList'
import ListEditor from './components/ListEditor'

function usePath() {
  const [path, setPath] = useState(() => window.location.pathname)
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  function go(event: MouseEvent<HTMLAnchorElement>, next: string) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
    event.preventDefault()
    if (window.location.pathname !== next) window.history.pushState(null, '', next)
    setPath(next)
  }
  return { path, go }
}

export default function App() {
  const [refreshKey, setRefreshKey] = useState(0)
  const recording = useStore((s) => s.recording)
  const { path, go } = usePath()
  const onControls = path === '/controls' || path === '/controls/'

  return (
    <main className="app">
      <header>
        <h1>Science Studio</h1>
        <div className="row">
          <a
            className="nav"
            href={onControls ? '/' : '/controls'}
            onClick={(e) => go(e, onControls ? '/' : '/controls')}
          >
            {onControls ? 'Studio' : 'Controls'}
          </a>
          <span className={recording ? 'badge rec' : 'badge'}>{recording ? '● Recording' : 'Idle'}</span>
        </div>
      </header>

      {onControls ? (
        <ControlPanel />
      ) : (
        <>
          <section className="card wide">
            <WaveformGraph />
            <LiveGraph />
            <RecordButton onSaved={() => setRefreshKey((k) => k + 1)} />
          </section>
          <EntriesList refreshKey={refreshKey} />
          <ListEditor />
        </>
      )}
    </main>
  )
}
