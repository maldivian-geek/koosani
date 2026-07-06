import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { IsoDate } from '@koosani/shared'
import { requireAuth } from '../../middleware/requireAuth.js'
import { hasPermission } from '../../middleware/authorize.js'
import { createRedisRateLimiter } from '../../lib/rateLimiter.js'
import * as svc from './service.js'
import type { AppEnv } from '../../types.js'
import type { Context } from 'hono'

// Per-user: 20 CSV exports per minute (SECURITY.md §13.7)
const csvLimiter = createRedisRateLimiter('rl:reports-csv', 20, 60)
// Per-user: 10 bulk exports per hour (SECURITY.md §13.6)
const bulkExportLimiter = createRedisRateLimiter('rl:reports-bulk-export', 10, 60 * 60)

// Bulk export requires admin or an explicit reports.export grant, even for
// managers (SECURITY.md §13.6) — stricter than the read-only json view. Also
// rate-limited separately from the general CSV limiter (10/hour vs 20/min).
async function assertExportAllowed(c: Context<AppEnv>): Promise<Response | null> {
  const allowed = await hasPermission(c.get('role'), c.get('userId'), 'reports', 'export')
  if (!allowed) return c.json({ error: 'forbidden' }, 403)
  if (!(await bulkExportLimiter(c.get('userId')))) return c.json({ error: 'rate_limited' }, 429)
  return null
}

const DateRange = z.object({
  from: IsoDate,
  to: IsoDate,
  format: z.enum(['json', 'csv']).default('json'),
})

const AsOfQuery = z.object({
  asOf: IsoDate,
  format: z.enum(['json', 'csv']).default('json'),
})

function csvResponse(body: string, filename: string) {
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

export const reportRoutes = new Hono<AppEnv>()
reportRoutes.use('*', requireAuth)

// GET /reports/sales
reportRoutes.get(
  '/sales',
  zValidator(
    'query',
    DateRange.extend({ groupBy: z.enum(['customer', 'item', 'day']).default('customer') }),
  ),
  async (c) => {
    const { from, to, groupBy, format } = c.req.valid('query')
    const businessId = c.get('businessId')
    const rows = await svc.salesReport(businessId, from, to, groupBy)
    if (format === 'csv') {
      const denied = await assertExportAllowed(c)
      if (denied) return denied
      if (!(await csvLimiter(c.get('userId')))) return c.json({ error: 'rate_limited' }, 429)
      return csvResponse(svc.salesReportCsv(rows, groupBy), `sales-${from}-${to}.csv`)
    }
    return c.json({ from, to, groupBy, rows })
  },
)

// GET /reports/purchases
reportRoutes.get(
  '/purchases',
  zValidator(
    'query',
    DateRange.extend({ groupBy: z.enum(['supplier', 'item', 'day']).default('supplier') }),
  ),
  async (c) => {
    const { from, to, groupBy, format } = c.req.valid('query')
    const businessId = c.get('businessId')
    const rows = await svc.purchasesReport(businessId, from, to, groupBy)
    if (format === 'csv') {
      const denied = await assertExportAllowed(c)
      if (denied) return denied
      if (!(await csvLimiter(c.get('userId')))) return c.json({ error: 'rate_limited' }, 429)
      return csvResponse(svc.purchasesReportCsv(rows, groupBy), `purchases-${from}-${to}.csv`)
    }
    return c.json({ from, to, groupBy, rows })
  },
)

// GET /reports/stock-valuation
reportRoutes.get(
  '/stock-valuation',
  zValidator(
    'query',
    z.object({
      asOf: IsoDate,
      method: z.enum(['avg', 'fifo']).default('avg'),
      format: z.enum(['json', 'csv']).default('json'),
    }),
  ),
  async (c) => {
    const { asOf, method, format } = c.req.valid('query')
    const businessId = c.get('businessId')
    const rows = await svc.stockValuationReport(businessId, asOf, method)
    if (format === 'csv') {
      const denied = await assertExportAllowed(c)
      if (denied) return denied
      if (!(await csvLimiter(c.get('userId')))) return c.json({ error: 'rate_limited' }, 429)
      return csvResponse(svc.stockValuationCsv(rows, method), `stock-valuation-${asOf}.csv`)
    }
    return c.json({ asOf, method, rows })
  },
)

// GET /reports/aged-receivables
reportRoutes.get('/aged-receivables', zValidator('query', AsOfQuery), async (c) => {
  const { asOf, format } = c.req.valid('query')
  const businessId = c.get('businessId')
  const rows = await svc.agedReceivablesReport(businessId, asOf)
  if (format === 'csv') {
    const denied = await assertExportAllowed(c)
    if (denied) return denied
    if (!(await csvLimiter(c.get('userId')))) return c.json({ error: 'rate_limited' }, 429)
    return csvResponse(svc.agedCsv(rows, 'Customer'), `aged-receivables-${asOf}.csv`)
  }
  return c.json({ asOf, rows })
})

// GET /reports/aged-payables
reportRoutes.get('/aged-payables', zValidator('query', AsOfQuery), async (c) => {
  const { asOf, format } = c.req.valid('query')
  const businessId = c.get('businessId')
  const rows = await svc.agedPayablesReport(businessId, asOf)
  if (format === 'csv') {
    const denied = await assertExportAllowed(c)
    if (denied) return denied
    if (!(await csvLimiter(c.get('userId')))) return c.json({ error: 'rate_limited' }, 429)
    return csvResponse(svc.agedCsv(rows, 'Supplier'), `aged-payables-${asOf}.csv`)
  }
  return c.json({ asOf, rows })
})

// GET /reports/gst-summary
reportRoutes.get(
  '/gst-summary',
  zValidator(
    'query',
    z.object({ from: IsoDate, to: IsoDate, format: z.enum(['json', 'csv']).default('json') }),
  ),
  async (c) => {
    const { from, to, format } = c.req.valid('query')
    const businessId = c.get('businessId')
    const result = await svc.gstSummaryReport(businessId, from, to)
    if (format === 'csv') {
      const denied = await assertExportAllowed(c)
      if (denied) return denied
      if (!(await csvLimiter(c.get('userId')))) return c.json({ error: 'rate_limited' }, 429)
      return csvResponse(svc.gstSummaryCsv(result), `gst-summary-${from}-${to}.csv`)
    }
    return c.json(result)
  },
)
