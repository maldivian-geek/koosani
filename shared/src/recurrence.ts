import { z } from 'zod'
import { IsoDate, Qty, Money, GstCategory } from './primitives.js'

// Recurring invoice profiles (Phase 26, UPGRADE.md G-6). Late fees are
// deliberately out of scope here — see api/src/db/schema/enums.ts's comment.
//
// The `RecurrenceFrequency` type itself lives in dates.js (advanceByFrequency
// uses it); this is just the Zod validator for the same string union.
export const RecurrenceFrequencySchema = z.enum(['weekly', 'monthly', 'quarterly', 'yearly'])

export const RecurrenceLineCreate = z.object({
  itemId: z.string().uuid().optional(),
  description: z.string().min(1).max(500),
  qty: Qty,
  unitPrice: Money,
  gstCategory: GstCategory,
  sortOrder: z.number().int().min(0).optional(),
})
export type RecurrenceLineCreate = z.infer<typeof RecurrenceLineCreate>

export const RecurrenceProfileCreate = z.object({
  customerId: z.string().uuid(),
  name: z.string().min(1).max(300),
  frequency: RecurrenceFrequencySchema,
  startDate: IsoDate,
  endDate: IsoDate.optional(),
  autoIssue: z.boolean().optional(),
  dueDaysAfterIssue: z.number().int().min(0).max(365).optional(),
  notes: z.string().max(2000).optional(),
  lines: z.array(RecurrenceLineCreate).min(1),
})
export type RecurrenceProfileCreate = z.infer<typeof RecurrenceProfileCreate>

export const RecurrenceProfilePatch = z.object({
  name: z.string().min(1).max(300).optional(),
  frequency: RecurrenceFrequencySchema.optional(),
  endDate: IsoDate.nullable().optional(),
  active: z.boolean().optional(),
  autoIssue: z.boolean().optional(),
  dueDaysAfterIssue: z.number().int().min(0).max(365).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  lines: z.array(RecurrenceLineCreate).min(1).optional(),
})
export type RecurrenceProfilePatch = z.infer<typeof RecurrenceProfilePatch>
