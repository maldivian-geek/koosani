import { describe, it, expect } from 'vitest'
import { SupplierCreate, SupplierPatch, SupplierContactCreate } from './suppliers.js'

describe('SupplierCreate', () => {
  const valid = {
    name: 'Global Imports Maldives',
    tin: '9876543',
    email: 'accounts@globalimports.mv',
    phone: '+960 332 5678',
    address: 'G. Feydhoofinolhu, Maleʼ',
    paymentTermsDays: 45,
    notes: 'Net 45 agreed',
  }

  it('accepts a fully populated record', () => {
    expect(SupplierCreate.safeParse(valid).success).toBe(true)
  })

  it('accepts minimal record (name only)', () => {
    expect(SupplierCreate.safeParse({ name: 'Simple Supplier' }).success).toBe(true)
  })

  it('rejects missing name', () => {
    expect(
      SupplierCreate.safeParse({ tin: '9876543', email: 'accounts@globalimports.mv' }).success,
    ).toBe(false)
  })

  it('rejects empty name', () => {
    expect(SupplierCreate.safeParse({ name: '' }).success).toBe(false)
  })

  it('rejects name over 300 chars', () => {
    expect(SupplierCreate.safeParse({ name: 'a'.repeat(301) }).success).toBe(false)
  })

  it('rejects invalid TIN', () => {
    expect(SupplierCreate.safeParse({ name: 'X', tin: 'ABC1234' }).success).toBe(false)
  })

  it('rejects invalid email', () => {
    expect(SupplierCreate.safeParse({ name: 'X', email: 'not-an-email' }).success).toBe(false)
  })

  it('rejects paymentTermsDays over 365', () => {
    expect(SupplierCreate.safeParse({ name: 'X', paymentTermsDays: 400 }).success).toBe(false)
  })

  it('rejects negative paymentTermsDays', () => {
    expect(SupplierCreate.safeParse({ name: 'X', paymentTermsDays: -1 }).success).toBe(false)
  })

  it('rejects non-integer paymentTermsDays', () => {
    expect(SupplierCreate.safeParse({ name: 'X', paymentTermsDays: 30.5 }).success).toBe(false)
  })
})

describe('SupplierPatch', () => {
  it('accepts empty object', () => {
    expect(SupplierPatch.safeParse({}).success).toBe(true)
  })

  it('accepts partial update', () => {
    expect(SupplierPatch.safeParse({ paymentTermsDays: 60 }).success).toBe(true)
  })

  it('still validates provided fields', () => {
    expect(SupplierPatch.safeParse({ tin: '123' }).success).toBe(false)
  })
})

describe('SupplierContactCreate', () => {
  it('accepts full record', () => {
    expect(
      SupplierContactCreate.safeParse({
        name: 'Ibrahim Mohamed',
        email: 'ibrahim@supplier.mv',
        phone: '+960 777 9999',
        role: 'Sales Manager',
        isPrimary: true,
      }).success,
    ).toBe(true)
  })

  it('accepts name only', () => {
    expect(SupplierContactCreate.safeParse({ name: 'Fathimath' }).success).toBe(true)
  })

  it('rejects empty name', () => {
    expect(SupplierContactCreate.safeParse({ name: '' }).success).toBe(false)
  })

  it('rejects name over 200 chars', () => {
    expect(SupplierContactCreate.safeParse({ name: 'b'.repeat(201) }).success).toBe(false)
  })

  it('rejects invalid email', () => {
    expect(SupplierContactCreate.safeParse({ name: 'X', email: 'bad' }).success).toBe(false)
  })
})
