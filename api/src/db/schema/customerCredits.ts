import { numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { creditLedgerKindEnum } from './enums'
import { businesses } from './businesses'
import { customers } from './customers'

// Customer credit ledger (Phase 27, UPGRADE.md G-7) — see ARCHITECTURE.md §4.8.
// Append-only: a customer's available credit balance is SUM(amount) over their
// rows. No FK on referenceId (polymorphic — payment, invoice, or nothing for
// manual advances/refunds), mirroring the files/estimates no-FK pattern.
export const customerCredits = pgTable('customer_credits', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id),
  amount: numeric('amount', { precision: 15, scale: 2 }).notNull(),
  kind: creditLedgerKindEnum('kind').notNull(),
  referenceType: text('reference_type'),
  referenceId: uuid('reference_id'),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  createdBy: uuid('created_by').notNull(),
})

export type CustomerCredit = typeof customerCredits.$inferSelect
export type NewCustomerCredit = typeof customerCredits.$inferInsert
