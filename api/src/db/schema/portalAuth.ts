import { boolean, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { businesses } from './businesses'
import { customers } from './customers'

// Customer portal auth (Phase 28, UPGRADE.md G-8) — see SECURITY.md §13.14.
// Deliberately separate from `auth_tokens`/`user_sessions`: portal identities
// are customers, not users, and share no table, no JWT secret, and no cookie
// with staff auth. Magic-link only — there is no password to store.

export const portalAuthTokens = pgTable('portal_auth_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export const portalSessions = pgTable('portal_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  customerId: uuid('customer_id')
    .notNull()
    .references(() => customers.id),
  browser: text('browser'),
  os: text('os'),
  ip: text('ip').notNull(),
  city: text('city'),
  country: text('country'),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }).defaultNow().notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

export type PortalAuthToken = typeof portalAuthTokens.$inferSelect
export type NewPortalAuthToken = typeof portalAuthTokens.$inferInsert
export type PortalSession = typeof portalSessions.$inferSelect
export type NewPortalSession = typeof portalSessions.$inferInsert
