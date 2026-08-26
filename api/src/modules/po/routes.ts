import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { PoDraftCreate, PoDraftPatch, PoCancelBody, GrnCreate } from '@koosani/shared'
import { requireAuth } from '../../middleware/requireAuth.js'
import { requirePermission } from '../../middleware/authorize.js'
import { getRealIp } from '../../lib/ip.js'
import { createRedisRateLimiter } from '../../lib/rateLimiter.js'
import { renderAndWaitForFile } from '../../lib/pdfClient.js'
import * as filesService from '../files/service.js'
import * as svc from './service.js'
import type { AppEnv } from '../../types.js'

// Per-user: 20 PDF requests per minute (SECURITY.md §13.7)
const pdfLimiter = createRedisRateLimiter('rl:po-pdf', 20, 60)

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
poRoutes.get('/', requirePermission('po', 'view'), zValidator('query', ListPosQuery), async (c) => {
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
poRoutes.get('/:id', requirePermission('po', 'view'), async (c) => {
  try {
    const po = await svc.getPo(c.get('businessId'), c.req.param('id'))
    return c.json(po)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})

// POST /pos
poRoutes.post('/', requirePermission('po', 'add'), zValidator('json', PoDraftCreate), async (c) => {
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
poRoutes.patch(
  '/:id',
  requirePermission('po', 'edit'),
  zValidator('json', PoDraftPatch),
  async (c) => {
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
  },
)

// POST /pos/:id/approve
poRoutes.post('/:id/approve', requirePermission('po', 'edit'), async (c) => {
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
poRoutes.post(
  '/:id/cancel',
  requirePermission('po', 'edit'),
  zValidator('json', PoCancelBody),
  async (c) => {
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
  },
)

// GET /pos/:id/pdf — renders via the pdf worker queue (Phase 23, UPGRADE.md)
poRoutes.get('/:id/pdf', requirePermission('po', 'view'), async (c) => {
  if (!(await pdfLimiter(c.get('userId')))) return c.json({ error: 'rate_limited' }, 429)
  const poId = c.req.param('id')
  try {
    await svc.getPo(c.get('businessId'), poId)
    const fileId = await renderAndWaitForFile({
      kind: 'po',
      businessId: c.get('businessId'),
      poId,
      userId: c.get('userId'),
    })
    const url = await filesService.getSignedUrl(c.get('businessId'), fileId)
    return c.json({ url })
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})

// POST /pos/:id/grns
poRoutes.post(
  '/:id/grns',
  requirePermission('po', 'edit'),
  zValidator('json', GrnCreate),
  async (c) => {
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
  },
)

// POST /pos/:id/bill — create a draft bill pre-filled from PO/GRN lines
poRoutes.post('/:id/bill', requirePermission('po', 'edit'), async (c) => {
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
grnRoutes.get('/:id', requirePermission('po', 'view'), async (c) => {
  try {
    const grn = await svc.getGrn(c.get('businessId'), c.req.param('id'))
    return c.json(grn)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})
