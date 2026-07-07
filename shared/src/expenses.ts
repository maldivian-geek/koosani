import { z } from 'zod'
import { IsoDate, Money, GstCategory } from './primitives.js'

// Lightweight expense capture (Phase 31, UPGRADE.md G-11) — see
// ARCHITECTURE.md §4.11. Distinct from supplier bills.

export const ExpenseCreate = z
  .object({
    category: z.string().min(1).max(200),
    description: z.string().max(2000).optional(),
    supplierId: z.string().uuid().optional(),
    expenseDate: IsoDate,
    // Net (pre-tax) amount — gstAmount/total are computed server-side via gstFor()
    amount: Money,
    gstCategory: GstCategory,
    paymentMethod: z.string().max(100).optional(),
    billable: z.boolean().optional(),
    customerId: z.string().uuid().optional(),
  })
  .refine((data) => !data.billable || !!data.customerId, {
    message: 'customerId is required when billable is true',
    path: ['customerId'],
  })
export type ExpenseCreate = z.infer<typeof ExpenseCreate>

export const ExpensePatch = z.object({
  category: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullable().optional(),
  supplierId: z.string().uuid().nullable().optional(),
  expenseDate: IsoDate.optional(),
  amount: Money.optional(),
  gstCategory: GstCategory.optional(),
  paymentMethod: z.string().max(100).nullable().optional(),
  billable: z.boolean().optional(),
  customerId: z.string().uuid().nullable().optional(),
})
export type ExpensePatch = z.infer<typeof ExpensePatch>

export const ExpenseMarkInvoiced = z.object({
  expenseIds: z.array(z.string().uuid()).min(1),
  invoiceId: z.string().uuid(),
})
export type ExpenseMarkInvoiced = z.infer<typeof ExpenseMarkInvoiced>
