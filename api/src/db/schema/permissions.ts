import { pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { businesses } from './businesses'
import { users } from './users'
import { permissionResourceEnum, permissionActionEnum } from './enums'

// Explicit per-user permission grants (SECURITY.md §Authorization Model).
// Admins bypass this table entirely; managers get elevated defaults in the
// authorize middleware. Only staff-level grants (and reports.export, which
// requires an explicit grant regardless of role) are ever read from here.
export const userPermissions = pgTable(
  'user_permissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    resource: permissionResourceEnum('resource').notNull(),
    action: permissionActionEnum('action').notNull(),
    grantedBy: uuid('granted_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('user_permissions_unique').on(table.userId, table.resource, table.action),
  ],
)

export type UserPermission = typeof userPermissions.$inferSelect
export type NewUserPermission = typeof userPermissions.$inferInsert
