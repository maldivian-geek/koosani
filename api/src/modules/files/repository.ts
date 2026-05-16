import { and, eq } from 'drizzle-orm'
import { db } from '../../db/client.js'
import type { DbTx } from '../../db/client.js'
import { files } from '../../db/schema/index.js'
import type { File, NewFile } from '../../db/schema/index.js'

export type { File, NewFile }

export async function insertFile(data: NewFile, tx?: DbTx): Promise<File> {
  const q = tx ?? db
  const [row] = await q.insert(files).values(data).returning()
  return row!
}

export async function findById(businessId: string, id: string, tx?: DbTx): Promise<File | null> {
  const q = tx ?? db
  const [row] = await q
    .select()
    .from(files)
    .where(and(eq(files.businessId, businessId), eq(files.id, id)))
  return row ?? null
}

export async function attachToEntity(
  businessId: string,
  fileId: string,
  entityType: string,
  entityId: string,
  tx?: DbTx,
): Promise<void> {
  const q = tx ?? db
  await q
    .update(files)
    .set({ entityType, entityId })
    .where(and(eq(files.businessId, businessId), eq(files.id, fileId)))
}
