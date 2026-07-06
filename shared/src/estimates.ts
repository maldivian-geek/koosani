import { z } from 'zod'
import { IsoDate, Qty, Money, GstCategory, CurrencyCode } from './primitives.js'

// Estimates / quotes (Phase 25, UPGRADE.md G-5) — mirrors invoicing's draft
// pattern (shared/src/invoicing.ts's InvoiceLineCreate).

export const EstimateLineCreate = z.object({
  itemId: z.string().uuid().optional(),
  description: z.string().min(1).max(500),
  qty: Qty,
  unitPrice: Money,
  gstCategory: GstCategory,
  sortOrder: z.number().int().min(0).optional(),
})
export type EstimateLineCreate = z.infer<typeof EstimateLineCreate>

export const EstimateDraftCreate = z.object({
  customerId: z.string().uuid(),
  expiryDate: IsoDate.optional(),
  notes: z.string().max(2000).optional(),
  lines: z.array(EstimateLineCreate).min(1),
  // Multi-currency (Phase 30, UPGRADE.md G-10) — defaults to the customer's
  // own currency if omitted.
  currency: CurrencyCode.optional(),
})
export type EstimateDraftCreate = z.infer<typeof EstimateDraftCreate>

export const EstimateDraftPatch = z.object({
  expiryDate: IsoDate.nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  lines: z.array(EstimateLineCreate).min(1).optional(),
})
export type EstimateDraftPatch = z.infer<typeof EstimateDraftPatch>
