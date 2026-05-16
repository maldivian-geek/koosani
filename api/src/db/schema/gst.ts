import {
  date,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'
import { timestamps, auditedBy } from './helpers'
import { gstCategoryEnum, gstPeriodTypeEnum, gstPeriodStatusEnum } from './enums'
import { businesses } from './businesses'
import { users } from './users'

export const gstRates = pgTable('gst_rates', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  category: gstCategoryEnum('category').notNull(),
  // stored as decimal, e.g. 0.0800 for 8% (ARCHITECTURE.md Â§4.1)
  rate: numeric('rate', { precision: 6, scale: 4 }).notNull(),
  validFrom: date('valid_from').notNull(),
  // null = currently active
  validTo: date('valid_to'),
  ...timestamps,
  ...auditedBy,
})

export const gstPeriods = pgTable(
  'gst_periods',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    periodType: gstPeriodTypeEnum('period_type').notNull(),
    status: gstPeriodStatusEnum('status').default('open').notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: uuid('locked_by').references(() => users.id),
    miraReturnRef: text('mira_return_ref'),
    ...timestamps,
    ...auditedBy,
  },
  (table) => [
    uniqueIndex('gst_periods_business_range_unique').on(
      table.businessId,
      table.periodStart,
      table.periodEnd,
    ),
  ],
)

// Append-only: once built, previous snapshot stays for audit (SECURITY.md Â§13.4)
export const gstReturns = pgTable('gst_returns', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  periodId: uuid('period_id')
    .notNull()
    .references(() => gstPeriods.id),
  // Snapshot of MIRA 205/206 summary values and Input Tax Statement
  summaryJson: jsonb('summary_json').notNull(),
  // [{ kind: '205' | '206' | 'its', fileId: uuid }]
  files: jsonb('files').notNull().$type<Array<{ kind: string; fileId: string }>>(),
  builtAt: timestamp('built_at', { withTimezone: true }).defaultNow().notNull(),
  builtBy: uuid('built_by')
    .notNull()
    .references(() => users.id),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  createdBy: uuid('created_by').notNull(),
})

export type GstRate = typeof gstRates.$inferSelect
export type GstPeriod = typeof gstPeriods.$inferSelect
export type GstReturn = typeof gstReturns.$inferSelect
