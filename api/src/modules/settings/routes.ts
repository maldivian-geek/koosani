import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { BusinessSettingsPatch } from '@koosani/shared'
import { requireAuth } from '../../middleware/requireAuth.js'
import { requireRole } from '../../middleware/authorize.js'
import { getRealIp } from '../../lib/ip.js'
import * as svc from './service.js'
import * as filesSvc from '../files/service.js'
import type { AppEnv } from '../../types.js'

export const settingsRoutes = new Hono<AppEnv>()
settingsRoutes.use('*', requireAuth)

// GET /settings — any authenticated role can read (business profile is
// displayed throughout the UI, e.g. on invoice PDFs), only admins can edit.
settingsRoutes.get('/', async (c) => {
  try {
    const settings = await svc.get(c.get('businessId'))
    return c.json(settings)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})

// PATCH /settings — admin only
settingsRoutes.patch(
  '/',
  requireRole('admin'),
  zValidator('json', BusinessSettingsPatch),
  async (c) => {
    const data = c.req.valid('json')
    const ctx = {
      userId: c.get('userId'),
      businessId: c.get('businessId'),
      ip: getRealIp(c),
      ua: c.req.header('user-agent'),
    }
    try {
      const business = await svc.update(c.get('businessId'), data, ctx)
      return c.json(business)
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
      throw err
    }
  },
)

// POST /settings/logo — admin only, multipart upload
settingsRoutes.post('/logo', requireRole('admin'), async (c) => {
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
    const business = await svc.updateLogo(c.get('businessId'), buffer, entry.name, entry.type, ctx)
    return c.json(business)
  } catch (err) {
    if (err instanceof filesSvc.ValidationError) return c.json({ error: err.message }, 422)
    throw err
  }
})
