import { and, eq, lt, gte, count, sql, desc } from 'drizzle-orm'
import { db } from '../../db/client.js'
import {
  users,
  userSessions,
  authLogs,
  authTokens,
  loginAttempts,
  type User,
  type UserSession,
} from '../../db/schema/index.js'
import type { Db, DbTx } from '../../db/client.js'

// ─── User lookups ────────────────────────────────────────────────────────────

export async function findUserByEmail(
  email: string,
  businessId?: string,
): Promise<User | undefined> {
  const conditions = [eq(users.email, email), sql`${users.deletedAt} IS NULL`]
  if (businessId) conditions.push(eq(users.businessId, businessId))
  const rows = await db
    .select()
    .from(users)
    .where(and(...conditions))
    .limit(1)
  return rows[0]
}

export async function findUserById(id: string): Promise<User | undefined> {
  const rows = await db
    .select()
    .from(users)
    .where(and(eq(users.id, id), sql`${users.deletedAt} IS NULL`))
    .limit(1)
  return rows[0]
}

export async function updatePasswordHash(
  userId: string,
  passwordHash: string,
  tx: Db = db,
): Promise<void> {
  await tx.update(users).set({ passwordHash, updatedBy: userId }).where(eq(users.id, userId))
}

// tx accepts either the plain db client or an open transaction — unlike this
// file's other tx-taking functions (which only ever run inside their own
// module's flow, always with the default db), this one is now also called
// from other modules' existing transactions (users.update/softDelete,
// SECURITY.md §JWT) and must be able to join them rather than opening a
// second, separate one.
export async function incrementTokenVersion(userId: string, tx: Db | DbTx = db): Promise<number> {
  const rows = await tx
    .update(users)
    .set({
      tokenVersion: sql`${users.tokenVersion} + 1`,
      updatedBy: userId,
    })
    .where(eq(users.id, userId))
    .returning({ tokenVersion: users.tokenVersion })
  const row = rows[0]
  if (!row) throw new Error(`User ${userId} not found`)
  return row.tokenVersion
}

export async function activateAccount(
  userId: string,
  passwordHash: string,
  tx: Db = db,
): Promise<void> {
  await tx
    .update(users)
    .set({ passwordHash, emailVerified: true, updatedBy: userId })
    .where(eq(users.id, userId))
}

// ─── Sessions ────────────────────────────────────────────────────────────────

type NewSession = {
  userId: string
  ip: string
  browser: string | null
  os: string | null
  city: string | null
  country: string | null
}

export async function createSession(data: NewSession): Promise<UserSession> {
  // Enforce session cap: evict oldest if user already has 10 active sessions
  const [countRow] = await db
    .select({ n: count() })
    .from(userSessions)
    .where(and(eq(userSessions.userId, data.userId), eq(userSessions.isActive, true)))

  if ((countRow?.n ?? 0) >= 10) {
    const oldest = await db
      .select({ id: userSessions.id })
      .from(userSessions)
      .where(and(eq(userSessions.userId, data.userId), eq(userSessions.isActive, true)))
      .orderBy(userSessions.lastUsedAt)
      .limit(1)
    const oldestId = oldest[0]?.id
    if (oldestId) {
      await db.update(userSessions).set({ isActive: false }).where(eq(userSessions.id, oldestId))
    }
  }

  const [session] = await db.insert(userSessions).values(data).returning()
  if (!session) throw new Error('Failed to create session')
  return session
}

export async function getSession(sid: string): Promise<UserSession | undefined> {
  const rows = await db.select().from(userSessions).where(eq(userSessions.id, sid)).limit(1)
  return rows[0]
}

// Session joined with the user's live token_version — the only source of truth
// for stale-token rejection (requireAuth compares this against the JWT claim).
export type SessionWithTokenVersion = {
  userId: string
  isActive: boolean
  tokenVersion: number
}

export async function getSessionWithTokenVersion(
  sid: string,
): Promise<SessionWithTokenVersion | undefined> {
  const rows = await db
    .select({
      userId: userSessions.userId,
      isActive: userSessions.isActive,
      tokenVersion: users.tokenVersion,
    })
    .from(userSessions)
    .innerJoin(users, eq(users.id, userSessions.userId))
    .where(eq(userSessions.id, sid))
    .limit(1)
  return rows[0]
}

export async function deactivateSession(sid: string): Promise<void> {
  await db.update(userSessions).set({ isActive: false }).where(eq(userSessions.id, sid))
}

export async function deactivateAllUserSessions(userId: string): Promise<void> {
  await db
    .update(userSessions)
    .set({ isActive: false })
    .where(and(eq(userSessions.userId, userId), eq(userSessions.isActive, true)))
}

export async function deactivateOtherSessions(userId: string, currentSid: string): Promise<void> {
  await db
    .update(userSessions)
    .set({ isActive: false })
    .where(
      and(
        eq(userSessions.userId, userId),
        eq(userSessions.isActive, true),
        sql`${userSessions.id} != ${currentSid}`,
      ),
    )
}

// touchSession throttle: skip DB UPDATE if touched within 60s (SECURITY.md §Session Management)
const touchThrottle = new Map<string, number>()
const TOUCH_THROTTLE_MAX = 10_000
const TOUCH_TTL_MS = 60_000

export function touchSession(sid: string): void {
  const now = Date.now()
  const last = touchThrottle.get(sid)
  if (last !== undefined && now - last < TOUCH_TTL_MS) return

  // Evict oldest entry when cap is reached
  if (touchThrottle.size >= TOUCH_THROTTLE_MAX) {
    const oldestKey = touchThrottle.keys().next().value
    if (oldestKey !== undefined) touchThrottle.delete(oldestKey)
  }

  touchThrottle.set(sid, now)

  // Fire-and-forget — do not await
  db.update(userSessions)
    .set({ lastUsedAt: new Date() })
    .where(eq(userSessions.id, sid))
    .catch((err: unknown) => console.error({ err }, 'touchSession failed'))
}

export function evictTouchThrottle(sid: string): void {
  touchThrottle.delete(sid)
}

// ─── Admin activity log ────────────────────────────────────────────────────────
// GET /admin/activity (SECURITY.md §Auth Event Logging) — joins auth_logs with
// users so the admin view can show who did what, not just a user_id.

export type ActivityRow = {
  id: string
  event: (typeof authLogs.$inferSelect)['event']
  ip: string
  userAgent: string | null
  createdAt: Date
  userId: string | null
  userName: string | null
  userEmail: string | null
}

export type ListActivityParams = {
  event: (typeof authLogs.$inferSelect)['event'] | undefined
  userId: string | undefined
  page: number
  pageSize: number
}

export async function listActivity(
  businessId: string,
  { event, userId, page, pageSize }: ListActivityParams,
): Promise<{ rows: ActivityRow[]; total: number }> {
  const where = and(
    eq(authLogs.businessId, businessId),
    event ? eq(authLogs.event, event) : undefined,
    userId ? eq(authLogs.userId, userId) : undefined,
  )

  const [totalRow, rows] = await Promise.all([
    db.select({ n: count() }).from(authLogs).where(where),
    db
      .select({
        id: authLogs.id,
        event: authLogs.event,
        ip: authLogs.ip,
        userAgent: authLogs.userAgent,
        createdAt: authLogs.createdAt,
        userId: users.id,
        userName: users.name,
        userEmail: users.email,
      })
      .from(authLogs)
      .leftJoin(users, eq(users.id, authLogs.userId))
      .where(where)
      .orderBy(desc(authLogs.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
  ])

  return { rows, total: totalRow[0]?.n ?? 0 }
}

export async function getActiveSessions(userId: string): Promise<UserSession[]> {
  return db
    .select()
    .from(userSessions)
    .where(and(eq(userSessions.userId, userId), eq(userSessions.isActive, true)))
    .orderBy(desc(userSessions.lastUsedAt))
}

// ─── Auth logs ───────────────────────────────────────────────────────────────

type AuthLogData = {
  businessId: string | null
  userId: string | null
  event: (typeof authLogs.$inferInsert)['event']
  ip: string
  userAgent: string | null
}

export async function recordAuthLog(data: AuthLogData, tx: Db = db): Promise<void> {
  await tx.insert(authLogs).values(data)
}

// ─── Login attempts (lockout) ─────────────────────────────────────────────────

export async function recordLoginAttempt(
  source: string,
  emailHash: string,
  ip: string,
): Promise<void> {
  await db.insert(loginAttempts).values({ source, emailHash, ip })
}

export async function countRecentAttempts(
  field: 'source' | 'emailHash',
  value: string,
  windowMs: number,
): Promise<number> {
  const since = new Date(Date.now() - windowMs)
  const column = field === 'source' ? loginAttempts.source : loginAttempts.emailHash
  const [row] = await db
    .select({ n: count() })
    .from(loginAttempts)
    .where(and(eq(column, value), gte(loginAttempts.attemptedAt, since)))
  return row?.n ?? 0
}

// ~1% probabilistic cleanup to keep the table small (SECURITY.md §Password Authentication)
export function maybePurgeStaleAttempts(): void {
  if (Math.random() > 0.01) return
  const cutoff = new Date(Date.now() - 60 * 60 * 1000) // 1 hour
  db.delete(loginAttempts)
    .where(lt(loginAttempts.attemptedAt, cutoff))
    .catch((err: unknown) => console.error({ err }, 'purgeStaleAttempts failed'))
}

// ─── Auth tokens ──────────────────────────────────────────────────────────────

type NewAuthToken = {
  userId: string
  businessId: string
  type: (typeof authTokens.$inferInsert)['type']
  tokenHash: string
  expiresAt: Date
}

export async function createAuthToken(data: NewAuthToken): Promise<void> {
  await db.insert(authTokens).values(data)
}

// Atomic single-use: DELETE + RETURNING prevents double-consume
export async function consumeAuthToken(
  tokenHash: string,
  type: (typeof authTokens.$inferInsert)['type'],
): Promise<typeof authTokens.$inferSelect | undefined> {
  const rows = await db
    .delete(authTokens)
    .where(
      and(
        eq(authTokens.tokenHash, tokenHash),
        eq(authTokens.type, type),
        sql`${authTokens.expiresAt} > now()`,
      ),
    )
    .returning()
  return rows[0]
}

// Check if a recent reset token exists (within cooldown window)
export async function hasRecentResetToken(userId: string, cooldownMs: number): Promise<boolean> {
  const since = new Date(Date.now() - cooldownMs)
  const [row] = await db
    .select({ n: count() })
    .from(authTokens)
    .where(
      and(
        eq(authTokens.userId, userId),
        eq(authTokens.type, 'password_reset'),
        gte(authTokens.createdAt, since),
      ),
    )
  return (row?.n ?? 0) > 0
}
