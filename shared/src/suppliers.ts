import { z } from 'zod'
import { Email, Tin } from './primitives.js'

export const SupplierCreate = z.object({
  name: z.string().min(1).max(300),
  tin: Tin.optional(),
  email: Email.optional(),
  phone: z.string().max(30).optional(),
  address: z.string().max(500).optional(),
  /** Net payment terms in days; defaults to 30. */
  paymentTermsDays: z.number().int().min(0).max(365).optional(),
  notes: z.string().max(2000).optional(),
})
export type SupplierCreate = z.infer<typeof SupplierCreate>

export const SupplierPatch = SupplierCreate.partial()
export type SupplierPatch = z.infer<typeof SupplierPatch>

export const SupplierContactCreate = z.object({
  name: z.string().min(1).max(200),
  email: Email.optional(),
  phone: z.string().max(30).optional(),
  role: z.string().max(100).optional(),
  isPrimary: z.boolean().optional(),
})
export type SupplierContactCreate = z.infer<typeof SupplierContactCreate>
