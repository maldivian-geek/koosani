import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { SupplierCreate, SupplierPatch, SupplierContactCreate } from '@koosani/shared'
import { requireAuth } from '../../middleware/requireAuth.js'
import { requirePermission } from '../../middleware/authorize.js'
import { getRealIp } from '../../lib/ip.js'
import { createRedisRateLimiter } from '../../lib/rateLimiter.js'
import { renderAndWaitForFile } from '../../lib/pdfClient.js'
import * as filesService from '../files/service.js'
import * as svc from './service.js'
import * as purchases from '../purchases/service.js'
import type { AppEnv } from '../../types.js'

// Per-user: 10 SOA PDF requests per minute (SECURITY.md §13.7)
const soaPdfLimiter = createRedisRateLimiter('rl:supplier-soa-pdf', 10, 60)

const ListQuery = z.object({
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
  active: z
    .string()
    .optional()
    .transform((v) => (v === 'false' ? false : v === 'true' ? true : undefined)),
})

export const supplierRoutes = new Hono<AppEnv>()

supplierRoutes.use('*', requireAuth)

// GET /suppliers
supplierRoutes.get(
  '/',
  requirePermission('suppliers', 'view'),
  zValidator('query', ListQuery),
  async (c) => {
    const { q, page, pageSize, active } = c.req.valid('query')
    const result = await svc.list(c.get('businessId'), { q, page, pageSize, active })
    return c.json(result)
  },
)

// GET /suppliers/:id
supplierRoutes.get('/:id', requirePermission('suppliers', 'view'), async (c) => {
  const id = c.req.param('id')
  try {
    const supplier = await svc.getById(c.get('businessId'), id)
    return c.json(supplier)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})

// POST /suppliers
supplierRoutes.post(
  '/',
  requirePermission('suppliers', 'add'),
  zValidator('json', SupplierCreate),
  async (c) => {
    const data = c.req.valid('json')
    const ctx = {
      userId: c.get('userId'),
      businessId: c.get('businessId'),
      ip: getRealIp(c),
      ua: c.req.header('user-agent'),
    }
    const supplier = await svc.create(c.get('businessId'), data, ctx)
    return c.json(supplier, 201)
  },
)

// PATCH /suppliers/:id
supplierRoutes.patch(
  '/:id',
  requirePermission('suppliers', 'edit'),
  zValidator('json', SupplierPatch),
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
      const supplier = await svc.update(c.get('businessId'), id, data, ctx)
      return c.json(supplier)
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
      throw err
    }
  },
)

// DELETE /suppliers/:id
supplierRoutes.delete('/:id', requirePermission('suppliers', 'delete'), async (c) => {
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

// GET /suppliers/:id/soa
const SoaQuery = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  format: z.enum(['json', 'pdf']).default('json'),
})

supplierRoutes.get(
  '/:id/soa',
  requirePermission('suppliers', 'view'),
  zValidator('query', SoaQuery),
  async (c) => {
    const { from, to, format } = c.req.valid('query')
    const supplierId = c.req.param('id')

    if (format === 'pdf') {
      if (!(await soaPdfLimiter(c.get('userId')))) return c.json({ error: 'rate_limited' }, 429)
      try {
        await svc.getById(c.get('businessId'), supplierId)
        const fileId = await renderAndWaitForFile({
          kind: 'supplier-soa',
          businessId: c.get('businessId'),
          supplierId,
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
      const soa = await purchases.buildSupplierSoa(c.get('businessId'), supplierId, from, to)
      return c.json(soa)
    } catch (err) {
      if (err instanceof purchases.NotFoundError) return c.json({ error: 'not_found' }, 404)
      throw err
    }
  },
)

// POST /suppliers/:id/contacts
supplierRoutes.post(
  '/:id/contacts',
  requirePermission('suppliers', 'edit'),
  zValidator('json', SupplierContactCreate),
  async (c) => {
    const supplierId = c.req.param('id')
    const data = c.req.valid('json')
    const ctx = {
      userId: c.get('userId'),
      businessId: c.get('businessId'),
      ip: getRealIp(c),
      ua: c.req.header('user-agent'),
    }
    try {
      const contact = await svc.addContact(c.get('businessId'), supplierId, data, ctx)
      return c.json(contact, 201)
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
      throw err
    }
  },
)
