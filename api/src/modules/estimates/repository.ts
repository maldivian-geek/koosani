import { and, count, desc, eq, gte, ilike, lte, or } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { allocateDocumentNumber } from '../../db/numbering.js'
import type { DbTx } from '../../db/client.js'
import { estimates, estimateLines, customers } from '../../db/schema/index.js'
import type { Estimate, NewEstimate, EstimateLine } from '../../db/schema/index.js'

export type EstimateWithCustomer = Estimate & { customerName: string }

export type { Estimate, NewEstimate, EstimateLine }

// ─── Estimate reads ───────────────────────────────────────────────────────────

export async function getById(businessId: string, id: string, tx?: DbTx): Promise<Estimate | null> {
  const q = tx ?? db
  const [row] = await q
    .select()
    .from(estimates)
    .where(and(eq(estimates.businessId, businessId), eq(estimates.id, id)))
  return row ?? null
}

export async function getLinesByEstimate(
  businessId: string,
  estimateId: string,
  tx?: DbTx,
): Promise<EstimateLine[]> {
  const q = tx ?? db
  return q
    .select()
    .from(estimateLines)
    .where(and(eq(estimateLines.businessId, businessId), eq(estimateLines.estimateId, estimateId)))
    .orderBy(estimateLines.sortOrder)
}

export type ListEstimateParams = {
  status: string | undefined
  customerId: string | undefined
  from: string | undefined
  to: string | undefined
  q: string | undefined
  page: number
  pageSize: number
}

export async function listEstimates(
  businessId: string,
  params: ListEstimateParams,
): Promise<{ rows: EstimateWithCustomer[]; total: number }> {
  const where = and(
    eq(estimates.businessId, businessId),
    params.status ? eq(estimates.status, params.status as Estimate['status']) : undefined,
    params.customerId ? eq(estimates.customerId, params.customerId) : undefined,
    params.from ? gte(estimates.issueDate, params.from) : undefined,
    params.to ? lte(estimates.issueDate, params.to) : undefined,
    params.q
      ? or(
          ilike(estimates.estimateNumber, `%${params.q}%`),
          ilike(estimates.notes, `%${params.q}%`),
        )
      : undefined,
  )

  const [totalRow, rows] = await Promise.all([
    db.select({ total: count() }).from(estimates).where(where),
    db
      .select({
        id: estimates.id,
        businessId: estimates.businessId,
        customerId: estimates.customerId,
        customerName: customers.name,
        estimateNumber: estimates.estimateNumber,
        status: estimates.status,
        issueDate: estimates.issueDate,
        expiryDate: estimates.expiryDate,
        subtotal: estimates.subtotal,
        gstAmount: estimates.gstAmount,
        total: estimates.total,
        currency: estimates.currency,
        exchangeRate: estimates.exchangeRate,
        subtotalMvr: estimates.subtotalMvr,
        gstAmountMvr: estimates.gstAmountMvr,
        totalMvr: estimates.totalMvr,
        notes: estimates.notes,
        convertedAt: estimates.convertedAt,
        createdAt: estimates.createdAt,
        updatedAt: estimates.updatedAt,
        createdBy: estimates.createdBy,
        updatedBy: estimates.updatedBy,
      })
      .from(estimates)
      .innerJoin(customers, eq(customers.id, estimates.customerId))
      .where(where)
      .orderBy(desc(estimates.createdAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
  ])

  return { rows, total: totalRow[0]?.total ?? 0 }
}

// Candidates for the daily expiry sweep (piggybacks on the reminders cron,
// Phase 25 — UPGRADE.md G-5): sent, not yet accepted/declined, with an expiry date.
export async function listExpiryCandidates(businessId: string): Promise<Estimate[]> {
  return db
    .select()
    .from(estimates)
    .where(and(eq(estimates.businessId, businessId), eq(estimates.status, 'sent')))
}

// ─── Estimate writes ──────────────────────────────────────────────────────────

export async function insertEstimate(
  data: Omit<NewEstimate, 'id' | 'createdAt' | 'updatedAt'>,
  tx: DbTx,
): Promise<Estimate> {
  const [row] = await tx.insert(estimates).values(data).returning()
  if (!row) throw new Error('insertEstimate: no row returned')
  return row
}

export async function updateEstimate(
  businessId: string,
  id: string,
  data: Partial<Omit<NewEstimate, 'id' | 'businessId' | 'createdAt' | 'createdBy'>>,
  tx: DbTx,
): Promise<Estimate> {
  const [row] = await tx
    .update(estimates)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(estimates.businessId, businessId), eq(estimates.id, id)))
    .returning()
  if (!row) throw new Error('updateEstimate: no row returned')
  return row
}

// ─── Estimate lines ───────────────────────────────────────────────────────────

type NewLine = {
  businessId: string
  estimateId: string
  itemId?: string | null
  description: string
  qty: string
  unitPrice: string
  gstCategory: EstimateLine['gstCategory']
  gstRate: string
  gstAmount: string
  lineTotal: string
  // Multi-currency (Phase 30, UPGRADE.md G-10)
  gstAmountMvr: string
  lineTotalMvr: string
  sortOrder?: number
  createdBy: string
}

export async function insertLines(lines: NewLine[], tx: DbTx): Promise<EstimateLine[]> {
  if (lines.length === 0) return []
  return tx
    .insert(estimateLines)
    .values(lines.map((l) => ({ ...l, updatedBy: l.createdBy })))
    .returning()
}

export async function deleteLinesByEstimate(
  businessId: string,
  estimateId: string,
  tx: DbTx,
): Promise<void> {
  await tx
    .delete(estimateLines)
    .where(and(eq(estimateLines.businessId, businessId), eq(estimateLines.estimateId, estimateId)))
}

// ─── Estimate number sequence (no-gap, advisory-locked) ──────────────────────
// Format: {businesses.estimate_number_prefix}000001 (default EST-000001).
// Same mechanism as invoice/bill/PO numbering (db/numbering.ts).

export async function allocateEstimateNumber(businessId: string, tx: DbTx): Promise<string> {
  return allocateDocumentNumber(
    tx,
    businessId,
    ':estimate',
    'estimates',
    'estimate_number',
    'estimate_number_prefix',
  )
}
