import { and, count, eq, ilike, isNull, or, sql } from 'drizzle-orm'
import { db } from '../../db/client.js'
import type { DbTx } from '../../db/client.js'
import { users } from '../../db/schema/index.js'
import type { User, NewUser } from '../../db/schema/index.js'

export type { User }

export type ListUsersParams = {
  q: string | undefined
  role: 'admin' | 'manager' | 'staff' | undefined
  page: number
  pageSize: number
}

export async function listUsers(
  businessId: string,
  { q, role, page, pageSize }: ListUsersParams,
): Promise<{ rows: User[]; total: number }> {
  const where = and(
    eq(users.businessId, businessId),
    isNull(users.deletedAt),
    role ? eq(users.role, role) : undefined,
    q ? or(ilike(users.name, `%${q}%`), ilike(users.email, `%${q}%`)) : undefined,
  )

  const [totalRow, rows] = await Promise.all([
    db.select({ total: count() }).from(users).where(where),
    db
      .select()
      .from(users)
      .where(where)
      .orderBy(users.name)
      .limit(pageSize)
      .offset((page - 1) * pageSize),
  ])

  return { rows, total: totalRow[0]?.total ?? 0 }
}

export async function getUserById(businessId: string, id: string): Promise<User | null> {
  const [row] = await db
    .select()
    .from(users)
    .where(and(eq(users.businessId, businessId), eq(users.id, id), isNull(users.deletedAt)))
  return row ?? null
}

export async function insertUser(data: NewUser, tx: DbTx): Promise<User> {
  const [row] = await tx.insert(users).values(data).returning()
  if (!row) throw new Error('insertUser: no row returned')
  return row
}

export async function updateUser(
  businessId: string,
  id: string,
  patch: Record<string, unknown>,
  tx: DbTx,
): Promise<User> {
  const [row] = await tx
    .update(users)
    .set(patch)
    .where(and(eq(users.businessId, businessId), eq(users.id, id)))
    .returning()
  if (!row) throw new Error(`updateUser: no row for ${id}`)
  return row
}

export async function softDeleteUser(
  businessId: string,
  id: string,
  updatedBy: string,
  tx: DbTx,
): Promise<void> {
  await tx
    .update(users)
    .set({ deletedAt: new Date(), updatedBy })
    .where(and(eq(users.businessId, businessId), eq(users.id, id)))
}

// Global uniqueness check — users.email has no per-business unique index,
// it's unique across the whole table (db/schema/users.ts).
export async function emailExists(email: string): Promise<boolean> {
  const [row] = await db
    .select({ n: count() })
    .from(users)
    .where(sql`lower(${users.email}) = lower(${email})`)
  return (row?.n ?? 0) > 0
}
