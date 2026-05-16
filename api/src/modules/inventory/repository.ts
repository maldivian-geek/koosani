import { and, count, desc, eq, gte, isNotNull, isNull, lte, sql } from 'drizzle-orm'
import Decimal from 'decimal.js'
import { db } from '../../db/client.js'
import type { DbTx } from '../../db/client.js'
import { stockMovements, items, businesses } from '../../db/schema/index.js'
import type { NewStockMovement, StockMovement } from '../../db/schema/index.js'

export type { StockMovement }

export type ListMovementsParams = {
  itemId: string | undefined
  from: Date | undefined
  to: Date | undefined
  page: number
  pageSize: number
}

export type OnHandRow = {
  itemId: string
  sku: string
  name: string
  unit: string
  stockOnHand: string
  reorderPoint: string | null
}

// ─── Movements ────────────────────────────────────────────────────────────────

export async function insertMovement(
  data: Omit<NewStockMovement, 'id' | 'createdAt' | 'movedAt'>,
  tx: DbTx,
): Promise<StockMovement> {
  const [row] = await tx.insert(stockMovements).values(data).returning()
  if (!row) throw new Error('insert movement: no row returned')
  return row
}

export async function listMovements(
  businessId: string,
  { itemId, from, to, page, pageSize }: ListMovementsParams,
): Promise<{ rows: StockMovement[]; total: number }> {
  const where = and(
    eq(stockMovements.businessId, businessId),
    itemId ? eq(stockMovements.itemId, itemId) : undefined,
    from ? gte(stockMovements.movedAt, from) : undefined,
    to ? lte(stockMovements.movedAt, to) : undefined,
  )

  const [totalRow, rows] = await Promise.all([
    db.select({ total: count() }).from(stockMovements).where(where),
    db
      .select()
      .from(stockMovements)
      .where(where)
      .orderBy(desc(stockMovements.movedAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
  ])

  return { rows, total: totalRow[0]?.total ?? 0 }
}

// ─── On-hand ──────────────────────────────────────────────────────────────────

export async function listOnHand(
  businessId: string,
  { categoryId, belowReorder }: { categoryId: string | undefined; belowReorder: boolean },
): Promise<OnHandRow[]> {
  const where = and(
    eq(items.businessId, businessId),
    isNull(items.deletedAt),
    categoryId ? eq(items.categoryId, categoryId) : undefined,
    belowReorder
      ? and(isNotNull(items.reorderPoint), sql`${items.stockOnHand} < ${items.reorderPoint}`)
      : undefined,
  )

  return db
    .select({
      itemId: items.id,
      sku: items.sku,
      name: items.name,
      unit: items.unit,
      stockOnHand: items.stockOnHand,
      reorderPoint: items.reorderPoint,
    })
    .from(items)
    .where(where)
    .orderBy(items.name)
}

// ─── Helpers used by service / worker ─────────────────────────────────────────

// Returns null if the item does not exist in this business
export async function getItemOnHand(
  businessId: string,
  itemId: string,
  tx: DbTx,
): Promise<string | null> {
  const [row] = await tx
    .select({ stockOnHand: items.stockOnHand })
    .from(items)
    .where(and(eq(items.businessId, businessId), eq(items.id, itemId)))
  return row?.stockOnHand ?? null
}

// Used by nightly reconcile job (ARCHITECTURE.md §8)
export async function recomputeOnHand(
  businessId: string,
  itemId: string,
  tx: DbTx,
): Promise<Decimal> {
  const [row] = await tx
    .select({ total: sql<string>`COALESCE(SUM(qty), '0')` })
    .from(stockMovements)
    .where(and(eq(stockMovements.businessId, businessId), eq(stockMovements.itemId, itemId)))
  return new Decimal(row?.total ?? '0')
}

export async function getBackorderFlag(businessId: string): Promise<boolean> {
  const [row] = await db
    .select({ allowBackorders: businesses.allowBackorders })
    .from(businesses)
    .where(eq(businesses.id, businessId))
  return row?.allowBackorders ?? false
}

export async function listActiveItemIds(
  businessId: string,
): Promise<Array<{ id: string; sku: string; stockOnHand: string }>> {
  return db
    .select({ id: items.id, sku: items.sku, stockOnHand: items.stockOnHand })
    .from(items)
    .where(and(eq(items.businessId, businessId), isNull(items.deletedAt)))
}
