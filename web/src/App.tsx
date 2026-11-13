import { useState } from 'react'
import { useStore } from './store/settings'
import LiveGraph from './components/LiveGraph'
import RecordButton from './components/RecordButton'
import ControlPanel from './components/ControlPanel'
import EntriesList from './components/EntriesList'
import ListEditor from './components/ListEditor'

export default function App() {
  const [refreshKey, setRefreshKey] = useState(0)
  const recording = useStore((s) => s.recording)

  return (
    <main className="app">
      <header>
        <h1>Science Studio</h1>
        <span className={recording ? 'badge rec' : 'badge'}>{recording ? '● Recording' : 'Idle'}</span>
      </header>

      <section className="card wide">
        <LiveGraph />
        <RecordButton onSaved={() => setRefreshKey((k) => k + 1)} />
      </section>

      <ControlPanel />
      <EntriesList refreshKey={refreshKey} />
      <ListEditor />
    </main>
  )
}
