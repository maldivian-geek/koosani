import { and, count, desc, eq, ilike, isNull, max } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { orderLists, orderListLines } from '../../db/schema/index.js'
import type {
  OrderList,
  NewOrderList,
  OrderListLine,
  NewOrderListLine,
} from '../../db/schema/index.js'
import type { DbTx } from '../../db/client.js'

export type { OrderList, OrderListLine }

// ─── Order list reads ──────────────────────────────────────────────────────────

export async function getById(
  businessId: string,
  id: string,
  tx?: DbTx,
): Promise<OrderList | null> {
  const q = tx ?? db
  const [row] = await q
    .select()
    .from(orderLists)
    .where(and(eq(orderLists.businessId, businessId), eq(orderLists.id, id)))
  return row ?? null
}

export type ListOrderListParams = {
  q: string | undefined
  page: number
  pageSize: number
}

export type OrderListWithLineCount = OrderList & { lineCount: number }

export async function listOrderLists(
  businessId: string,
  params: ListOrderListParams,
): Promise<{ rows: OrderListWithLineCount[]; total: number }> {
  const where = and(
    eq(orderLists.businessId, businessId),
    isNull(orderLists.deletedAt),
    params.q ? ilike(orderLists.title, `%${params.q}%`) : undefined,
  )

  const [totalRow, rows] = await Promise.all([
    db.select({ total: count() }).from(orderLists).where(where),
    db
      .select({
        id: orderLists.id,
        businessId: orderLists.businessId,
        title: orderLists.title,
        notes: orderLists.notes,
        deletedAt: orderLists.deletedAt,
        createdAt: orderLists.createdAt,
        updatedAt: orderLists.updatedAt,
        createdBy: orderLists.createdBy,
        updatedBy: orderLists.updatedBy,
        lineCount: count(orderListLines.id),
      })
      .from(orderLists)
      .leftJoin(orderListLines, eq(orderListLines.orderListId, orderLists.id))
      .where(where)
      .groupBy(orderLists.id)
      .orderBy(desc(orderLists.updatedAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
  ])

  return { rows, total: totalRow[0]?.total ?? 0 }
}

// ─── Order list writes ─────────────────────────────────────────────────────────

export async function insertOrderList(
  data: Omit<NewOrderList, 'id' | 'createdAt' | 'updatedAt'>,
  tx: DbTx,
): Promise<OrderList> {
  const [row] = await tx.insert(orderLists).values(data).returning()
  if (!row) throw new Error('insertOrderList: no row returned')
  return row
}

export async function updateOrderList(
  businessId: string,
  id: string,
  data: Partial<Omit<NewOrderList, 'id' | 'businessId' | 'createdAt' | 'createdBy'>>,
  tx: DbTx,
): Promise<OrderList> {
  const [row] = await tx
    .update(orderLists)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(orderLists.businessId, businessId), eq(orderLists.id, id)))
    .returning()
  if (!row) throw new Error('updateOrderList: no row returned')
  return row
}

export async function softDeleteOrderList(
  businessId: string,
  id: string,
  userId: string,
  tx: DbTx,
): Promise<void> {
  await tx
    .update(orderLists)
    .set({ deletedAt: new Date(), updatedBy: userId, updatedAt: new Date() })
    .where(and(eq(orderLists.businessId, businessId), eq(orderLists.id, id)))
}

// ─── Lines ──────────────────────────────────────────────────────────────────────

export async function getLinesByOrderList(
  businessId: string,
  orderListId: string,
  tx?: DbTx,
): Promise<OrderListLine[]> {
  const q = tx ?? db
  return q
    .select()
    .from(orderListLines)
    .where(
      and(eq(orderListLines.businessId, businessId), eq(orderListLines.orderListId, orderListId)),
    )
    .orderBy(orderListLines.position)
}

export async function getLineById(
  businessId: string,
  orderListId: string,
  lineId: string,
  tx?: DbTx,
): Promise<OrderListLine | null> {
  const q = tx ?? db
  const [row] = await q
    .select()
    .from(orderListLines)
    .where(
      and(
        eq(orderListLines.businessId, businessId),
        eq(orderListLines.orderListId, orderListId),
        eq(orderListLines.id, lineId),
      ),
    )
  return row ?? null
}

// Insertion order — the next position is simply the current max + 1 (never
// rewritten on delete, so gaps from removed lines are fine; no reorder UI
// exists in this phase).
export async function nextPosition(
  businessId: string,
  orderListId: string,
  tx: DbTx,
): Promise<number> {
  const [row] = await tx
    .select({ max: max(orderListLines.position) })
    .from(orderListLines)
    .where(
      and(eq(orderListLines.businessId, businessId), eq(orderListLines.orderListId, orderListId)),
    )
  return (row?.max ?? -1) + 1
}

export async function insertLine(
  data: Omit<NewOrderListLine, 'id' | 'createdAt' | 'updatedAt'>,
  tx: DbTx,
): Promise<OrderListLine> {
  const [row] = await tx.insert(orderListLines).values(data).returning()
  if (!row) throw new Error('insertLine: no row returned')
  return row
}

export async function insertLines(
  rows: Array<Omit<NewOrderListLine, 'id' | 'createdAt' | 'updatedAt'>>,
  tx: DbTx,
): Promise<OrderListLine[]> {
  if (rows.length === 0) return []
  return tx.insert(orderListLines).values(rows).returning()
}

export async function updateLine(
  businessId: string,
  orderListId: string,
  lineId: string,
  data: Partial<Omit<NewOrderListLine, 'id' | 'businessId' | 'orderListId' | 'createdAt'>>,
  tx: DbTx,
): Promise<OrderListLine> {
  const [row] = await tx
    .update(orderListLines)
    .set({ ...data, updatedAt: new Date() })
    .where(
      and(
        eq(orderListLines.businessId, businessId),
        eq(orderListLines.orderListId, orderListId),
        eq(orderListLines.id, lineId),
      ),
    )
    .returning()
  if (!row) throw new Error('updateLine: no row returned')
  return row
}

export async function deleteLine(
  businessId: string,
  orderListId: string,
  lineId: string,
  tx: DbTx,
): Promise<void> {
  await tx
    .delete(orderListLines)
    .where(
      and(
        eq(orderListLines.businessId, businessId),
        eq(orderListLines.orderListId, orderListId),
        eq(orderListLines.id, lineId),
      ),
    )
}
