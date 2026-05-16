import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'
import { db } from '../../db/client.js'
import type { DbTx } from '../../db/client.js'
import {
  gstRates,
  gstPeriods,
  gstReturns,
  businesses,
  invoices,
  invoiceLines,
  creditNotes,
  creditNoteLines,
  bills,
  billLines,
  suppliers,
} from '../../db/schema/index.js'
import type { GstRate, GstPeriod, GstReturn } from '../../db/schema/index.js'

export type { GstRate, GstPeriod, GstReturn }

// Aggregation result types for buildReturn (ARCHITECTURE.md §3 — reads persisted amounts only)
export interface PeriodLineAgg {
  category: string
  netAmount: string
  gstAmount: string
}

export interface BillLineAgg {
  supplierId: string
  supplierName: string
  supplierTin: string | null
  category: string
  netAmount: string
  gstAmount: string
}

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

// ─── GST return aggregation ───────────────────────────────────────────────────
// These read persisted gst_amount / line_total from invoice_lines, credit_note_lines,
// and bill_lines — they never recompute tax (ARCHITECTURE.md §3).

export async function getInvoiceLinesForPeriod(
  businessId: string,
  periodStart: string,
  periodEnd: string,
): Promise<PeriodLineAgg[]> {
  return db
    .select({
      category: invoiceLines.gstCategory,
      netAmount: sql<string>`COALESCE(SUM(${invoiceLines.lineTotal} - ${invoiceLines.gstAmount}), '0')`,
      gstAmount: sql<string>`COALESCE(SUM(${invoiceLines.gstAmount}), '0')`,
    })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
    .where(
      and(
        eq(invoices.businessId, businessId),
        inArray(invoices.status, ['issued', 'paid', 'partially_paid', 'voided']),
        isNotNull(invoices.issueDate),
        gte(invoices.issueDate, periodStart),
        lte(invoices.issueDate, periodEnd),
      ),
    )
    .groupBy(invoiceLines.gstCategory) as unknown as PeriodLineAgg[]
}

export async function getCreditNoteLinesForPeriod(
  businessId: string,
  periodStart: string,
  periodEnd: string,
): Promise<PeriodLineAgg[]> {
  return db
    .select({
      category: creditNoteLines.gstCategory,
      netAmount: sql<string>`COALESCE(SUM(${creditNoteLines.lineTotal} - ${creditNoteLines.gstAmount}), '0')`,
      gstAmount: sql<string>`COALESCE(SUM(${creditNoteLines.gstAmount}), '0')`,
    })
    .from(creditNoteLines)
    .innerJoin(creditNotes, eq(creditNoteLines.creditNoteId, creditNotes.id))
    .where(
      and(
        eq(creditNotes.businessId, businessId),
        eq(creditNotes.status, 'issued'),
        isNotNull(creditNotes.issueDate),
        gte(creditNotes.issueDate, periodStart),
        lte(creditNotes.issueDate, periodEnd),
      ),
    )
    .groupBy(creditNoteLines.gstCategory) as unknown as PeriodLineAgg[]
}

export async function getBillLinesForPeriod(
  businessId: string,
  periodStart: string,
  periodEnd: string,
): Promise<BillLineAgg[]> {
  return db
    .select({
      supplierId: suppliers.id,
      supplierName: suppliers.name,
      supplierTin: suppliers.tin,
      category: billLines.gstCategory,
      netAmount: sql<string>`COALESCE(SUM(${billLines.lineTotal} - ${billLines.gstAmount}), '0')`,
      gstAmount: sql<string>`COALESCE(SUM(${billLines.gstAmount}), '0')`,
    })
    .from(billLines)
    .innerJoin(bills, eq(billLines.billId, bills.id))
    .innerJoin(suppliers, eq(bills.supplierId, suppliers.id))
    .where(
      and(
        eq(bills.businessId, businessId),
        inArray(bills.status, ['confirmed', 'paid', 'partially_paid']),
        isNotNull(bills.billDate),
        gte(bills.billDate, periodStart),
        lte(bills.billDate, periodEnd),
      ),
    )
    .groupBy(suppliers.id, suppliers.name, suppliers.tin, billLines.gstCategory) as unknown as BillLineAgg[]
}

// ─── GST returns (append-only, SECURITY.md §13.4) ────────────────────────────

export async function insertGstReturn(
  data: {
    businessId: string
    periodId: string
    summaryJson: unknown
    files: Array<{ kind: string; fileId: string }>
    builtBy: string
  },
  tx: DbTx,
): Promise<GstReturn> {
  const [row] = await tx
    .insert(gstReturns)
    .values({
      businessId: data.businessId,
      periodId: data.periodId,
      summaryJson: data.summaryJson,
      files: data.files,
      builtBy: data.builtBy,
      createdBy: data.builtBy,
    })
    .returning()
  if (!row) throw new Error('insertGstReturn: no row returned')
  return row
}

export async function getLatestReturnForPeriod(
  businessId: string,
  periodId: string,
): Promise<GstReturn | null> {
  const [row] = await db
    .select()
    .from(gstReturns)
    .where(and(eq(gstReturns.businessId, businessId), eq(gstReturns.periodId, periodId)))
    .orderBy(desc(gstReturns.builtAt))
    .limit(1)
  return row ?? null
}

export async function markPeriodBuilt(id: string, updatedBy: string, tx: DbTx): Promise<GstPeriod> {
  const [row] = await tx
    .update(gstPeriods)
    .set({ status: 'built', updatedBy, updatedAt: new Date() })
    .where(eq(gstPeriods.id, id))
    .returning()
  if (!row) throw new Error('markPeriodBuilt: no row returned')
  return row
}
