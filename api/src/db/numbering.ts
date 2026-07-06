import { sql } from 'drizzle-orm'
import type { DbTx } from './client.js'

// Shared by invoicing/purchases/po repositories to allocate gap-free,
// per-business document numbers with a configurable prefix (Phase 22,
// UPGRADE.md G-15). Table/column names here are internal constants, never
// user input, so sql.identifier() is safe.
//
// Numbers are 6-digit zero-padded. The MAX is computed only over rows whose
// number already starts with the *current* prefix — so changing a business's
// prefix restarts that document type's sequence at 1 instead of risking a
// SUBSTRING offset mismatch against rows written under a different-length
// prefix (see businesses.ts comment).
export async function allocateDocumentNumber(
  tx: DbTx,
  businessId: string,
  lockKey: string,
  tableName: string,
  numberColumn: string,
  prefixColumn: string,
): Promise<string> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${businessId} || ${lockKey}))`)

  const [row] = await tx.execute<{ prefix: string; max_num: string }>(
    sql`SELECT
          b.${sql.identifier(prefixColumn)} AS prefix,
          COALESCE(MAX(CAST(SUBSTRING(d.${sql.identifier(numberColumn)}, LENGTH(b.${sql.identifier(prefixColumn)}) + 1) AS INTEGER)), 0) AS max_num
        FROM businesses b
        LEFT JOIN ${sql.identifier(tableName)} d
          ON d.business_id = b.id
          AND d.${sql.identifier(numberColumn)} LIKE b.${sql.identifier(prefixColumn)} || '%'
        WHERE b.id = ${businessId}
        GROUP BY b.${sql.identifier(prefixColumn)}`,
  )
  const prefix = row?.prefix ?? ''
  const next = Number(row?.max_num ?? '0') + 1
  return `${prefix}${String(next).padStart(6, '0')}`
}
