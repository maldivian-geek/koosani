import { z } from 'zod'
import { Decimal } from 'decimal.js'
import { IsoDate, Qty, Money, GstCategory, CurrencyCode } from './primitives.js'

// ─── Invoice line (shared between create and patch) ───────────────────────────

export const InvoiceLineCreate = z.object({
  itemId: z.string().uuid().optional(),
  description: z.string().min(1).max(500),
  qty: Qty,
  unitPrice: Money,
  gstCategory: GstCategory,
  sortOrder: z.number().int().min(0).optional(),
})
export type InvoiceLineCreate = z.infer<typeof InvoiceLineCreate>

// ─── Draft invoice ────────────────────────────────────────────────────────────

export const InvoiceDraftCreate = z.object({
  customerId: z.string().uuid(),
  dueDate: IsoDate.optional(),
  notes: z.string().max(2000).optional(),
  lines: z.array(InvoiceLineCreate).min(1),
  // Multi-currency (Phase 30, UPGRADE.md G-10) — defaults to the customer's
  // own currency if omitted.
  currency: CurrencyCode.optional(),
})
export type InvoiceDraftCreate = z.infer<typeof InvoiceDraftCreate>

export const InvoiceDraftPatch = z.object({
  dueDate: IsoDate.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  lines: z.array(InvoiceLineCreate).min(1).optional(),
})
export type InvoiceDraftPatch = z.infer<typeof InvoiceDraftPatch>

// ─── Payment ──────────────────────────────────────────────────────────────────

export const InvoicePaymentCreate = z.object({
  // Strictly positive money amount — zero and negative payments are rejected
  // (UPGRADE.md F-15; a reversal, not a zero payment, is how you undo one)
  amount: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, 'Amount must be a positive decimal')
    .refine((v) => new Decimal(v).gt(0), 'Amount must be greater than zero'),
  method: z.string().min(1).max(100),
  ref: z.string().max(200).optional(),
  paidAt: IsoDate,
})
export type InvoicePaymentCreate = z.infer<typeof InvoicePaymentCreate>

// ─── Void ─────────────────────────────────────────────────────────────────────

export const InvoiceVoidBody = z.object({
  reason: z.string().min(1).max(2000),
})
export type InvoiceVoidBody = z.infer<typeof InvoiceVoidBody>

// ─── Credit note ─────────────────────────────────────────────────────────────

export const CreditNoteCreate = z.object({
  invoiceId: z.string().uuid(),
  reason: z.string().min(1).max(2000),
  lines: z.array(InvoiceLineCreate).min(1),
})
export type CreditNoteCreate = z.infer<typeof CreditNoteCreate>

// ─── Delivery note (Phase 33, UPGRADE.md G-13/F-24) ──────────────────────────
// Lines are always copied from the source invoice, not user-supplied — this
// body only carries the one optional free-text field.

export const DeliveryNoteCreate = z.object({
  notes: z.string().max(2000).optional(),
})
export type DeliveryNoteCreate = z.infer<typeof DeliveryNoteCreate>

// ─── Reminders opt-out (Phase 24, UPGRADE.md G-4) ────────────────────────────

export const InvoiceRemindersPatch = z.object({
  enabled: z.boolean(),
})
export type InvoiceRemindersPatch = z.infer<typeof InvoiceRemindersPatch>

// ─── Customer credit application (Phase 27, UPGRADE.md G-7) ─────────────────

export const ApplyCreditBody = z.object({
  amount: Money,
})
export type ApplyCreditBody = z.infer<typeof ApplyCreditBody>
