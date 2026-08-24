import { db } from '../../db/client.js'
import * as repo from './repository.js'
import * as audit from '../audit/service.js'
import type { AuditCtx } from '../audit/service.js'
import type { DbTx } from '../../db/client.js'
import type {
  OrderList,
  OrderListLine,
  ListOrderListParams,
  OrderListWithLineCount,
} from './repository.js'
import type {
  OrderListCreate,
  OrderListPatch,
  OrderLineCreate,
  OrderLinePatch,
} from '@koosani/shared'

export type { AuditCtx, OrderList, OrderListLine, ListOrderListParams, OrderListWithLineCount }

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

const PAGE_SIZE_DEFAULT = 50
const PAGE_SIZE_MAX = 200

// ─── assertExists ─────────────────────────────────────────────────────────────

async function assertExists(businessId: string, id: string, tx?: DbTx) {
  const list = await repo.getById(businessId, id, tx)
  if (!list || list.deletedAt !== null) {
    throw new NotFoundError(`Order list ${id} not found`)
  }
  return list
}

// ─── listOrderLists ───────────────────────────────────────────────────────────

export async function listOrderLists(
  businessId: string,
  params: { q: string | undefined; page: number | undefined; pageSize: number | undefined },
): Promise<{ items: OrderListWithLineCount[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, params.pageSize ?? PAGE_SIZE_DEFAULT))
  const { rows, total } = await repo.listOrderLists(businessId, { q: params.q, page, pageSize })
  return { items: rows, total, page, pageSize }
}

// ─── getOrderList ─────────────────────────────────────────────────────────────

export async function getOrderList(
  businessId: string,
  id: string,
): Promise<OrderList & { lines: OrderListLine[] }> {
  const list = await assertExists(businessId, id)
  const lines = await repo.getLinesByOrderList(businessId, id)
  return { ...list, lines }
}

// ─── createOrderList ──────────────────────────────────────────────────────────

export async function createOrderList(
  businessId: string,
  data: OrderListCreate,
  ctx: AuditCtx,
): Promise<OrderList & { lines: OrderListLine[] }> {
  return db.transaction(async (tx) => {
    const list = await repo.insertOrderList(
      {
        businessId,
        title: data.title,
        notes: data.notes ?? null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      },
      tx,
    )

    await audit.record(
      'order_list.create',
      'order_list',
      list.id,
      null,
      { title: data.title },
      ctx,
      tx,
    )

    return { ...list, lines: [] }
  })
}

// ─── patchOrderList ───────────────────────────────────────────────────────────

export async function patchOrderList(
  businessId: string,
  id: string,
  data: OrderListPatch,
  ctx: AuditCtx,
): Promise<OrderList> {
  return db.transaction(async (tx) => {
    const before = await assertExists(businessId, id, tx)

    const updated = await repo.updateOrderList(
      businessId,
      id,
      {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        updatedBy: ctx.userId,
      },
      tx,
    )

    await audit.record(
      'order_list.update',
      'order_list',
      id,
      before as Record<string, unknown>,
      updated as Record<string, unknown>,
      ctx,
      tx,
    )

    return updated
  })
}

// ─── softDeleteOrderList ──────────────────────────────────────────────────────

export async function softDeleteOrderList(
  businessId: string,
  id: string,
  ctx: AuditCtx,
): Promise<void> {
  return db.transaction(async (tx) => {
    const before = await assertExists(businessId, id, tx)

    await repo.softDeleteOrderList(businessId, id, ctx.userId, tx)

    await audit.record(
      'order_list.delete',
      'order_list',
      id,
      before as Record<string, unknown>,
      null,
      ctx,
      tx,
    )
  })
}

// ─── addLine ──────────────────────────────────────────────────────────────────

export async function addLine(
  businessId: string,
  orderListId: string,
  data: OrderLineCreate,
  ctx: AuditCtx,
): Promise<OrderListLine> {
  return db.transaction(async (tx) => {
    await assertExists(businessId, orderListId, tx)

    const position = await repo.nextPosition(businessId, orderListId, tx)

    const line = await repo.insertLine(
      {
        businessId,
        orderListId,
        position,
        itemName: data.itemName,
        qty: data.qty,
        uom: data.uom,
        note: data.note ?? null,
        additionalNote: data.additionalNote ?? null,
      },
      tx,
    )

    await audit.record(
      'order_list.line_add',
      'order_list',
      orderListId,
      null,
      { lineId: line.id, itemName: line.itemName, qty: line.qty },
      ctx,
      tx,
    )

    return line
  })
}

// ─── patchLine ────────────────────────────────────────────────────────────────

export async function patchLine(
  businessId: string,
  orderListId: string,
  lineId: string,
  data: OrderLinePatch,
  ctx: AuditCtx,
): Promise<OrderListLine> {
  return db.transaction(async (tx) => {
    await assertExists(businessId, orderListId, tx)

    const before = await repo.getLineById(businessId, orderListId, lineId, tx)
    if (!before) throw new NotFoundError(`Order list line ${lineId} not found`)

    const updated = await repo.updateLine(
      businessId,
      orderListId,
      lineId,
      {
        ...(data.itemName !== undefined ? { itemName: data.itemName } : {}),
        ...(data.qty !== undefined ? { qty: data.qty } : {}),
        ...(data.uom !== undefined ? { uom: data.uom } : {}),
        ...(data.note !== undefined ? { note: data.note } : {}),
        ...(data.additionalNote !== undefined ? { additionalNote: data.additionalNote } : {}),
        ...(data.paymentStatus !== undefined ? { paymentStatus: data.paymentStatus } : {}),
        ...(data.stockStatus !== undefined ? { stockStatus: data.stockStatus } : {}),
      },
      tx,
    )

    await audit.record(
      'order_list.line_update',
      'order_list',
      orderListId,
      { lineId, ...(before as Record<string, unknown>) },
      { lineId, ...(updated as Record<string, unknown>) },
      ctx,
      tx,
    )

    return updated
  })
}

// ─── deleteLine ───────────────────────────────────────────────────────────────

export async function deleteLine(
  businessId: string,
  orderListId: string,
  lineId: string,
  ctx: AuditCtx,
): Promise<void> {
  return db.transaction(async (tx) => {
    await assertExists(businessId, orderListId, tx)

    const before = await repo.getLineById(businessId, orderListId, lineId, tx)
    if (!before) throw new NotFoundError(`Order list line ${lineId} not found`)

    await repo.deleteLine(businessId, orderListId, lineId, tx)

    await audit.record(
      'order_list.line_delete',
      'order_list',
      orderListId,
      { lineId, ...(before as Record<string, unknown>) },
      null,
      ctx,
      tx,
    )
  })
}
