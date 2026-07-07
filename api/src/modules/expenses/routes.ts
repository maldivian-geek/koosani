import { Hono, type Context } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { ExpenseCreate, ExpensePatch, ExpenseMarkInvoiced } from '@koosani/shared'
import { requireAuth } from '../../middleware/requireAuth.js'
import { requirePermission } from '../../middleware/authorize.js'
import { getRealIp } from '../../lib/ip.js'
import * as svc from './service.js'
import * as filesSvc from '../files/service.js'
import type { AppEnv } from '../../types.js'

const ListExpensesQuery = z.object({
  category: z.string().optional(),
  supplierId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  billable: z.coerce.boolean().optional(),
  invoiced: z.coerce.boolean().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})

export const expenseRoutes = new Hono<AppEnv>()
expenseRoutes.use('*', requireAuth)

function ctxFrom(c: Context<AppEnv>) {
  return {
    userId: c.get('userId'),
    businessId: c.get('businessId'),
    ip: getRealIp(c),
    ua: c.req.header('user-agent'),
  }
}

// GET /expenses
expenseRoutes.get('/', zValidator('query', ListExpensesQuery), async (c) => {
  const q = c.req.valid('query')
  const { rows, total } = await svc.listExpenses(c.get('businessId'), {
    category: q.category,
    supplierId: q.supplierId,
    customerId: q.customerId,
    billable: q.billable,
    invoiced: q.invoiced,
    from: q.from,
    to: q.to,
    page: q.page,
    pageSize: q.pageSize,
  })
  return c.json({ items: rows, total, page: q.page, pageSize: q.pageSize })
})

// GET /expenses/billable?customerId= — uninvoiced billable expenses for a
// customer, used by the invoice editor to prefill line items
expenseRoutes.get(
  '/billable',
  zValidator('query', z.object({ customerId: z.string().uuid() })),
  async (c) => {
    const { customerId } = c.req.valid('query')
    const items = await svc.listUninvoicedBillable(c.get('businessId'), customerId)
    return c.json({ items })
  },
)

// GET /expenses/:id
expenseRoutes.get('/:id', async (c) => {
  try {
    const expense = await svc.getExpense(c.get('businessId'), c.req.param('id'))
    return c.json(expense)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})

// POST /expenses
expenseRoutes.post(
  '/',
  requirePermission('expenses', 'add'),
  zValidator('json', ExpenseCreate),
  async (c) => {
    try {
      const expense = await svc.createExpense(c.get('businessId'), c.req.valid('json'), ctxFrom(c))
      return c.json(expense, 201)
    } catch (err) {
      if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
      throw err
    }
  },
)

// PATCH /expenses/:id
expenseRoutes.patch(
  '/:id',
  requirePermission('expenses', 'edit'),
  zValidator('json', ExpensePatch),
  async (c) => {
    try {
      const expense = await svc.updateExpense(
        c.get('businessId'),
        c.req.param('id'),
        c.req.valid('json'),
        ctxFrom(c),
      )
      return c.json(expense)
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
      if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
      throw err
    }
  },
)

// DELETE /expenses/:id
expenseRoutes.delete('/:id', requirePermission('expenses', 'delete'), async (c) => {
  try {
    await svc.deleteExpense(c.get('businessId'), c.req.param('id'), ctxFrom(c))
    return c.body(null, 204)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
    throw err
  }
})

// POST /expenses/:id/receipt — multipart upload, reuses the files module's
// scan/hash/signed-URL pipeline (SECURITY.md §13.5)
expenseRoutes.post('/:id/receipt', requirePermission('expenses', 'edit'), async (c) => {
  const id = c.req.param('id')
  const formData = await c.req.formData()
  const entry = formData.get('file')
  if (!entry || !(entry instanceof File)) return c.json({ error: 'file field required' }, 400)

  const buffer = Buffer.from(await entry.arrayBuffer())
  try {
    const expense = await svc.attachReceipt(
      c.get('businessId'),
      id,
      buffer,
      entry.name,
      entry.type,
      ctxFrom(c),
    )
    return c.json(expense, 201)
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    if (err instanceof filesSvc.ValidationError) return c.json({ error: err.message }, 422)
    throw err
  }
})

// GET /expenses/:id/receipt — signed download URL for the attached receipt
expenseRoutes.get('/:id/receipt', async (c) => {
  try {
    const expense = await svc.getExpense(c.get('businessId'), c.req.param('id'))
    if (!expense.receiptFileId) return c.json({ error: 'not_found' }, 404)
    const url = await filesSvc.getSignedUrl(c.get('businessId'), expense.receiptFileId)
    return c.json({ url })
  } catch (err) {
    if (err instanceof svc.NotFoundError || err instanceof filesSvc.NotFoundError) {
      return c.json({ error: 'not_found' }, 404)
    }
    throw err
  }
})

// POST /expenses/mark-invoiced — called by the web client right after
// creating an invoice draft from selected billable expenses
expenseRoutes.post(
  '/mark-invoiced',
  requirePermission('expenses', 'edit'),
  zValidator('json', ExpenseMarkInvoiced),
  async (c) => {
    const { expenseIds, invoiceId } = c.req.valid('json')
    try {
      await svc.markInvoiced(c.get('businessId'), expenseIds, invoiceId, ctxFrom(c))
      return c.body(null, 204)
    } catch (err) {
      if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
      if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
      throw err
    }
  },
)
