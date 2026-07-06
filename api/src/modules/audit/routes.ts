import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { requireAuth } from '../../middleware/requireAuth.js'
import { requireRole } from '../../middleware/authorize.js'
import * as repo from './repository.js'
import type { AppEnv } from '../../types.js'

const ListQuery = z.object({
  entityType: z.string().optional(),
  entityId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})

// Admin only (FUNCTIONS.md §audit) — the financial audit log is sensitive
// enough that no permission grant loosens this.
export const auditRoutes = new Hono<AppEnv>()
auditRoutes.use('*', requireAuth, requireRole('admin'))

// GET /audit
auditRoutes.get('/', zValidator('query', ListQuery), async (c) => {
  const q = c.req.valid('query')
  const { rows, total } = await repo.listAuditLogs(c.get('businessId'), {
    entityType: q.entityType,
    entityId: q.entityId,
    userId: q.userId,
    from: q.from ? new Date(q.from) : undefined,
    to: q.to ? new Date(q.to) : undefined,
    page: q.page,
    pageSize: q.pageSize,
  })
  return c.json({ items: rows, total, page: q.page, pageSize: q.pageSize })
})
