import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { SupplierCreate, SupplierPatch, SupplierContactCreate } from '@koosani/shared'
import { requireAuth } from '../../middleware/requireAuth.js'
import { getRealIp } from '../../lib/ip.js'
import * as svc from './service.js'
import type { AppEnv } from '../../types.js'

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
supplierRoutes.get('/', zValidator('query', ListQuery), async (c) => {
  const { q, page, pageSize, active } = c.req.valid('query')
  const result = await svc.list(c.get('businessId'), { q, page, pageSize, active })
  return c.json(result)
})

// GET /suppliers/:id
supplierRoutes.get('/:id', async (c) => {
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
supplierRoutes.post('/', zValidator('json', SupplierCreate), async (c) => {
  const data = c.req.valid('json')
  const ctx = {
    userId: c.get('userId'),
    businessId: c.get('businessId'),
    ip: getRealIp(c),
    ua: c.req.header('user-agent'),
  }
  const supplier = await svc.create(c.get('businessId'), data, ctx)
  return c.json(supplier, 201)
})

// PATCH /suppliers/:id
supplierRoutes.patch('/:id', zValidator('json', SupplierPatch), async (c) => {
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
})

// DELETE /suppliers/:id
supplierRoutes.delete('/:id', async (c) => {
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

// GET /suppliers/:id/soa — implemented in Phase 8 (purchases)
supplierRoutes.get('/:id/soa', async (c) => {
  return c.json({ error: 'not_implemented' }, 501)
})

// POST /suppliers/:id/contacts
supplierRoutes.post('/:id/contacts', zValidator('json', SupplierContactCreate), async (c) => {
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
})
