import { describe, it, expect } from 'vitest'
import { money, qty } from './money.js'

describe('money.add', () => {
  it('adds two positive values', () => {
    expect(money.add('10.00', '5.00')).toBe('15.00')
  })

  it('adds values with differing precision', () => {
    expect(money.add('1.5', '2.5')).toBe('4.00')
  })

  it('adds negative values', () => {
    expect(money.add('-3.00', '5.00')).toBe('2.00')
  })

  it('returns 2dp even for whole numbers', () => {
    expect(money.add('1', '2')).toBe('3.00')
  })
})

describe('money.sub', () => {
  it('subtracts correctly', () => {
    expect(money.sub('10.00', '3.50')).toBe('6.50')
  })

  it('returns negative when b > a', () => {
    expect(money.sub('1.00', '2.00')).toBe('-1.00')
  })
})

describe('money.mul', () => {
  it('multiplies and rounds to 2dp (ROUND_HALF_UP)', () => {
    expect(money.mul('3.00', '3.00')).toBe('9.00')
    // 10 * 1/3 = 3.333... → rounds to 3.33
    expect(money.mul('10.00', '0.333333')).toBe('3.33')
    // 2.345 * 1 = 2.35 (half-up)
    expect(money.mul('2.345', '1')).toBe('2.35')
  })
})

describe('money.round2', () => {
  it('rounds a number to 2dp', () => {
    expect(money.round2(1.005)).toBe('1.01')
    expect(money.round2('0')).toBe('0.00')
    expect(money.round2('99.999')).toBe('100.00')
  })
})

describe('money.negate', () => {
  it('negates positive', () => {
    expect(money.negate('10.00')).toBe('-10.00')
  })

  it('negates negative (becomes positive)', () => {
    expect(money.negate('-5.50')).toBe('5.50')
  })

  it('negates zero', () => {
    expect(money.negate('0.00')).toBe('0.00')
  })
})

describe('money comparisons', () => {
  it('gt', () => {
    expect(money.gt('10.00', '5.00')).toBe(true)
    expect(money.gt('5.00', '10.00')).toBe(false)
    expect(money.gt('5.00', '5.00')).toBe(false)
  })

  it('gte', () => {
    expect(money.gte('5.00', '5.00')).toBe(true)
    expect(money.gte('5.01', '5.00')).toBe(true)
  })

  it('lt', () => {
    expect(money.lt('1.00', '2.00')).toBe(true)
    expect(money.lt('2.00', '1.00')).toBe(false)
  })

  it('lte', () => {
    expect(money.lte('5.00', '5.00')).toBe(true)
    expect(money.lte('4.99', '5.00')).toBe(true)
  })

  it('eq', () => {
    expect(money.eq('1.00', '1.0')).toBe(true)
    expect(money.eq('1.00', '1.01')).toBe(false)
  })
})

describe('money.isZero', () => {
  it('returns true for zero values', () => {
    expect(money.isZero('0')).toBe(true)
    expect(money.isZero('0.00')).toBe(true)
  })

  it('returns false for non-zero', () => {
    expect(money.isZero('0.01')).toBe(false)
    expect(money.isZero('-0.01')).toBe(false)
  })
})

describe('money.isNegative', () => {
  it('returns true for negatives', () => {
    expect(money.isNegative('-1.00')).toBe(true)
  })

  it('returns false for zero and positive', () => {
    expect(money.isNegative('0.00')).toBe(false)
    expect(money.isNegative('1.00')).toBe(false)
  })
})

describe('money.sum', () => {
  it('sums an array of money strings', () => {
    expect(money.sum(['1.00', '2.00', '3.00'])).toBe('6.00')
  })

  it('returns 0.00 for empty array', () => {
    expect(money.sum([])).toBe('0.00')
  })

  it('handles mixed sign values', () => {
    expect(money.sum(['10.00', '-3.00', '1.50'])).toBe('8.50')
  })
})

// --- Qty ---

describe('qty.add', () => {
  it('adds to 4dp', () => {
    expect(qty.add('1.0000', '2.0000')).toBe('3.0000')
    expect(qty.add('0.1', '0.2')).toBe('0.3000')
  })
})

describe('qty.sub', () => {
  it('subtracts to 4dp', () => {
    expect(qty.sub('5.0000', '2.5000')).toBe('2.5000')
  })
})

describe('qty.mul', () => {
  it('multiplies and rounds to 4dp', () => {
    expect(qty.mul('3.0000', '2.0000')).toBe('6.0000')
    expect(qty.mul('1.00001', '1.0000')).toBe('1.0000')
  })
})

describe('qty.round4', () => {
  it('rounds to 4dp', () => {
    expect(qty.round4('1.12345')).toBe('1.1235')
    expect(qty.round4(0)).toBe('0.0000')
  })
})

describe('qty.negate', () => {
  it('negates', () => {
    expect(qty.negate('3.5000')).toBe('-3.5000')
    expect(qty.negate('-2.0000')).toBe('2.0000')
  })
})

describe('qty comparisons', () => {
  it('gt / lt / eq', () => {
    expect(qty.gt('2.0000', '1.0000')).toBe(true)
    expect(qty.lt('1.0000', '2.0000')).toBe(true)
    expect(qty.eq('1.5000', '1.5')).toBe(true)
  })

  it('gte', () => {
    expect(qty.gte('1.0000', '1.0000')).toBe(true)
  })
})

describe('qty.isZero', () => {
  it('detects zero', () => {
    expect(qty.isZero('0.0000')).toBe(true)
    expect(qty.isZero('0.0001')).toBe(false)
  })
})

describe('qty.isNegative', () => {
  it('detects negatives', () => {
    expect(qty.isNegative('-0.0001')).toBe(true)
    expect(qty.isNegative('0.0000')).toBe(false)
  })
})

describe('qty.sum', () => {
  it('sums to 4dp', () => {
    expect(qty.sum(['1.0000', '2.5000', '0.5000'])).toBe('4.0000')
    expect(qty.sum([])).toBe('0.0000')
  })
})
