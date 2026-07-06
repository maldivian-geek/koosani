import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { BillDraftCreate, BillDraftPatch, BillPaymentCreate } from '@koosani/shared'
import { requireAuth } from '../../middleware/requireAuth.js'
import { requirePermission } from '../../middleware/authorize.js'
import { getRealIp } from '../../lib/ip.js'
import { soaExtractQueue } from '../../lib/queues.js'
import * as svc from './service.js'
import * as filesSvc from '../files/service.js'
import type { AppEnv } from '../../types.js'

const ListBillsQuery = z.object({
  status: z.string().optional(),
  supplierId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})

export const billRoutes = new Hono<AppEnv>()
billRoutes.use('*', requireAuth)

// GET /bills
billRoutes.get('/', zValidator('query', ListBillsQuery), async (c) => {
  const q = c.req.valid('query')
  const { rows, total } = await svc.listBills(c.get('businessId'), {
    status: q.status,
    supplierId: q.supplierId,
    from: q.from,
    to: q.to,
    page: q.page,
    pageSize: q.pageSize,
  })
  return c.json({ items: rows, total, page: q.page, pageSize: q.pageSize })
})

// GET /bills/:id
billRoutes.get('/:id', async (c) => {
  try {
    const bill = await svc.getBill(c.get('businessId'), c.req.param('id'))
    return c.json(bill)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})

// POST /bills
billRoutes.post(
  '/',
  requirePermission('bills', 'add'),
  zValidator('json', BillDraftCreate),
  async (c) => {
    const data = c.req.valid('json')
    const ctx = {
      userId: c.get('userId'),
      businessId: c.get('businessId'),
      ip: getRealIp(c),
      ua: c.req.header('user-agent'),
    }
    try {
      const bill = await svc.createDraft(c.get('businessId'), data, ctx)
      return c.json(bill, 201)
    } catch (err) {
      if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
      if (err instanceof svc.NotFoundError) return c.json({ error: err.message }, 422)
      throw err
    }
  },
)

// PATCH /bills/:id
billRoutes.patch(
  '/:id',
  requirePermission('bills', 'edit'),
  zValidator('json', BillDraftPatch),
  async (c) => {
    const data = c.req.valid('json')
    const ctx = {
      userId: c.get('userId'),
      businessId: c.get('businessId'),
      ip: getRealIp(c),
      ua: c.req.header('user-agent'),
    }
    try {
      const bill = await svc.patchDraft(c.get('businessId'), c.req.param('id'), data, ctx)
      return c.json(bill)
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
      if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
      throw err
    }
  },
)

// POST /bills/:id/confirm
billRoutes.post('/:id/confirm', requirePermission('bills', 'edit'), async (c) => {
  const ctx = {
    userId: c.get('userId'),
    businessId: c.get('businessId'),
    ip: getRealIp(c),
    ua: c.req.header('user-agent'),
  }
  try {
    const bill = await svc.confirmBill(c.get('businessId'), c.req.param('id'), ctx)
    return c.json(bill)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
    throw err
  }
})

// POST /bills/:id/payments
billRoutes.post(
  '/:id/payments',
  requirePermission('bills', 'add'),
  zValidator('json', BillPaymentCreate),
  async (c) => {
    const data = c.req.valid('json')
    const ctx = {
      userId: c.get('userId'),
      businessId: c.get('businessId'),
      ip: getRealIp(c),
      ua: c.req.header('user-agent'),
    }
    try {
      const payment = await svc.addPayment(c.get('businessId'), c.req.param('id'), data, ctx)
      return c.json(payment, 201)
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
      if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
      throw err
    }
  },
)

// DELETE /bills/:id/payments/:paymentId
billRoutes.delete('/:id/payments/:paymentId', requirePermission('bills', 'delete'), async (c) => {
  const ctx = {
    userId: c.get('userId'),
    businessId: c.get('businessId'),
    ip: getRealIp(c),
    ua: c.req.header('user-agent'),
  }
  try {
    await svc.reversePayment(c.get('businessId'), c.req.param('id'), c.req.param('paymentId'), ctx)
    return c.body(null, 204)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
    throw err
  }
})

// POST /bills/:id/attach — upload and attach a supplier invoice file
billRoutes.post('/:id/attach', requirePermission('bills', 'edit'), async (c) => {
  const billId = c.req.param('id')
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
    const file = await filesSvc.uploadFile(c.get('businessId'), buffer, entry.name, entry.type, ctx)
    await filesSvc.attachToEntity(c.get('businessId'), file.id, 'bill', billId, ctx)
    return c.json({ fileId: file.id }, 201)
  } catch (err) {
    if (err instanceof filesSvc.ValidationError) return c.json({ error: err.message }, 422)
    if (err instanceof filesSvc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})

// ─── SOA extract ──────────────────────────────────────────────────────────────

const SoaExtractBody = z.object({
  supplierId: z.string().uuid(),
})

// POST /soa-extract — multipart: file + supplierId; returns { jobId }
billRoutes.post('/soa-extract', requirePermission('bills', 'add'), async (c) => {
  const formData = await c.req.formData()
  const entry = formData.get('file')
  const supplierIdRaw = formData.get('supplierId')

  if (!entry || !(entry instanceof File)) return c.json({ error: 'file field required' }, 400)

  const parsed = SoaExtractBody.safeParse({ supplierId: supplierIdRaw })
  if (!parsed.success) return c.json({ error: 'supplierId is required' }, 400)

  const { supplierId } = parsed.data
  const ctx = {
    userId: c.get('userId'),
    businessId: c.get('businessId'),
    ip: getRealIp(c),
    ua: c.req.header('user-agent'),
  }

  const buffer = Buffer.from(await entry.arrayBuffer())

  try {
    const file = await filesSvc.uploadFile(c.get('businessId'), buffer, entry.name, entry.type, ctx)

    const job = await soaExtractQueue.add('extract', {
      businessId: c.get('businessId'),
      supplierId,
      fileId: file.id,
    })

    return c.json({ jobId: job.id }, 202)
  } catch (err) {
    if (err instanceof filesSvc.ValidationError) return c.json({ error: err.message }, 422)
    throw err
  }
})

// GET /soa-extract/:jobId — poll
billRoutes.get('/soa-extract/:jobId', async (c) => {
  const job = await soaExtractQueue.getJob(c.req.param('jobId'))
  if (!job) return c.json({ error: 'not_found' }, 404)

  const state = await job.getState()
  if (state === 'completed') {
    return c.json({ status: 'completed', matches: job.returnvalue as unknown })
  }
  if (state === 'failed') {
    return c.json({ status: 'failed', error: job.failedReason })
  }
  return c.json({ status: state })
})
