import type { ServerMsg, Settings } from '../../../shared/types'

let ws: WebSocket | null = null

interface Handlers {
  onStatus: (connected: boolean) => void
  onSettings: (patch: Partial<Settings>) => void
}

export function initSocket(h: Handlers) {
  const connect = () => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws'
    ws = new WebSocket(`${proto}://${location.host}/ws`)
    ws.onopen = () => h.onStatus(true)
    ws.onclose = () => {
      h.onStatus(false)
      setTimeout(connect, 1500) // auto-reconnect
    }
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data) as ServerMsg
      if (msg.type === 'init') h.onSettings(msg.settings)
      if (msg.type === 'patch') h.onSettings(msg.patch)
    }
  }
  connect()
}

export function sendPatch(patch: Partial<Settings>) {
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'patch', patch }))
  }
}
