import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { GstRateCreate } from '@koosani/shared'
import { requireAuth } from '../../middleware/requireAuth.js'
import { getRealIp } from '../../lib/ip.js'
import * as svc from './service.js'
import type { AppEnv } from '../../types.js'

const LockBody = z.object({ miraReturnRef: z.string().min(1) })
const UnlockBody = z.object({ reason: z.string().min(1) })

export const gstRoutes = new Hono<AppEnv>()
gstRoutes.use('*', requireAuth)

// GET /gst/rates
gstRoutes.get('/rates', async (c) => {
  const rates = await svc.listRates(c.get('businessId'))
  return c.json(rates)
})

// POST /gst/rates — admin only (FUNCTIONS.md §gst)
gstRoutes.post('/rates', zValidator('json', GstRateCreate), async (c) => {
  if (c.get('role') !== 'admin') return c.json({ error: 'forbidden' }, 403)
  const data = c.req.valid('json')
  const ctx = {
    userId: c.get('userId'),
    businessId: c.get('businessId'),
    ip: getRealIp(c),
    ua: c.req.header('user-agent'),
  }
  const rate = await svc.createRate(c.get('businessId'), data, ctx)
  return c.json(rate, 201)
})

// GET /gst/periods
gstRoutes.get('/periods', async (c) => {
  const periods = await svc.listPeriods(c.get('businessId'))
  return c.json(periods)
})

// POST /gst/periods/:id/lock
gstRoutes.post('/periods/:id/lock', zValidator('json', LockBody), async (c) => {
  const { miraReturnRef } = c.req.valid('json')
  const ctx = {
    userId: c.get('userId'),
    businessId: c.get('businessId'),
    ip: getRealIp(c),
    ua: c.req.header('user-agent'),
  }
  try {
    const period = await svc.lockPeriod(c.get('businessId'), c.req.param('id'), miraReturnRef, ctx)
    return c.json(period)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
    throw err
  }
})

// POST /gst/periods/:id/unlock — admin only, fully audited (FUNCTIONS.md §gst)
gstRoutes.post('/periods/:id/unlock', zValidator('json', UnlockBody), async (c) => {
  if (c.get('role') !== 'admin') return c.json({ error: 'forbidden' }, 403)
  const { reason } = c.req.valid('json')
  const ctx = {
    userId: c.get('userId'),
    businessId: c.get('businessId'),
    ip: getRealIp(c),
    ua: c.req.header('user-agent'),
  }
  try {
    const period = await svc.unlockPeriod(c.get('businessId'), c.req.param('id'), reason, ctx)
    return c.json(period)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
    throw err
  }
})

// POST /gst/periods/:id/build — deferred to Phase 7 (return building)
gstRoutes.post('/periods/:id/build', async (c) => {
  const period = await svc.getPeriodById(c.get('businessId'), c.req.param('id'))
  if (!period) return c.json({ error: 'not_found' }, 404)
  const jobId = `gst-build-${c.req.param('id')}-${Date.now()}`
  return c.json({ jobId })
})

// GET /gst/periods/:id/return — deferred to Phase 7
gstRoutes.get('/periods/:id/return', async (c) => {
  const period = await svc.getPeriodById(c.get('businessId'), c.req.param('id'))
  if (!period) return c.json({ error: 'not_found' }, 404)
  return c.json({ status: 'not_built', files: [] })
})
