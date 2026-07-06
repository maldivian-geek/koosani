import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import {
  InvoiceDraftCreate,
  InvoiceDraftPatch,
  InvoicePaymentCreate,
  InvoiceVoidBody,
  CreditNoteCreate,
} from '@koosani/shared'
import { requireAuth } from '../../middleware/requireAuth.js'
import { requirePermission } from '../../middleware/authorize.js'
import { getRealIp } from '../../lib/ip.js'
import { createRedisRateLimiter } from '../../lib/rateLimiter.js'
import * as svc from './service.js'
import type { AppEnv } from '../../types.js'

// Per-user: 20 PDF requests per minute (SECURITY.md §13.7)
const pdfLimiter = createRedisRateLimiter('rl:invoice-pdf', 20, 60)

const ListInvoicesQuery = z.object({
  status: z.string().optional(),
  customerId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})

const ListCreditNotesQuery = z.object({
  customerId: z.string().uuid().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
})

// ─── Invoice routes ───────────────────────────────────────────────────────────

export const invoiceRoutes = new Hono<AppEnv>()
invoiceRoutes.use('*', requireAuth)

// GET /invoices
invoiceRoutes.get('/', zValidator('query', ListInvoicesQuery), async (c) => {
  const q = c.req.valid('query')
  const { rows, total } = await svc.listInvoices(c.get('businessId'), {
    status: q.status,
    customerId: q.customerId,
    from: q.from,
    to: q.to,
    q: q.q,
    page: q.page,
    pageSize: q.pageSize,
  })
  return c.json({ items: rows, total, page: q.page, pageSize: q.pageSize })
})

// GET /invoices/:id
invoiceRoutes.get('/:id', async (c) => {
  try {
    const invoice = await svc.getInvoice(c.get('businessId'), c.req.param('id'))
    return c.json(invoice)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})

// POST /invoices
invoiceRoutes.post(
  '/',
  requirePermission('invoices', 'add'),
  zValidator('json', InvoiceDraftCreate),
  async (c) => {
    const data = c.req.valid('json')
    const ctx = {
      userId: c.get('userId'),
      businessId: c.get('businessId'),
      ip: getRealIp(c),
      ua: c.req.header('user-agent'),
    }
    try {
      const invoice = await svc.createDraft(c.get('businessId'), data, ctx)
      return c.json(invoice, 201)
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: err.message }, 422)
      if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
      throw err
    }
  },
)

// PATCH /invoices/:id
invoiceRoutes.patch(
  '/:id',
  requirePermission('invoices', 'edit'),
  zValidator('json', InvoiceDraftPatch),
  async (c) => {
    const data = c.req.valid('json')
    const ctx = {
      userId: c.get('userId'),
      businessId: c.get('businessId'),
      ip: getRealIp(c),
      ua: c.req.header('user-agent'),
    }
    try {
      const invoice = await svc.patchDraft(c.get('businessId'), c.req.param('id'), data, ctx)
      return c.json(invoice)
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
      if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
      throw err
    }
  },
)

// POST /invoices/:id/issue
invoiceRoutes.post('/:id/issue', requirePermission('invoices', 'edit'), async (c) => {
  const ctx = {
    userId: c.get('userId'),
    businessId: c.get('businessId'),
    ip: getRealIp(c),
    ua: c.req.header('user-agent'),
  }
  try {
    const invoice = await svc.issue(c.get('businessId'), c.req.param('id'), ctx)
    return c.json(invoice)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
    throw err
  }
})

// POST /invoices/:id/void
invoiceRoutes.post(
  '/:id/void',
  requirePermission('invoices', 'edit'),
  zValidator('json', InvoiceVoidBody),
  async (c) => {
    const { reason } = c.req.valid('json')
    const ctx = {
      userId: c.get('userId'),
      businessId: c.get('businessId'),
      ip: getRealIp(c),
      ua: c.req.header('user-agent'),
    }
    try {
      const invoice = await svc.voidInvoice(c.get('businessId'), c.req.param('id'), reason, ctx)
      return c.json(invoice)
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
      if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
      throw err
    }
  },
)

// GET /invoices/:id/pdf — stub (PDF worker is a later phase)
invoiceRoutes.get('/:id/pdf', async (c) => {
  if (!(await pdfLimiter(c.get('userId')))) return c.json({ error: 'rate_limited' }, 429)
  try {
    await svc.getInvoice(c.get('businessId'), c.req.param('id'))
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
  return c.json({ error: 'pdf_not_implemented' }, 501)
})

// POST /invoices/:id/payments
invoiceRoutes.post(
  '/:id/payments',
  requirePermission('invoices', 'add'),
  zValidator('json', InvoicePaymentCreate),
  async (c) => {
    const data = c.req.valid('json')
    const ctx = {
      userId: c.get('userId'),
      businessId: c.get('businessId'),
      ip: getRealIp(c),
      ua: c.req.header('user-agent'),
    }
    try {
      const payment = await svc.addPayment(c.get('businessId'), c.req.param('id'), data, ctx)
      return c.json(payment, 201)
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
      if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
      throw err
    }
  },
)

// DELETE /invoices/:id/payments/:pid
invoiceRoutes.delete('/:id/payments/:pid', requirePermission('invoices', 'delete'), async (c) => {
  const ctx = {
    userId: c.get('userId'),
    businessId: c.get('businessId'),
    ip: getRealIp(c),
    ua: c.req.header('user-agent'),
  }
  try {
    await svc.reversePayment(c.get('businessId'), c.req.param('id'), c.req.param('pid'), ctx)
    return c.body(null, 204)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
    throw err
  }
})

// ─── Credit note routes ───────────────────────────────────────────────────────

export const creditNoteRoutes = new Hono<AppEnv>()
creditNoteRoutes.use('*', requireAuth)

// GET /credit-notes
creditNoteRoutes.get('/', zValidator('query', ListCreditNotesQuery), async (c) => {
  const q = c.req.valid('query')
  const notes = await svc.listCreditNotes(c.get('businessId'), {
    customerId: q.customerId,
    from: q.from,
    to: q.to,
  })
  return c.json(notes)
})

// POST /credit-notes
creditNoteRoutes.post(
  '/',
  requirePermission('invoices', 'add'),
  zValidator('json', CreditNoteCreate),
  async (c) => {
    const data = c.req.valid('json')
    const ctx = {
      userId: c.get('userId'),
      businessId: c.get('businessId'),
      ip: getRealIp(c),
      ua: c.req.header('user-agent'),
    }
    try {
      const cn = await svc.createCreditNote(c.get('businessId'), data, ctx)
      return c.json(cn, 201)
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: err.message }, 422)
      if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
      throw err
    }
  },
)

// POST /credit-notes/:id/issue
creditNoteRoutes.post('/:id/issue', requirePermission('invoices', 'edit'), async (c) => {
  const ctx = {
    userId: c.get('userId'),
    businessId: c.get('businessId'),
    ip: getRealIp(c),
    ua: c.req.header('user-agent'),
  }
  try {
    const cn = await svc.issueCreditNote(c.get('businessId'), c.req.param('id'), ctx)
    return c.json(cn)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
    throw err
  }
})
