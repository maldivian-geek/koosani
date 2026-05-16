import { z } from 'zod'
import { Money, Email, Tin } from './primitives.js'

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
})
export type CustomerCreate = z.infer<typeof CustomerCreate>

export const CustomerPatch = CustomerCreate.partial()
export type CustomerPatch = z.infer<typeof CustomerPatch>
