import Decimal from 'decimal.js'
import * as repo from './repository.js'
import type { ExchangeRate, FxRealizedGainLoss } from './repository.js'
import type { CurrencyCode } from '@koosani/shared'
import type { DbTx } from '../../db/client.js'

export type { ExchangeRate, FxRealizedGainLoss }

export class NotFoundError extends Error {}

// MVR is always rate 1 — never requires a stored row, never looked up
// (ARCHITECTURE.md §4.10). Every other currency must have a manually-entered
// rate on or before the requested date, or this throws — callers (invoicing,
// estimates) surface that as a clear 422, not a silent fallback to 1.
export async function rateAt(
  businessId: string,
  currency: CurrencyCode,
  date: string,
): Promise<Decimal> {
  if (currency === 'MVR') return new Decimal(1)

  const row = await repo.getRateAt(businessId, currency, date)
  if (!row) {
    throw new NotFoundError(
      `No exchange rate found for ${currency} on or before ${date}. Record one via POST /exchange-rates first.`,
    )
  }
  return new Decimal(row.rate)
}

export async function recordRate(
  businessId: string,
  currency: CurrencyCode,
  rate: string,
  rateDate: string,
  userId: string,
): Promise<ExchangeRate> {
  if (currency === 'MVR') {
    throw new Error('Cannot record an exchange rate for MVR — it is always 1 by definition')
  }
  return repo.insertRate({
    businessId,
    currency,
    rate,
    rateDate,
    source: 'manual',
    createdBy: userId,
  })
}

export async function listRates(
  businessId: string,
  currency?: CurrencyCode,
): Promise<ExchangeRate[]> {
  return repo.listRates(businessId, currency)
}

// Records the difference between what a payment is actually worth in MVR (at
// the payment date's rate) and what the invoice's own MVR snapshot (at its
// issue-date rate) implied for that same document-currency amount. Called by
// invoicing.addPayment inside its own transaction; a no-op for MVR invoices
// since there's never a rate difference to realize (ARCHITECTURE.md §4.10).
export async function recordRealizedGainLoss(
  businessId: string,
  invoiceId: string,
  paymentId: string,
  amount: string,
  tx: DbTx,
): Promise<FxRealizedGainLoss | null> {
  if (new Decimal(amount).isZero()) return null
  return repo.insertGainLoss({ businessId, invoiceId, paymentId, amount }, tx)
}

export async function listGainLossByInvoice(
  businessId: string,
  invoiceId: string,
): Promise<FxRealizedGainLoss[]> {
  return repo.listGainLossByInvoice(businessId, invoiceId)
}
