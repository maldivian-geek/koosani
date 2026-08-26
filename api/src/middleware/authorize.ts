import type { MiddlewareHandler } from 'hono'
import { hasExplicitGrant, hasAnyGrantOnResource } from '../modules/permissions/repository.js'
import type { AppEnv } from '../types.js'
import type { PermissionResource, PermissionAction, Role } from '@koosani/shared'

// Note: `authorize` is shared request-pipeline infrastructure (like
// `requireAuth`), not a peer module, so it reads the `permissions` module's
// repository directly for this single boolean check rather than adding a
// service-layer indirection for a one-line query.

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

// Role-based default policy, checked in this order (Phase 37 — staff view
// gating, SECURITY.md §Authorization Model):
//  - admin bypasses every check
//  - 'export' (bulk report CSV) requires an explicit grant even for managers
//    (SECURITY.md §13.6 — "role admin or explicit reports.export permission")
//  - 'view': manager gets it by default; staff needs ANY grant on the
//    resource — an explicit `view` row, or an add/edit/delete grant, which
//    implies view (a user_permissions row is a row regardless of which
//    action it names, so one exists-check covers both cases)
//  - manager gets add/edit/delete by default ("elevated access")
//  - staff needs an explicit per-user grant for anything beyond view
export async function hasPermission(
  role: Role,
  userId: string,
  resource: PermissionResource,
  action: PermissionAction,
): Promise<boolean> {
  if (role === 'admin') return true
  if (action === 'export') return hasExplicitGrant(userId, resource, action)
  if (action === 'view') {
    if (role === 'manager') return true
    return hasAnyGrantOnResource(userId, resource)
  }
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
