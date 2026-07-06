import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { ExchangeRateCreate, CurrencyCode } from '@koosani/shared'
import { requireAuth } from '../../middleware/requireAuth.js'
import { requireRole } from '../../middleware/authorize.js'
import * as svc from './service.js'
import type { AppEnv } from '../../types.js'

export const exchangeRateRoutes = new Hono<AppEnv>()
exchangeRateRoutes.use('*', requireAuth)

const ListQuery = z.object({ currency: CurrencyCode.optional() })

// GET /exchange-rates?currency= — any authenticated role (read-only, needed
// to show rates when building an invoice/estimate)
exchangeRateRoutes.get('/', zValidator('query', ListQuery), async (c) => {
  const { currency } = c.req.valid('query')
  const rates = await svc.listRates(c.get('businessId'), currency)
  return c.json({ items: rates })
})

// POST /exchange-rates — admin only; feeds directly into financial totals
exchangeRateRoutes.post(
  '/',
  requireRole('admin'),
  zValidator('json', ExchangeRateCreate),
  async (c) => {
    const { currency, rate, rateDate } = c.req.valid('json')
    const row = await svc.recordRate(c.get('businessId'), currency, rate, rateDate, c.get('userId'))
    return c.json(row, 201)
  },
)
