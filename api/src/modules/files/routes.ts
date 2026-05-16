import { Hono } from 'hono'
import { requireAuth } from '../../middleware/requireAuth.js'
import { getRealIp } from '../../lib/ip.js'
import * as svc from './service.js'
import type { AppEnv } from '../../types.js'

export const fileRoutes = new Hono<AppEnv>()
fileRoutes.use('*', requireAuth)

// POST /files — multipart upload; returns { id, url }
fileRoutes.post('/', async (c) => {
  const formData = await c.req.formData()
  const entry = formData.get('file')
  if (!entry || !(entry instanceof File)) return c.json({ error: 'file field required' }, 400)

  const buffer = Buffer.from(await entry.arrayBuffer())
  const ctx = {
    userId: c.get('userId'),
    businessId: c.get('businessId'),
    ip: getRealIp(c),
    ua: c.req.header('user-agent'),
  }

  try {
    const record = await svc.uploadFile(c.get('businessId'), buffer, entry.name, entry.type, ctx)
    const url = await svc.getSignedUrl(c.get('businessId'), record.id)
    return c.json({ id: record.id, url }, 201)
  } catch (err) {
    if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
    throw err
  }
})

// GET /files/:id/url — returns { url }
fileRoutes.get('/:id/url', async (c) => {
  try {
    const url = await svc.getSignedUrl(c.get('businessId'), c.req.param('id'))
    return c.json({ url })
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})
