import Decimal from 'decimal.js'
import { db } from '../../db/client.js'
import type { DbTx } from '../../db/client.js'
import * as repo from './repository.js'
import * as audit from '../audit/service.js'
import * as inventory from '../inventory/service.js'
import * as purchases from '../purchases/service.js'
import type { AuditCtx } from '../audit/service.js'
import type { PurchaseOrder, PoLine, Grn, GrnLine, ListPoParams } from './repository.js'
import type { PoDraftCreate, PoDraftPatch, GrnCreate } from '@koosani/shared'

export type { AuditCtx, PurchaseOrder, PoLine, Grn, GrnLine, ListPoParams }
export type Bill = Awaited<ReturnType<typeof purchases.createDraft>>

// ─── Error types ──────────────────────────────────────────────────────────────

export class NotFoundError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'ValidationError'
  }
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

function poLineTotals(lines: Array<{ qtyOrdered: string; unitCost: string }>) {
  const subtotal = lines
    .reduce((acc, l) => acc.plus(new Decimal(l.qtyOrdered).times(l.unitCost)), new Decimal(0))
    .toFixed(2)
  return { subtotal, total: subtotal }
}

// ─── createDraft ──────────────────────────────────────────────────────────────

export async function createDraft(
  businessId: string,
  data: PoDraftCreate,
  ctx: AuditCtx,
): Promise<PurchaseOrder & { lines: PoLine[] }> {
  return db.transaction(async (tx) => {
    const lineInputs = data.lines.map((l, idx) => ({
      businessId,
      poId: '' as string,
      itemId: l.itemId ?? null,
      description: l.description,
      qtyOrdered: l.qtyOrdered,
      unitCost: l.unitCost,
      lineTotal: new Decimal(l.qtyOrdered).times(l.unitCost).toFixed(2),
      sortOrder: String(l.sortOrder ?? idx),
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    }))

    const totals = poLineTotals(lineInputs)

    const po = await repo.insertPo(
      {
        businessId,
        supplierId: data.supplierId,
        orderDate: data.orderDate ?? null,
        expectedDate: data.expectedDate ?? null,
        notes: data.notes ?? null,
        subtotal: totals.subtotal,
        total: totals.total,
        status: 'draft',
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      },
      tx,
    )

    const lines = await repo.insertPoLines(
      lineInputs.map((l) => ({ ...l, poId: po.id })),
      tx,
    )

    await audit.record('po.draft_created', 'po', po.id, {}, po as Record<string, unknown>, ctx, tx)

    return { ...po, lines }
  })
}

// ─── patchDraft ───────────────────────────────────────────────────────────────

export async function patchDraft(
  businessId: string,
  id: string,
  data: PoDraftPatch,
  ctx: AuditCtx,
): Promise<PurchaseOrder & { lines: PoLine[] }> {
  return db.transaction(async (tx) => {
    const po = await repo.getById(businessId, id, tx)
    if (!po) throw new NotFoundError(`PO ${id} not found`)
    if (po.status !== 'draft') throw new ValidationError('Only draft POs can be patched')

    const before = { ...po }
    let lines: PoLine[] = await repo.getLinesByPo(businessId, id, tx)

    if (data.lines !== undefined) {
      const lineInputs = data.lines.map((l, idx) => ({
        businessId,
        poId: id,
        itemId: l.itemId ?? null,
        description: l.description,
        qtyOrdered: l.qtyOrdered,
        unitCost: l.unitCost,
        lineTotal: new Decimal(l.qtyOrdered).times(l.unitCost).toFixed(2),
        sortOrder: String(l.sortOrder ?? idx),
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      }))
      await repo.deleteLinesByPo(businessId, id, tx)
      lines = await repo.insertPoLines(lineInputs, tx)
    }

    const totals = poLineTotals(lines)

    const updated = await repo.updatePo(
      businessId,
      id,
      {
        ...(data.orderDate !== undefined ? { orderDate: data.orderDate } : {}),
        ...(data.expectedDate !== undefined ? { expectedDate: data.expectedDate } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        subtotal: totals.subtotal,
        total: totals.total,
        updatedBy: ctx.userId,
      },
      tx,
    )

    await audit.record(
      'po.draft_patched',
      'po',
      id,
      before as Record<string, unknown>,
      updated as Record<string, unknown>,
      ctx,
      tx,
    )

    return { ...updated, lines }
  })
}

// ─── approvePo ────────────────────────────────────────────────────────────────

export async function approvePo(
  businessId: string,
  poId: string,
  ctx: AuditCtx,
): Promise<PurchaseOrder> {
  const approved = await db.transaction(async (tx) => {
    const po = await repo.getById(businessId, poId, tx)
    if (!po) throw new NotFoundError(`PO ${poId} not found`)
    if (po.status !== 'draft') throw new ValidationError('Only draft POs can be approved')

    const lines = await repo.getLinesByPo(businessId, poId, tx)
    if (lines.length === 0) throw new ValidationError('Cannot approve a PO with no lines')

    const poNumber = await repo.allocatePoNumber(businessId, tx)

    const result = await repo.updatePo(
      businessId,
      poId,
      { status: 'approved', poNumber, updatedBy: ctx.userId },
      tx,
    )

    await audit.record(
      'po.approved',
      'po',
      poId,
      { status: 'draft' },
      { status: 'approved', poNumber },
      ctx,
      tx,
    )

    return result
  })

  return approved
}

// ─── cancelPo ─────────────────────────────────────────────────────────────────

export async function cancelPo(
  businessId: string,
  poId: string,
  reason: string,
  ctx: AuditCtx,
): Promise<PurchaseOrder> {
  return db.transaction(async (tx) => {
    const po = await repo.getById(businessId, poId, tx)
    if (!po) throw new NotFoundError(`PO ${poId} not found`)
    if (po.status === 'cancelled') throw new ValidationError('PO is already cancelled')
    if (po.status === 'received') throw new ValidationError('Cannot cancel a fully received PO')

    const grnList = await repo.getGrnsByPo(businessId, poId, tx)
    if (grnList.length > 0)
      throw new ValidationError('Cannot cancel a PO that has goods received notes')

    const cancelled = await repo.updatePo(
      businessId,
      poId,
      { status: 'cancelled', cancelReason: reason, updatedBy: ctx.userId },
      tx,
    )

    await audit.record(
      'po.cancelled',
      'po',
      poId,
      { status: po.status },
      { status: 'cancelled', reason },
      ctx,
      tx,
    )

    return cancelled
  })
}

// ─── canReceive ───────────────────────────────────────────────────────────────
// Returns false if receipt would exceed qty ordered and business disallows over-receipt.

export async function canReceive(
  businessId: string,
  poLineId: string,
  qty: string,
  tx?: DbTx,
): Promise<boolean> {
  const line = await repo.getPoLineById(businessId, poLineId, tx)
  if (!line) return false

  const totalAfter = new Decimal(line.qtyReceived).plus(qty)
  if (totalAfter.lte(line.qtyOrdered)) return true

  return repo.isOverReceiptAllowed(businessId, tx)
}

// ─── createGrn ────────────────────────────────────────────────────────────────

export async function createGrn(
  businessId: string,
  poId: string,
  data: GrnCreate,
  ctx: AuditCtx,
): Promise<Grn & { lines: GrnLine[] }> {
  return db.transaction(async (tx) => {
    const po = await repo.getById(businessId, poId, tx)
    if (!po) throw new NotFoundError(`PO ${poId} not found`)
    if (po.status !== 'approved' && po.status !== 'partially_received') {
      throw new ValidationError(
        'GRN can only be created against an approved or partially received PO',
      )
    }

    // Validate all lines up-front before mutating. Locks each PO line row
    // until this tx commits, so a concurrent GRN against the same line
    // cannot also pass this check before either commits (UPGRADE.md F-16).
    for (const l of data.lines) {
      const poLine = await repo.getPoLineByIdForUpdate(businessId, l.poLineId, tx)
      if (!poLine) throw new NotFoundError(`PO line ${l.poLineId} not found`)
      if (poLine.poId !== poId)
        throw new ValidationError(`PO line ${l.poLineId} does not belong to this PO`)

      const totalAfter = new Decimal(poLine.qtyReceived).plus(l.qtyReceived)
      if (totalAfter.gt(poLine.qtyOrdered)) {
        const overReceiptAllowed = await repo.isOverReceiptAllowed(businessId, tx)
        if (!overReceiptAllowed) {
          throw new ValidationError(
            `Over-receipt rejected for PO line ${l.poLineId}: would exceed qty ordered`,
          )
        }
      }
    }

    const grn = await repo.insertGrn(
      {
        businessId,
        poId,
        supplierId: po.supplierId,
        receivedAt: data.receivedAt,
        notes: data.notes ?? null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      },
      tx,
    )

    // Commit stock and build GRN line records
    const grnLineValues: Parameters<typeof repo.insertGrnLines>[0] = []

    for (const l of data.lines) {
      const poLine = await repo.getPoLineById(businessId, l.poLineId, tx)
      // poLine guaranteed non-null (validated above)
      const itemId = poLine!.itemId

      if (itemId) {
        await inventory.applyMovement(
          businessId,
          itemId,
          l.qtyReceived,
          'grn',
          grn.id,
          null,
          ctx,
          tx,
        )
      }

      await repo.incrementPoLineReceived(l.poLineId, l.qtyReceived, tx)

      grnLineValues.push({
        businessId,
        grnId: grn.id,
        poLineId: l.poLineId,
        itemId: itemId ?? ('' as string),
        qtyReceived: l.qtyReceived,
        unitCost: l.unitCost,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      })
    }

    const insertedLines = await repo.insertGrnLines(grnLineValues, tx)

    // Derive new PO status
    const allPoLines = await repo.getLinesByPo(businessId, poId, tx)
    const allReceived = allPoLines.every((l) => new Decimal(l.qtyReceived).gte(l.qtyOrdered))
    await repo.updatePo(
      businessId,
      poId,
      { status: allReceived ? 'received' : 'partially_received', updatedBy: ctx.userId },
      tx,
    )

    await audit.record(
      'po.grn_created',
      'po',
      poId,
      {},
      { grnId: grn.id, lines: data.lines.length },
      ctx,
      tx,
    )

    return { ...grn, lines: insertedLines }
  })
}

// ─── getPo ────────────────────────────────────────────────────────────────────

export async function getPo(
  businessId: string,
  poId: string,
): Promise<PurchaseOrder & { lines: PoLine[]; grns: Grn[] }> {
  const po = await repo.getById(businessId, poId)
  if (!po) throw new NotFoundError(`PO ${poId} not found`)
  const [lines, grnList] = await Promise.all([
    repo.getLinesByPo(businessId, poId),
    repo.getGrnsByPo(businessId, poId),
  ])
  return { ...po, lines, grns: grnList }
}

// ─── listPos ─────────────────────────────────────────────────────────────────

export async function listPos(
  businessId: string,
  params: ListPoParams,
): Promise<{ rows: PurchaseOrder[]; total: number }> {
  return repo.listPos(businessId, params)
}

// ─── getGrn ──────────────────────────────────────────────────────────────────

export async function getGrn(
  businessId: string,
  grnId: string,
): Promise<Grn & { lines: GrnLine[] }> {
  const grn = await repo.getGrnById(businessId, grnId)
  if (!grn) throw new NotFoundError(`GRN ${grnId} not found`)
  const lines = await repo.getGrnLinesByGrn(businessId, grnId)
  return { ...grn, lines }
}

// ─── createBillFromPo ────────────────────────────────────────────────────────
// Aggregates all GRN-received quantities and creates a pre-filled draft bill.

export async function createBillFromPo(
  businessId: string,
  poId: string,
  ctx: AuditCtx,
): Promise<Bill & { poId: string }> {
  const po = await repo.getById(businessId, poId)
  if (!po) throw new NotFoundError(`PO ${poId} not found`)
  if (po.status === 'draft' || po.status === 'cancelled') {
    throw new ValidationError('PO must be approved or have goods received before creating a bill')
  }

  const aggregated = await repo.getAggregatedGrnLinesByPo(businessId, poId)
  if (aggregated.length === 0) {
    throw new ValidationError('No GRN lines found for this PO — receive goods first')
  }

  const billLines = aggregated.map((l) => ({
    itemId: l.itemId ?? undefined,
    description: l.description,
    qty: new Decimal(l.totalQtyReceived).toFixed(4),
    unitCost: l.unitCost,
    gstCategory: (l.gstCategory ?? 'zero') as
      | 'general_8'
      | 'tourism_16'
      | 'tourism_17'
      | 'zero'
      | 'exempt',
  }))

  const bill = await purchases.createDraft(
    businessId,
    { supplierId: po.supplierId, lines: billLines },
    ctx,
  )

  await purchases.linkBillToPo(businessId, bill.id, poId)

  return { ...bill, poId }
}
