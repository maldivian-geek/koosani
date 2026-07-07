import { date, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { businesses } from './businesses.js'
import { invoices } from './invoicing.js'
import { currencyCodeEnum } from './enums.js'

// Multi-currency (Phase 30, UPGRADE.md G-10) — see ARCHITECTURE.md §4.10.

// MVR-per-unit rate for a foreign currency on a given date. Never a row for
// 'MVR' itself — MVR-denominated documents always use rate 1 without a
// lookup (ARCHITECTURE.md §4.10). Manual entry only in this phase — `source`
// is an extension point for an automated daily-rate job, not yet built (no
// FX data provider has been chosen; see STACK.md's open decisions).
export const exchangeRates = pgTable(
  'exchange_rates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    currency: currencyCodeEnum('currency').notNull(),
    rate: numeric('rate', { precision: 15, scale: 6 }).notNull(),
    rateDate: date('rate_date').notNull(),
    source: text('source').default('manual').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    createdBy: uuid('created_by').notNull(),
  },
  (table) => [
    uniqueIndex('exchange_rates_business_currency_date_idx').on(
      table.businessId,
      table.currency,
      table.rateDate,
    ),
  ],
)

// Append-only, like customer_credits (ARCHITECTURE.md §4.8) — never updated.
// Recorded whenever a foreign-currency payment's MVR value (at the payment
// date's rate) differs from what the invoice's own MVR snapshot (at the
// invoice's issue-date rate) implied for that portion. Positive = gain,
// negative = loss. Always zero for MVR-denominated invoices (rate is always
// 1, so there is no FX exposure to realize) — no special-casing needed.
export const fxRealizedGainLoss = pgTable('fx_realized_gain_loss', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id),
  paymentId: uuid('payment_id').notNull(),
  amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export type ExchangeRate = typeof exchangeRates.$inferSelect
export type NewExchangeRate = typeof exchangeRates.$inferInsert
export type FxRealizedGainLoss = typeof fxRealizedGainLoss.$inferSelect
export type NewFxRealizedGainLoss = typeof fxRealizedGainLoss.$inferInsert
