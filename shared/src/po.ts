import { z } from 'zod'
import { IsoDate, Qty, Money } from './primitives.js'

// ─── PO line (shared between create and patch) ────────────────────────────────

export const PoLineCreate = z.object({
  itemId: z.string().uuid().optional(),
  description: z.string().min(1).max(500),
  qtyOrdered: Qty,
  unitCost: Money,
  sortOrder: z.number().int().min(0).optional(),
})
export type PoLineCreate = z.infer<typeof PoLineCreate>

// ─── Draft PO ─────────────────────────────────────────────────────────────────

export const PoDraftCreate = z.object({
  supplierId: z.string().uuid(),
  orderDate: IsoDate.optional(),
  expectedDate: IsoDate.optional(),
  notes: z.string().max(2000).optional(),
  lines: z.array(PoLineCreate).min(1),
})
export type PoDraftCreate = z.infer<typeof PoDraftCreate>

export const PoDraftPatch = z.object({
  orderDate: IsoDate.nullable().optional(),
  expectedDate: IsoDate.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  lines: z.array(PoLineCreate).min(1).optional(),
})
export type PoDraftPatch = z.infer<typeof PoDraftPatch>

export const PoCancelBody = z.object({
  reason: z.string().min(1).max(1000),
})
export type PoCancelBody = z.infer<typeof PoCancelBody>

// ─── GRN ──────────────────────────────────────────────────────────────────────

export const GrnLineCreate = z.object({
  poLineId: z.string().uuid(),
  qtyReceived: Qty,
  unitCost: Money,
})
export type GrnLineCreate = z.infer<typeof GrnLineCreate>

export const GrnCreate = z.object({
  receivedAt: IsoDate,
  notes: z.string().max(2000).optional(),
  lines: z.array(GrnLineCreate).min(1),
})
export type GrnCreate = z.infer<typeof GrnCreate>
