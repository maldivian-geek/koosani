import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { fileTypeFromBuffer } from 'file-type'
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
import { createRedisRateLimiter } from '../../lib/rateLimiter.js'
import { extractAndWait } from '../../lib/extractClient.js'
import * as svc from './service.js'
import type { AppEnv } from '../../types.js'
import type { Context } from 'hono'

// Per-user: 10 image-OCR extracts per hour (SECURITY.md, rate limit table) —
// OCR is CPU-heavy, same reasoning as the pdf/report limiters.
const ocrLimiter = createRedisRateLimiter('rl:orderlist-ocr', 10, 3600)
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const ALLOWED_IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp'])

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
orderListRoutes.get(
  '/',
  requirePermission('orders', 'view'),
  zValidator('query', ListOrderListsQuery),
  async (c) => {
    const q = c.req.valid('query')
    const result = await svc.listOrderLists(c.get('businessId'), {
      q: q.q,
      page: q.page,
      pageSize: q.pageSize,
    })
    return c.json(result)
  },
)

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
orderListRoutes.get('/:id', requirePermission('orders', 'view'), async (c) => {
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

// POST /order-lists/:id/lines/extract-image — OCR an uploaded screenshot/
// photo of an order table into draft rows, feeding the SAME
// { lines, skipped } shape into the SAME review-and-confirm step as
// /lines/parse (ARCHITECTURE.md §4.16). The image is transient: held in
// memory, sent through the `extract` BullMQ queue, and never written to
// storage or disk (SECURITY.md §13.5 area note) — magic-byte + size checks
// still apply since it's still an untrusted upload.
orderListRoutes.post('/:id/lines/extract-image', requirePermission('orders', 'add'), async (c) => {
  const orderListId = c.req.param('id')

  try {
    await svc.assertOrderListExists(c.get('businessId'), orderListId)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }

  if (!(await ocrLimiter(c.get('userId')))) return c.json({ error: 'rate_limited' }, 429)

  const body = await c.req.parseBody()
  const entry = body['file']
  if (!entry || !(entry instanceof File)) return c.json({ error: 'file field required' }, 400)

  const buffer = Buffer.from(await entry.arrayBuffer())
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    return c.json({ error: 'file_too_large' }, 413)
  }

  // Magic-byte sniff (SECURITY.md §13.5 rule 1) — never trust the browser's
  // declared Content-Type for the part.
  const detected = await fileTypeFromBuffer(buffer)
  if (!detected || !ALLOWED_IMAGE_MIME.has(detected.mime)) {
    return c.json({ error: 'unsupported_media_type' }, 415)
  }

  const result = await extractAndWait({ imageBase64: buffer.toString('base64') })
  return c.json(result)
})

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
