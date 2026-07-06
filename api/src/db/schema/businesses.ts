import { boolean, integer, pgTable, text, uuid } from 'drizzle-orm/pg-core'
import { timestamps } from './helpers'
import { gstPeriodTypeEnum } from './enums'

export const businesses = pgTable('businesses', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  tin: text('tin'),
  address: text('address'),
  phone: text('phone'),
  email: text('email'),
  allowBackorders: boolean('allow_backorders').default(false).notNull(),
  gstPeriodType: gstPeriodTypeEnum('gst_period_type').default('monthly').notNull(),
  // Branding + defaults (Phase 22, UPGRADE.md). logoFileId has no FK constraint
  // (files can be deleted independently; a dangling reference just means no
  // logo renders) — mirrors the polymorphic, FK-less pattern in files.ts.
  logoFileId: uuid('logo_file_id'),
  defaultCreditTermsDays: integer('default_credit_terms_days').default(30).notNull(),
  defaultInvoiceNotes: text('default_invoice_notes'),
  // Numbering prefixes — defaults match the previously hard-coded values, so
  // existing installs see no behavior change until an admin edits them.
  // Changing a prefix starts that document type's sequence over at 1 (the new
  // prefix's MAX is computed only over rows already starting with it) rather
  // than risk mis-parsing old-prefix rows at a different SUBSTRING offset.
  invoiceNumberPrefix: text('invoice_number_prefix').default('INV-').notNull(),
  creditNoteNumberPrefix: text('credit_note_number_prefix').default('CN-').notNull(),
  billNumberPrefix: text('bill_number_prefix').default('BILL-').notNull(),
  poNumberPrefix: text('po_number_prefix').default('PO-').notNull(),
  // Payment reminder dunning schedule, in days relative to due date (negative
  // = before due, 0 = on due date, positive = overdue). Phase 24, UPGRADE.md
  // G-4. Per-invoice opt-out is `invoices.remindersEnabled`.
  reminderScheduleDays: integer('reminder_schedule_days').array().default([-3, 0, 7, 14]).notNull(),
  ...timestamps,
  // nullable: no user exists yet when the business row is first created
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
})

export type Business = typeof businesses.$inferSelect
export type NewBusiness = typeof businesses.$inferInsert
