import { numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { timestamps, auditedBy } from './helpers.js'
import { gstCategoryEnum } from './enums.js'
import { businesses } from './businesses.js'

export const itemCategories = pgTable('item_categories', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  name: text('name').notNull(),
  parentId: uuid('parent_id'),
  ...timestamps,
  ...auditedBy,
})

export const items = pgTable(
  'items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    sku: text('sku').notNull(),
    name: text('name').notNull(),
    unit: text('unit').notNull(),
    categoryId: uuid('category_id').references(() => itemCategories.id),
    gstCategory: gstCategoryEnum('gst_category').notNull(),
    defaultPrice: numeric('default_price', { precision: 15, scale: 2 }),
    defaultCost: numeric('default_cost', { precision: 15, scale: 2 }),
    // trigger-maintained: SUM of stock_movements.qty (ARCHITECTURE.md Â§4.3)
    stockOnHand: numeric('stock_on_hand', { precision: 15, scale: 4 }).default('0').notNull(),
    reorderPoint: numeric('reorder_point', { precision: 15, scale: 4 }),
    notes: text('notes'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
    ...auditedBy,
  },
  (table) => [uniqueIndex('items_business_sku_unique').on(table.businessId, table.sku)],
)

export type Item = typeof items.$inferSelect
export type NewItem = typeof items.$inferInsert
