import { db } from '../../db/client.js'
import * as repo from './repository.js'
import * as audit from '../audit/service.js'
import * as items from '../items/service.js'
import { parseImportText, type ParsedImport } from '../../lib/order-list-import.js'
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

// ─── withSystemNames ──────────────────────────────────────────────────────────
// A line's item_name is the CUSTOMER's wording; resolve it (case-insensitive)
// against the item master's customer_item_name and attach the catalogue name.
// Derived at read time — never stored — so it stays live as the catalogue
// changes. Ties on a shared customer_item_name resolve to the alphabetically
// first item name, deterministically.

export type OrderListLineWithSystemName = OrderListLine & { systemItemName: string | null }

async function withSystemNames(
  businessId: string,
  lines: OrderListLine[],
): Promise<OrderListLineWithSystemName[]> {
  if (lines.length === 0) return []
  const names = [...new Set(lines.map((l) => l.itemName.trim().toLowerCase()))]
  const matches = await items.findByCustomerItemNames(businessId, names)
  const byCustomerName = new Map<string, string>()
  for (const m of matches) {
    const key = (m.customerItemName ?? '').trim().toLowerCase()
    if (key && !byCustomerName.has(key)) byCustomerName.set(key, m.name)
  }
  return lines.map((l) => ({
    ...l,
    systemItemName: byCustomerName.get(l.itemName.trim().toLowerCase()) ?? null,
  }))
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

// ─── assertOrderListExists ────────────────────────────────────────────────────
// Thin, exported existence check for callers that only need the 404 guard,
// not the full list+lines read — used by the image-import route (Phase 36)
// before it spends the OCR rate-limit budget on a nonexistent list.

export async function assertOrderListExists(businessId: string, id: string): Promise<void> {
  await assertExists(businessId, id)
}

// ─── getOrderList ─────────────────────────────────────────────────────────────

export async function getOrderList(
  businessId: string,
  id: string,
): Promise<OrderList & { lines: OrderListLineWithSystemName[] }> {
  const list = await assertExists(businessId, id)
  const lines = await repo.getLinesByOrderList(businessId, id)
  return { ...list, lines: await withSystemNames(businessId, lines) }
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
): Promise<OrderListLineWithSystemName> {
  const line = await db.transaction(async (tx) => {
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

  const [enriched] = await withSystemNames(businessId, [line])
  if (!enriched) throw new Error('addLine: enrichment returned no row')
  return enriched
}

// ─── parseImport / importLines ────────────────────────────────────────────────
// Paste/CSV import in two steps (SECURITY.md §13.13 requires review-and-confirm
// for bulk imports): parseImport turns pasted spreadsheet text into draft rows
// without persisting anything; after the user reviews/edits them, importLines
// creates the whole batch in one transaction with a single audit row.

export async function parseImport(
  businessId: string,
  orderListId: string,
  text: string,
): Promise<ParsedImport> {
  await assertExists(businessId, orderListId)
  return parseImportText(text)
}

export async function importLines(
  businessId: string,
  orderListId: string,
  lines: OrderLineCreate[],
  ctx: AuditCtx,
): Promise<OrderListLineWithSystemName[]> {
  const inserted = await db.transaction(async (tx) => {
    await assertExists(businessId, orderListId, tx)

    const base = await repo.nextPosition(businessId, orderListId, tx)

    const inserted = await repo.insertLines(
      lines.map((line, i) => ({
        businessId,
        orderListId,
        position: base + i,
        itemName: line.itemName,
        qty: line.qty,
        uom: line.uom,
        note: line.note ?? null,
        additionalNote: line.additionalNote ?? null,
      })),
      tx,
    )

    await audit.record(
      'order_list.import',
      'order_list',
      orderListId,
      null,
      { count: inserted.length },
      ctx,
      tx,
    )

    return inserted
  })

  return withSystemNames(businessId, inserted)
}

// ─── patchLine ────────────────────────────────────────────────────────────────

export async function patchLine(
  businessId: string,
  orderListId: string,
  lineId: string,
  data: OrderLinePatch,
  ctx: AuditCtx,
): Promise<OrderListLineWithSystemName> {
  const updated = await db.transaction(async (tx) => {
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

  const [enriched] = await withSystemNames(businessId, [updated])
  if (!enriched) throw new Error('patchLine: enrichment returned no row')
  return enriched
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
