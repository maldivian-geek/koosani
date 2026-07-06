import { and, count, desc, eq, gte, ilike, isNull, lte, or, sql } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { allocateDocumentNumber } from '../../db/numbering.js'
import type { DbTx } from '../../db/client.js'
import { bills, billLines, paymentsMade } from '../../db/schema/index.js'
import type { Bill, BillLine, PaymentMade } from '../../db/schema/index.js'

export type { Bill, BillLine, PaymentMade }
export type NewBillLine = typeof billLines.$inferInsert

// ─── Bill reads ───────────────────────────────────────────────────────────────

export async function getById(businessId: string, id: string, tx?: DbTx): Promise<Bill | null> {
  const q = tx ?? db
  const [row] = await q
    .select()
    .from(bills)
    .where(and(eq(bills.businessId, businessId), eq(bills.id, id)))
  return row ?? null
}

export async function getLinesByBill(
  businessId: string,
  billId: string,
  tx?: DbTx,
): Promise<BillLine[]> {
  const q = tx ?? db
  return q
    .select()
    .from(billLines)
    .where(and(eq(billLines.businessId, businessId), eq(billLines.billId, billId)))
    .orderBy(billLines.sortOrder)
}

export type ListBillParams = {
  status: string | undefined
  supplierId: string | undefined
  from: string | undefined
  to: string | undefined
  page: number
  pageSize: number
}

export async function listBills(
  businessId: string,
  params: ListBillParams,
): Promise<{ rows: Bill[]; total: number }> {
  const where = and(
    eq(bills.businessId, businessId),
    params.status ? eq(bills.status, params.status as Bill['status']) : undefined,
    params.supplierId ? eq(bills.supplierId, params.supplierId) : undefined,
    params.from ? gte(bills.billDate, params.from) : undefined,
    params.to ? lte(bills.billDate, params.to) : undefined,
  )

  const [totalRow, rows] = await Promise.all([
    db.select({ total: count() }).from(bills).where(where),
    db
      .select()
      .from(bills)
      .where(where)
      .orderBy(desc(bills.createdAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
  ])

  return { rows, total: totalRow[0]?.total ?? 0 }
}

// ─── Bill writes ──────────────────────────────────────────────────────────────

export async function insertBill(data: typeof bills.$inferInsert, tx?: DbTx): Promise<Bill> {
  const q = tx ?? db
  const [row] = await q.insert(bills).values(data).returning()
  return row!
}

export async function insertBillLines(lines: NewBillLine[], tx?: DbTx): Promise<BillLine[]> {
  const q = tx ?? db
  return q.insert(billLines).values(lines).returning()
}

export async function updateBill(
  businessId: string,
  id: string,
  data: Partial<typeof bills.$inferInsert>,
  tx?: DbTx,
): Promise<Bill> {
  const q = tx ?? db
  const [row] = await q
    .update(bills)
    .set(data)
    .where(and(eq(bills.businessId, businessId), eq(bills.id, id)))
    .returning()
  return row!
}

export async function deleteLinesByBill(
  businessId: string,
  billId: string,
  tx?: DbTx,
): Promise<void> {
  const q = tx ?? db
  await q
    .delete(billLines)
    .where(and(eq(billLines.businessId, businessId), eq(billLines.billId, billId)))
}

export async function updateBillLine(
  lineId: string,
  data: Partial<NewBillLine>,
  tx?: DbTx,
): Promise<BillLine> {
  const q = tx ?? db
  const [row] = await q.update(billLines).set(data).where(eq(billLines.id, lineId)).returning()
  return row!
}

// ─── Bill number allocation (advisory lock) ───────────────────────────────────
// Format: {businesses.bill_number_prefix}000001 (default BILL-000001, Phase 22
// — UPGRADE.md G-15).

export async function allocateBillNumber(businessId: string, tx: DbTx): Promise<string> {
  return allocateDocumentNumber(
    tx,
    businessId,
    ':bill',
    'bills',
    'bill_number',
    'bill_number_prefix',
  )
}

// ─── Payments ─────────────────────────────────────────────────────────────────

export async function insertPayment(
  data: typeof paymentsMade.$inferInsert,
  tx?: DbTx,
): Promise<PaymentMade> {
  const q = tx ?? db
  const [row] = await q.insert(paymentsMade).values(data).returning()
  return row!
}

export async function getPaymentById(
  businessId: string,
  id: string,
  tx?: DbTx,
): Promise<PaymentMade | null> {
  const q = tx ?? db
  const [row] = await q
    .select()
    .from(paymentsMade)
    .where(and(eq(paymentsMade.businessId, businessId), eq(paymentsMade.id, id)))
  return row ?? null
}

// Locks the payment row until the caller's tx commits — prevents a concurrent
// reversal of the same payment from also passing the reversedAt check
// (UPGRADE.md F-17).
export async function getPaymentByIdForUpdate(
  businessId: string,
  id: string,
  tx: DbTx,
): Promise<PaymentMade | null> {
  const [row] = await tx
    .select()
    .from(paymentsMade)
    .where(and(eq(paymentsMade.businessId, businessId), eq(paymentsMade.id, id)))
    .for('update')
  return row ?? null
}

export async function getPaymentsByBill(
  businessId: string,
  billId: string,
  tx?: DbTx,
): Promise<PaymentMade[]> {
  const q = tx ?? db
  return q
    .select()
    .from(paymentsMade)
    .where(and(eq(paymentsMade.businessId, businessId), eq(paymentsMade.billId, billId)))
    .orderBy(desc(paymentsMade.paidAt))
}

export async function sumActivePayments(
  businessId: string,
  billId: string,
  tx?: DbTx,
): Promise<string> {
  const q = tx ?? db
  const [row] = await q.execute<{ total: string }>(
    sql`
      SELECT COALESCE(SUM(amount), 0)::TEXT AS total
      FROM payments_made
      WHERE business_id = ${businessId}
        AND bill_id = ${billId}
        AND reversed_at IS NULL
    `,
  )
  return (row as { total: string }).total ?? '0'
}

// Guards on reversedAt IS NULL — a double-reversal race becomes a no-op
// instead of a second reversal (UPGRADE.md F-17). Returns null if the payment
// was already reversed.
export async function markPaymentReversed(
  businessId: string,
  paymentId: string,
  tx?: DbTx,
): Promise<PaymentMade | null> {
  const q = tx ?? db
  const [row] = await q
    .update(paymentsMade)
    .set({ reversedAt: new Date() })
    .where(
      and(
        eq(paymentsMade.businessId, businessId),
        eq(paymentsMade.id, paymentId),
        isNull(paymentsMade.reversedAt),
      ),
    )
    .returning()
  return row ?? null
}

// ─── SOA queries ──────────────────────────────────────────────────────────────

export async function soaBills(
  businessId: string,
  supplierId: string,
  from: string,
  to: string,
): Promise<Bill[]> {
  return db
    .select()
    .from(bills)
    .where(
      and(
        eq(bills.businessId, businessId),
        eq(bills.supplierId, supplierId),
        or(
          eq(bills.status, 'confirmed'),
          eq(bills.status, 'paid'),
          eq(bills.status, 'partially_paid'),
        ),
        gte(bills.billDate, from),
        lte(bills.billDate, to),
      ),
    )
    .orderBy(bills.billDate)
}

export async function soaPayments(
  businessId: string,
  supplierId: string,
  from: string,
  to: string,
): Promise<PaymentMade[]> {
  return db
    .select()
    .from(paymentsMade)
    .where(
      and(
        eq(paymentsMade.businessId, businessId),
        eq(paymentsMade.supplierId, supplierId),
        isNull(paymentsMade.reversedAt),
        gte(paymentsMade.paidAt, from),
        lte(paymentsMade.paidAt, to),
      ),
    )
    .orderBy(paymentsMade.paidAt)
}

// ─── SOA match ────────────────────────────────────────────────────────────────

export async function findMatchingBill(
  businessId: string,
  supplierId: string,
  ref: string,
  amount: string,
  dateFrom: string,
  dateTo: string,
): Promise<Bill | null> {
  const [row] = await db
    .select()
    .from(bills)
    .where(
      and(
        eq(bills.businessId, businessId),
        eq(bills.supplierId, supplierId),
        or(ilike(bills.supplierRef, ref), ilike(bills.billNumber, ref)),
        sql`ABS(${bills.total}::NUMERIC - ${amount}::NUMERIC) < 0.01`,
        gte(bills.billDate, dateFrom),
        lte(bills.billDate, dateTo),
      ),
    )
    .limit(1)
  return row ?? null
}
