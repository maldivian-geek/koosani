import { z } from 'zod'
import { IsoDate, Qty, Money, GstCategory } from './primitives.js'

// ─── Bill line (shared between create and patch) ──────────────────────────────

export const BillLineCreate = z.object({
  itemId: z.string().uuid().optional(),
  description: z.string().min(1).max(500),
  qty: Qty,
  unitCost: Money,
  gstCategory: GstCategory,
  sortOrder: z.number().int().min(0).optional(),
})
export type BillLineCreate = z.infer<typeof BillLineCreate>

// ─── Draft bill ───────────────────────────────────────────────────────────────

export const BillDraftCreate = z.object({
  supplierId: z.string().uuid(),
  supplierRef: z.string().max(200).optional(),
  billDate: IsoDate.optional(),
  dueDate: IsoDate.optional(),
  notes: z.string().max(2000).optional(),
  lines: z.array(BillLineCreate).min(1),
})
export type BillDraftCreate = z.infer<typeof BillDraftCreate>

export const BillDraftPatch = z.object({
  supplierRef: z.string().max(200).nullable().optional(),
  billDate: IsoDate.nullable().optional(),
  dueDate: IsoDate.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  lines: z.array(BillLineCreate).min(1).optional(),
})
export type BillDraftPatch = z.infer<typeof BillDraftPatch>

// ─── Payment ──────────────────────────────────────────────────────────────────

export const BillPaymentCreate = z.object({
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/, 'Amount must be a positive decimal'),
  method: z.string().min(1).max(100),
  ref: z.string().max(200).optional(),
  paidAt: IsoDate,
})
export type BillPaymentCreate = z.infer<typeof BillPaymentCreate>

// ─── SOA extract line (output of parser, input to matchSoaLine) ───────────────

export const SoaExtractLine = z.object({
  date: IsoDate,
  ref: z.string().max(200),
  description: z.string().max(500).optional(),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
})
export type SoaExtractLine = z.infer<typeof SoaExtractLine>
