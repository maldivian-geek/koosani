import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { CustomerCreate, CustomerPatch, ContactCreate, StatementSendBody } from '@koosani/shared'
import { requireAuth } from '../../middleware/requireAuth.js'
import { requirePermission } from '../../middleware/authorize.js'
import { getRealIp } from '../../lib/ip.js'
import { createRedisRateLimiter } from '../../lib/rateLimiter.js'
import { renderAndWaitForFile } from '../../lib/pdfClient.js'
import { emailQueue } from '../../lib/queues.js'
import * as filesService from '../files/service.js'
import * as svc from './service.js'
import type { AppEnv } from '../../types.js'

// Per-user: 10 SOA PDF requests per minute (SECURITY.md §13.7)
const soaPdfLimiter = createRedisRateLimiter('rl:customer-soa-pdf', 10, 60)

// Per-user: 10 statement-email requests per minute — same CPU cost as the
// SOA PDF route, plus an outbound send (Phase 24, UPGRADE.md)
const soaSendLimiter = createRedisRateLimiter('rl:customer-soa-send', 10, 60)

const ListQuery = z.object({
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  active: z
    .string()
    .optional()
    .transform((v) => (v === 'false' ? false : v === 'true' ? true : undefined)),
})

export const customerRoutes = new Hono<AppEnv>()

customerRoutes.use('*', requireAuth)

// GET /customers
customerRoutes.get(
  '/',
  requirePermission('customers', 'view'),
  zValidator('query', ListQuery),
  async (c) => {
    const { q, page, pageSize, active } = c.req.valid('query')
    const result = await svc.list(c.get('businessId'), { q, page, pageSize, active })
    return c.json(result)
  },
)

// GET /customers/:id
customerRoutes.get('/:id', requirePermission('customers', 'view'), async (c) => {
  const id = c.req.param('id')
  try {
    const customer = await svc.getById(c.get('businessId'), id)
    return c.json(customer)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})

// POST /customers
customerRoutes.post(
  '/',
  requirePermission('customers', 'add'),
  zValidator('json', CustomerCreate),
  async (c) => {
    const data = c.req.valid('json')
    const ctx = {
      userId: c.get('userId'),
      businessId: c.get('businessId'),
      ip: getRealIp(c),
      ua: c.req.header('user-agent'),
    }
    const customer = await svc.create(c.get('businessId'), data, ctx)
    return c.json(customer, 201)
  },
)

// PATCH /customers/:id
customerRoutes.patch(
  '/:id',
  requirePermission('customers', 'edit'),
  zValidator('json', CustomerPatch),
  async (c) => {
    const id = c.req.param('id')
    const data = c.req.valid('json')
    const ctx = {
      userId: c.get('userId'),
      businessId: c.get('businessId'),
      ip: getRealIp(c),
      ua: c.req.header('user-agent'),
    }
    try {
      const customer = await svc.update(c.get('businessId'), id, data, ctx)
      return c.json(customer)
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
      throw err
    }
  },
)

// DELETE /customers/:id
customerRoutes.delete('/:id', requirePermission('customers', 'delete'), async (c) => {
  const id = c.req.param('id')
  const ctx = {
    userId: c.get('userId'),
    businessId: c.get('businessId'),
    ip: getRealIp(c),
    ua: c.req.header('user-agent'),
  }
  try {
    await svc.softDelete(c.get('businessId'), id, ctx)
    return c.body(null, 204)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
    throw err
  }
})

// GET /customers/:id/soa
customerRoutes.get('/:id/soa', requirePermission('customers', 'view'), async (c) => {
  const from = c.req.query('from')
  const to = c.req.query('to')
  const format = c.req.query('format') ?? 'json'
  const customerId = c.req.param('id')

  if (!from || !to) return c.json({ error: 'from and to are required' }, 422)

  if (format === 'pdf') {
    if (!(await soaPdfLimiter(c.get('userId')))) return c.json({ error: 'rate_limited' }, 429)
    try {
      await svc.assertExists(customerId, c.get('businessId'))
      const fileId = await renderAndWaitForFile({
        kind: 'customer-soa',
        businessId: c.get('businessId'),
        customerId,
        from,
        to,
        userId: c.get('userId'),
      })
      const url = await filesService.getSignedUrl(c.get('businessId'), fileId)
      return c.json({ url })
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
      throw err
    }
  }

  try {
    const soa = await svc.buildSoa(c.get('businessId'), customerId, from, to)
    return c.json(soa)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})

// POST /customers/:id/soa/send — emails the statement PDF to the customer on
// file (Phase 24, UPGRADE.md G-3). Fire-and-forget, like /invoices/:id/send.
customerRoutes.post(
  '/:id/soa/send',
  requirePermission('customers', 'view'),
  zValidator('json', StatementSendBody),
  async (c) => {
    if (!(await soaSendLimiter(c.get('userId')))) return c.json({ error: 'rate_limited' }, 429)
    const { from, to } = c.req.valid('json')
    const customerId = c.req.param('id')
    try {
      await svc.assertExists(customerId, c.get('businessId'))
      await emailQueue.add('statement', {
        kind: 'statement',
        businessId: c.get('businessId'),
        customerId,
        from,
        to,
        userId: c.get('userId'),
      })
      return c.json({ queued: true }, 202)
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
      throw err
    }
  },
)

// POST /customers/:id/contacts
customerRoutes.post(
  '/:id/contacts',
  requirePermission('customers', 'edit'),
  zValidator('json', ContactCreate),
  async (c) => {
    const customerId = c.req.param('id')
    const data = c.req.valid('json')
    const ctx = {
      userId: c.get('userId'),
      businessId: c.get('businessId'),
      ip: getRealIp(c),
      ua: c.req.header('user-agent'),
    }
    try {
      const contact = await svc.addContact(c.get('businessId'), customerId, data, ctx)
      return c.json(contact, 201)
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
      throw err
    }
  },
)
