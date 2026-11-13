import Fastify from 'fastify'
import cors from '@fastify/cors'
import websocket from '@fastify/websocket'
import { initDb } from './db/client'
import { registerWs } from './ws'
import { entriesRoutes } from './routes/entries'
import { listsRoutes } from './routes/lists'

const app = Fastify({ logger: true })

await app.register(cors, { origin: true })
await app.register(websocket)
await initDb()
await registerWs(app)
await app.register(entriesRoutes, { prefix: '/api' })
await app.register(listsRoutes, { prefix: '/api' })

const port = Number(process.env.PORT ?? 3001)
await app.listen({ port, host: '127.0.0.1' })
