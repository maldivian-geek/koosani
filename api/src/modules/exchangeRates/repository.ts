import { and, desc, eq, lte } from 'drizzle-orm'
import { db } from '../../db/client.js'
import type { DbTx } from '../../db/client.js'
import { exchangeRates, fxRealizedGainLoss } from '../../db/schema/index.js'
import type { ExchangeRate, NewExchangeRate, FxRealizedGainLoss } from '../../db/schema/index.js'
import type { CurrencyCode } from '@koosani/shared'

export type { ExchangeRate, FxRealizedGainLoss }

// Most recent rate on or before `date` — mirrors gst.repository.getRateAt's
// effective-dated lookup, but a plain "latest snapshot <= date" rather than a
// validFrom/validTo range: FX rates are daily snapshots, not regime changes.
export async function getRateAt(
  businessId: string,
  currency: CurrencyCode,
  date: string,
): Promise<ExchangeRate | null> {
  const [row] = await db
    .select()
    .from(exchangeRates)
    .where(
      and(
        eq(exchangeRates.businessId, businessId),
        eq(exchangeRates.currency, currency),
        lte(exchangeRates.rateDate, date),
      ),
    )
    .orderBy(desc(exchangeRates.rateDate))
    .limit(1)
  return row ?? null
}

export async function insertRate(data: NewExchangeRate): Promise<ExchangeRate> {
  const [row] = await db
    .insert(exchangeRates)
    .values(data)
    .onConflictDoUpdate({
      target: [exchangeRates.businessId, exchangeRates.currency, exchangeRates.rateDate],
      set: { rate: data.rate, source: data.source, createdBy: data.createdBy },
    })
    .returning()
  if (!row) throw new Error('insertRate: no row returned')
  return row
}

export async function listRates(
  businessId: string,
  currency?: CurrencyCode,
): Promise<ExchangeRate[]> {
  return db
    .select()
    .from(exchangeRates)
    .where(
      currency
        ? and(eq(exchangeRates.businessId, businessId), eq(exchangeRates.currency, currency))
        : eq(exchangeRates.businessId, businessId),
    )
    .orderBy(desc(exchangeRates.rateDate))
}

// ─── Realized gain/loss (append-only, ARCHITECTURE.md §4.10) ────────────────

export async function insertGainLoss(
  data: { businessId: string; invoiceId: string; paymentId: string; amount: string },
  tx: DbTx,
): Promise<FxRealizedGainLoss> {
  const [row] = await tx.insert(fxRealizedGainLoss).values(data).returning()
  if (!row) throw new Error('insertGainLoss: no row returned')
  return row
}

export async function listGainLossByInvoice(
  businessId: string,
  invoiceId: string,
): Promise<FxRealizedGainLoss[]> {
  return db
    .select()
    .from(fxRealizedGainLoss)
    .where(
      and(
        eq(fxRealizedGainLoss.businessId, businessId),
        eq(fxRealizedGainLoss.invoiceId, invoiceId),
      ),
    )
    .orderBy(desc(fxRealizedGainLoss.createdAt))
}
