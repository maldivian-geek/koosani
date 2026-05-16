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
import { gstCategoryEnum, billStatusEnum } from './enums'
import { businesses } from './businesses'
import { suppliers } from './suppliers'
import { items } from './items'

export const bills = pgTable(
  'bills',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    billNumber: text('bill_number'),
    supplierRef: text('supplier_ref'),
    status: billStatusEnum('status').default('draft').notNull(),
    billDate: date('bill_date'),
    dueDate: date('due_date'),
    subtotal: numeric('subtotal', { precision: 15, scale: 2 }).default('0').notNull(),
    inputGstAmount: numeric('input_gst_amount', { precision: 15, scale: 2 }).default('0').notNull(),
    total: numeric('total', { precision: 15, scale: 2 }).default('0').notNull(),
    paidAmount: numeric('paid_amount', { precision: 15, scale: 2 }).default('0').notNull(),
    notes: text('notes'),
    // po_id and file_id are set after creation; these tables are defined later
    poId: uuid('po_id'),
    fileId: uuid('file_id'),
    ...timestamps,
    ...auditedBy,
  },
  (table) => [
    uniqueIndex('bills_business_number_unique')
      .on(table.businessId, table.billNumber)
      .where(sql`status != 'draft'`),
  ],
)

export const billLines = pgTable('bill_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  billId: uuid('bill_id')
    .notNull()
    .references(() => bills.id),
  itemId: uuid('item_id').references(() => items.id),
  description: text('description').notNull(),
  qty: numeric('qty', { precision: 15, scale: 4 }).notNull(),
  unitCost: numeric('unit_cost', { precision: 15, scale: 2 }).notNull(),
  gstCategory: gstCategoryEnum('gst_category').notNull(),
  gstRate: numeric('gst_rate', { precision: 6, scale: 4 }).notNull(),
  gstAmount: numeric('gst_amount', { precision: 15, scale: 2 }).notNull(),
  lineTotal: numeric('line_total', { precision: 15, scale: 2 }).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  ...timestamps,
  ...auditedBy,
})

// Immutable once persisted; reversals create a new row (SECURITY.md Â§13.4)
export const paymentsMade = pgTable('payments_made', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  billId: uuid('bill_id')
    .notNull()
    .references(() => bills.id),
  supplierId: uuid('supplier_id')
    .notNull()
    .references(() => suppliers.id),
  amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
  method: text('method').notNull(),
  reference: text('reference'),
  paidAt: date('paid_at').notNull(),
  reversedAt: timestamp('reversed_at', { withTimezone: true }),
  reversalOfId: uuid('reversal_of_id'),
  ...timestamps,
  ...auditedBy,
})

export type Bill = typeof bills.$inferSelect
export type NewBill = typeof bills.$inferInsert
export type BillLine = typeof billLines.$inferSelect
export type PaymentMade = typeof paymentsMade.$inferSelect
