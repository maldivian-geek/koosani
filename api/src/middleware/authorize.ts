import type { MiddlewareHandler } from 'hono'
import { hasExplicitGrant } from '../modules/permissions/repository.js'
import type { AppEnv } from '../types.js'
import type { PermissionResource, PermissionAction, Role } from '@koosani/shared'

// Role hierarchy: admin > manager > staff (SECURITY.md §Authorization Model).
const ROLE_RANK: Record<Role, number> = { staff: 0, manager: 1, admin: 2 }

// Hard role gate — used for admin-only actions (GST rate changes, period unlock,
// user management) where no permission grant can loosen the requirement.
export function requireRole(minRole: Role): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const role = c.get('role')
    if (ROLE_RANK[role] < ROLE_RANK[minRole]) {
      return c.json({ error: 'forbidden' }, 403)
    }
    await next()
  }
}

// Role-based default policy, checked in this order:
//  - admin bypasses every check
//  - 'view' is always allowed for any authenticated role (DESIGN.md §7 — the
//    DataTable itself is never hidden; a permission-restricted empty state is
//    the only UI-level gate, and no route currently implements one)
//  - 'export' (bulk report CSV) requires an explicit grant even for managers
//    (SECURITY.md §13.6 — "role admin or explicit reports.export permission")
//  - manager gets add/edit/delete by default ("elevated access")
//  - staff needs an explicit per-user grant for anything beyond view
export async function hasPermission(
  role: Role,
  userId: string,
  resource: PermissionResource,
  action: PermissionAction,
): Promise<boolean> {
  if (role === 'admin') return true
  if (action === 'view') return true
  if (action === 'export') return hasExplicitGrant(userId, resource, action)
  if (role === 'manager') return true
  return hasExplicitGrant(userId, resource, action)
}

export function requirePermission(
  resource: PermissionResource,
  action: PermissionAction,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const allowed = await hasPermission(c.get('role'), c.get('userId'), resource, action)
    if (!allowed) return c.json({ error: 'forbidden' }, 403)
    await next()
  }
}
