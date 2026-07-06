import { integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { emailKindEnum, emailStatusEnum } from './enums'
import { businesses } from './businesses'

// Append-only outbound email log — audit-adjacent, not the audit_logs table
// itself, since these record deliveries, not mutations (Phase 24, UPGRADE.md).
export const emailLogs = pgTable('email_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  kind: emailKindEnum('kind').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  toEmail: text('to_email').notNull(),
  subject: text('subject').notNull(),
  status: emailStatusEnum('status').notNull(),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

// One row per (invoice, schedule offset) actually sent — the uniqueness
// constraint is the idempotency guard against the reminders cron firing
// twice for the same offset (e.g. after a restart mid-run).
export const invoiceRemindersSent = pgTable(
  'invoice_reminders_sent',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    invoiceId: uuid('invoice_id').notNull(),
    offsetDays: integer('offset_days').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('invoice_reminders_sent_unique').on(table.invoiceId, table.offsetDays)],
)

export type EmailLog = typeof emailLogs.$inferSelect
export type NewEmailLog = typeof emailLogs.$inferInsert
export type InvoiceReminderSent = typeof invoiceRemindersSent.$inferSelect
