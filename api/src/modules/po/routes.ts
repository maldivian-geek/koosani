import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { PoDraftCreate, PoDraftPatch, PoCancelBody, GrnCreate } from '@koosani/shared'
import { requireAuth } from '../../middleware/requireAuth.js'
import { getRealIp } from '../../lib/ip.js'
import * as svc from './service.js'
import type { AppEnv } from '../../types.js'

const ListPosQuery = z.object({
  status: z.string().optional(),
  supplierId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})

// ─── PO routes (/pos) ─────────────────────────────────────────────────────────

export const poRoutes = new Hono<AppEnv>()
poRoutes.use('*', requireAuth)

// GET /pos
poRoutes.get('/', zValidator('query', ListPosQuery), async (c) => {
  const q = c.req.valid('query')
  const { rows, total } = await svc.listPos(c.get('businessId'), {
    status: q.status,
    supplierId: q.supplierId,
    from: q.from,
    to: q.to,
    page: q.page,
    pageSize: q.pageSize,
  })
  return c.json({ items: rows, total, page: q.page, pageSize: q.pageSize })
})

// GET /pos/:id
poRoutes.get('/:id', async (c) => {
  try {
    const po = await svc.getPo(c.get('businessId'), c.req.param('id'))
    return c.json(po)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})

// POST /pos
poRoutes.post('/', zValidator('json', PoDraftCreate), async (c) => {
  const data = c.req.valid('json')
  const ctx = {
    userId: c.get('userId'),
    businessId: c.get('businessId'),
    ip: getRealIp(c),
    ua: c.req.header('user-agent'),
  }
  try {
    const po = await svc.createDraft(c.get('businessId'), data, ctx)
    return c.json(po, 201)
  } catch (err) {
    if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
    throw err
  }
})

// PATCH /pos/:id
poRoutes.patch('/:id', zValidator('json', PoDraftPatch), async (c) => {
  const data = c.req.valid('json')
  const ctx = {
    userId: c.get('userId'),
    businessId: c.get('businessId'),
    ip: getRealIp(c),
    ua: c.req.header('user-agent'),
  }
  try {
    const po = await svc.patchDraft(c.get('businessId'), c.req.param('id'), data, ctx)
    return c.json(po)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
    throw err
  }
})

// POST /pos/:id/approve
poRoutes.post('/:id/approve', async (c) => {
  const ctx = {
    userId: c.get('userId'),
    businessId: c.get('businessId'),
    ip: getRealIp(c),
    ua: c.req.header('user-agent'),
  }
  try {
    const po = await svc.approvePo(c.get('businessId'), c.req.param('id'), ctx)
    return c.json(po)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
    throw err
  }
})

// POST /pos/:id/cancel
poRoutes.post('/:id/cancel', zValidator('json', PoCancelBody), async (c) => {
  const { reason } = c.req.valid('json')
  const ctx = {
    userId: c.get('userId'),
    businessId: c.get('businessId'),
    ip: getRealIp(c),
    ua: c.req.header('user-agent'),
  }
  try {
    const po = await svc.cancelPo(c.get('businessId'), c.req.param('id'), reason, ctx)
    return c.json(po)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
    throw err
  }
})

// GET /pos/:id/pdf — PDF enqueued on approve; return job status
poRoutes.get('/:id/pdf', async (c) => {
  try {
    await svc.getPo(c.get('businessId'), c.req.param('id'))
    // PDF generation handled by the worker; return 501 until Phase 12 renders PDFs
    return c.json({ error: 'pdf_not_yet_generated' }, 501)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})

// POST /pos/:id/grns
poRoutes.post('/:id/grns', zValidator('json', GrnCreate), async (c) => {
  const data = c.req.valid('json')
  const ctx = {
    userId: c.get('userId'),
    businessId: c.get('businessId'),
    ip: getRealIp(c),
    ua: c.req.header('user-agent'),
  }
  try {
    const grn = await svc.createGrn(c.get('businessId'), c.req.param('id'), data, ctx)
    return c.json(grn, 201)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
    throw err
  }
})

// POST /pos/:id/bill — create a draft bill pre-filled from PO/GRN lines
poRoutes.post('/:id/bill', async (c) => {
  const ctx = {
    userId: c.get('userId'),
    businessId: c.get('businessId'),
    ip: getRealIp(c),
    ua: c.req.header('user-agent'),
  }
  try {
    const bill = await svc.createBillFromPo(c.get('businessId'), c.req.param('id'), ctx)
    return c.json(bill, 201)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
    throw err
  }
})

// ─── GRN routes (/grns) ───────────────────────────────────────────────────────

export const grnRoutes = new Hono<AppEnv>()
grnRoutes.use('*', requireAuth)

// GET /grns/:id
grnRoutes.get('/:id', async (c) => {
  try {
    const grn = await svc.getGrn(c.get('businessId'), c.req.param('id'))
    return c.json(grn)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})
