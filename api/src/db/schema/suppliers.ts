import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { timestamps, auditedBy } from './helpers'
import { businesses } from './businesses'

export const suppliers = pgTable('suppliers', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  name: text('name').notNull(),
  tin: text('tin'),
  email: text('email'),
  phone: text('phone'),
  address: text('address'),
  paymentTermsDays: text('payment_terms_days').default('30').notNull(),
  notes: text('notes'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  ...timestamps,
  ...auditedBy,
})

export const supplierContacts = pgTable('supplier_contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  supplierId: uuid('supplier_id')
    .notNull()
    .references(() => suppliers.id),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  role: text('role'),
  isPrimary: boolean('is_primary').default(false).notNull(),
  ...timestamps,
  ...auditedBy,
})

export type Supplier = typeof suppliers.$inferSelect
export type NewSupplier = typeof suppliers.$inferInsert
