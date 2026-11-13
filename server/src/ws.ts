import type { FastifyInstance } from 'fastify'
import type { WebSocket } from 'ws'
import { getKv, setKv } from './db/client'
import {
  DEFAULT_SETTINGS,
  sanitize,
  type ClientMsg,
  type ServerMsg,
  type Settings,
} from '../../shared/types'

let settings: Settings = { ...DEFAULT_SETTINGS }

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg))
}

export async function registerWs(app: FastifyInstance) {
  // Load saved settings so they survive server restarts.
  settings = { ...DEFAULT_SETTINGS, ...sanitize(await getKv<Partial<Settings>>('settings', {})) }

  app.get('/ws', { websocket: true }, (socket) => {
    send(socket, { type: 'init', settings })

    socket.on('message', (raw) => {
      let msg: ClientMsg
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }
      if (msg.type !== 'patch') return

      const patch = sanitize(msg.patch)
      settings = { ...settings, ...patch }

      // Tell every other open tab/device immediately.
      for (const client of app.websocketServer.clients) {
        if (client !== socket) send(client, { type: 'patch', patch })
      }
      setKv('settings', settings).catch((err) => app.log.error(err))
    })
  })
}
