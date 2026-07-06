import { and, eq } from 'drizzle-orm'
import { db } from '../../db/client.js'
import type { DbTx } from '../../db/client.js'
import { userPermissions } from '../../db/schema/index.js'
import type { PermissionResource, PermissionAction, Permission } from '@koosani/shared'

export async function hasExplicitGrant(
  userId: string,
  resource: PermissionResource,
  action: PermissionAction,
): Promise<boolean> {
  const rows = await db
    .select({ id: userPermissions.id })
    .from(userPermissions)
    .where(
      and(
        eq(userPermissions.userId, userId),
        eq(userPermissions.resource, resource),
        eq(userPermissions.action, action),
      ),
    )
    .limit(1)
  return rows.length > 0
}

// Pass `tx` when reading back inside the same transaction that just wrote
// (e.g. users.update's response payload) — a separate `db` connection won't
// see uncommitted changes yet (read-committed isolation).
export async function listForUser(userId: string, tx?: DbTx): Promise<Permission[]> {
  const q = tx ?? db
  return q
    .select({ resource: userPermissions.resource, action: userPermissions.action })
    .from(userPermissions)
    .where(eq(userPermissions.userId, userId))
}

// Full-replace: clears every existing grant for this user, then inserts the
// new set. Matches the "one form, one schema, full replace" pattern used for
// draft invoice/bill/PO lines elsewhere in the codebase.
export async function replaceForUser(
  businessId: string,
  userId: string,
  permissions: Permission[],
  grantedBy: string,
  tx: DbTx,
): Promise<void> {
  await tx.delete(userPermissions).where(eq(userPermissions.userId, userId))
  if (permissions.length === 0) return
  await tx.insert(userPermissions).values(
    permissions.map((p) => ({
      businessId,
      userId,
      resource: p.resource,
      action: p.action,
      grantedBy,
    })),
  )
}
