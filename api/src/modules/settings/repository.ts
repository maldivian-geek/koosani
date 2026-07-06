import { eq } from 'drizzle-orm'
import { db } from '../../db/client.js'
import type { DbTx } from '../../db/client.js'
import { businesses } from '../../db/schema/index.js'
import type { Business } from '../../db/schema/index.js'

export type { Business }

export async function getBusiness(businessId: string): Promise<Business | null> {
  const [row] = await db.select().from(businesses).where(eq(businesses.id, businessId))
  return row ?? null
}

export async function updateBusiness(
  businessId: string,
  patch: Record<string, unknown>,
  tx: DbTx,
): Promise<Business> {
  const [row] = await tx
    .update(businesses)
    .set(patch)
    .where(eq(businesses.id, businessId))
    .returning()
  if (!row) throw new Error(`updateBusiness: no row for ${businessId}`)
  return row
}
