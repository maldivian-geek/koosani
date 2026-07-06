import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { RecurrenceProfileCreate, RecurrenceProfilePatch } from '@koosani/shared'
import { requireAuth } from '../../middleware/requireAuth.js'
import { requirePermission } from '../../middleware/authorize.js'
import { getRealIp } from '../../lib/ip.js'
import * as svc from './service.js'
import type { AppEnv } from '../../types.js'

const ListProfilesQuery = z.object({
  active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  customerId: z.string().uuid().optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})

export const recurrenceRoutes = new Hono<AppEnv>()
recurrenceRoutes.use('*', requireAuth)

// GET /recurrence-profiles
recurrenceRoutes.get('/', zValidator('query', ListProfilesQuery), async (c) => {
  const q = c.req.valid('query')
  const { rows, total } = await svc.listProfiles(c.get('businessId'), {
    active: q.active,
    customerId: q.customerId,
    q: q.q,
    page: q.page,
    pageSize: q.pageSize,
  })
  return c.json({ items: rows, total, page: q.page, pageSize: q.pageSize })
})

// GET /recurrence-profiles/:id
recurrenceRoutes.get('/:id', async (c) => {
  try {
    const profile = await svc.getProfile(c.get('businessId'), c.req.param('id'))
    return c.json(profile)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})

// POST /recurrence-profiles
recurrenceRoutes.post(
  '/',
  requirePermission('recurring', 'add'),
  zValidator('json', RecurrenceProfileCreate),
  async (c) => {
    const data = c.req.valid('json')
    const ctx = {
      userId: c.get('userId'),
      businessId: c.get('businessId'),
      ip: getRealIp(c),
      ua: c.req.header('user-agent'),
    }
    try {
      const profile = await svc.createProfile(c.get('businessId'), data, ctx)
      return c.json(profile, 201)
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: err.message }, 422)
      if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
      throw err
    }
  },
)

// PATCH /recurrence-profiles/:id
recurrenceRoutes.patch(
  '/:id',
  requirePermission('recurring', 'edit'),
  zValidator('json', RecurrenceProfilePatch),
  async (c) => {
    const data = c.req.valid('json')
    const ctx = {
      userId: c.get('userId'),
      businessId: c.get('businessId'),
      ip: getRealIp(c),
      ua: c.req.header('user-agent'),
    }
    try {
      const profile = await svc.patchProfile(c.get('businessId'), c.req.param('id'), data, ctx)
      return c.json(profile)
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
      if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
      throw err
    }
  },
)

// POST /recurrence-profiles/:id/generate — manual "run now", mainly for
// testing/support; the daily cron (worker/reminders.ts) is the normal path.
recurrenceRoutes.post('/:id/generate', requirePermission('recurring', 'edit'), async (c) => {
  const ctx = {
    userId: c.get('userId'),
    businessId: c.get('businessId'),
    ip: getRealIp(c),
    ua: c.req.header('user-agent'),
  }
  try {
    const result = await svc.generateFromProfile(c.get('businessId'), c.req.param('id'), ctx)
    if (!result) return c.json({ error: 'not_due' }, 422)
    return c.json(result, 201)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})
