import {
  boolean,
  date,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'
import { timestamps, auditedBy } from './helpers.js'
import { gstCategoryEnum, recurrenceFrequencyEnum } from './enums.js'
import { businesses } from './businesses.js'
import { customers } from './customers.js'
import { items } from './items.js'

// Recurring invoice profiles (Phase 26, UPGRADE.md G-6). The daily cron
// (worker/reminders.ts) generates a draft (or auto-issues, per autoIssue) each
// time nextRunDate <= today, then advances nextRunDate by one frequency
// cycle — always dated today, so GST period locks are respected by
// construction (ARCHITECTURE.md §4.4) rather than needing a special-case
// check. No late-fee modeling here — see enums.ts's comment.
export const recurrenceProfiles = pgTable('recurrence_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id),
  name: text('name').notNull(),
  frequency: recurrenceFrequencyEnum('frequency').notNull(),
  startDate: date('start_date').notNull(),
  endDate: date('end_date'),
  nextRunDate: date('next_run_date').notNull(),
  active: boolean('active').default(true).notNull(),
  // false (default): generates a draft for staff to review before issuing.
  // true: the generated invoice is issued immediately (stock committed,
  // number allocated) with no human in the loop.
  autoIssue: boolean('auto_issue').default(false).notNull(),
  // Falls back to businesses.defaultCreditTermsDays when null.
  dueDaysAfterIssue: integer('due_days_after_issue'),
  notes: text('notes'),
  lastGeneratedAt: timestamp('last_generated_at', { withTimezone: true }),
  ...timestamps,
  ...auditedBy,
})

export const recurrenceProfileLines = pgTable('recurrence_profile_lines', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  profileId: uuid('profile_id')
    .notNull()
    .references(() => recurrenceProfiles.id),
  itemId: uuid('item_id').references(() => items.id),
  description: text('description').notNull(),
  qty: numeric('qty', { precision: 15, scale: 4 }).notNull(),
  unitPrice: numeric('unit_price', { precision: 15, scale: 2 }).notNull(),
  gstCategory: gstCategoryEnum('gst_category').notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  ...timestamps,
  ...auditedBy,
})

export type RecurrenceProfile = typeof recurrenceProfiles.$inferSelect
export type NewRecurrenceProfile = typeof recurrenceProfiles.$inferInsert
export type RecurrenceProfileLine = typeof recurrenceProfileLines.$inferSelect
