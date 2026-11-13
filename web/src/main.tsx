import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { useStore } from './store/settings'
import { initSocket } from './lib/socket'
import './styles.css'

initSocket({
  onStatus: (c) => useStore.getState().setConnected(c),
  onSettings: (patch) => useStore.getState().applyRemote(patch),
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
