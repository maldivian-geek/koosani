import { db } from '../../db/client.js'
import * as repo from './repository.js'
import * as audit from '../audit/service.js'
import type { AuditCtx } from '../audit/service.js'
import type { CustomFieldDefinition, CustomFieldValue } from './repository.js'
import type {
  CustomFieldDefinitionCreate,
  CustomFieldDefinitionPatch,
  CustomFieldValueUpsert,
} from '@koosani/shared'

export type { AuditCtx, CustomFieldDefinition, CustomFieldValue }

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

// ─── Definitions ──────────────────────────────────────────────────────────────

export async function createDefinition(
  businessId: string,
  data: CustomFieldDefinitionCreate,
  ctx: AuditCtx,
): Promise<CustomFieldDefinition> {
  const existing = await repo.listDefinitions(businessId, data.docType)
  if (existing.some((d) => d.fieldName === data.fieldName)) {
    throw new ValidationError(
      `A field named "${data.fieldName}" already exists for ${data.docType}`,
    )
  }

  return db.transaction(async (tx) => {
    const def = await repo.insertDefinition(
      {
        businessId,
        docType: data.docType,
        fieldName: data.fieldName,
        fieldLabel: data.fieldLabel,
        fieldType: data.fieldType,
        sortOrder: data.sortOrder ?? existing.length,
        createdBy: ctx.userId,
      },
      tx,
    )
    await audit.record(
      'custom_field_definition.create',
      'custom_field_definition',
      def.id,
      null,
      { docType: data.docType, fieldName: data.fieldName },
      ctx,
      tx,
    )
    return def
  })
}

export async function listDefinitions(
  businessId: string,
  docType: string,
): Promise<CustomFieldDefinition[]> {
  return repo.listDefinitions(businessId, docType)
}

export async function updateDefinition(
  businessId: string,
  id: string,
  data: CustomFieldDefinitionPatch,
  ctx: AuditCtx,
): Promise<CustomFieldDefinition> {
  return db.transaction(async (tx) => {
    const before = await repo.getDefinitionById(businessId, id, tx)
    if (!before) throw new NotFoundError(`Custom field definition ${id} not found`)

    const updated = await repo.updateDefinition(
      businessId,
      id,
      {
        ...(data.fieldLabel !== undefined ? { fieldLabel: data.fieldLabel } : {}),
        ...(data.sortOrder !== undefined ? { sortOrder: data.sortOrder } : {}),
        updatedBy: ctx.userId,
      },
      tx,
    )
    await audit.record(
      'custom_field_definition.update',
      'custom_field_definition',
      id,
      before as Record<string, unknown>,
      updated as Record<string, unknown>,
      ctx,
      tx,
    )
    return updated
  })
}

export async function deleteDefinition(
  businessId: string,
  id: string,
  ctx: AuditCtx,
): Promise<void> {
  return db.transaction(async (tx) => {
    const def = await repo.getDefinitionById(businessId, id, tx)
    if (!def) throw new NotFoundError(`Custom field definition ${id} not found`)

    // Values have no ON DELETE CASCADE (house style avoids DB-level cascades
    // — ARCHITECTURE.md's explicit-multi-table-delete convention, same as
    // expenses/credit notes) — remove them first, in the same transaction.
    await repo.deleteValuesByDefinition(businessId, id, tx)
    await repo.deleteDefinition(businessId, id, tx)

    await audit.record(
      'custom_field_definition.delete',
      'custom_field_definition',
      id,
      def as Record<string, unknown>,
      null,
      ctx,
      tx,
    )
  })
}

// ─── Values ───────────────────────────────────────────────────────────────────

export type CustomFieldWithValue = {
  fieldDefinitionId: string
  fieldName: string
  fieldLabel: string
  fieldType: CustomFieldDefinition['fieldType']
  sortOrder: number
  value: string | null
}

export async function listValuesForDoc(
  businessId: string,
  docType: string,
  docId: string,
): Promise<CustomFieldWithValue[]> {
  const [definitions, values] = await Promise.all([
    repo.listDefinitions(businessId, docType),
    repo.listValuesForDoc(businessId, docId),
  ])
  const valueByDefId = new Map(values.map((v) => [v.fieldDefinitionId, v.value]))

  return definitions.map((d) => ({
    fieldDefinitionId: d.id,
    fieldName: d.fieldName,
    fieldLabel: d.fieldLabel,
    fieldType: d.fieldType,
    sortOrder: d.sortOrder,
    value: valueByDefId.get(d.id) ?? null,
  }))
}

function assertValidForType(fieldType: CustomFieldDefinition['fieldType'], value: string): void {
  switch (fieldType) {
    case 'number':
      if (isNaN(Number(value))) throw new ValidationError(`"${value}" is not a valid number`)
      break
    case 'boolean':
      if (value !== 'true' && value !== 'false') {
        throw new ValidationError(`"${value}" is not a valid boolean (expected "true" or "false")`)
      }
      break
    case 'date':
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || isNaN(Date.parse(value))) {
        throw new ValidationError(`"${value}" is not a valid date (expected YYYY-MM-DD)`)
      }
      break
    case 'text':
      break
  }
}

export async function upsertValues(
  businessId: string,
  data: CustomFieldValueUpsert,
  ctx: AuditCtx,
): Promise<CustomFieldWithValue[]> {
  const definitions = await repo.listDefinitions(businessId, data.docType)
  const defById = new Map(definitions.map((d) => [d.id, d]))

  for (const v of data.values) {
    const def = defById.get(v.fieldDefinitionId)
    if (!def) {
      throw new NotFoundError(
        `Custom field ${v.fieldDefinitionId} not found for doc type ${data.docType}`,
      )
    }
    if (v.value !== null) assertValidForType(def.fieldType, v.value)
  }

  await db.transaction(async (tx) => {
    for (const v of data.values) {
      await repo.upsertValue(businessId, v.fieldDefinitionId, data.docType, data.docId, v.value, tx)
    }
    await audit.record(
      'custom_field_value.upsert',
      data.docType,
      data.docId,
      null,
      { fieldCount: data.values.length },
      ctx,
      tx,
    )
  })

  // Read after commit — reading via `tx` mid-transaction would work too, but
  // reading post-commit on the default connection is simpler and just as
  // correct once the transaction promise has resolved.
  return listValuesForDoc(businessId, data.docType, data.docId)
}
