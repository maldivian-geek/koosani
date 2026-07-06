import { z } from 'zod'
import { Money, Email, Tin, IsoDate, CurrencyCode } from './primitives.js'

export const ContactCreate = z.object({
  name: z.string().min(1).max(200),
  email: Email.optional(),
  phone: z.string().max(30).optional(),
  role: z.string().max(100).optional(),
  isPrimary: z.boolean().optional(),
})
export type ContactCreate = z.infer<typeof ContactCreate>

export const CustomerCreate = z.object({
  name: z.string().min(1).max(300),
  tin: Tin.optional(),
  email: Email.optional(),
  phone: z.string().max(30).optional(),
  address: z.string().max(500).optional(),
  /** Net payment terms in days; defaults to 30. */
  creditTermsDays: z.number().int().min(0).max(365).optional(),
  /** Optional credit limit ceiling; omit for unlimited. */
  creditLimit: Money.optional(),
  notes: z.string().max(2000).optional(),
  // Multi-currency (Phase 30, UPGRADE.md G-10) — default document currency
  // for new invoices/estimates for this customer; defaults to MVR.
  currency: CurrencyCode.optional(),
})
export type CustomerCreate = z.infer<typeof CustomerCreate>

export const CustomerPatch = CustomerCreate.partial()
export type CustomerPatch = z.infer<typeof CustomerPatch>

// Phase 24, UPGRADE.md G-3 — email a statement of account
export const StatementSendBody = z.object({
  from: IsoDate,
  to: IsoDate,
})
export type StatementSendBody = z.infer<typeof StatementSendBody>
