// Shared input shapes for every PDF template (Phase 23, UPGRADE.md Part 3).
// Assembled by each module's service from its own persisted data — templates
// never query the DB themselves.

export type BusinessInfo = {
  name: string
  tin: string | null
  address: string | null
  phone: string | null
  email: string | null
  logoUrl: string | null
}

export type PartyInfo = {
  name: string
  tin: string | null
  address: string | null
}

export type DocumentLine = {
  description: string
  qty: string
  rate: string
  gstRate?: string | null
  gstAmount?: string | null
  lineTotal: string
}
