import { z } from 'zod'

// Custom fields (Phase 33c, UPGRADE.md G-13/F-24) — a generic typed
// key-value system per document type, values shown on the document's PDF.

export const CustomFieldDocType = z.enum(['invoice', 'estimate', 'po', 'bill', 'credit_note'])
export type CustomFieldDocType = z.infer<typeof CustomFieldDocType>

export const CustomFieldType = z.enum(['text', 'number', 'date', 'boolean'])
export type CustomFieldType = z.infer<typeof CustomFieldType>

export const CustomFieldDefinitionCreate = z.object({
  docType: CustomFieldDocType,
  // Machine key — lowercase snake_case, stable once other rows reference it.
  fieldName: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z][a-z0-9_]*$/, 'Use lowercase letters, numbers, and underscores only'),
  fieldLabel: z.string().min(1).max(200),
  fieldType: CustomFieldType,
  sortOrder: z.number().int().min(0).optional(),
})
export type CustomFieldDefinitionCreate = z.infer<typeof CustomFieldDefinitionCreate>

export const CustomFieldDefinitionPatch = z.object({
  fieldLabel: z.string().min(1).max(200).optional(),
  sortOrder: z.number().int().min(0).optional(),
})
export type CustomFieldDefinitionPatch = z.infer<typeof CustomFieldDefinitionPatch>

export const CustomFieldValueUpsert = z.object({
  docType: CustomFieldDocType,
  docId: z.string().uuid(),
  values: z
    .array(
      z.object({
        fieldDefinitionId: z.string().uuid(),
        value: z.string().max(2000).nullable(),
      }),
    )
    .max(100),
})
export type CustomFieldValueUpsert = z.infer<typeof CustomFieldValueUpsert>
