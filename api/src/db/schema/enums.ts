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
])

export const permissionActionEnum = pgEnum('permission_action', [
  'view',
  'add',
  'edit',
  'delete',
  'export',
])

// Outbound email log (Phase 24, UPGRADE.md G-3/G-4)
export const emailKindEnum = pgEnum('email_kind', ['invoice', 'receipt', 'reminder', 'statement'])
export const emailStatusEnum = pgEnum('email_status', ['sent', 'failed'])
