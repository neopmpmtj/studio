import Fastify from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import websocket from '@fastify/websocket'
import { initDb } from './db/client'
import { registerWs } from './ws'
import { entriesRoutes } from './routes/entries'
import { listsRoutes } from './routes/lists'
import { presetsRoutes } from './routes/presets'

const MB = 1024 * 1024

const app = Fastify({ logger: true, bodyLimit: 256 * MB })

await app.register(cors, { origin: true })
await app.register(multipart, {
  throwFileSizeLimit: true,
  limits: { fileSize: 256 * MB, files: 1, fieldSize: 8 * MB },
})
await app.register(websocket)
await initDb()
await registerWs(app)
await app.register(entriesRoutes, { prefix: '/api' })
await app.register(listsRoutes, { prefix: '/api' })
await app.register(presetsRoutes, { prefix: '/api' })

const port = Number(process.env.PORT ?? 3001)
await app.listen({ port, host: '127.0.0.1' })

