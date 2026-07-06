import { Hono } from 'hono'
import { z } from 'zod'
import { zValidator } from '@hono/zod-validator'
import { requirePortalAuth } from '../../middleware/requirePortalAuth.js'
import { createRedisRateLimiter } from '../../lib/rateLimiter.js'
import { getRealIp } from '../../lib/ip.js'
import { renderAndWaitForFile } from '../../lib/pdfClient.js'
import * as filesService from '../files/service.js'
import * as invoicing from '../invoicing/service.js'
import * as estimates from '../estimates/service.js'
import * as customers from '../customers/service.js'
import type { PortalEnv } from '../../types.js'

// Read-only customer-facing surface (Phase 28, UPGRADE.md G-8) — see
// ARCHITECTURE.md §4.9, SECURITY.md §13.14. Every route re-derives its
// customer/business scope from the authenticated portal session
// (c.get('portalBusinessId')/('portalCustomerId')), never from the URL, and
// every detail/mutation route re-checks the fetched entity's own customerId
// before returning or acting on it — the underlying services have no
// portal-awareness of their own, so this ownership check is the only thing
// standing between "my own invoice" and "any invoice in the business."

const pdfLimiter = createRedisRateLimiter('rl:portal-pdf', 20, 60)
const acceptDeclineLimiter = createRedisRateLimiter('rl:portal-estimate-action', 20, 60)

const ListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
})

export const portalRoutes = new Hono<PortalEnv>()
portalRoutes.use('*', requirePortalAuth)

// GET /portal/me
portalRoutes.get('/me', async (c) => {
  try {
    const customer = await customers.assertExists(
      c.get('portalCustomerId'),
      c.get('portalBusinessId'),
    )
    return c.json({ id: customer.id, name: customer.name, email: customer.email })
  } catch (err) {
    if (err instanceof customers.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})

// ─── Invoices ─────────────────────────────────────────────────────────────────

// GET /portal/invoices
portalRoutes.get('/invoices', zValidator('query', ListQuery), async (c) => {
  const { page, pageSize } = c.req.valid('query')
  const { rows, total } = await invoicing.listInvoices(c.get('portalBusinessId'), {
    status: undefined,
    customerId: c.get('portalCustomerId'),
    from: undefined,
    to: undefined,
    q: undefined,
    page,
    pageSize,
  })
  return c.json({ items: rows, total, page, pageSize })
})

// GET /portal/invoices/:id
portalRoutes.get('/invoices/:id', async (c) => {
  try {
    const invoice = await invoicing.getInvoice(c.get('portalBusinessId'), c.req.param('id'))
    if (invoice.customerId !== c.get('portalCustomerId')) return c.json({ error: 'not_found' }, 404)
    return c.json(invoice)
  } catch (err) {
    if (err instanceof invoicing.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})

// GET /portal/invoices/:id/pdf
portalRoutes.get('/invoices/:id/pdf', async (c) => {
  if (!(await pdfLimiter(c.get('portalCustomerId')))) return c.json({ error: 'rate_limited' }, 429)
  const invoiceId = c.req.param('id')
  try {
    const invoice = await invoicing.getInvoice(c.get('portalBusinessId'), invoiceId)
    if (invoice.customerId !== c.get('portalCustomerId')) return c.json({ error: 'not_found' }, 404)

    const fileId = await renderAndWaitForFile({
      kind: 'invoice',
      businessId: c.get('portalBusinessId'),
      invoiceId,
      userId: c.get('portalCustomerId'),
    })
    const url = await filesService.getSignedUrl(c.get('portalBusinessId'), fileId)
    return c.json({ url })
  } catch (err) {
    if (err instanceof invoicing.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})

// ─── Estimates ────────────────────────────────────────────────────────────────

// GET /portal/estimates
portalRoutes.get('/estimates', zValidator('query', ListQuery), async (c) => {
  const { page, pageSize } = c.req.valid('query')
  const { rows, total } = await estimates.listEstimates(c.get('portalBusinessId'), {
    status: undefined,
    customerId: c.get('portalCustomerId'),
    from: undefined,
    to: undefined,
    q: undefined,
    page,
    pageSize,
  })
  return c.json({ items: rows, total, page, pageSize })
})

// GET /portal/estimates/:id
portalRoutes.get('/estimates/:id', async (c) => {
  try {
    const estimate = await estimates.getEstimate(c.get('portalBusinessId'), c.req.param('id'))
    if (estimate.customerId !== c.get('portalCustomerId'))
      return c.json({ error: 'not_found' }, 404)
    return c.json(estimate)
  } catch (err) {
    if (err instanceof estimates.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})

// GET /portal/estimates/:id/pdf
portalRoutes.get('/estimates/:id/pdf', async (c) => {
  if (!(await pdfLimiter(c.get('portalCustomerId')))) return c.json({ error: 'rate_limited' }, 429)
  const estimateId = c.req.param('id')
  try {
    const estimate = await estimates.getEstimate(c.get('portalBusinessId'), estimateId)
    if (estimate.customerId !== c.get('portalCustomerId'))
      return c.json({ error: 'not_found' }, 404)

    const fileId = await renderAndWaitForFile({
      kind: 'estimate',
      businessId: c.get('portalBusinessId'),
      estimateId,
      userId: c.get('portalCustomerId'),
    })
    const url = await filesService.getSignedUrl(c.get('portalBusinessId'), fileId)
    return c.json({ url })
  } catch (err) {
    if (err instanceof estimates.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})

// POST /portal/estimates/:id/accept — the actual customer-facing caller
// estimates.markAccepted was always meant to have (UPGRADE.md Phase 25 built
// it staff-only, pending this portal)
portalRoutes.post('/estimates/:id/accept', async (c) => {
  if (!(await acceptDeclineLimiter(c.get('portalCustomerId')))) {
    return c.json({ error: 'rate_limited' }, 429)
  }
  const estimateId = c.req.param('id')
  try {
    const estimate = await estimates.getEstimate(c.get('portalBusinessId'), estimateId)
    if (estimate.customerId !== c.get('portalCustomerId'))
      return c.json({ error: 'not_found' }, 404)

    const updated = await estimates.markAccepted(c.get('portalBusinessId'), estimateId, {
      userId: null,
      businessId: c.get('portalBusinessId'),
      ip: getRealIp(c),
      ua: c.req.header('user-agent'),
    })
    return c.json(updated)
  } catch (err) {
    if (err instanceof estimates.NotFoundError) return c.json({ error: 'not_found' }, 404)
    if (err instanceof estimates.ValidationError) return c.json({ error: err.message }, 422)
    throw err
  }
})

// POST /portal/estimates/:id/decline
portalRoutes.post('/estimates/:id/decline', async (c) => {
  if (!(await acceptDeclineLimiter(c.get('portalCustomerId')))) {
    return c.json({ error: 'rate_limited' }, 429)
  }
  const estimateId = c.req.param('id')
  try {
    const estimate = await estimates.getEstimate(c.get('portalBusinessId'), estimateId)
    if (estimate.customerId !== c.get('portalCustomerId'))
      return c.json({ error: 'not_found' }, 404)

    const updated = await estimates.markDeclined(c.get('portalBusinessId'), estimateId, {
      userId: null,
      businessId: c.get('portalBusinessId'),
      ip: getRealIp(c),
      ua: c.req.header('user-agent'),
    })
    return c.json(updated)
  } catch (err) {
    if (err instanceof estimates.NotFoundError) return c.json({ error: 'not_found' }, 404)
    if (err instanceof estimates.ValidationError) return c.json({ error: err.message }, 422)
    throw err
  }
})

// ─── Statement of account ─────────────────────────────────────────────────────

// GET /portal/statement
const StatementQuery = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
})

portalRoutes.get('/statement', zValidator('query', StatementQuery), async (c) => {
  const { from, to } = c.req.valid('query')
  try {
    const soa = await customers.buildSoa(
      c.get('portalBusinessId'),
      c.get('portalCustomerId'),
      from,
      to,
    )
    return c.json(soa)
  } catch (err) {
    if (err instanceof customers.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})
