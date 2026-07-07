import { and, eq } from 'drizzle-orm'
import { db } from '../../db/client.js'
import type { DbTx } from '../../db/client.js'
import { customFieldDefinitions, customFieldValues } from '../../db/schema/index.js'
import type { CustomFieldDefinition, CustomFieldValue } from '../../db/schema/index.js'

export type { CustomFieldDefinition, CustomFieldValue }

// ─── Definitions ──────────────────────────────────────────────────────────────

export async function getDefinitionById(
  businessId: string,
  id: string,
  tx?: DbTx,
): Promise<CustomFieldDefinition | null> {
  const q = tx ?? db
  const [row] = await q
    .select()
    .from(customFieldDefinitions)
    .where(
      and(eq(customFieldDefinitions.businessId, businessId), eq(customFieldDefinitions.id, id)),
    )
  return row ?? null
}

export async function listDefinitions(
  businessId: string,
  docType: string,
): Promise<CustomFieldDefinition[]> {
  return db
    .select()
    .from(customFieldDefinitions)
    .where(
      and(
        eq(customFieldDefinitions.businessId, businessId),
        eq(customFieldDefinitions.docType, docType as CustomFieldDefinition['docType']),
      ),
    )
    .orderBy(customFieldDefinitions.sortOrder)
}

type NewDefinition = {
  businessId: string
  docType: CustomFieldDefinition['docType']
  fieldName: string
  fieldLabel: string
  fieldType: CustomFieldDefinition['fieldType']
  sortOrder?: number
  createdBy: string
}

export async function insertDefinition(
  data: NewDefinition,
  tx: DbTx,
): Promise<CustomFieldDefinition> {
  const [row] = await tx
    .insert(customFieldDefinitions)
    .values({ ...data, updatedBy: data.createdBy })
    .returning()
  if (!row) throw new Error('insertDefinition: no row returned')
  return row
}

export async function updateDefinition(
  businessId: string,
  id: string,
  data: { fieldLabel?: string; sortOrder?: number; updatedBy: string },
  tx: DbTx,
): Promise<CustomFieldDefinition> {
  const [row] = await tx
    .update(customFieldDefinitions)
    .set({ ...data, updatedAt: new Date() })
    .where(
      and(eq(customFieldDefinitions.businessId, businessId), eq(customFieldDefinitions.id, id)),
    )
    .returning()
  if (!row) throw new Error('updateDefinition: no row returned')
  return row
}

export async function deleteDefinition(businessId: string, id: string, tx: DbTx): Promise<void> {
  await tx
    .delete(customFieldDefinitions)
    .where(
      and(eq(customFieldDefinitions.businessId, businessId), eq(customFieldDefinitions.id, id)),
    )
}

// ─── Values ───────────────────────────────────────────────────────────────────

export async function listValuesForDoc(
  businessId: string,
  docId: string,
  tx?: DbTx,
): Promise<CustomFieldValue[]> {
  const q = tx ?? db
  return q
    .select()
    .from(customFieldValues)
    .where(and(eq(customFieldValues.businessId, businessId), eq(customFieldValues.docId, docId)))
}

export async function deleteValuesByDefinition(
  businessId: string,
  fieldDefinitionId: string,
  tx: DbTx,
): Promise<void> {
  await tx
    .delete(customFieldValues)
    .where(
      and(
        eq(customFieldValues.businessId, businessId),
        eq(customFieldValues.fieldDefinitionId, fieldDefinitionId),
      ),
    )
}

export async function upsertValue(
  businessId: string,
  fieldDefinitionId: string,
  docType: CustomFieldDefinition['docType'],
  docId: string,
  value: string | null,
  tx: DbTx,
): Promise<CustomFieldValue> {
  const [existing] = await tx
    .select()
    .from(customFieldValues)
    .where(
      and(
        eq(customFieldValues.businessId, businessId),
        eq(customFieldValues.fieldDefinitionId, fieldDefinitionId),
        eq(customFieldValues.docId, docId),
      ),
    )

  if (existing) {
    const [row] = await tx
      .update(customFieldValues)
      .set({ value, updatedAt: new Date() })
      .where(eq(customFieldValues.id, existing.id))
      .returning()
    if (!row) throw new Error('upsertValue: no row returned on update')
    return row
  }

  const [row] = await tx
    .insert(customFieldValues)
    .values({ businessId, fieldDefinitionId, docType, docId, value })
    .returning()
  if (!row) throw new Error('upsertValue: no row returned on insert')
  return row
}
