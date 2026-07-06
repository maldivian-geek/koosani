import Decimal from 'decimal.js'
import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '../../db/client.js'
import type { DbTx } from '../../db/client.js'
import { customerCredits } from '../../db/schema/index.js'
import type { CustomerCredit, NewCustomerCredit } from '../../db/schema/index.js'

export type { CustomerCredit, NewCustomerCredit }

export async function insertEntry(data: NewCustomerCredit, tx: DbTx): Promise<CustomerCredit> {
  const [row] = await tx.insert(customerCredits).values(data).returning()
  if (!row) throw new Error('insertEntry: no row returned')
  return row
}

export async function listLedger(
  businessId: string,
  customerId: string,
): Promise<CustomerCredit[]> {
  return db
    .select()
    .from(customerCredits)
    .where(
      and(eq(customerCredits.businessId, businessId), eq(customerCredits.customerId, customerId)),
    )
    .orderBy(desc(customerCredits.createdAt))
}

export async function getBalance(
  businessId: string,
  customerId: string,
  tx?: DbTx,
): Promise<string> {
  const q = tx ?? db
  const [row] = await q
    .select({ total: sql<string>`COALESCE(SUM(amount), '0')` })
    .from(customerCredits)
    .where(
      and(eq(customerCredits.businessId, businessId), eq(customerCredits.customerId, customerId)),
    )
  // COALESCE's fallback isn't numeric(15,2)-typed like a real summed row would
  // be, so an empty ledger returns a bare '0' instead of '0.00' — normalize
  // through Decimal rather than relying on Postgres's aggregate typing.
  return new Decimal(row?.total ?? '0').toFixed(2)
}

// Serializes concurrent credit consumption/grants for the same customer, so
// two concurrent "apply credit" requests can't both read a balance that's
// sufficient for either alone but not both (mirrors db/numbering.ts's
// per-business advisory lock pattern).
export async function lockCustomerCredits(
  businessId: string,
  customerId: string,
  tx: DbTx,
): Promise<void> {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${businessId} || ${customerId} || ':credit'))`,
  )
}
