import { date, numeric, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { timestamps, auditedBy } from './helpers'
import { poStatusEnum } from './enums'
import { businesses } from './businesses'
import { suppliers } from './suppliers'
import { items } from './items'

export const purchaseOrders = pgTable(
  'purchase_orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    supplierId: uuid('supplier_id')
      .notNull()
      .references(() => suppliers.id),
    poNumber: text('po_number'),
    status: poStatusEnum('status').default('draft').notNull(),
    orderDate: date('order_date'),
    expectedDate: date('expected_date'),
    subtotal: numeric('subtotal', { precision: 15, scale: 2 }).default('0').notNull(),
    total: numeric('total', { precision: 15, scale: 2 }).default('0').notNull(),
    notes: text('notes'),
    cancelReason: text('cancel_reason'),
    ...timestamps,
    ...auditedBy,
  },
  (table) => [
    uniqueIndex('po_business_number_unique')
      .on(table.businessId, table.poNumber)
      .where(sql`status != 'draft'`),
  ],
)

export const poLines = pgTable('po_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  poId: uuid('po_id')
    .notNull()
    .references(() => purchaseOrders.id),
  itemId: uuid('item_id').references(() => items.id),
  description: text('description').notNull(),
  qtyOrdered: numeric('qty_ordered', { precision: 15, scale: 4 }).notNull(),
  qtyReceived: numeric('qty_received', { precision: 15, scale: 4 }).default('0').notNull(),
  unitCost: numeric('unit_cost', { precision: 15, scale: 2 }).notNull(),
  lineTotal: numeric('line_total', { precision: 15, scale: 2 }).notNull(),
  sortOrder: numeric('sort_order', { precision: 5, scale: 0 }).default('0').notNull(),
  ...timestamps,
  ...auditedBy,
})

// Append-only once created (SECURITY.md Â§13.4)
export const grns = pgTable('grns', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  poId: uuid('po_id')
    .notNull()
    .references(() => purchaseOrders.id),
  supplierId: uuid('supplier_id')
    .notNull()
    .references(() => suppliers.id),
  receivedAt: date('received_at').notNull(),
  notes: text('notes'),
  ...timestamps,
  ...auditedBy,
})

export const grnLines = pgTable('grn_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  grnId: uuid('grn_id')
    .notNull()
    .references(() => grns.id),
  poLineId: uuid('po_line_id')
    .notNull()
    .references(() => poLines.id),
  itemId: uuid('item_id')
    .notNull()
    .references(() => items.id),
  qtyReceived: numeric('qty_received', { precision: 15, scale: 4 }).notNull(),
  unitCost: numeric('unit_cost', { precision: 15, scale: 2 }).notNull(),
  ...timestamps,
  ...auditedBy,
})

export type PurchaseOrder = typeof purchaseOrders.$inferSelect
export type NewPurchaseOrder = typeof purchaseOrders.$inferInsert
export type Grn = typeof grns.$inferSelect
