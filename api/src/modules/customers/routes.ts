import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { CustomerCreate, CustomerPatch, ContactCreate } from '@koosani/shared'
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

export const customerRoutes = new Hono<AppEnv>()

customerRoutes.use('*', requireAuth)

// GET /customers
customerRoutes.get('/', zValidator('query', ListQuery), async (c) => {
  const { q, page, pageSize, active } = c.req.valid('query')
  const result = await svc.list(c.get('businessId'), { q, page, pageSize, active })
  return c.json(result)
})

// GET /customers/:id
customerRoutes.get('/:id', async (c) => {
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
customerRoutes.post('/', zValidator('json', CustomerCreate), async (c) => {
  const data = c.req.valid('json')
  const ctx = {
    userId: c.get('userId'),
    businessId: c.get('businessId'),
    ip: getRealIp(c),
    ua: c.req.header('user-agent'),
  }
  const customer = await svc.create(c.get('businessId'), data, ctx)
  return c.json(customer, 201)
})

// PATCH /customers/:id
customerRoutes.patch('/:id', zValidator('json', CustomerPatch), async (c) => {
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
})

// DELETE /customers/:id
customerRoutes.delete('/:id', async (c) => {
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
customerRoutes.get('/:id/soa', async (c) => {
  const from = c.req.query('from')
  const to = c.req.query('to')
  const format = c.req.query('format') ?? 'json'

  if (!from || !to) return c.json({ error: 'from and to are required' }, 422)
  if (format === 'pdf') return c.json({ error: 'pdf_not_implemented' }, 501)

  try {
    const soa = await svc.buildSoa(c.get('businessId'), c.req.param('id'), from, to)
    return c.json(soa)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})

// POST /customers/:id/contacts
customerRoutes.post('/:id/contacts', zValidator('json', ContactCreate), async (c) => {
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
})
