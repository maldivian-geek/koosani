import { and, count, desc, eq, gte, ilike, isNull, lte, or } from 'drizzle-orm'
import { db } from '../../db/client.js'
import type { DbTx } from '../../db/client.js'
import { recurrenceProfiles, recurrenceProfileLines, customers } from '../../db/schema/index.js'
import type {
  RecurrenceProfile,
  NewRecurrenceProfile,
  RecurrenceProfileLine,
} from '../../db/schema/index.js'

export type { RecurrenceProfile, NewRecurrenceProfile, RecurrenceProfileLine }
export type RecurrenceProfileWithCustomer = RecurrenceProfile & { customerName: string }

export async function getById(
  businessId: string,
  id: string,
  tx?: DbTx,
): Promise<RecurrenceProfile | null> {
  const q = tx ?? db
  const [row] = await q
    .select()
    .from(recurrenceProfiles)
    .where(and(eq(recurrenceProfiles.businessId, businessId), eq(recurrenceProfiles.id, id)))
  return row ?? null
}

// Locks the profile row until the caller's tx commits, so two concurrent
// generation runs for the same profile can't both pass the nextRunDate check
// before either commits (mirrors invoicing's getPaymentByIdForUpdate pattern).
export async function getByIdForUpdate(
  businessId: string,
  id: string,
  tx: DbTx,
): Promise<RecurrenceProfile | null> {
  const [row] = await tx
    .select()
    .from(recurrenceProfiles)
    .where(and(eq(recurrenceProfiles.businessId, businessId), eq(recurrenceProfiles.id, id)))
    .for('update')
  return row ?? null
}

export async function getLinesByProfile(
  businessId: string,
  profileId: string,
  tx?: DbTx,
): Promise<RecurrenceProfileLine[]> {
  const q = tx ?? db
  return q
    .select()
    .from(recurrenceProfileLines)
    .where(
      and(
        eq(recurrenceProfileLines.businessId, businessId),
        eq(recurrenceProfileLines.profileId, profileId),
      ),
    )
    .orderBy(recurrenceProfileLines.sortOrder)
}

export type ListProfileParams = {
  active: boolean | undefined
  customerId: string | undefined
  q: string | undefined
  page: number
  pageSize: number
}

export async function listProfiles(
  businessId: string,
  params: ListProfileParams,
): Promise<{ rows: RecurrenceProfileWithCustomer[]; total: number }> {
  const where = and(
    eq(recurrenceProfiles.businessId, businessId),
    params.active !== undefined ? eq(recurrenceProfiles.active, params.active) : undefined,
    params.customerId ? eq(recurrenceProfiles.customerId, params.customerId) : undefined,
    params.q ? ilike(recurrenceProfiles.name, `%${params.q}%`) : undefined,
  )

  const [totalRow, rows] = await Promise.all([
    db.select({ total: count() }).from(recurrenceProfiles).where(where),
    db
      .select({
        id: recurrenceProfiles.id,
        businessId: recurrenceProfiles.businessId,
        customerId: recurrenceProfiles.customerId,
        customerName: customers.name,
        name: recurrenceProfiles.name,
        frequency: recurrenceProfiles.frequency,
        startDate: recurrenceProfiles.startDate,
        endDate: recurrenceProfiles.endDate,
        nextRunDate: recurrenceProfiles.nextRunDate,
        active: recurrenceProfiles.active,
        autoIssue: recurrenceProfiles.autoIssue,
        dueDaysAfterIssue: recurrenceProfiles.dueDaysAfterIssue,
        notes: recurrenceProfiles.notes,
        lastGeneratedAt: recurrenceProfiles.lastGeneratedAt,
        createdAt: recurrenceProfiles.createdAt,
        updatedAt: recurrenceProfiles.updatedAt,
        createdBy: recurrenceProfiles.createdBy,
        updatedBy: recurrenceProfiles.updatedBy,
      })
      .from(recurrenceProfiles)
      .innerJoin(customers, eq(customers.id, recurrenceProfiles.customerId))
      .where(where)
      .orderBy(desc(recurrenceProfiles.createdAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
  ])

  return { rows, total: totalRow[0]?.total ?? 0 }
}

// Candidates for the daily generation scan (Phase 26, UPGRADE.md G-6): active,
// due (nextRunDate <= today), and not past their end date.
export async function listDueProfiles(
  businessId: string,
  today: string,
): Promise<RecurrenceProfile[]> {
  return db
    .select()
    .from(recurrenceProfiles)
    .where(
      and(
        eq(recurrenceProfiles.businessId, businessId),
        eq(recurrenceProfiles.active, true),
        lte(recurrenceProfiles.nextRunDate, today),
        or(isNull(recurrenceProfiles.endDate), gte(recurrenceProfiles.endDate, today)),
      ),
    )
}

export async function insertProfile(
  data: Omit<NewRecurrenceProfile, 'id' | 'createdAt' | 'updatedAt'>,
  tx: DbTx,
): Promise<RecurrenceProfile> {
  const [row] = await tx.insert(recurrenceProfiles).values(data).returning()
  if (!row) throw new Error('insertProfile: no row returned')
  return row
}

export async function updateProfile(
  businessId: string,
  id: string,
  data: Partial<Omit<NewRecurrenceProfile, 'id' | 'businessId' | 'createdAt' | 'createdBy'>>,
  tx: DbTx,
): Promise<RecurrenceProfile> {
  const [row] = await tx
    .update(recurrenceProfiles)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(recurrenceProfiles.businessId, businessId), eq(recurrenceProfiles.id, id)))
    .returning()
  if (!row) throw new Error('updateProfile: no row returned')
  return row
}

type NewLine = {
  businessId: string
  profileId: string
  itemId?: string | null
  description: string
  qty: string
  unitPrice: string
  gstCategory: RecurrenceProfileLine['gstCategory']
  sortOrder?: number
  createdBy: string
}

export async function insertLines(lines: NewLine[], tx: DbTx): Promise<RecurrenceProfileLine[]> {
  if (lines.length === 0) return []
  return tx
    .insert(recurrenceProfileLines)
    .values(lines.map((l) => ({ ...l, updatedBy: l.createdBy })))
    .returning()
}

export async function deleteLinesByProfile(
  businessId: string,
  profileId: string,
  tx: DbTx,
): Promise<void> {
  await tx
    .delete(recurrenceProfileLines)
    .where(
      and(
        eq(recurrenceProfileLines.businessId, businessId),
        eq(recurrenceProfileLines.profileId, profileId),
      ),
    )
}
