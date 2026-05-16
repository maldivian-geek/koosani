import { and, asc, desc, eq, gte, isNull, lte, or } from 'drizzle-orm'
import { db } from '../../db/client.js'
import type { DbTx } from '../../db/client.js'
import { gstRates, gstPeriods, businesses } from '../../db/schema/index.js'
import type { GstRate, GstPeriod } from '../../db/schema/index.js'

export type { GstRate, GstPeriod }

// ─── Rates ────────────────────────────────────────────────────────────────────

export async function getRateAt(
  businessId: string,
  category: GstRate['category'],
  date: string,
): Promise<GstRate | null> {
  const [row] = await db
    .select()
    .from(gstRates)
    .where(
      and(
        eq(gstRates.businessId, businessId),
        eq(gstRates.category, category),
        lte(gstRates.validFrom, date),
        or(isNull(gstRates.validTo), gte(gstRates.validTo, date)),
      ),
    )
    .orderBy(desc(gstRates.validFrom))
    .limit(1)
  return row ?? null
}

export async function listRates(businessId: string): Promise<GstRate[]> {
  return db
    .select()
    .from(gstRates)
    .where(eq(gstRates.businessId, businessId))
    .orderBy(asc(gstRates.category), asc(gstRates.validFrom))
}

export async function insertRate(
  data: {
    businessId: string
    category: GstRate['category']
    rate: string
    validFrom: string
    validTo?: string | null
    createdBy: string
  },
  tx: DbTx,
): Promise<GstRate> {
  const [row] = await tx
    .insert(gstRates)
    .values({ ...data, updatedBy: data.createdBy })
    .returning()
  if (!row) throw new Error('insertRate: no row returned')
  return row
}

// ─── Periods ──────────────────────────────────────────────────────────────────

export async function getPeriodForDate(
  businessId: string,
  date: string,
): Promise<GstPeriod | null> {
  const [row] = await db
    .select()
    .from(gstPeriods)
    .where(
      and(
        eq(gstPeriods.businessId, businessId),
        lte(gstPeriods.periodStart, date),
        gte(gstPeriods.periodEnd, date),
      ),
    )
  return row ?? null
}

// Inserts the period if it doesn't already exist, then returns the row.
// Uses the unique index on (businessId, periodStart, periodEnd).
export async function upsertPeriod(
  data: {
    businessId: string
    periodStart: string
    periodEnd: string
    periodType: GstPeriod['periodType']
    createdBy: string
  },
  tx: DbTx,
): Promise<GstPeriod> {
  await tx
    .insert(gstPeriods)
    .values({ ...data, status: 'open', updatedBy: data.createdBy })
    .onConflictDoNothing()

  const [row] = await tx
    .select()
    .from(gstPeriods)
    .where(
      and(
        eq(gstPeriods.businessId, data.businessId),
        eq(gstPeriods.periodStart, data.periodStart),
        eq(gstPeriods.periodEnd, data.periodEnd),
      ),
    )
  if (!row) throw new Error('upsertPeriod: period not found after upsert')
  return row
}

export async function getPeriodById(businessId: string, id: string): Promise<GstPeriod | null> {
  const [row] = await db
    .select()
    .from(gstPeriods)
    .where(and(eq(gstPeriods.businessId, businessId), eq(gstPeriods.id, id)))
  return row ?? null
}

export async function listPeriods(businessId: string): Promise<GstPeriod[]> {
  return db
    .select()
    .from(gstPeriods)
    .where(eq(gstPeriods.businessId, businessId))
    .orderBy(desc(gstPeriods.periodStart))
}

export async function lockPeriod(
  id: string,
  miraReturnRef: string,
  lockedBy: string,
  tx: DbTx,
): Promise<GstPeriod> {
  const [row] = await tx
    .update(gstPeriods)
    .set({
      status: 'locked',
      lockedAt: new Date(),
      lockedBy,
      miraReturnRef,
      updatedBy: lockedBy,
      updatedAt: new Date(),
    })
    .where(eq(gstPeriods.id, id))
    .returning()
  if (!row) throw new Error('lockPeriod: no row returned')
  return row
}

export async function unlockPeriod(id: string, unlockedBy: string, tx: DbTx): Promise<GstPeriod> {
  const [row] = await tx
    .update(gstPeriods)
    .set({
      status: 'open',
      lockedAt: null,
      lockedBy: null,
      miraReturnRef: null,
      updatedBy: unlockedBy,
      updatedAt: new Date(),
    })
    .where(eq(gstPeriods.id, id))
    .returning()
  if (!row) throw new Error('unlockPeriod: no row returned')
  return row
}

// ─── Business config ──────────────────────────────────────────────────────────

export async function getBusinessPeriodType(businessId: string): Promise<'monthly' | 'quarterly'> {
  const [row] = await db
    .select({ gstPeriodType: businesses.gstPeriodType })
    .from(businesses)
    .where(eq(businesses.id, businessId))
  return row?.gstPeriodType ?? 'monthly'
}
