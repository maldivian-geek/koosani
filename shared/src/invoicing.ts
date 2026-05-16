import { z } from 'zod'
import { IsoDate, Qty, Money, GstCategory } from './primitives.js'

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
  // Positive money amount only; service rejects negatives
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Amount must be a positive decimal'),
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
