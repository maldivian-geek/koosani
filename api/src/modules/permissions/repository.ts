import { and, eq } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { userPermissions } from '../../db/schema/index.js'
import type { PermissionResource, PermissionAction } from '@koosani/shared'

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
