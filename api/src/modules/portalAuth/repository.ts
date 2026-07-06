import { and, eq, gt, isNull, lt, sql } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { portalAuthTokens, portalSessions, customers } from '../../db/schema/index.js'
import type { PortalSession, NewPortalSession, Customer } from '../../db/schema/index.js'

export type { PortalSession }

// Every (businessId, customerId) pair whose email matches, across ALL
// businesses — a portal magic-link request isn't scoped to one business
// (SECURITY.md §13.14). Case-insensitive EXACT match — not ILIKE, since an
// email containing a literal % or _ would otherwise be treated as a wildcard
// pattern. Excludes soft-deleted customers.
export async function findActiveCustomersByEmail(email: string): Promise<Customer[]> {
  return db
    .select()
    .from(customers)
    .where(
      and(eq(sql`lower(${customers.email})`, email.toLowerCase()), isNull(customers.deletedAt)),
    )
}

export async function createToken(data: {
  businessId: string
  customerId: string
  tokenHash: string
  expiresAt: Date
}): Promise<void> {
  await db.insert(portalAuthTokens).values(data)
}

// Atomic single-use consume, same pattern as staff auth_tokens (SECURITY.md
// §Magic Link Auth) — the row is physically deleted, so no double-consume race.
export async function consumeToken(
  tokenHash: string,
): Promise<{ businessId: string; customerId: string } | null> {
  const [row] = await db
    .delete(portalAuthTokens)
    .where(
      and(eq(portalAuthTokens.tokenHash, tokenHash), gt(portalAuthTokens.expiresAt, new Date())),
    )
    .returning({ businessId: portalAuthTokens.businessId, customerId: portalAuthTokens.customerId })
  return row ?? null
}

export async function deleteExpiredTokens(): Promise<void> {
  await db.delete(portalAuthTokens).where(lt(portalAuthTokens.expiresAt, new Date()))
}

export async function createSession(
  data: Omit<NewPortalSession, 'id' | 'createdAt' | 'updatedAt' | 'lastUsedAt' | 'isActive'>,
): Promise<PortalSession> {
  const [row] = await db.insert(portalSessions).values(data).returning()
  if (!row) throw new Error('createSession: no row returned')
  return row
}

export async function getSession(id: string): Promise<PortalSession | null> {
  const [row] = await db.select().from(portalSessions).where(eq(portalSessions.id, id))
  return row ?? null
}

export async function deactivateSession(id: string): Promise<void> {
  await db.update(portalSessions).set({ isActive: false }).where(eq(portalSessions.id, id))
}

// Throttled touch, mirrors auth/repository.ts's touchSession — avoids an
// UPDATE on every single portal request.
const touchThrottle = new Map<string, number>()
const TOUCH_THROTTLE_MS = 60_000

export function touchSession(id: string): void {
  const last = touchThrottle.get(id)
  const now = Date.now()
  if (last && now - last < TOUCH_THROTTLE_MS) return
  touchThrottle.set(id, now)
  void db
    .update(portalSessions)
    .set({ lastUsedAt: sql`now()` })
    .where(eq(portalSessions.id, id))
    .catch(() => {})
}
