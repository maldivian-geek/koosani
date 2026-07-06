import { z } from 'zod'

// Stringified decimal — 2dp, supports negatives (credit notes, adjustments)
export const Money = z.string().regex(/^-?\d+(\.\d{1,2})?$/, 'Invalid money format')
export type Money = z.infer<typeof Money>

// Stringified decimal — 4dp, supports negatives
export const Qty = z.string().regex(/^-?\d+(\.\d{1,4})?$/, 'Invalid quantity format')
export type Qty = z.infer<typeof Qty>

// YYYY-MM-DD
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
export type IsoDate = z.infer<typeof IsoDate>

// Email — max 254 per RFC 5321
export const Email = z.string().email().max(254)
export type Email = z.infer<typeof Email>

// Maldives TIN: 7–10 digit numeric string (MIRA-issued)
export const Tin = z.string().regex(/^\d{7,10}$/, 'TIN must be 7–10 digits')
export type Tin = z.infer<typeof Tin>

// GST categories per MIRA classification (extend as MIRA evolves)
export const GstCategory = z.enum(['general_8', 'tourism_16', 'tourism_17', 'zero', 'exempt'])
export type GstCategory = z.infer<typeof GstCategory>

// Permission model
export const PermissionResource = z.enum([
  'customers',
  'suppliers',
  'items',
  'inventory',
  'invoices',
  'bills',
  'po',
  'gst',
  'reports',
])
export type PermissionResource = z.infer<typeof PermissionResource>

// 'export' only applies to the `reports` resource (bulk CSV export, SECURITY.md §13.6)
export const PermissionAction = z.enum(['view', 'add', 'edit', 'delete', 'export'])
export type PermissionAction = z.infer<typeof PermissionAction>

export const Permission = z.object({
  resource: PermissionResource,
  action: PermissionAction,
})
export type Permission = z.infer<typeof Permission>

// User role hierarchy: admin > manager > staff
export const Role = z.enum(['admin', 'manager', 'staff'])
export type Role = z.infer<typeof Role>
