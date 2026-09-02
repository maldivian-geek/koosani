import { z } from 'zod'
import { Qty } from './primitives.js'

// Order lists (Phase 34) — a lightweight named working checklist of
// stock-order lines, modeled on a spreadsheet the owner already uses. Not a
// financial document: no GST, no numbering, no stock movement. item_name is
// free text by deliberate product decision — NOT linked to the items master.
// See ARCHITECTURE.md §4.16.

export const OrderListPaymentStatus = z.enum(['pending', 'paid'])
export type OrderListPaymentStatus = z.infer<typeof OrderListPaymentStatus>

export const OrderListStockStatus = z.enum(['unknown', 'in_stock', 'available', 'not_available'])
export type OrderListStockStatus = z.infer<typeof OrderListStockStatus>

export const OrderListCreate = z.object({
  title: z.string().min(1).max(200),
  notes: z.string().max(2000).optional(),
})
export type OrderListCreate = z.infer<typeof OrderListCreate>

export const OrderListPatch = z.object({
  title: z.string().min(1).max(200).optional(),
  notes: z.string().max(2000).nullable().optional(),
})
export type OrderListPatch = z.infer<typeof OrderListPatch>

export const OrderLineCreate = z.object({
  itemName: z.string().min(1).max(300),
  qty: Qty,
  uom: z.string().min(1).max(50).default('Each'),
  note: z.string().max(1000).optional(),
  additionalNote: z.string().max(1000).optional(),
  // Loading workflow: which box the item was packed into, and whether it's
  // on the vehicle — free text / checkbox, same non-financial spirit as the
  // status columns.
  boxNo: z.string().max(50).optional(),
  loaded: z.boolean().optional(),
})
export type OrderLineCreate = z.infer<typeof OrderLineCreate>

// Paste/CSV import (review-and-confirm flow — SECURITY.md §13.13): the client
// submits raw pasted text for parsing, edits the returned draft rows, then
// confirms them as a bulk create.
export const OrderListParseRequest = z.object({
  text: z.string().min(1).max(200_000),
})
export type OrderListParseRequest = z.infer<typeof OrderListParseRequest>

export const OrderLinesImport = z.object({
  lines: z.array(OrderLineCreate).min(1).max(500),
})
export type OrderLinesImport = z.infer<typeof OrderLinesImport>

export const OrderLinePatch = z.object({
  itemName: z.string().min(1).max(300).optional(),
  qty: Qty.optional(),
  uom: z.string().min(1).max(50).optional(),
  note: z.string().max(1000).nullable().optional(),
  additionalNote: z.string().max(1000).nullable().optional(),
  paymentStatus: OrderListPaymentStatus.optional(),
  stockStatus: OrderListStockStatus.optional(),
  boxNo: z.string().max(50).nullable().optional(),
  loaded: z.boolean().optional(),
})
export type OrderLinePatch = z.infer<typeof OrderLinePatch>
