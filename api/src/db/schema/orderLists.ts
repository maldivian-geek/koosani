import { integer, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { timestamps, auditedBy } from './helpers.js'
import { orderListPaymentStatusEnum, orderListStockStatusEnum } from './enums.js'
import { businesses } from './businesses.js'

// Order lists (Phase 34) — a lightweight named working checklist modeled on a
// spreadsheet the owner already uses: free-text stock-order lines with a
// per-row payment/stock status edited inline. Deliberately NOT a financial
// document (no GST, no numbering, no stock movement) and NOT linked to the
// items master (item_name is free text by product decision) — see
// ARCHITECTURE.md §4.16.
export const orderLists = pgTable('order_lists', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  title: text('title').notNull(),
  notes: text('notes'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  ...timestamps,
  ...auditedBy,
})

export const orderListLines = pgTable('order_list_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  orderListId: uuid('order_list_id')
    .notNull()
    .references(() => orderLists.id, { onDelete: 'cascade' }),
  // Insertion order — no drag-reorder in this phase, so this is simply set
  // once at insert time (max existing position + 1) and never rewritten.
  position: integer('position').notNull(),
  // Free text, NOT a foreign key into items — a deliberate product decision
  // (ARCHITECTURE.md §4.16): this is a working checklist, not a priced
  // document, and the owner's spreadsheet never referenced the item master.
  itemName: text('item_name').notNull(),
  qty: numeric('qty', { precision: 14, scale: 4 }).default('1').notNull(),
  uom: text('uom').default('Each').notNull(),
  note: text('note'),
  additionalNote: text('additional_note'),
  paymentStatus: orderListPaymentStatusEnum('payment_status').default('pending').notNull(),
  stockStatus: orderListStockStatusEnum('stock_status').default('unknown').notNull(),
  ...timestamps,
})

export type OrderList = typeof orderLists.$inferSelect
export type NewOrderList = typeof orderLists.$inferInsert
export type OrderListLine = typeof orderListLines.$inferSelect
export type NewOrderListLine = typeof orderListLines.$inferInsert
