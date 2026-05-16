import { integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { timestamps, auditedBy } from './helpers'
import { fileScanResultEnum } from './enums'
import { businesses } from './businesses'
import { users } from './users'

export const files = pgTable('files', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  // polymorphic link â€” no FK (files can attach to any entity type)
  entityType: text('entity_type'),
  entityId: uuid('entity_id'),
  originalName: text('original_name').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: text('sha256').notNull(),
  // {businessId}/{entityType}/{entityId}/{sha256}.{ext} â€” never user-controlled (SECURITY.md Â§13.5)
  storageKey: text('storage_key').notNull().unique(),
  uploadedBy: uuid('uploaded_by')
    .notNull()
    .references(() => users.id),
  scannedAt: timestamp('scanned_at', { withTimezone: true }),
  scanResult: fileScanResultEnum('scan_result').default('pending'),
  ...timestamps,
  ...auditedBy,
})

export type File = typeof files.$inferSelect
export type NewFile = typeof files.$inferInsert
