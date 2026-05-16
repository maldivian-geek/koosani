import { jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { businesses } from './businesses'
import { users } from './users'

// Append-only. REVOKE UPDATE, DELETE ON audit_logs FROM koosani_app (enforced in migration).
// Written by audit.record() only â€” never directly (ARCHITECTURE.md Â§3, SECURITY.md Â§13.3).
export const auditLogs = pgTable('audit_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  userId: uuid('user_id').references(() => users.id),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: uuid('entity_id').notNull(),
  beforeJson: jsonb('before_json'),
  afterJson: jsonb('after_json'),
  ip: text('ip').notNull(),
  userAgent: text('user_agent'),
  at: timestamp('at', { withTimezone: true }).defaultNow().notNull(),
})

export type AuditLog = typeof auditLogs.$inferSelect
export type NewAuditLog = typeof auditLogs.$inferInsert
