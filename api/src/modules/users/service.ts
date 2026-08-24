import { db } from '../../db/client.js'
import * as repo from './repository.js'
import * as audit from '../audit/service.js'
import * as authRepo from '../auth/repository.js'
import * as permissions from '../permissions/service.js'
import { generateToken, sha256 } from '../auth/service.js'
import { sendEmail, inviteEmail } from '../../lib/mailer.js'
import { config } from '../../lib/config.js'
import type { AuditCtx } from '../audit/service.js'
import type { UserCreate, UserPatch, Permission } from '@koosani/shared'
import type { User } from './repository.js'

export type { AuditCtx }

const PAGE_SIZE_DEFAULT = 50
const PAGE_SIZE_MAX = 200
const INVITE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000 // 7 days, matches inviteEmail copy

// Never echo the Drizzle row directly (ARCHITECTURE.md §6) — passwordHash in
// particular must never leave the api, even hashed.
export type SafeUser = Omit<User, 'passwordHash' | 'tokenVersion'>

function toSafeUser(user: User): SafeUser {
  return {
    id: user.id,
    businessId: user.businessId,
    email: user.email,
    name: user.name,
    role: user.role,
    emailVerified: user.emailVerified,
    deletedAt: user.deletedAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    createdBy: user.createdBy,
    updatedBy: user.updatedBy,
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

export async function assertExists(businessId: string, id: string): Promise<User> {
  const user = await repo.getUserById(businessId, id)
  if (!user) throw new NotFoundError(`User ${id} not found`)
  return user
}

export async function list(
  businessId: string,
  params: {
    q: string | undefined
    role: 'admin' | 'manager' | 'staff' | undefined
    page: number | undefined
    pageSize: number | undefined
  },
): Promise<{ items: SafeUser[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, params.pageSize ?? PAGE_SIZE_DEFAULT))
  const { rows, total } = await repo.listUsers(businessId, {
    q: params.q,
    role: params.role,
    page,
    pageSize,
  })
  return { items: rows.map(toSafeUser), total, page, pageSize }
}

export async function getById(
  businessId: string,
  id: string,
): Promise<SafeUser & { permissions: Permission[] }> {
  const user = await assertExists(businessId, id)
  const perms = await permissions.listForUser(id)
  return { ...toSafeUser(user), permissions: perms }
}

// ─── create (invite) ──────────────────────────────────────────────────────────
// Creates the user with no password (matches the accept-invite flow in
// auth/service.ts) and emails a 7-day invite token. Global email uniqueness
// is enforced by users.email's unique index (db/schema/users.ts).

export async function create(
  businessId: string,
  data: UserCreate,
  ctx: AuditCtx,
): Promise<SafeUser> {
  if (await repo.emailExists(data.email)) {
    throw new ValidationError(`A user with email ${data.email} already exists`)
  }

  const inviter = await assertExists(businessId, ctx.userId).catch(() => null)

  const user = await db.transaction(async (tx) => {
    const row = await repo.insertUser(
      {
        businessId,
        email: data.email,
        name: data.name,
        role: data.role,
        passwordHash: null,
        emailVerified: false,
        tokenVersion: 0,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      },
      tx,
    )

    if (data.permissions && data.permissions.length > 0) {
      await permissions.replaceForUser(businessId, row.id, data.permissions, ctx.userId, tx)
    }

    await audit.record(
      'user.invited',
      'user',
      row.id,
      null,
      { email: data.email, name: data.name, role: data.role },
      ctx,
      tx,
    )

    return row
  })

  const token = generateToken()
  const tokenHash = sha256(token)
  await authRepo.createAuthToken({
    userId: user.id,
    businessId,
    type: 'invite',
    tokenHash,
    expiresAt: new Date(Date.now() + INVITE_EXPIRY_MS),
  })

  const link = `${config.FRONTEND_URL}/accept-invite?token=${token}`
  await sendEmail(inviteEmail({ to: user.email, link, inviterName: inviter?.name ?? 'An admin' }))

  return toSafeUser(user)
}

// ─── update ───────────────────────────────────────────────────────────────────
// Role/name changes and a full-replace of permission grants (UPGRADE.md
// Phase 21). Changing a user's own role/permissions is allowed by the route
// gate (admin-only) — no extra restriction here.

export async function update(
  businessId: string,
  id: string,
  data: UserPatch,
  ctx: AuditCtx,
): Promise<SafeUser & { permissions: Permission[] }> {
  return db.transaction(async (tx) => {
    const before = await assertExists(businessId, id)

    const patch: Record<string, unknown> = { updatedBy: ctx.userId }
    if (data.name !== undefined) patch['name'] = data.name
    if (data.role !== undefined) patch['role'] = data.role

    const after = await repo.updateUser(businessId, id, patch, tx)

    // Role changes must revoke every live JWT for this user — requireAuth
    // trusts the JWT's role claim, so a demoted admin would otherwise keep
    // admin access for up to 8h (SECURITY.md §JWT, §13.2). Bumping
    // token_version fails the live comparison for every existing token,
    // forcing re-login with the new role. Session-cache invalidation is the
    // route's job (matches the existing logout/logout-all/change-password
    // pattern — routes call invalidateSessionCache, not services, to avoid
    // importing the requireAuth middleware from here).
    if (data.role !== undefined && data.role !== before.role) {
      await authRepo.incrementTokenVersion(id, tx)
    }

    if (data.permissions !== undefined) {
      await permissions.replaceForUser(businessId, id, data.permissions, ctx.userId, tx)
    }

    await audit.record(
      'user.permissions_change',
      'user',
      id,
      before as Record<string, unknown>,
      { ...after, permissions: data.permissions } as Record<string, unknown>,
      ctx,
      tx,
    )

    const perms = await permissions.listForUser(id, tx)
    return { ...toSafeUser(after), permissions: perms }
  })
}

// ─── softDelete ───────────────────────────────────────────────────────────────
// Soft delete + revoke all sessions (FUNCTIONS.md §users).

export async function softDelete(businessId: string, id: string, ctx: AuditCtx): Promise<void> {
  if (id === ctx.userId) {
    throw new ValidationError('Cannot delete your own account')
  }
  const user = await assertExists(businessId, id)

  await db.transaction(async (tx) => {
    await repo.softDeleteUser(businessId, id, ctx.userId, tx)
    // Bump token_version for full parity with the session deactivation below —
    // without this, a deleted user's still-cached JWT stays accepted for up to
    // the 30s session-cache window (SECURITY.md §13.2) instead of dying
    // immediately once the cache is cleared by the route.
    await authRepo.incrementTokenVersion(id, tx)
    await audit.record('user.deleted', 'user', id, user as Record<string, unknown>, null, ctx, tx)
  })

  await authRepo.deactivateAllUserSessions(id)
}
