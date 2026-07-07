import Decimal from 'decimal.js'
import { db } from '../../db/client.js'
import * as repo from './repository.js'
import * as audit from '../audit/service.js'
import type { AuditCtx } from '../audit/service.js'
import type { InventoryAdjustmentCreate, StockCountCreate } from '@koosani/shared'
import type { StockMovement, MovementRow, OnHandRow } from './repository.js'
import type { NewStockMovement } from '../../db/schema/index.js'
import type { DbTx } from '../../db/client.js'

export type { AuditCtx }
export type { OnHandRow, MovementRow }

const PAGE_SIZE_DEFAULT = 50
const PAGE_SIZE_MAX = 200

// ─── Helpers ──────────────────────────────────────────────────────────────────

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

// ─── applyMovement ────────────────────────────────────────────────────────────
// The ONLY function that writes stock_movements (FUNCTIONS.md §inventory).
// Caller must supply an open transaction; the trigger handles updating stock_on_hand.

export async function applyMovement(
  businessId: string,
  itemId: string,
  qty: string,
  source: NewStockMovement['source'],
  sourceId: string | null,
  reason: string | null,
  ctx: AuditCtx,
  tx: DbTx,
): Promise<StockMovement> {
  return repo.insertMovement(
    {
      businessId,
      itemId,
      qty,
      source,
      sourceId: sourceId ?? undefined,
      reason,
      createdBy: ctx.userId,
    },
    tx,
  )
}

// ─── assertAvailable ──────────────────────────────────────────────────────────
// Throws ValidationError if applying qty would make stock_on_hand negative,
// unless the business has allowBackorders = true (ARCHITECTURE.md §4.3).

export async function assertAvailable(
  businessId: string,
  itemId: string,
  qty: string,
  tx: DbTx,
): Promise<void> {
  const allowBackorders = await repo.getBackorderFlag(businessId)
  if (allowBackorders) return

  // Locks the item row until this tx commits, so a concurrent issue/adjustment
  // against the same item cannot also pass this check before stock is updated.
  const onHand = await repo.getItemOnHandForUpdate(businessId, itemId, tx)
  if (onHand === null) return // item not found — FK constraint will catch it

  const result = new Decimal(onHand).plus(qty)
  if (result.lt(0)) {
    throw new ValidationError(
      `Insufficient stock: ${onHand} on hand, applying ${qty} would result in ${result.toFixed(4)}`,
    )
  }
}

// ─── createAdjustment ────────────────────────────────────────────────────────

export async function createAdjustment(
  businessId: string,
  data: InventoryAdjustmentCreate,
  ctx: AuditCtx,
): Promise<StockMovement> {
  return db.transaction(async (tx) => {
    const onHand = await repo.getItemOnHand(businessId, data.itemId, tx)
    if (onHand === null) throw new NotFoundError(`Item ${data.itemId} not found`)

    await assertAvailable(businessId, data.itemId, data.qty, tx)

    const movement = await applyMovement(
      businessId,
      data.itemId,
      data.qty,
      'adjustment',
      null,
      data.reason,
      ctx,
      tx,
    )

    await audit.record(
      'inventory.adjustment',
      'item',
      data.itemId,
      { stockOnHand: onHand },
      { movement: movement.id, qty: data.qty, reason: data.reason },
      ctx,
      tx,
    )

    return movement
  })
}

// ─── bulkStockCount ───────────────────────────────────────────────────────────
// Diffs counted vs current and creates adjustment movements for changed items.

export async function bulkStockCount(
  businessId: string,
  data: StockCountCreate,
  ctx: AuditCtx,
): Promise<{ adjustmentsCreated: number }> {
  let adjustmentsCreated = 0

  await db.transaction(async (tx) => {
    for (const { itemId, qty: countedQty } of data.counts) {
      const onHand = await repo.getItemOnHand(businessId, itemId, tx)
      if (onHand === null) throw new NotFoundError(`Item ${itemId} not found`)

      const diff = new Decimal(countedQty).minus(onHand)
      if (diff.isZero()) continue

      const movement = await applyMovement(
        businessId,
        itemId,
        diff.toFixed(4),
        'adjustment',
        null,
        'Stock count',
        ctx,
        tx,
      )

      await audit.record(
        'inventory.stock_count',
        'item',
        itemId,
        { stockOnHand: onHand },
        { movement: movement.id, counted: countedQty, diff: diff.toFixed(4) },
        ctx,
        tx,
      )

      adjustmentsCreated++
    }
  })

  return { adjustmentsCreated }
}

// ─── listMovements ────────────────────────────────────────────────────────────

export async function listMovements(
  businessId: string,
  params: {
    itemId: string | undefined
    from: Date | undefined
    to: Date | undefined
    page: number | undefined
    pageSize: number | undefined
  },
): Promise<{ items: MovementRow[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, params.pageSize ?? PAGE_SIZE_DEFAULT))
  const { rows, total } = await repo.listMovements(businessId, {
    itemId: params.itemId,
    from: params.from,
    to: params.to,
    page,
    pageSize,
  })
  return { items: rows, total, page, pageSize }
}

// ─── listOnHand ───────────────────────────────────────────────────────────────

export async function listOnHand(
  businessId: string,
  params: { categoryId: string | undefined; belowReorder: boolean },
): Promise<OnHandRow[]> {
  return repo.listOnHand(businessId, params)
}
