import { z } from 'zod'
import { Money, Qty, GstCategory } from './primitives.js'

export const ItemCategoryCreate = z.object({
  name: z.string().min(1).max(200),
  parentId: z.string().uuid().optional(),
})
export type ItemCategoryCreate = z.infer<typeof ItemCategoryCreate>

export const ItemCreate = z.object({
  sku: z.string().min(1).max(100),
  name: z.string().min(1).max(300),
  /** How a customer refers to this item on their own POs/paperwork (Phase 34) — display/reference only, not wired into PDFs or the portal. */
  customerItemName: z.string().max(300).optional(),
  /** Unit of measure, e.g. 'pcs', 'kg', 'litre', 'box'. */
  unit: z.string().min(1).max(50),
  categoryId: z.string().uuid().optional(),
  gstCategory: GstCategory,
  defaultPrice: Money.optional(),
  defaultCost: Money.optional(),
  reorderPoint: Qty.optional(),
  notes: z.string().max(2000).optional(),
})
export type ItemCreate = z.infer<typeof ItemCreate>

export const ItemPatch = ItemCreate.partial()
export type ItemPatch = z.infer<typeof ItemPatch>
