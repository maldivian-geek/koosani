import { and, count, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { db } from '../../db/client.js'
import type { DbTx } from '../../db/client.js'
import { suppliers, supplierContacts, bills } from '../../db/schema/index.js'
import type { NewSupplier } from '../../db/schema/index.js'

export type SupplierRow = typeof suppliers.$inferSelect
export type SupplierContactRow = typeof supplierContacts.$inferSelect

export type ListParams = {
  q: string | undefined
  page: number
  pageSize: number
  active: boolean | undefined
}

// ─── List / lookup ────────────────────────────────────────────────────────────

export async function listSuppliers(
  businessId: string,
  { q, page, pageSize, active }: ListParams,
): Promise<{ rows: SupplierRow[]; total: number }> {
  const where = and(
    eq(suppliers.businessId, businessId),
    active === false ? isNotNull(suppliers.deletedAt) : isNull(suppliers.deletedAt),
    q ? or(ilike(suppliers.name, `%${q}%`), ilike(suppliers.email, `%${q}%`)) : undefined,
  )

  const [totalRow, rows] = await Promise.all([
    db.select({ total: count() }).from(suppliers).where(where),
    db
      .select()
      .from(suppliers)
      .where(where)
      .orderBy(desc(suppliers.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
  ])

  return { rows, total: totalRow[0]?.total ?? 0 }
}

export async function findSupplierById(
  businessId: string,
  id: string,
): Promise<SupplierRow | undefined> {
  const [row] = await db
    .select()
    .from(suppliers)
    .where(and(eq(suppliers.businessId, businessId), eq(suppliers.id, id)))
  return row
}

// ─── Write ────────────────────────────────────────────────────────────────────

export async function insertSupplier(
  data: Omit<NewSupplier, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<SupplierRow> {
  const [row] = await db.insert(suppliers).values(data).returning()
  if (!row) throw new Error('insert supplier: no row returned')
  return row
}

export async function updateSupplier(
  businessId: string,
  id: string,
  data: Partial<Omit<NewSupplier, 'id' | 'businessId' | 'createdAt' | 'updatedAt' | 'createdBy'>>,
  tx: DbTx,
): Promise<SupplierRow> {
  const [row] = await tx
    .update(suppliers)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(suppliers.businessId, businessId), eq(suppliers.id, id)))
    .returning()
  if (!row) throw new Error('update supplier: no row returned')
  return row
}

export async function softDeleteSupplier(
  businessId: string,
  id: string,
  userId: string,
  tx: DbTx,
): Promise<void> {
  await tx
    .update(suppliers)
    .set({ deletedAt: new Date(), updatedBy: userId, updatedAt: new Date() })
    .where(and(eq(suppliers.businessId, businessId), eq(suppliers.id, id)))
}

// ─── Contacts ─────────────────────────────────────────────────────────────────

export async function listSupplierContacts(
  businessId: string,
  supplierId: string,
): Promise<SupplierContactRow[]> {
  return db
    .select()
    .from(supplierContacts)
    .where(
      and(eq(supplierContacts.businessId, businessId), eq(supplierContacts.supplierId, supplierId)),
    )
    .orderBy(desc(supplierContacts.isPrimary), desc(supplierContacts.createdAt))
}

export async function insertSupplierContact(
  data: Omit<typeof supplierContacts.$inferInsert, 'id' | 'createdAt' | 'updatedAt'>,
  tx: DbTx,
): Promise<SupplierContactRow> {
  const [row] = await tx.insert(supplierContacts).values(data).returning()
  if (!row) throw new Error('insert supplier contact: no row returned')
  return row
}

// ─── Delete guards ────────────────────────────────────────────────────────────

export async function hasDraftBills(businessId: string, supplierId: string): Promise<boolean> {
  const [row] = await db
    .select({ n: count() })
    .from(bills)
    .where(
      and(
        eq(bills.businessId, businessId),
        eq(bills.supplierId, supplierId),
        eq(bills.status, 'draft'),
      ),
    )
  return (row?.n ?? 0) > 0
}

// Returns the two components needed to compute outstanding payables:
// - billOwed: SUM(total − paid_amount) for confirmed/partially_paid bills
// Both are NUMERIC strings; caller uses Decimal for math (ARCHITECTURE.md §4.1).
export async function supplierBalanceComponents(
  businessId: string,
  supplierId: string,
): Promise<{ billOwed: string }> {
  const [row] = await db
    .select({ amount: sql<string>`COALESCE(SUM(total - paid_amount), '0')` })
    .from(bills)
    .where(
      and(
        eq(bills.businessId, businessId),
        eq(bills.supplierId, supplierId),
        inArray(bills.status, ['confirmed', 'partially_paid']),
      ),
    )
  return { billOwed: row?.amount ?? '0' }
}
