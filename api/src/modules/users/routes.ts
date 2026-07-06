import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { UserCreate, UserPatch } from '@koosani/shared'
import { requireAuth } from '../../middleware/requireAuth.js'
import { requireRole } from '../../middleware/authorize.js'
import { getRealIp } from '../../lib/ip.js'
import * as svc from './service.js'
import type { AppEnv } from '../../types.js'

const ListQuery = z.object({
  q: z.string().optional(),
  role: z.enum(['admin', 'manager', 'staff']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
})

// Every route here is admin-only (FUNCTIONS.md §users) — user management is
// not permission-grantable like the domain resources.
export const userRoutes = new Hono<AppEnv>()
userRoutes.use('*', requireAuth, requireRole('admin'))

// GET /users
userRoutes.get('/', zValidator('query', ListQuery), async (c) => {
  const { q, role, page, pageSize } = c.req.valid('query')
  const result = await svc.list(c.get('businessId'), { q, role, page, pageSize })
  return c.json(result)
})

// GET /users/:id
userRoutes.get('/:id', async (c) => {
  try {
    const user = await svc.getById(c.get('businessId'), c.req.param('id'))
    return c.json(user)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})

// POST /users — creates + sends invite
userRoutes.post('/', zValidator('json', UserCreate), async (c) => {
  const data = c.req.valid('json')
  const ctx = {
    userId: c.get('userId'),
    businessId: c.get('businessId'),
    ip: getRealIp(c),
    ua: c.req.header('user-agent'),
  }
  try {
    const user = await svc.create(c.get('businessId'), data, ctx)
    return c.json(user, 201)
  } catch (err) {
    if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
    throw err
  }
})

// PATCH /users/:id
userRoutes.patch('/:id', zValidator('json', UserPatch), async (c) => {
  const data = c.req.valid('json')
  const ctx = {
    userId: c.get('userId'),
    businessId: c.get('businessId'),
    ip: getRealIp(c),
    ua: c.req.header('user-agent'),
  }
  try {
    const user = await svc.update(c.get('businessId'), c.req.param('id'), data, ctx)
    return c.json(user)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})

// DELETE /users/:id
userRoutes.delete('/:id', async (c) => {
  const ctx = {
    userId: c.get('userId'),
    businessId: c.get('businessId'),
    ip: getRealIp(c),
    ua: c.req.header('user-agent'),
  }
  try {
    await svc.softDelete(c.get('businessId'), c.req.param('id'), ctx)
    return c.body(null, 204)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
    throw err
  }
})
