import { describe, it, expect } from 'vitest'
import { CustomerCreate, CustomerPatch, ContactCreate } from './customers.js'

describe('CustomerCreate', () => {
  const valid = {
    name: 'Acme Trading Pvt Ltd',
    tin: '1234567',
    email: 'billing@acme.mv',
    phone: '+960 300 1234',
    address: 'Ma. Dhilbahaaru, Maleʼ, Maldives',
    creditTermsDays: 30,
    creditLimit: '10000.00',
    notes: 'Key account',
  }

  it('accepts a fully populated record', () => {
    expect(CustomerCreate.safeParse(valid).success).toBe(true)
  })

  it('accepts minimal record (name only)', () => {
    expect(CustomerCreate.safeParse({ name: 'Solo Customer' }).success).toBe(true)
  })

  it('rejects missing name', () => {
    expect(CustomerCreate.safeParse({ tin: '1234567', email: 'billing@acme.mv' }).success).toBe(
      false,
    )
  })

  it('rejects empty name', () => {
    expect(CustomerCreate.safeParse({ name: '' }).success).toBe(false)
  })

  it('rejects name over 300 chars', () => {
    expect(CustomerCreate.safeParse({ name: 'a'.repeat(301) }).success).toBe(false)
  })

  it('rejects invalid email', () => {
    expect(CustomerCreate.safeParse({ name: 'X', email: 'notanemail' }).success).toBe(false)
  })

  it('rejects invalid TIN', () => {
    expect(CustomerCreate.safeParse({ name: 'X', tin: '123' }).success).toBe(false)
  })

  it('rejects invalid money format for creditLimit', () => {
    expect(CustomerCreate.safeParse({ name: 'X', creditLimit: '1000.999' }).success).toBe(false)
  })

  it('rejects negative creditTermsDays', () => {
    expect(CustomerCreate.safeParse({ name: 'X', creditTermsDays: -1 }).success).toBe(false)
  })

  it('rejects creditTermsDays over 365', () => {
    expect(CustomerCreate.safeParse({ name: 'X', creditTermsDays: 366 }).success).toBe(false)
  })

  it('rejects non-integer creditTermsDays', () => {
    expect(CustomerCreate.safeParse({ name: 'X', creditTermsDays: 30.5 }).success).toBe(false)
  })
})

describe('CustomerPatch', () => {
  it('accepts an empty object (all fields optional)', () => {
    expect(CustomerPatch.safeParse({}).success).toBe(true)
  })

  it('accepts partial update', () => {
    expect(CustomerPatch.safeParse({ phone: '+960 777 8888' }).success).toBe(true)
  })

  it('still validates fields that are provided', () => {
    expect(CustomerPatch.safeParse({ email: 'bad-email' }).success).toBe(false)
  })
})

describe('ContactCreate', () => {
  it('accepts full record', () => {
    expect(
      ContactCreate.safeParse({
        name: 'Ahmed Ali',
        email: 'ahmed@acme.mv',
        phone: '+960 300 0001',
        role: 'Accounts',
        isPrimary: true,
      }).success,
    ).toBe(true)
  })

  it('accepts name only', () => {
    expect(ContactCreate.safeParse({ name: 'Aminath' }).success).toBe(true)
  })

  it('rejects empty name', () => {
    expect(ContactCreate.safeParse({ name: '' }).success).toBe(false)
  })

  it('rejects name over 200 chars', () => {
    expect(ContactCreate.safeParse({ name: 'a'.repeat(201) }).success).toBe(false)
  })

  it('rejects invalid email', () => {
    expect(ContactCreate.safeParse({ name: 'X', email: 'bad' }).success).toBe(false)
  })
})
