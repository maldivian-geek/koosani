import { boolean, date, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { timestamps, auditedBy } from './helpers'
import { gstCategoryEnum } from './enums'
import { businesses } from './businesses'
import { suppliers } from './suppliers'
import { customers } from './customers'

// Lightweight expense capture (Phase 31, UPGRADE.md G-11) — distinct from
// supplier bills (ARCHITECTURE.md §4.11): category is free text (no managed
// category list, unlike item_categories), always MVR (payables-side scope
// boundary, same as bills — Phase 30 multi-currency is sales-side only), and
// gstAmount is informational/reporting only — it does NOT feed MIRA input
// tax the way bill_lines does. A business that needs input tax credit for a
// purchase should record it as a supplier bill instead.
export const expenses = pgTable('expenses', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  category: text('category').notNull(),
  description: text('description'),
  // Optional — an expense doesn't have to be tied to a known supplier (e.g. petty cash).
  supplierId: uuid('supplier_id').references(() => suppliers.id),
  expenseDate: date('expense_date').notNull(),
  // Net (pre-tax) amount, same convention as invoice/bill lines — gstAmount/total
  // are computed forward via gstFor(), never entered as a gross receipt total.
  amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
  gstCategory: gstCategoryEnum('gst_category').notNull(),
  gstRate: numeric('gst_rate', { precision: 6, scale: 4 }).notNull(),
  gstAmount: numeric('gst_amount', { precision: 15, scale: 2 }).notNull(),
  total: numeric('total', { precision: 15, scale: 2 }).notNull(),
  paymentMethod: text('payment_method'),
  // No FK constraint — mirrors bills.fileId / businesses.logoFileId's
  // deliberate FK-less convention (files.ts's polymorphic attachment model).
  receiptFileId: uuid('receipt_file_id'),
  // Billable → invoice line (the feature's namesake half). billable=true
  // requires customerId (enforced at the service layer, not a DB constraint,
  // same as elsewhere in this app). invoiceId has no FK, mirrors
  // invoices.estimateId's "traceability without a circular schema reference"
  // pattern — set once, alongside invoicedAt, when added to an invoice draft.
  billable: boolean('billable').default(false).notNull(),
  customerId: uuid('customer_id').references(() => customers.id),
  invoiceId: uuid('invoice_id'),
  invoicedAt: timestamp('invoiced_at', { withTimezone: true }),
  ...timestamps,
  ...auditedBy,
})

export type Expense = typeof expenses.$inferSelect
export type NewExpense = typeof expenses.$inferInsert
