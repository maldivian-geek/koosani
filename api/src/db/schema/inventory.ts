import { numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { movementSourceEnum } from './enums'
import { businesses } from './businesses'
import { items } from './items'

// Append-only. REVOKE UPDATE, DELETE ON stock_movements FROM koosani_app (enforced in migration).
export const stockMovements = pgTable('stock_movements', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  itemId: uuid('item_id')
    .notNull()
    .references(() => items.id),
  qty: numeric('qty', { precision: 15, scale: 4 }).notNull(),
  source: movementSourceEnum('source').notNull(),
  sourceId: uuid('source_id'),
  reason: text('reason'),
  movedAt: timestamp('moved_at', { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  createdBy: uuid('created_by').notNull(),
})

export type StockMovement = typeof stockMovements.$inferSelect
export type NewStockMovement = typeof stockMovements.$inferInsert
