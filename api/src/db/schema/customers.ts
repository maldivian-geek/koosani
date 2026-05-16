import { boolean, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { timestamps, auditedBy } from './helpers'
import { businesses } from './businesses'

export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  name: text('name').notNull(),
  tin: text('tin'),
  email: text('email'),
  phone: text('phone'),
  address: text('address'),
  creditTermsDays: numeric('credit_terms_days', { precision: 5, scale: 0 }).default('30').notNull(),
  creditLimit: numeric('credit_limit', { precision: 15, scale: 2 }),
  notes: text('notes'),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  ...timestamps,
  ...auditedBy,
})

export const customerContacts = pgTable('customer_contacts', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id),
  name: text('name').notNull(),
  email: text('email'),
  phone: text('phone'),
  role: text('role'),
  isPrimary: boolean('is_primary').default(false).notNull(),
  ...timestamps,
  ...auditedBy,
})

export type Customer = typeof customers.$inferSelect
export type NewCustomer = typeof customers.$inferInsert
