import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { GstRateCreate } from '@koosani/shared'
import { requireAuth } from '../../middleware/requireAuth.js'
import { getRealIp } from '../../lib/ip.js'
import { gstQueue } from '../../lib/queues.js'
import * as svc from './service.js'
import * as filesService from '../files/service.js'
import type { AppEnv } from '../../types.js'

// Per-business rate limit: 3 builds per 5 minutes (SECURITY.md §13.7)
const buildWindows = new Map<string, { count: number; resetAt: number }>()

function checkBuildLimit(businessId: string): boolean {
  const now = Date.now()
  const win = buildWindows.get(businessId)
  if (!win || now > win.resetAt) {
    buildWindows.set(businessId, { count: 1, resetAt: now + 5 * 60 * 1000 })
    return true
  }
  if (win.count >= 3) return false
  win.count++
  return true
}

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

// POST /gst/periods/:id/build — enqueues GST return build (SECURITY.md §13.7: 3/5 min/business)
gstRoutes.post('/periods/:id/build', async (c) => {
  const businessId = c.get('businessId')
  const periodId = c.req.param('id')

  if (!checkBuildLimit(businessId)) {
    return c.json({ error: 'rate_limited', message: 'Max 3 builds per 5 minutes per business' }, 429)
  }

  const period = await svc.getPeriodById(businessId, periodId)
  if (!period) return c.json({ error: 'not_found' }, 404)

  const job = await gstQueue.add('build', {
    businessId,
    periodId,
    userId: c.get('userId'),
    ip: getRealIp(c),
  })

  return c.json({ jobId: job.id })
})

// GET /gst/periods/:id/return — returns built artefacts with signed URLs
gstRoutes.get('/periods/:id/return', async (c) => {
  const businessId = c.get('businessId')
  const periodId = c.req.param('id')

  const period = await svc.getPeriodById(businessId, periodId)
  if (!period) return c.json({ error: 'not_found' }, 404)

  const gstReturn = await svc.getLatestReturn(businessId, periodId)
  if (!gstReturn) return c.json({ status: 'not_built', files: [] })

  const storedFiles = gstReturn.files as Array<{ kind: string; fileId: string }>
  const files = await Promise.all(
    storedFiles.map(async (f) => ({
      kind: f.kind,
      url: await filesService.getSignedUrl(businessId, f.fileId),
    })),
  )

  return c.json({
    status: 'built',
    builtAt: gstReturn.builtAt,
    summary: gstReturn.summaryJson,
    files,
  })
})
