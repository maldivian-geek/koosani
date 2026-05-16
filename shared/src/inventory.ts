import { Decimal } from 'decimal.js'
import { z } from 'zod'
import { Qty } from './primitives.js'

export const InventoryAdjustmentCreate = z.object({
  itemId: z.string().uuid(),
  qty: Qty.refine((v) => !new Decimal(v).isZero(), { message: 'qty must be non-zero' }),
  reason: z.string().min(1).max(500),
})
export type InventoryAdjustmentCreate = z.infer<typeof InventoryAdjustmentCreate>

export const StockCountCreate = z.object({
  counts: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        qty: Qty.refine((v) => !new Decimal(v).isNegative(), {
          message: 'counted qty cannot be negative',
        }),
      }),
    )
    .min(1)
    .max(500),
})
export type StockCountCreate = z.infer<typeof StockCountCreate>
