import { and, count, desc, eq, gte, lte, sql, sum } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { allocateDocumentNumber } from '../../db/numbering.js'
import type { DbTx } from '../../db/client.js'
import {
  purchaseOrders,
  poLines,
  grns,
  grnLines,
  items,
  businesses,
} from '../../db/schema/index.js'
import type { PurchaseOrder, NewPurchaseOrder, Grn } from '../../db/schema/index.js'

export type { PurchaseOrder, NewPurchaseOrder, Grn }
export type PoLine = typeof poLines.$inferSelect
export type GrnLine = typeof grnLines.$inferSelect
export type NewPoLine = typeof poLines.$inferInsert
export type NewGrn = typeof grns.$inferInsert
export type NewGrnLine = typeof grnLines.$inferInsert

// ─── PO reads ─────────────────────────────────────────────────────────────────

export async function getById(
  businessId: string,
  id: string,
  tx?: DbTx,
): Promise<PurchaseOrder | null> {
  const q = tx ?? db
  const [row] = await q
    .select()
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.businessId, businessId), eq(purchaseOrders.id, id)))
  return row ?? null
}

export async function getLinesByPo(businessId: string, poId: string, tx?: DbTx): Promise<PoLine[]> {
  const q = tx ?? db
  return q
    .select()
    .from(poLines)
    .where(and(eq(poLines.businessId, businessId), eq(poLines.poId, poId)))
    .orderBy(poLines.sortOrder)
}

export async function getPoLineById(
  businessId: string,
  lineId: string,
  tx?: DbTx,
): Promise<PoLine | null> {
  const q = tx ?? db
  const [row] = await q
    .select()
    .from(poLines)
    .where(and(eq(poLines.businessId, businessId), eq(poLines.id, lineId)))
  return row ?? null
}

// Locks the PO line row until the caller's tx commits — prevents two
// concurrent GRNs against the same line from both passing the over-receipt
// check before either commits (UPGRADE.md F-16).
export async function getPoLineByIdForUpdate(
  businessId: string,
  lineId: string,
  tx: DbTx,
): Promise<PoLine | null> {
  const [row] = await tx
    .select()
    .from(poLines)
    .where(and(eq(poLines.businessId, businessId), eq(poLines.id, lineId)))
    .for('update')
  return row ?? null
}

export type ListPoParams = {
  status: string | undefined
  supplierId: string | undefined
  from: string | undefined
  to: string | undefined
  page: number
  pageSize: number
}

export async function listPos(
  businessId: string,
  params: ListPoParams,
): Promise<{ rows: PurchaseOrder[]; total: number }> {
  const where = and(
    eq(purchaseOrders.businessId, businessId),
    params.status ? eq(purchaseOrders.status, params.status as PurchaseOrder['status']) : undefined,
    params.supplierId ? eq(purchaseOrders.supplierId, params.supplierId) : undefined,
    params.from ? gte(purchaseOrders.orderDate, params.from) : undefined,
    params.to ? lte(purchaseOrders.orderDate, params.to) : undefined,
  )

  const [totalRow, rows] = await Promise.all([
    db.select({ total: count() }).from(purchaseOrders).where(where),
    db
      .select()
      .from(purchaseOrders)
      .where(where)
      .orderBy(desc(purchaseOrders.createdAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
  ])

  return { rows, total: totalRow[0]?.total ?? 0 }
}

// ─── PO writes ────────────────────────────────────────────────────────────────

export async function insertPo(data: NewPurchaseOrder, tx?: DbTx): Promise<PurchaseOrder> {
  const q = tx ?? db
  const [row] = await q.insert(purchaseOrders).values(data).returning()
  return row!
}

export async function insertPoLines(lines: NewPoLine[], tx?: DbTx): Promise<PoLine[]> {
  const q = tx ?? db
  return q.insert(poLines).values(lines).returning()
}

export async function updatePo(
  businessId: string,
  id: string,
  data: Partial<NewPurchaseOrder>,
  tx?: DbTx,
): Promise<PurchaseOrder> {
  const q = tx ?? db
  const [row] = await q
    .update(purchaseOrders)
    .set(data)
    .where(and(eq(purchaseOrders.businessId, businessId), eq(purchaseOrders.id, id)))
    .returning()
  return row!
}

export async function deleteLinesByPo(businessId: string, poId: string, tx?: DbTx): Promise<void> {
  const q = tx ?? db
  await q.delete(poLines).where(and(eq(poLines.businessId, businessId), eq(poLines.poId, poId)))
}

export async function updatePoLine(
  lineId: string,
  data: Partial<NewPoLine>,
  tx?: DbTx,
): Promise<PoLine> {
  const q = tx ?? db
  const [row] = await q.update(poLines).set(data).where(eq(poLines.id, lineId)).returning()
  return row!
}

// Increment qty_received on a PO line atomically
export async function incrementPoLineReceived(
  lineId: string,
  addedQty: string,
  tx?: DbTx,
): Promise<PoLine> {
  const q = tx ?? db
  const [row] = await q
    .update(poLines)
    .set({ qtyReceived: sql`qty_received + ${addedQty}::NUMERIC` })
    .where(eq(poLines.id, lineId))
    .returning()
  return row!
}

// ─── PO number allocation (advisory lock) ────────────────────────────────────
// Format: {businesses.po_number_prefix}000001 (default PO-000001, Phase 22 —
// UPGRADE.md G-15).

export async function allocatePoNumber(businessId: string, tx: DbTx): Promise<string> {
  return allocateDocumentNumber(
    tx,
    businessId,
    ':po',
    'purchase_orders',
    'po_number',
    'po_number_prefix',
  )
}

export async function isOverReceiptAllowed(businessId: string, tx?: DbTx): Promise<boolean> {
  const q = tx ?? db
  const [biz] = await q
    .select({ allowBackorders: businesses.allowBackorders })
    .from(businesses)
    .where(eq(businesses.id, businessId))
  return biz?.allowBackorders ?? false
}

// ─── GRN reads ────────────────────────────────────────────────────────────────

export async function getGrnById(businessId: string, id: string, tx?: DbTx): Promise<Grn | null> {
  const q = tx ?? db
  const [row] = await q
    .select()
    .from(grns)
    .where(and(eq(grns.businessId, businessId), eq(grns.id, id)))
  return row ?? null
}

export async function getGrnsByPo(businessId: string, poId: string, tx?: DbTx): Promise<Grn[]> {
  const q = tx ?? db
  return q
    .select()
    .from(grns)
    .where(and(eq(grns.businessId, businessId), eq(grns.poId, poId)))
    .orderBy(grns.receivedAt)
}

export async function getGrnLinesByGrn(
  businessId: string,
  grnId: string,
  tx?: DbTx,
): Promise<GrnLine[]> {
  const q = tx ?? db
  return q
    .select()
    .from(grnLines)
    .where(and(eq(grnLines.businessId, businessId), eq(grnLines.grnId, grnId)))
}

// Aggregate GRN lines per PO line across all GRNs, joined with PO line + item data
export type AggregatedGrnLine = {
  poLineId: string
  itemId: string | null
  description: string
  unitCost: string
  totalQtyReceived: string
  gstCategory: string | null
}

export async function getAggregatedGrnLinesByPo(
  businessId: string,
  poId: string,
): Promise<AggregatedGrnLine[]> {
  const rows = await db
    .select({
      poLineId: grnLines.poLineId,
      itemId: grnLines.itemId,
      description: poLines.description,
      unitCost: grnLines.unitCost,
      totalQtyReceived: sum(grnLines.qtyReceived).as('total_qty_received'),
      gstCategory: items.gstCategory,
    })
    .from(grnLines)
    .innerJoin(poLines, eq(grnLines.poLineId, poLines.id))
    .leftJoin(items, eq(grnLines.itemId, items.id))
    .where(and(eq(grnLines.businessId, businessId), eq(poLines.poId, poId)))
    .groupBy(
      grnLines.poLineId,
      grnLines.itemId,
      poLines.description,
      grnLines.unitCost,
      items.gstCategory,
    )

  return rows.map((r) => ({
    poLineId: r.poLineId,
    itemId: r.itemId ?? null,
    description: r.description,
    unitCost: r.unitCost,
    totalQtyReceived: r.totalQtyReceived ?? '0',
    gstCategory: r.gstCategory ?? null,
  }))
}

// ─── GRN writes ───────────────────────────────────────────────────────────────

export async function insertGrn(data: NewGrn, tx?: DbTx): Promise<Grn> {
  const q = tx ?? db
  const [row] = await q.insert(grns).values(data).returning()
  return row!
}

export async function insertGrnLines(lines: NewGrnLine[], tx?: DbTx): Promise<GrnLine[]> {
  const q = tx ?? db
  return q.insert(grnLines).values(lines).returning()
}
