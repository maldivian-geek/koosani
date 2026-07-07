import { z } from 'zod'
import { Email, Tin } from './primitives.js'

// Business profile + defaults (Phase 22, UPGRADE.md G-2/G-15). Every field is
// optional on patch — this is a single settings form, not a create flow.
export const BusinessSettingsPatch = z.object({
  name: z.string().min(1).max(300).optional(),
  tin: Tin.optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  phone: z.string().max(30).optional().nullable(),
  email: Email.optional().nullable(),
  allowBackorders: z.boolean().optional(),
  gstPeriodType: z.enum(['monthly', 'quarterly']).optional(),
  defaultCreditTermsDays: z.number().int().min(0).max(365).optional(),
  defaultInvoiceNotes: z.string().max(2000).optional().nullable(),
  invoiceNumberPrefix: z.string().min(1).max(20).optional(),
  creditNoteNumberPrefix: z.string().min(1).max(20).optional(),
  billNumberPrefix: z.string().min(1).max(20).optional(),
  poNumberPrefix: z.string().min(1).max(20).optional(),
  estimateNumberPrefix: z.string().min(1).max(20).optional(),
  defaultEstimateValidityDays: z.number().int().min(0).max(365).optional(),
  deliveryNoteNumberPrefix: z.string().min(1).max(20).optional(),
})
export type BusinessSettingsPatch = z.infer<typeof BusinessSettingsPatch>
