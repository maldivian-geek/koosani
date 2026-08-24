import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import {
  OrderListCreate,
  OrderListPatch,
  OrderLineCreate,
  OrderLinePatch,
  OrderListParseRequest,
  OrderLinesImport,
} from '@koosani/shared'
import { requireAuth } from '../../middleware/requireAuth.js'
import { requirePermission } from '../../middleware/authorize.js'
import { getRealIp } from '../../lib/ip.js'
import * as svc from './service.js'
import type { AppEnv } from '../../types.js'
import type { Context } from 'hono'

const ListOrderListsQuery = z.object({
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})

export const orderListRoutes = new Hono<AppEnv>()
orderListRoutes.use('*', requireAuth)

function ctxFrom(c: Context<AppEnv>) {
  return {
    userId: c.get('userId'),
    businessId: c.get('businessId'),
    ip: getRealIp(c),
    ua: c.req.header('user-agent'),
  }
}

// GET /order-lists
orderListRoutes.get('/', zValidator('query', ListOrderListsQuery), async (c) => {
  const q = c.req.valid('query')
  const result = await svc.listOrderLists(c.get('businessId'), {
    q: q.q,
    page: q.page,
    pageSize: q.pageSize,
  })
  return c.json(result)
})

// POST /order-lists
orderListRoutes.post(
  '/',
  requirePermission('orders', 'add'),
  zValidator('json', OrderListCreate),
  async (c) => {
    const list = await svc.createOrderList(c.get('businessId'), c.req.valid('json'), ctxFrom(c))
    return c.json(list, 201)
  },
)

// GET /order-lists/:id
orderListRoutes.get('/:id', async (c) => {
  try {
    const list = await svc.getOrderList(c.get('businessId'), c.req.param('id'))
    return c.json(list)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})

// PATCH /order-lists/:id
orderListRoutes.patch(
  '/:id',
  requirePermission('orders', 'edit'),
  zValidator('json', OrderListPatch),
  async (c) => {
    try {
      const list = await svc.patchOrderList(
        c.get('businessId'),
        c.req.param('id'),
        c.req.valid('json'),
        ctxFrom(c),
      )
      return c.json(list)
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
      throw err
    }
  },
)

// DELETE /order-lists/:id
orderListRoutes.delete('/:id', requirePermission('orders', 'delete'), async (c) => {
  try {
    await svc.softDeleteOrderList(c.get('businessId'), c.req.param('id'), ctxFrom(c))
    return c.body(null, 204)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})

// POST /order-lists/:id/lines
orderListRoutes.post(
  '/:id/lines',
  requirePermission('orders', 'add'),
  zValidator('json', OrderLineCreate),
  async (c) => {
    try {
      const line = await svc.addLine(
        c.get('businessId'),
        c.req.param('id'),
        c.req.valid('json'),
        ctxFrom(c),
      )
      return c.json(line, 201)
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
      throw err
    }
  },
)

// POST /order-lists/:id/lines/parse — turn pasted spreadsheet/CSV text into
// draft rows. Persists nothing; the client shows the drafts in a
// review-and-confirm screen (SECURITY.md §13.13) before calling /lines/bulk.
orderListRoutes.post(
  '/:id/lines/parse',
  requirePermission('orders', 'add'),
  zValidator('json', OrderListParseRequest),
  async (c) => {
    try {
      const result = await svc.parseImport(
        c.get('businessId'),
        c.req.param('id'),
        c.req.valid('json').text,
      )
      return c.json(result)
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
      throw err
    }
  },
)

// POST /order-lists/:id/lines/bulk — create the reviewed rows in one
// transaction with a single order_list.import audit row.
orderListRoutes.post(
  '/:id/lines/bulk',
  requirePermission('orders', 'add'),
  zValidator('json', OrderLinesImport),
  async (c) => {
    try {
      const lines = await svc.importLines(
        c.get('businessId'),
        c.req.param('id'),
        c.req.valid('json').lines,
        ctxFrom(c),
      )
      return c.json({ lines }, 201)
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
      throw err
    }
  },
)

// PATCH /order-lists/:id/lines/:lineId
orderListRoutes.patch(
  '/:id/lines/:lineId',
  requirePermission('orders', 'edit'),
  zValidator('json', OrderLinePatch),
  async (c) => {
    try {
      const line = await svc.patchLine(
        c.get('businessId'),
        c.req.param('id'),
        c.req.param('lineId'),
        c.req.valid('json'),
        ctxFrom(c),
      )
      return c.json(line)
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
      throw err
    }
  },
)

// DELETE /order-lists/:id/lines/:lineId
orderListRoutes.delete('/:id/lines/:lineId', requirePermission('orders', 'delete'), async (c) => {
  try {
    await svc.deleteLine(c.get('businessId'), c.req.param('id'), c.req.param('lineId'), ctxFrom(c))
    return c.body(null, 204)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})
