import { boolean, date, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { timestamps, auditedBy } from './helpers'
import { projectStatusEnum, taskStatusEnum, gstCategoryEnum } from './enums'
import { businesses } from './businesses'
import { customers } from './customers'
import { users } from './users'

// Projects & time tracking (Phase 32, UPGRADE.md G-12) — optional,
// service-business-oriented feature; see ARCHITECTURE.md §4.12. MVR-only,
// same payables/internal-cost scope boundary as expenses (§4.11) — Phase
// 30's multi-currency work is sales-document-only.

export const projects = pgTable('projects', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  // Nullable — an internal (non-billable) project has no customer.
  customerId: uuid('customer_id').references(() => customers.id),
  name: text('name').notNull(),
  description: text('description'),
  status: projectStatusEnum('status').default('active').notNull(),
  // Defaults inherited by tasks/time entries unless overridden there.
  defaultBillableRate: numeric('default_billable_rate', { precision: 15, scale: 2 }),
  defaultGstCategory: gstCategoryEnum('default_gst_category').default('general_8').notNull(),
  ...timestamps,
  ...auditedBy,
})

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id),
  name: text('name').notNull(),
  description: text('description'),
  status: taskStatusEnum('status').default('open').notNull(),
  billable: boolean('billable').default(true).notNull(),
  // Overrides the project's default rate for time logged against this task specifically.
  billableRate: numeric('billable_rate', { precision: 15, scale: 2 }),
  ...timestamps,
  ...auditedBy,
})

// Time entries snapshot their own rate/GST/billable at creation time (from
// the task, falling back to the project) rather than reading it live from
// the project/task at invoicing time — same "snapshot, don't recompute
// later" principle as invoice/estimate line GST (ARCHITECTURE.md §4.1).
export const timeEntries = pgTable('time_entries', {
  id: uuid('id').primaryKey().defaultRandom(),
  businessId: uuid('business_id')
    .notNull()
    .references(() => businesses.id),
  projectId: uuid('project_id')
    .notNull()
    .references(() => projects.id),
  taskId: uuid('task_id').references(() => tasks.id),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  entryDate: date('entry_date').notNull(),
  // Decimal hours (e.g. '1.5000') — same 4dp convention as invoice line qty
  // (shared/src/primitives.ts's Qty), since hours becomes an invoice line's
  // qty when billed.
  hours: numeric('hours', { precision: 15, scale: 4 }).notNull(),
  description: text('description'),
  billable: boolean('billable').default(true).notNull(),
  billableRate: numeric('billable_rate', { precision: 15, scale: 2 }),
  gstCategory: gstCategoryEnum('gst_category').default('general_8').notNull(),
  // No FK, mirrors expenses.invoiceId / invoices.estimateId's traceability-
  // without-a-circular-schema-reference pattern (ARCHITECTURE.md §4.11).
  invoiceId: uuid('invoice_id'),
  invoicedAt: timestamp('invoiced_at', { withTimezone: true }),
  ...timestamps,
  ...auditedBy,
})

export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type Task = typeof tasks.$inferSelect
export type NewTask = typeof tasks.$inferInsert
export type TimeEntry = typeof timeEntries.$inferSelect
export type NewTimeEntry = typeof timeEntries.$inferInsert
