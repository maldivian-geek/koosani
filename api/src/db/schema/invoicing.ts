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
import { timestamps, auditedBy } from './helpers'
import { gstCategoryEnum, invoiceStatusEnum, creditNoteStatusEnum } from './enums'
import { businesses } from './businesses'
import { customers } from './customers'
import { items } from './items'

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
    notes: text('notes'),
    voidReason: text('void_reason'),
    voidedAt: timestamp('voided_at', { withTimezone: true }),
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
  ...timestamps,
  ...auditedBy,
})

export type Invoice = typeof invoices.$inferSelect
export type NewInvoice = typeof invoices.$inferInsert
export type InvoiceLine = typeof invoiceLines.$inferSelect
export type CreditNote = typeof creditNotes.$inferSelect
export type PaymentReceived = typeof paymentsReceived.$inferSelect
