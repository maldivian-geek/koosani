import { and, count, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm'
import { db } from '../../db/client.js'
import type { DbTx } from '../../db/client.js'
import { customers, customerContacts, invoices, creditNotes } from '../../db/schema/index.js'
import type { NewCustomer } from '../../db/schema/index.js'

export type CustomerRow = typeof customers.$inferSelect
export type ContactRow = typeof customerContacts.$inferSelect

export type ListParams = {
  q: string | undefined
  page: number
  pageSize: number
  active: boolean | undefined
}

// ─── List / lookup ────────────────────────────────────────────────────────────

export async function listCustomers(
  businessId: string,
  { q, page, pageSize, active }: ListParams,
): Promise<{ rows: CustomerRow[]; total: number }> {
  const where = and(
    eq(customers.businessId, businessId),
    active === false ? isNotNull(customers.deletedAt) : isNull(customers.deletedAt),
    q ? or(ilike(customers.name, `%${q}%`), ilike(customers.email, `%${q}%`)) : undefined,
  )

  const [totalRow, rows] = await Promise.all([
    db.select({ total: count() }).from(customers).where(where),
    db
      .select()
      .from(customers)
      .where(where)
      .orderBy(desc(customers.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize),
  ])

  return { rows, total: totalRow[0]?.total ?? 0 }
}

export async function findCustomerById(
  businessId: string,
  id: string,
): Promise<CustomerRow | undefined> {
  const [row] = await db
    .select()
    .from(customers)
    .where(and(eq(customers.businessId, businessId), eq(customers.id, id)))
  return row
}

// ─── Write ────────────────────────────────────────────────────────────────────

export async function insertCustomer(
  data: Omit<NewCustomer, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<CustomerRow> {
  const [row] = await db.insert(customers).values(data).returning()
  if (!row) throw new Error('insert customer: no row returned')
  return row
}

export async function updateCustomer(
  businessId: string,
  id: string,
  data: Partial<Omit<NewCustomer, 'id' | 'businessId' | 'createdAt' | 'updatedAt' | 'createdBy'>>,
  tx: DbTx,
): Promise<CustomerRow> {
  const [row] = await tx
    .update(customers)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(customers.businessId, businessId), eq(customers.id, id)))
    .returning()
  if (!row) throw new Error('update customer: no row returned')
  return row
}

export async function softDeleteCustomer(
  businessId: string,
  id: string,
  userId: string,
  tx: DbTx,
): Promise<void> {
  await tx
    .update(customers)
    .set({ deletedAt: new Date(), updatedBy: userId, updatedAt: new Date() })
    .where(and(eq(customers.businessId, businessId), eq(customers.id, id)))
}

// ─── Contacts ─────────────────────────────────────────────────────────────────

export async function listContacts(businessId: string, customerId: string): Promise<ContactRow[]> {
  return db
    .select()
    .from(customerContacts)
    .where(
      and(eq(customerContacts.businessId, businessId), eq(customerContacts.customerId, customerId)),
    )
    .orderBy(desc(customerContacts.isPrimary), desc(customerContacts.createdAt))
}

export async function insertContact(
  data: Omit<typeof customerContacts.$inferInsert, 'id' | 'createdAt' | 'updatedAt'>,
  tx: DbTx,
): Promise<ContactRow> {
  const [row] = await tx.insert(customerContacts).values(data).returning()
  if (!row) throw new Error('insert contact: no row returned')
  return row
}

// ─── Delete guards ────────────────────────────────────────────────────────────

export async function hasDraftInvoices(businessId: string, customerId: string): Promise<boolean> {
  const [row] = await db
    .select({ n: count() })
    .from(invoices)
    .where(
      and(
        eq(invoices.businessId, businessId),
        eq(invoices.customerId, customerId),
        eq(invoices.status, 'draft'),
      ),
    )
  return (row?.n ?? 0) > 0
}

// Returns the two components the service uses to compute outstanding balance:
// - invoiceOwed: SUM(total − paid_amount) for issued/partially_paid invoices
// - creditNoteTotal: SUM(total) for issued credit notes
// Both are NUMERIC strings; caller uses Decimal for subtraction (ARCHITECTURE.md §4.1).
export async function customerBalanceComponents(
  businessId: string,
  customerId: string,
): Promise<{ invoiceOwed: string; creditNoteTotal: string }> {
  const [invRow] = await db
    .select({ amount: sql<string>`COALESCE(SUM(total - paid_amount), '0')` })
    .from(invoices)
    .where(
      and(
        eq(invoices.businessId, businessId),
        eq(invoices.customerId, customerId),
        inArray(invoices.status, ['issued', 'partially_paid']),
      ),
    )

  const [cnRow] = await db
    .select({ amount: sql<string>`COALESCE(SUM(total), '0')` })
    .from(creditNotes)
    .where(
      and(
        eq(creditNotes.businessId, businessId),
        eq(creditNotes.customerId, customerId),
        eq(creditNotes.status, 'issued'),
      ),
    )

  return {
    invoiceOwed: invRow?.amount ?? '0',
    creditNoteTotal: cnRow?.amount ?? '0',
  }
}
