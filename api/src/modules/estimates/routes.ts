import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { EstimateDraftCreate, EstimateDraftPatch } from '@koosani/shared'
import { requireAuth } from '../../middleware/requireAuth.js'
import { requirePermission } from '../../middleware/authorize.js'
import { getRealIp } from '../../lib/ip.js'
import { createRedisRateLimiter } from '../../lib/rateLimiter.js'
import { renderAndWaitForFile } from '../../lib/pdfClient.js'
import * as filesService from '../files/service.js'
import * as emailLogsService from '../emailLogs/service.js'
import * as svc from './service.js'
import type { AppEnv } from '../../types.js'

// Per-user: 20 PDF/send requests per minute (mirrors invoicing, SECURITY.md §13.7)
const pdfLimiter = createRedisRateLimiter('rl:estimate-pdf', 20, 60)

const ListEstimatesQuery = z.object({
  status: z.string().optional(),
  customerId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})

export const estimateRoutes = new Hono<AppEnv>()
estimateRoutes.use('*', requireAuth)

// GET /estimates
estimateRoutes.get('/', zValidator('query', ListEstimatesQuery), async (c) => {
  const q = c.req.valid('query')
  const { rows, total } = await svc.listEstimates(c.get('businessId'), {
    status: q.status,
    customerId: q.customerId,
    from: q.from,
    to: q.to,
    q: q.q,
    page: q.page,
    pageSize: q.pageSize,
  })
  return c.json({ items: rows, total, page: q.page, pageSize: q.pageSize })
})

// GET /estimates/:id
estimateRoutes.get('/:id', async (c) => {
  try {
    const estimate = await svc.getEstimate(c.get('businessId'), c.req.param('id'))
    return c.json(estimate)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})

// POST /estimates
estimateRoutes.post(
  '/',
  requirePermission('estimates', 'add'),
  zValidator('json', EstimateDraftCreate),
  async (c) => {
    const data = c.req.valid('json')
    const ctx = {
      userId: c.get('userId'),
      businessId: c.get('businessId'),
      ip: getRealIp(c),
      ua: c.req.header('user-agent'),
    }
    try {
      const estimate = await svc.createDraft(c.get('businessId'), data, ctx)
      return c.json(estimate, 201)
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: err.message }, 422)
      if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
      throw err
    }
  },
)

// PATCH /estimates/:id
estimateRoutes.patch(
  '/:id',
  requirePermission('estimates', 'edit'),
  zValidator('json', EstimateDraftPatch),
  async (c) => {
    const data = c.req.valid('json')
    const ctx = {
      userId: c.get('userId'),
      businessId: c.get('businessId'),
      ip: getRealIp(c),
      ua: c.req.header('user-agent'),
    }
    try {
      const estimate = await svc.patchDraft(c.get('businessId'), c.req.param('id'), data, ctx)
      return c.json(estimate)
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
      if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
      throw err
    }
  },
)

// POST /estimates/:id/send — allocates the number and emails the customer
estimateRoutes.post('/:id/send', requirePermission('estimates', 'edit'), async (c) => {
  if (!(await pdfLimiter(c.get('userId')))) return c.json({ error: 'rate_limited' }, 429)
  const ctx = {
    userId: c.get('userId'),
    businessId: c.get('businessId'),
    ip: getRealIp(c),
    ua: c.req.header('user-agent'),
  }
  try {
    const estimate = await svc.send(c.get('businessId'), c.req.param('id'), ctx)
    return c.json(estimate)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
    throw err
  }
})

// POST /estimates/:id/accept, /decline — staff records the customer's
// response manually; there's no customer-facing accept/decline surface until
// the portal (UPGRADE.md Phase 28).
estimateRoutes.post('/:id/accept', requirePermission('estimates', 'edit'), async (c) => {
  const ctx = {
    userId: c.get('userId'),
    businessId: c.get('businessId'),
    ip: getRealIp(c),
    ua: c.req.header('user-agent'),
  }
  try {
    const estimate = await svc.markAccepted(c.get('businessId'), c.req.param('id'), ctx)
    return c.json(estimate)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
    throw err
  }
})

estimateRoutes.post('/:id/decline', requirePermission('estimates', 'edit'), async (c) => {
  const ctx = {
    userId: c.get('userId'),
    businessId: c.get('businessId'),
    ip: getRealIp(c),
    ua: c.req.header('user-agent'),
  }
  try {
    const estimate = await svc.markDeclined(c.get('businessId'), c.req.param('id'), ctx)
    return c.json(estimate)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
    throw err
  }
})

// POST /estimates/:id/convert — copies lines into a new draft invoice
estimateRoutes.post('/:id/convert', requirePermission('invoices', 'add'), async (c) => {
  const ctx = {
    userId: c.get('userId'),
    businessId: c.get('businessId'),
    ip: getRealIp(c),
    ua: c.req.header('user-agent'),
  }
  try {
    const result = await svc.convertToInvoice(c.get('businessId'), c.req.param('id'), ctx)
    return c.json(result, 201)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
    throw err
  }
})

// GET /estimates/:id/pdf
estimateRoutes.get('/:id/pdf', async (c) => {
  if (!(await pdfLimiter(c.get('userId')))) return c.json({ error: 'rate_limited' }, 429)
  const estimateId = c.req.param('id')
  try {
    await svc.getEstimate(c.get('businessId'), estimateId)
    const fileId = await renderAndWaitForFile({
      kind: 'estimate',
      businessId: c.get('businessId'),
      estimateId,
      userId: c.get('userId'),
    })
    const url = await filesService.getSignedUrl(c.get('businessId'), fileId)
    return c.json({ url })
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})

// GET /estimates/:id/emails — delivery history
estimateRoutes.get('/:id/emails', async (c) => {
  const estimateId = c.req.param('id')
  try {
    await svc.getEstimate(c.get('businessId'), estimateId)
    const logs = await emailLogsService.listForEntity(c.get('businessId'), 'estimate', estimateId)
    return c.json(logs)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})
