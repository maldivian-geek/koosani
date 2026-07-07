import { integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { timestamps, auditedBy } from './helpers.js'
import { customFieldDocTypeEnum, customFieldTypeEnum } from './enums.js'
import { businesses } from './businesses.js'

// Custom fields (Phase 33c, UPGRADE.md G-13/F-24) — see ARCHITECTURE.md §4.15.
// A generic typed key-value system per document type. `custom_field_values`
// has no FK on `docId` — it's polymorphic across five different tables
// (invoices, estimates, pos, bills, credit_notes), same "no-FK traceability"
// convention used elsewhere for polymorphic references (files.ts, audit.ts).
// `value` is always stored as text regardless of `fieldType`; the field
// definition's type governs display/validation only, not storage — a single
// nullable text column is simpler than one nullable column per type and this
// data never feeds financial computation.

export const customFieldDefinitions = pgTable(
  'custom_field_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    docType: customFieldDocTypeEnum('doc_type').notNull(),
    fieldName: text('field_name').notNull(),
    fieldLabel: text('field_label').notNull(),
    fieldType: customFieldTypeEnum('field_type').notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    ...timestamps,
    ...auditedBy,
  },
  (table) => [
    uniqueIndex('custom_field_definitions_business_doctype_name_unique').on(
      table.businessId,
      table.docType,
      table.fieldName,
    ),
  ],
)

export const customFieldValues = pgTable(
  'custom_field_values',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    businessId: uuid('business_id')
      .notNull()
      .references(() => businesses.id),
    fieldDefinitionId: uuid('field_definition_id')
      .notNull()
      .references(() => customFieldDefinitions.id),
    docType: customFieldDocTypeEnum('doc_type').notNull(),
    docId: uuid('doc_id').notNull(),
    value: text('value'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('custom_field_values_definition_doc_unique').on(
      table.fieldDefinitionId,
      table.docId,
    ),
  ],
)

export type CustomFieldDefinition = typeof customFieldDefinitions.$inferSelect
export type NewCustomFieldDefinition = typeof customFieldDefinitions.$inferInsert
export type CustomFieldValue = typeof customFieldValues.$inferSelect
export type NewCustomFieldValue = typeof customFieldValues.$inferInsert
