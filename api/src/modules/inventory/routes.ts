import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { InventoryAdjustmentCreate, StockCountCreate } from '@koosani/shared'
import { requireAuth } from '../../middleware/requireAuth.js'
import { requirePermission } from '../../middleware/authorize.js'
import { getRealIp } from '../../lib/ip.js'
import * as svc from './service.js'
import type { AppEnv } from '../../types.js'

const MovementsQuery = z.object({
  itemId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
})

const OnHandQuery = z.object({
  categoryId: z.string().uuid().optional(),
  belowReorder: z
    .string()
    .optional()
    .transform((v) => v === 'true'),
})

export const inventoryRoutes = new Hono<AppEnv>()
inventoryRoutes.use('*', requireAuth)

// GET /inventory/movements
inventoryRoutes.get(
  '/movements',
  requirePermission('inventory', 'view'),
  zValidator('query', MovementsQuery),
  async (c) => {
    const { itemId, from, to, page, pageSize } = c.req.valid('query')
    const result = await svc.listMovements(c.get('businessId'), {
      itemId,
      from: from ? new Date(from) : undefined,
      to: to ? new Date(to) : undefined,
      page,
      pageSize,
    })
    return c.json(result)
  },
)

// GET /inventory/on-hand
inventoryRoutes.get(
  '/on-hand',
  requirePermission('inventory', 'view'),
  zValidator('query', OnHandQuery),
  async (c) => {
    const { categoryId, belowReorder } = c.req.valid('query')
    const rows = await svc.listOnHand(c.get('businessId'), { categoryId, belowReorder })
    return c.json(rows)
  },
)

// POST /inventory/adjustments
inventoryRoutes.post(
  '/adjustments',
  requirePermission('inventory', 'edit'),
  zValidator('json', InventoryAdjustmentCreate),
  async (c) => {
    const data = c.req.valid('json')
    const ctx = {
      userId: c.get('userId'),
      businessId: c.get('businessId'),
      ip: getRealIp(c),
      ua: c.req.header('user-agent'),
    }
    try {
      const movement = await svc.createAdjustment(c.get('businessId'), data, ctx)
      return c.json(movement, 201)
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
      if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
      throw err
    }
  },
)

// POST /inventory/stock-count
inventoryRoutes.post(
  '/stock-count',
  requirePermission('inventory', 'edit'),
  zValidator('json', StockCountCreate),
  async (c) => {
    const data = c.req.valid('json')
    const ctx = {
      userId: c.get('userId'),
      businessId: c.get('businessId'),
      ip: getRealIp(c),
      ua: c.req.header('user-agent'),
    }
    try {
      const result = await svc.bulkStockCount(c.get('businessId'), data, ctx)
      return c.json(result)
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
      throw err
    }
  },
)
