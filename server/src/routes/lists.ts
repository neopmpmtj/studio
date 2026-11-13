import type { FastifyPluginAsync } from 'fastify'
import { getKv, setKv } from '../db/client'
import type { Lists } from '../../../shared/types'

export const listsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/lists', async () => getKv<Lists>('lists', { labels: [] }))

  app.put<{ Body: Lists }>('/lists', async (req, reply) => {
    const raw = req.body?.labels
    if (!Array.isArray(raw)) return reply.code(400).send({ error: 'labels must be an array' })
    const labels = raw
      .filter((x): x is string => typeof x === 'string')
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 200)
    await setKv('lists', { labels })
    return { labels }
  })
}
