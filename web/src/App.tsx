import { useEffect, useState, type MouseEvent } from 'react'
import { useStore } from './store/settings'
import WaveformGraph from './components/WaveformGraph'
import LiveGraph from './components/LiveGraph'
import RecordButton from './components/RecordButton'
import ControlPanel from './components/ControlPanel'
import EntriesList from './components/EntriesList'
import ListEditor from './components/ListEditor'
import RecordingsPage from './components/RecordingsPage'
import EditPage from './components/EditPage'

function useLocation() {
  const read = () => window.location.pathname + window.location.search
  const [href, setHref] = useState(read)
  useEffect(() => {
    const onPop = () => setHref(read())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  function go(event: MouseEvent<HTMLAnchorElement> | null, next: string) {
    if (event) {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return
      event.preventDefault()
    }
    if (read() !== next) window.history.pushState(null, '', next)
    setHref(next)
  }
  const q = href.indexOf('?')
  const rawPath = q === -1 ? href : href.slice(0, q)
  const path = rawPath.length > 1 && rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath
  const search = q === -1 ? '' : href.slice(q)
  return { path, search, go }
}

export default function App() {
  const [refreshKey, setRefreshKey] = useState(0)
  const recording = useStore((s) => s.recording)
  const { path, search, go } = useLocation()

  return (
    <main className="app">
      <header>
        <h1>Science Studio</h1>
        <div className="row">
          <a className={path === '/' ? 'nav active' : 'nav'} href="/" onClick={(e) => go(e, '/')}>
            Studio
          </a>
          <a className={path === '/controls' ? 'nav active' : 'nav'} href="/controls" onClick={(e) => go(e, '/controls')}>
            Controls
          </a>
          <a
            className={path === '/recordings' || path === '/recordings/edit' ? 'nav active' : 'nav'}
            href="/recordings"
            onClick={(e) => go(e, '/recordings')}
          >
            Recordings
          </a>
          <span className={recording ? 'badge rec' : 'badge'}>{recording ? '● Recording' : 'Idle'}</span>
        </div>
      </header>

      {path === '/controls' ? (
        <ControlPanel />
      ) : path === '/recordings/edit' ? (
        <EditPage search={search} go={go} />
      ) : path === '/recordings' ? (
        <RecordingsPage search={search} go={go} />
      ) : (
        <>
          <section className="card wide">
            <WaveformGraph />
            <LiveGraph />
            <RecordButton onSaved={() => setRefreshKey((k) => k + 1)} />
          </section>
          <EntriesList refreshKey={refreshKey} go={go} />
          <ListEditor />
        </>
      )}
    </main>
  )
}
