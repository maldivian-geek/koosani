import { z } from 'zod'
import { CurrencyCode, ExchangeRateValue, IsoDate } from './primitives.js'

// Multi-currency (Phase 30, UPGRADE.md G-10)

export const ExchangeRateCreate = z.object({
  currency: CurrencyCode.exclude(['MVR']),
  rate: ExchangeRateValue,
  rateDate: IsoDate,
})
export type ExchangeRateCreate = z.infer<typeof ExchangeRateCreate>
