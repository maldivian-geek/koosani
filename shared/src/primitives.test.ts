import { describe, it, expect } from 'vitest'
import { Money, Qty, IsoDate, Email, Tin, GstCategory, Permission, Role } from './primitives.js'

describe('Money', () => {
  it('accepts valid positive integers', () => {
    expect(Money.safeParse('0').success).toBe(true)
    expect(Money.safeParse('100').success).toBe(true)
    expect(Money.safeParse('99999999999999').success).toBe(true)
  })

  it('accepts valid positive decimals', () => {
    expect(Money.safeParse('1.5').success).toBe(true)
    expect(Money.safeParse('1.50').success).toBe(true)
    expect(Money.safeParse('0.01').success).toBe(true)
  })

  it('accepts negatives', () => {
    expect(Money.safeParse('-10').success).toBe(true)
    expect(Money.safeParse('-0.99').success).toBe(true)
  })

  it('rejects 3+ decimal places', () => {
    expect(Money.safeParse('1.001').success).toBe(false)
  })

  it('rejects non-numeric strings', () => {
    expect(Money.safeParse('abc').success).toBe(false)
    expect(Money.safeParse('1,000').success).toBe(false)
    expect(Money.safeParse('').success).toBe(false)
  })
})

describe('Qty', () => {
  it('accepts up to 4 decimal places', () => {
    expect(Qty.safeParse('1.5000').success).toBe(true)
    expect(Qty.safeParse('0.1234').success).toBe(true)
    expect(Qty.safeParse('10').success).toBe(true)
  })

  it('rejects 5+ decimal places', () => {
    expect(Qty.safeParse('1.00001').success).toBe(false)
  })

  it('accepts negatives', () => {
    expect(Qty.safeParse('-3.5000').success).toBe(true)
  })
})

describe('IsoDate', () => {
  it('accepts YYYY-MM-DD', () => {
    expect(IsoDate.safeParse('2026-05-16').success).toBe(true)
    expect(IsoDate.safeParse('2000-01-01').success).toBe(true)
  })

  it('rejects other formats', () => {
    expect(IsoDate.safeParse('16/05/2026').success).toBe(false)
    expect(IsoDate.safeParse('2026-5-6').success).toBe(false)
    expect(IsoDate.safeParse('').success).toBe(false)
  })
})

describe('Email', () => {
  it('accepts valid emails', () => {
    expect(Email.safeParse('user@example.com').success).toBe(true)
    expect(Email.safeParse('user+vendor@company.mv').success).toBe(true)
  })

  it('rejects invalid emails', () => {
    expect(Email.safeParse('notanemail').success).toBe(false)
    expect(Email.safeParse('@nodomain').success).toBe(false)
  })

  it('rejects emails over 254 chars', () => {
    const long = 'a'.repeat(249) + '@b.com' // 255 chars total
    expect(long.length).toBeGreaterThan(254)
    expect(Email.safeParse(long).success).toBe(false)
  })
})

describe('Tin', () => {
  it('accepts 7–10 digit strings', () => {
    expect(Tin.safeParse('1234567').success).toBe(true)
    expect(Tin.safeParse('1234567890').success).toBe(true)
  })

  it('rejects fewer than 7 digits', () => {
    expect(Tin.safeParse('123456').success).toBe(false)
  })

  it('rejects more than 10 digits', () => {
    expect(Tin.safeParse('12345678901').success).toBe(false)
  })

  it('rejects non-digits', () => {
    expect(Tin.safeParse('C1234567').success).toBe(false)
    expect(Tin.safeParse('12-34567').success).toBe(false)
  })
})

describe('GstCategory', () => {
  it('accepts all valid categories', () => {
    for (const cat of ['general_8', 'tourism_16', 'tourism_17', 'zero', 'exempt'] as const) {
      expect(GstCategory.safeParse(cat).success).toBe(true)
    }
  })

  it('rejects unknown categories', () => {
    expect(GstCategory.safeParse('general_5').success).toBe(false)
    expect(GstCategory.safeParse('').success).toBe(false)
  })
})

describe('Permission', () => {
  it('accepts valid resource/action pairs', () => {
    expect(Permission.safeParse({ resource: 'invoices', action: 'view' }).success).toBe(true)
    expect(Permission.safeParse({ resource: 'gst', action: 'delete' }).success).toBe(true)
  })

  it('rejects unknown resources or actions', () => {
    expect(Permission.safeParse({ resource: 'payroll', action: 'view' }).success).toBe(false)
    expect(Permission.safeParse({ resource: 'invoices', action: 'approve' }).success).toBe(false)
  })
})

describe('Role', () => {
  it('accepts admin, manager, staff', () => {
    expect(Role.safeParse('admin').success).toBe(true)
    expect(Role.safeParse('manager').success).toBe(true)
    expect(Role.safeParse('staff').success).toBe(true)
  })

  it('rejects unknown roles', () => {
    expect(Role.safeParse('superadmin').success).toBe(false)
  })
})
