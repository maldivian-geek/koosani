import { and, count, desc, eq, gte, isNull, isNotNull, lte, or } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { expenses } from '../../db/schema/index.js'
import type { Expense, NewExpense } from '../../db/schema/index.js'
import type { DbTx } from '../../db/client.js'

export type { Expense }

export async function getById(businessId: string, id: string, tx?: DbTx): Promise<Expense | null> {
  const q = tx ?? db
  const [row] = await q
    .select()
    .from(expenses)
    .where(and(eq(expenses.businessId, businessId), eq(expenses.id, id)))
  return row ?? null
}

export type ListExpenseParams = {
  category: string | undefined
  supplierId: string | undefined
  customerId: string | undefined
  billable: boolean | undefined
  invoiced: boolean | undefined
  from: string | undefined
  to: string | undefined
  page: number
  pageSize: number
}

export async function listExpenses(
  businessId: string,
  params: ListExpenseParams,
): Promise<{ rows: Expense[]; total: number }> {
  const where = and(
    eq(expenses.businessId, businessId),
    params.category ? eq(expenses.category, params.category) : undefined,
    params.supplierId ? eq(expenses.supplierId, params.supplierId) : undefined,
    params.customerId ? eq(expenses.customerId, params.customerId) : undefined,
    params.billable !== undefined ? eq(expenses.billable, params.billable) : undefined,
    params.invoiced === true
      ? isNotNull(expenses.invoicedAt)
      : params.invoiced === false
        ? isNull(expenses.invoicedAt)
        : undefined,
    params.from ? gte(expenses.expenseDate, params.from) : undefined,
    params.to ? lte(expenses.expenseDate, params.to) : undefined,
  )

  const [totalRow, rows] = await Promise.all([
    db.select({ total: count() }).from(expenses).where(where),
    db
      .select()
      .from(expenses)
      .where(where)
      .orderBy(desc(expenses.expenseDate), desc(expenses.createdAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
  ])

  return { rows, total: totalRow[0]?.total ?? 0 }
}

export async function insertExpense(
  data: Omit<NewExpense, 'id' | 'createdAt' | 'updatedAt'>,
  tx?: DbTx,
): Promise<Expense> {
  const q = tx ?? db
  const [row] = await q.insert(expenses).values(data).returning()
  if (!row) throw new Error('insertExpense: no row returned')
  return row
}

export async function updateExpense(
  businessId: string,
  id: string,
  data: Partial<Omit<NewExpense, 'id' | 'businessId' | 'createdAt' | 'createdBy'>>,
  tx?: DbTx,
): Promise<Expense> {
  const q = tx ?? db
  const [row] = await q
    .update(expenses)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(expenses.businessId, businessId), eq(expenses.id, id)))
    .returning()
  if (!row) throw new Error('updateExpense: no row returned')
  return row
}

export async function deleteExpense(businessId: string, id: string, tx?: DbTx): Promise<void> {
  const q = tx ?? db
  await q.delete(expenses).where(and(eq(expenses.businessId, businessId), eq(expenses.id, id)))
}

// Uninvoiced billable expenses for a customer — used by the invoice editor to
// prefill line items (Phase 31, UPGRADE.md G-11's "billable → invoice line").
export async function listUninvoicedBillable(
  businessId: string,
  customerId: string,
): Promise<Expense[]> {
  return db
    .select()
    .from(expenses)
    .where(
      and(
        eq(expenses.businessId, businessId),
        eq(expenses.customerId, customerId),
        eq(expenses.billable, true),
        isNull(expenses.invoicedAt),
      ),
    )
    .orderBy(expenses.expenseDate)
}

// Locks the rows until the caller's tx commits, so two concurrent
// "add to invoice" attempts on the same expense can't both succeed.
export async function getManyForUpdate(
  businessId: string,
  ids: string[],
  tx: DbTx,
): Promise<Expense[]> {
  if (ids.length === 0) return []
  return tx
    .select()
    .from(expenses)
    .where(and(eq(expenses.businessId, businessId), or(...ids.map((id) => eq(expenses.id, id)))))
    .for('update')
}
