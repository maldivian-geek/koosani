import { pgEnum } from 'drizzle-orm/pg-core'

export const roleEnum = pgEnum('role', ['admin', 'manager', 'staff'])

export const gstCategoryEnum = pgEnum('gst_category', [
  'general_8',
  'tourism_16',
  'tourism_17',
  'zero',
  'exempt',
])

export const invoiceStatusEnum = pgEnum('invoice_status', [
  'draft',
  'issued',
  'paid',
  'partially_paid',
  'voided',
])

export const billStatusEnum = pgEnum('bill_status', [
  'draft',
  'confirmed',
  'paid',
  'partially_paid',
])

export const creditNoteStatusEnum = pgEnum('credit_note_status', ['draft', 'issued'])

export const poStatusEnum = pgEnum('po_status', [
  'draft',
  'approved',
  'partially_received',
  'received',
  'cancelled',
])

export const movementSourceEnum = pgEnum('movement_source', [
  'invoice',
  'credit_note',
  'grn',
  'adjustment',
  'opening',
])

export const gstPeriodTypeEnum = pgEnum('gst_period_type', ['monthly', 'quarterly'])

export const gstPeriodStatusEnum = pgEnum('gst_period_status', ['open', 'built', 'locked'])

export const authEventEnum = pgEnum('auth_event', [
  'login_success',
  'login_failed',
  'logout',
  'logout_all',
  'logout_others',
  'magic_link_used',
  'password_changed',
  'password_reset',
  'emergency_jwt_rotation',
])

export const authTokenTypeEnum = pgEnum('auth_token_type', [
  'magic_link',
  'password_reset',
  'invite',
])

export const fileScanResultEnum = pgEnum('file_scan_result', ['pending', 'clean', 'infected'])

// Permission model (SECURITY.md §Authorization Model, shared/src/primitives.ts)
export const permissionResourceEnum = pgEnum('permission_resource', [
  'customers',
  'suppliers',
  'items',
  'inventory',
  'invoices',
  'bills',
  'po',
  'gst',
  'reports',
  'estimates',
  'recurring',
  'expenses',
  'projects',
])

export const permissionActionEnum = pgEnum('permission_action', [
  'view',
  'add',
  'edit',
  'delete',
  'export',
])

// Outbound email log (Phase 24, UPGRADE.md G-3/G-4)
export const emailKindEnum = pgEnum('email_kind', [
  'invoice',
  'receipt',
  'reminder',
  'statement',
  'estimate',
])
export const emailStatusEnum = pgEnum('email_status', ['sent', 'failed'])

// Estimates / quotes (Phase 25, UPGRADE.md G-5)
export const estimateStatusEnum = pgEnum('estimate_status', [
  'draft',
  'sent',
  'accepted',
  'declined',
  'expired',
])

// Recurring invoices (Phase 26, UPGRADE.md G-6). Late fees are explicitly
// NOT modeled here — MIRA GST treatment of late fees needs owner confirmation
// before that part of G-6/G-4b is built (see UPGRADE.md).
export const recurrenceFrequencyEnum = pgEnum('recurrence_frequency', [
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
])

// Customer credit ledger (Phase 27, UPGRADE.md G-7) — append-only double-entry
// style: positive-amount kinds add credit, negative-amount kinds consume it.
// Never updated once written; a correction is always a new offsetting row.
export const creditLedgerKindEnum = pgEnum('credit_ledger_kind', [
  'overpayment', // + created automatically when a payment exceeds the invoice's outstanding balance
  'advance', // + manually recorded retainer/advance payment with no invoice yet
  'voided_invoice', // + created when voiding an invoice that had active (non-reversed) payments
  'applied_to_invoice', // - credit consumed against an invoice's outstanding balance
  'refunded', // - money physically paid back to the customer
])

// Multi-currency (Phase 30, UPGRADE.md G-10). MVR is the functional currency
// (MIRA GST reporting is always MVR, ARCHITECTURE.md's MIRAconnect note) and
// is always a valid document currency alongside these. Starter set for the
// Maldives SME market — extend as customers request more.
export const currencyCodeEnum = pgEnum('currency_code', ['MVR', 'USD', 'EUR', 'GBP'])

// Projects & time tracking (Phase 32, UPGRADE.md G-12) — optional, service-
// business-oriented feature; see ARCHITECTURE.md §4.12.
export const projectStatusEnum = pgEnum('project_status', ['active', 'completed', 'archived'])
export const taskStatusEnum = pgEnum('task_status', ['open', 'done'])
