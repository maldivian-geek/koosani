import { timestamp, uuid } from 'drizzle-orm/pg-core'

export const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}

export const auditedBy = {
  createdBy: uuid('created_by').notNull(),
  updatedBy: uuid('updated_by').notNull(),
}
