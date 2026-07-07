import {
  boolean,
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
import {
  gstCategoryEnum,
  invoiceStatusEnum,
  creditNoteStatusEnum,
  currencyCodeEnum,
} from './enums.js'
import { businesses } from './businesses.js'
import { customers } from './customers.js'
import { items } from './items.js'

export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    invoiceNumber: text('invoice_number'),
    status: invoiceStatusEnum('status').default('draft').notNull(),
    issueDate: date('issue_date'),
    dueDate: date('due_date'),
    subtotal: numeric('subtotal', { precision: 15, scale: 2 }).default('0').notNull(),
    gstAmount: numeric('gst_amount', { precision: 15, scale: 2 }).default('0').notNull(),
    total: numeric('total', { precision: 15, scale: 2 }).default('0').notNull(),
    paidAmount: numeric('paid_amount', { precision: 15, scale: 2 }).default('0').notNull(),
    // Multi-currency (Phase 30, UPGRADE.md G-10; ARCHITECTURE.md §4.10).
    // subtotal/gstAmount/total/paidAmount above are always in `currency`;
    // the *Mvr columns are the MVR-equivalent snapshot at `exchangeRate`,
    // re-snapshotted at issue time (mirrors gst_rate's re-snapshot on issue).
    // MVR-denominated documents always carry exchangeRate '1' and Mvr columns
    // equal to their document-currency counterparts — no special-casing.
    currency: currencyCodeEnum('currency').default('MVR').notNull(),
    exchangeRate: numeric('exchange_rate', { precision: 15, scale: 6 }).default('1').notNull(),
    subtotalMvr: numeric('subtotal_mvr', { precision: 15, scale: 2 }).default('0').notNull(),
    gstAmountMvr: numeric('gst_amount_mvr', { precision: 15, scale: 2 }).default('0').notNull(),
    totalMvr: numeric('total_mvr', { precision: 15, scale: 2 }).default('0').notNull(),
    paidAmountMvr: numeric('paid_amount_mvr', { precision: 15, scale: 2 }).default('0').notNull(),
    notes: text('notes'),
    voidReason: text('void_reason'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
    // Per-invoice opt-out for the reminders cron (Phase 24, UPGRADE.md G-4).
    // Not in guard_invoice_frozen()'s frozen-column tuple — updatable post-issue.
    remindersEnabled: boolean('reminders_enabled').default(true).notNull(),
    // Traceability back to the estimate this was converted from, if any
    // (Phase 25, UPGRADE.md G-5). No FK to estimates here to avoid a circular
    // module reference at the schema level; enforced at the service layer.
    estimateId: uuid('estimate_id'),
    // Traceability back to the recurrence profile that generated this invoice,
    // if any (Phase 26, UPGRADE.md G-6). Same no-FK rationale as estimateId.
    recurrenceProfileId: uuid('recurrence_profile_id'),
    ...timestamps,
    ...auditedBy,
  },
  (table) => [
    // No gaps allowed: number allocated only on issue, unique per business (ARCHITECTURE.md Â§4.2)
    uniqueIndex('invoices_business_number_unique')
      .on(table.businessId, table.invoiceNumber)
      .where(sql`status != 'draft'`),
  ],
)

export const invoiceLines = pgTable('invoice_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id),
  itemId: uuid('item_id').references(() => items.id),
  description: text('description').notNull(),
  qty: numeric('qty', { precision: 15, scale: 4 }).notNull(),
  unitPrice: numeric('unit_price', { precision: 15, scale: 2 }).notNull(),
  gstCategory: gstCategoryEnum('gst_category').notNull(),
  // Snapshotted at invoice issue time (ARCHITECTURE.md Â§4.1)
  gstRate: numeric('gst_rate', { precision: 6, scale: 4 }).notNull(),
  gstAmount: numeric('gst_amount', { precision: 15, scale: 2 }).notNull(),
  lineTotal: numeric('line_total', { precision: 15, scale: 2 }).notNull(),
  // MVR-equivalent snapshot (Phase 30, UPGRADE.md G-10) — the GST module and
  // most reports sum line-level gstAmount/lineTotal, so the MVR columns must
  // live here, not just on the invoice header (ARCHITECTURE.md §4.10).
  gstAmountMvr: numeric('gst_amount_mvr', { precision: 15, scale: 2 }).default('0').notNull(),
  lineTotalMvr: numeric('line_total_mvr', { precision: 15, scale: 2 }).default('0').notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  ...timestamps,
  ...auditedBy,
})

export const creditNotes = pgTable(
  'credit_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    invoiceId: uuid('invoice_id').references(() => invoices.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    creditNoteNumber: text('credit_note_number'),
    status: creditNoteStatusEnum('status').default('draft').notNull(),
    issueDate: date('issue_date'),
    subtotal: numeric('subtotal', { precision: 15, scale: 2 }).default('0').notNull(),
    gstAmount: numeric('gst_amount', { precision: 15, scale: 2 }).default('0').notNull(),
    total: numeric('total', { precision: 15, scale: 2 }).default('0').notNull(),
    // Multi-currency (Phase 30, UPGRADE.md G-10) — same shape as invoices,
    // no paidAmount equivalent (credit notes aren't paid against).
    currency: currencyCodeEnum('currency').default('MVR').notNull(),
    exchangeRate: numeric('exchange_rate', { precision: 15, scale: 6 }).default('1').notNull(),
    subtotalMvr: numeric('subtotal_mvr', { precision: 15, scale: 2 }).default('0').notNull(),
    gstAmountMvr: numeric('gst_amount_mvr', { precision: 15, scale: 2 }).default('0').notNull(),
    totalMvr: numeric('total_mvr', { precision: 15, scale: 2 }).default('0').notNull(),
    reason: text('reason'),
    ...timestamps,
    ...auditedBy,
  },
  (table) => [
    uniqueIndex('credit_notes_business_number_unique')
      .on(table.businessId, table.creditNoteNumber)
      .where(sql`status != 'draft'`),
  ],
)

export const creditNoteLines = pgTable('credit_note_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  creditNoteId: uuid('credit_note_id')
    .notNull()
    .references(() => creditNotes.id),
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

// Immutable once persisted; reversals create a new row (SECURITY.md Â§13.4)
export const paymentsReceived = pgTable('payments_received', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  invoiceId: uuid('invoice_id')
    .notNull()
    .references(() => invoices.id),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id),
  amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
  method: text('method').notNull(),
  reference: text('reference'),
  paidAt: date('paid_at').notNull(),
  reversedAt: timestamp('reversed_at', { withTimezone: true }),
  reversalOfId: uuid('reversal_of_id'),
  // Multi-currency (Phase 30, UPGRADE.md G-10) — the exchange rate on the
  // *payment* date (which may differ from the invoice's issue-date rate),
  // and this payment's own MVR-equivalent. The gap between amountMvr here
  // and (amount * invoice.exchangeRate) is the realized gain/loss recorded
  // in fx_realized_gain_loss. Always exchangeRate '1' for MVR invoices.
  exchangeRate: numeric('exchange_rate', { precision: 15, scale: 6 }).default('1').notNull(),
  amountMvr: numeric('amount_mvr', { precision: 15, scale: 2 }).default('0').notNull(),
  ...timestamps,
  ...auditedBy,
})

// Delivery notes / packing slips (Phase 33, UPGRADE.md G-13/F-24) — generated
// from an issued invoice, immutable once created (no draft state; there's
// nothing to approve, it's a snapshot of what's being physically delivered).
// No prices — see ARCHITECTURE.md §4.14.
export const deliveryNotes = pgTable(
  'delivery_notes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id),
    customerId: uuid('customer_id')
      .notNull()
      .references(() => customers.id),
    deliveryNoteNumber: text('delivery_note_number').notNull(),
    issueDate: date('issue_date').notNull(),
    notes: text('notes'),
    ...timestamps,
    ...auditedBy,
  },
  (table) => [
    uniqueIndex('delivery_notes_business_number_unique').on(
      table.businessId,
      table.deliveryNoteNumber,
    ),
  ],
)

export const deliveryNoteLines = pgTable('delivery_note_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  deliveryNoteId: uuid('delivery_note_id')
    .notNull()
    .references(() => deliveryNotes.id),
  itemId: uuid('item_id').references(() => items.id),
  description: text('description').notNull(),
  qty: numeric('qty', { precision: 15, scale: 4 }).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  ...timestamps,
})

export type Invoice = typeof invoices.$inferSelect
export type NewInvoice = typeof invoices.$inferInsert
export type InvoiceLine = typeof invoiceLines.$inferSelect
export type CreditNote = typeof creditNotes.$inferSelect
export type DeliveryNote = typeof deliveryNotes.$inferSelect
export type DeliveryNoteLine = typeof deliveryNoteLines.$inferSelect
export type PaymentReceived = typeof paymentsReceived.$inferSelect
