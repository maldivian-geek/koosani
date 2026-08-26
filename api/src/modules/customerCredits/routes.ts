import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { Money } from '@koosani/shared'
import { requireAuth } from '../../middleware/requireAuth.js'
import { requirePermission } from '../../middleware/authorize.js'
import { getRealIp } from '../../lib/ip.js'
import * as svc from './service.js'
import * as customersSvc from '../customers/service.js'
import type { AppEnv } from '../../types.js'

const CreditEntryBody = z.object({
  amount: Money,
  notes: z.string().max(2000).optional(),
})

// Mounted at /customers (alongside customerRoutes) rather than relying on a
// parent-supplied :id — Hono's type system doesn't propagate params from the
// mount prefix into a sub-app's own c.req.param() typing, so each path here
// declares :id itself.
export const customerCreditRoutes = new Hono<AppEnv>()
customerCreditRoutes.use('*', requireAuth)

// GET /customers/:id/credits — balance + ledger
customerCreditRoutes.get('/:id/credits', requirePermission('customers', 'view'), async (c) => {
  const customerId = c.req.param('id')
  try {
    await customersSvc.assertExists(customerId, c.get('businessId'))
    const [balance, ledger] = await Promise.all([
      svc.getBalance(c.get('businessId'), customerId),
      svc.listLedger(c.get('businessId'), customerId),
    ])
    return c.json({ balance, ledger })
  } catch (err) {
    if (err instanceof customersSvc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})

// POST /customers/:id/credits/advance — manually record a retainer/advance
customerCreditRoutes.post(
  '/:id/credits/advance',
  requirePermission('customers', 'edit'),
  zValidator('json', CreditEntryBody),
  async (c) => {
    const { amount, notes } = c.req.valid('json')
    const ctx = {
      userId: c.get('userId'),
      businessId: c.get('businessId'),
      ip: getRealIp(c),
      ua: c.req.header('user-agent'),
    }
    try {
      const entry = await svc.recordAdvance(
        c.get('businessId'),
        c.req.param('id'),
        amount,
        notes,
        ctx,
      )
      return c.json(entry, 201)
    } catch (err) {
      if (err instanceof customersSvc.NotFoundError) return c.json({ error: 'not_found' }, 404)
      if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
      throw err
    }
  },
)

// POST /customers/:id/credits/refund — pay credit back out to the customer
customerCreditRoutes.post(
  '/:id/credits/refund',
  requirePermission('customers', 'edit'),
  zValidator('json', CreditEntryBody),
  async (c) => {
    const { amount, notes } = c.req.valid('json')
    const ctx = {
      userId: c.get('userId'),
      businessId: c.get('businessId'),
      ip: getRealIp(c),
      ua: c.req.header('user-agent'),
    }
    try {
      const entry = await svc.refund(c.get('businessId'), c.req.param('id'), amount, notes, ctx)
      return c.json(entry, 201)
    } catch (err) {
      if (err instanceof customersSvc.NotFoundError) return c.json({ error: 'not_found' }, 404)
      if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
      throw err
    }
  },
)
