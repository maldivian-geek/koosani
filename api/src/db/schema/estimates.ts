import {
  date,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { timestamps, auditedBy } from './helpers.js'
import { gstCategoryEnum, estimateStatusEnum, currencyCodeEnum } from './enums.js'
import { businesses } from './businesses.js'
import { customers } from './customers.js'
import { items } from './items.js'

// Estimates / quotes (Phase 25, UPGRADE.md G-5) — mirrors invoicing's draft
// pattern but with no stock reservation and no GST period interaction; GST is
// computed for display only, using the rate in effect when the line is
// priced, not snapshotted against a locked period the way invoice lines are.
export const estimates = pgTable(
  'estimates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    estimateNumber: text('estimate_number'),
    status: estimateStatusEnum('status').default('draft').notNull(),
    issueDate: date('issue_date'),
    expiryDate: date('expiry_date'),
    subtotal: numeric('subtotal', { precision: 15, scale: 2 }).default('0').notNull(),
    gstAmount: numeric('gst_amount', { precision: 15, scale: 2 }).default('0').notNull(),
    total: numeric('total', { precision: 15, scale: 2 }).default('0').notNull(),
    // Multi-currency (Phase 30, UPGRADE.md G-10) — same shape as invoices,
    // re-snapshotted fresh at draft-creation only (estimates never re-snapshot
    // GST or currency at `send`, unlike invoice `issue` — ARCHITECTURE.md §4.6).
    currency: currencyCodeEnum('currency').default('MVR').notNull(),
    exchangeRate: numeric('exchange_rate', { precision: 15, scale: 6 }).default('1').notNull(),
    subtotalMvr: numeric('subtotal_mvr', { precision: 15, scale: 2 }).default('0').notNull(),
    gstAmountMvr: numeric('gst_amount_mvr', { precision: 15, scale: 2 }).default('0').notNull(),
    totalMvr: numeric('total_mvr', { precision: 15, scale: 2 }).default('0').notNull(),
    notes: text('notes'),
    // Set once, on conversion — guards against converting the same estimate twice.
    convertedAt: timestamp('converted_at', { withTimezone: true }),
    ...timestamps,
    ...auditedBy,
  },
  (table) => [
    uniqueIndex('estimates_business_number_unique')
      .on(table.businessId, table.estimateNumber)
      .where(sql`status != 'draft'`),
  ],
)

export const estimateLines = pgTable('estimate_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  estimateId: uuid('estimate_id')
    .notNull()
    .references(() => estimates.id),
  itemId: uuid('item_id').references(() => items.id),
  description: text('description').notNull(),
  qty: numeric('qty', { precision: 15, scale: 4 }).notNull(),
  unitPrice: numeric('unit_price', { precision: 15, scale: 2 }).notNull(),
  gstCategory: gstCategoryEnum('gst_category').notNull(),
  gstRate: numeric('gst_rate', { precision: 6, scale: 4 }).notNull(),
  gstAmount: numeric('gst_amount', { precision: 15, scale: 2 }).notNull(),
  lineTotal: numeric('line_total', { precision: 15, scale: 2 }).notNull(),
  gstAmountMvr: numeric('gst_amount_mvr', { precision: 15, scale: 2 }).default('0').notNull(),
  lineTotalMvr: numeric('line_total_mvr', { precision: 15, scale: 2 }).default('0').notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  ...timestamps,
  ...auditedBy,
})

export type Estimate = typeof estimates.$inferSelect
export type NewEstimate = typeof estimates.$inferInsert
export type EstimateLine = typeof estimateLines.$inferSelect
