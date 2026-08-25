import {
  and,
  count,
  desc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  notInArray,
  or,
  sql,
} from 'drizzle-orm'
import Decimal from 'decimal.js'
import { db } from '../../db/client.js'
import type { DbTx } from '../../db/client.js'
import {
  items,
  itemCategories,
  invoiceLines,
  invoices,
  billLines,
  bills,
  poLines,
  purchaseOrders,
} from '../../db/schema/index.js'
import type { NewItem } from '../../db/schema/index.js'

export type ItemRow = typeof items.$inferSelect
export type CategoryRow = typeof itemCategories.$inferSelect

export type ListParams = {
  q: string | undefined
  categoryId: string | undefined
  active: boolean | undefined
  page: number
  pageSize: number
}

// ─── List / lookup ────────────────────────────────────────────────────────────

// Case-insensitive lookup by customer_item_name — used (via the items service)
// to resolve an order-list line's customer wording to the catalogue item.
// namesLower must already be lowercased/trimmed by the caller.
export async function findByCustomerItemNames(
  businessId: string,
  namesLower: string[],
): Promise<Array<{ id: string; name: string; customerItemName: string | null }>> {
  if (namesLower.length === 0) return []
  return db
    .select({ id: items.id, name: items.name, customerItemName: items.customerItemName })
    .from(items)
    .where(
      and(
        eq(items.businessId, businessId),
        isNull(items.deletedAt),
        isNotNull(items.customerItemName),
        inArray(sql`lower(${items.customerItemName})`, namesLower),
      ),
    )
    .orderBy(items.name)
}

export async function listItems(
  businessId: string,
  { q, categoryId, active, page, pageSize }: ListParams,
): Promise<{ rows: ItemRow[]; total: number }> {
  const where = and(
    eq(items.businessId, businessId),
    active === false ? isNotNull(items.deletedAt) : isNull(items.deletedAt),
    q ? or(ilike(items.name, `%${q}%`), ilike(items.sku, `%${q}%`)) : undefined,
    categoryId ? eq(items.categoryId, categoryId) : undefined,
  )

  const [totalRow, rows] = await Promise.all([
    db.select({ total: count() }).from(items).where(where),
    db
      .select()
      .from(items)
      .where(where)
      .orderBy(desc(items.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
  ])

  return { rows, total: totalRow[0]?.total ?? 0 }
}

export async function findItemById(businessId: string, id: string): Promise<ItemRow | undefined> {
  const [row] = await db
    .select()
    .from(items)
    .where(and(eq(items.businessId, businessId), eq(items.id, id)))
  return row
}

// ─── Categories ───────────────────────────────────────────────────────────────

export async function listCategories(businessId: string): Promise<CategoryRow[]> {
  return db
    .select()
    .from(itemCategories)
    .where(eq(itemCategories.businessId, businessId))
    .orderBy(itemCategories.name)
}

export async function findCategoryById(
  businessId: string,
  id: string,
): Promise<CategoryRow | undefined> {
  const [row] = await db
    .select()
    .from(itemCategories)
    .where(and(eq(itemCategories.businessId, businessId), eq(itemCategories.id, id)))
  return row
}

export async function insertCategory(
  data: Omit<typeof itemCategories.$inferInsert, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<CategoryRow> {
  const [row] = await db.insert(itemCategories).values(data).returning()
  if (!row) throw new Error('insert category: no row returned')
  return row
}

// ─── Write ────────────────────────────────────────────────────────────────────

export async function insertItem(
  data: Omit<NewItem, 'id' | 'createdAt' | 'updatedAt' | 'stockOnHand'>,
): Promise<ItemRow> {
  const [row] = await db.insert(items).values(data).returning()
  if (!row) throw new Error('insert item: no row returned')
  return row
}

export async function updateItem(
  businessId: string,
  id: string,
  data: Partial<
    Omit<NewItem, 'id' | 'businessId' | 'createdAt' | 'updatedAt' | 'createdBy' | 'stockOnHand'>
  >,
  tx: DbTx,
): Promise<ItemRow> {
  const [row] = await tx
    .update(items)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(items.businessId, businessId), eq(items.id, id)))
    .returning()
  if (!row) throw new Error('update item: no row returned')
  return row
}

export async function softDeleteItem(
  businessId: string,
  id: string,
  userId: string,
  tx: DbTx,
): Promise<void> {
  await tx
    .update(items)
    .set({ deletedAt: new Date(), updatedBy: userId, updatedAt: new Date() })
    .where(and(eq(items.businessId, businessId), eq(items.id, id)))
}

// ─── SKU uniqueness check ─────────────────────────────────────────────────────

export async function skuExists(
  businessId: string,
  sku: string,
  excludeId: string | undefined,
): Promise<boolean> {
  const where = and(
    eq(items.businessId, businessId),
    eq(items.sku, sku),
    isNull(items.deletedAt),
    excludeId ? sql`${items.id} != ${excludeId}` : undefined,
  )
  const [row] = await db.select({ n: count() }).from(items).where(where)
  return (row?.n ?? 0) > 0
}

// ─── Delete guards ────────────────────────────────────────────────────────────

// Item can be deleted only if: stock_on_hand = 0 AND no active references
export async function hasPositiveStock(businessId: string, id: string): Promise<boolean> {
  const [row] = await db
    .select({ qty: items.stockOnHand })
    .from(items)
    .where(and(eq(items.businessId, businessId), eq(items.id, id)))
  const qty = row?.qty ?? '0'
  return new Decimal(qty).gt(0)
}

export async function hasActiveReferences(businessId: string, id: string): Promise<boolean> {
  // Draft invoice lines
  const [invRow] = await db
    .select({ n: count() })
    .from(invoiceLines)
    .innerJoin(invoices, and(eq(invoiceLines.invoiceId, invoices.id), eq(invoices.status, 'draft')))
    .where(and(eq(invoiceLines.businessId, businessId), eq(invoiceLines.itemId, id)))

  if ((invRow?.n ?? 0) > 0) return true

  // Draft bill lines
  const [billRow] = await db
    .select({ n: count() })
    .from(billLines)
    .innerJoin(bills, and(eq(billLines.billId, bills.id), eq(bills.status, 'draft')))
    .where(and(eq(billLines.businessId, businessId), eq(billLines.itemId, id)))

  if ((billRow?.n ?? 0) > 0) return true

  // Non-cancelled PO lines
  const [poRow] = await db
    .select({ n: count() })
    .from(poLines)
    .innerJoin(
      purchaseOrders,
      and(eq(poLines.poId, purchaseOrders.id), notInArray(purchaseOrders.status, ['cancelled'])),
    )
    .where(and(eq(poLines.businessId, businessId), eq(poLines.itemId, id)))

  return (poRow?.n ?? 0) > 0
}
