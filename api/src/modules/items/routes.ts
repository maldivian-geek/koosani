import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { ItemCreate, ItemPatch, ItemCategoryCreate } from '@koosani/shared'
import { requireAuth } from '../../middleware/requireAuth.js'
import { requirePermission } from '../../middleware/authorize.js'
import { getRealIp } from '../../lib/ip.js'
import * as svc from './service.js'
import type { AppEnv } from '../../types.js'

const ListQuery = z.object({
  q: z.string().optional(),
  categoryId: z.string().uuid().optional(),
  active: z
    .string()
    .optional()
    .transform((v) => (v === 'false' ? false : v === 'true' ? true : undefined)),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
})

// Route-level patch schema extends the shared ItemPatch with the GST reason field
const ItemPatchRequest = ItemPatch.extend({
  gstCategoryChangeReason: z.string().min(1).max(500).optional(),
})

// ─── /items router ────────────────────────────────────────────────────────────

export const itemRoutes = new Hono<AppEnv>()
itemRoutes.use('*', requireAuth)

// GET /items
itemRoutes.get('/', zValidator('query', ListQuery), async (c) => {
  const { q, categoryId, active, page, pageSize } = c.req.valid('query')
  const result = await svc.list(c.get('businessId'), { q, categoryId, active, page, pageSize })
  return c.json(result)
})

// GET /items/:id
itemRoutes.get('/:id', async (c) => {
  const id = c.req.param('id')
  try {
    const item = await svc.getById(c.get('businessId'), id)
    return c.json(item)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})

// POST /items
itemRoutes.post(
  '/',
  requirePermission('items', 'add'),
  zValidator('json', ItemCreate),
  async (c) => {
    const data = c.req.valid('json')
    const ctx = {
      userId: c.get('userId'),
      businessId: c.get('businessId'),
      ip: getRealIp(c),
      ua: c.req.header('user-agent'),
    }
    try {
      const item = await svc.create(c.get('businessId'), data, ctx)
      return c.json(item, 201)
    } catch (err) {
      if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
      throw err
    }
  },
)

// PATCH /items/:id
itemRoutes.patch(
  '/:id',
  requirePermission('items', 'edit'),
  zValidator('json', ItemPatchRequest),
  async (c) => {
    const id = c.req.param('id')
    const { gstCategoryChangeReason, ...patch } = c.req.valid('json')
    const ctx = {
      userId: c.get('userId'),
      businessId: c.get('businessId'),
      ip: getRealIp(c),
      ua: c.req.header('user-agent'),
    }
    try {
      const item = await svc.update(c.get('businessId'), id, patch, gstCategoryChangeReason, ctx)
      return c.json(item)
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
      if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
      throw err
    }
  },
)

// DELETE /items/:id
itemRoutes.delete('/:id', requirePermission('items', 'delete'), async (c) => {
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

// ─── /item-categories router ─────────────────────────────────────────────────

export const categoryRoutes = new Hono<AppEnv>()
categoryRoutes.use('*', requireAuth)

// GET /item-categories
categoryRoutes.get('/', async (c) => {
  const categories = await svc.listCategories(c.get('businessId'))
  return c.json(categories)
})

// POST /item-categories
categoryRoutes.post(
  '/',
  requirePermission('items', 'edit'),
  zValidator('json', ItemCategoryCreate),
  async (c) => {
    const { name, parentId } = c.req.valid('json')
    const ctx = {
      userId: c.get('userId'),
      businessId: c.get('businessId'),
      ip: getRealIp(c),
      ua: c.req.header('user-agent'),
    }
    // Explicitly build the data object so parentId is absent (not undefined) when not provided
    const data = parentId !== undefined ? { name, parentId } : { name }
    const category = await svc.createCategory(c.get('businessId'), data, ctx)
    return c.json(category, 201)
  },
)
