import { describe, it, expect } from 'vitest'
import {
  formatMvDate,
  todayMv,
  parseMvDate,
  endOfMvDay,
  isInMvRange,
  mvYearMonth,
  startOfMvMonth,
  endOfMvMonth,
  addDays,
  daysBetween,
  addMonths,
  advanceByFrequency,
  MV_TZ,
} from './dates.js'

describe('MV_TZ', () => {
  it('is Indian/Maldives', () => {
    expect(MV_TZ).toBe('Indian/Maldives')
  })
})

describe('formatMvDate', () => {
  it('formats a UTC date as YYYY-MM-DD in MV timezone (UTC+5)', () => {
    // 2026-05-15T20:00:00Z = 2026-05-16T01:00:00+05:00 → MV date is 2026-05-16
    const d = new Date('2026-05-15T20:00:00Z')
    expect(formatMvDate(d)).toBe('2026-05-16')
  })

  it('returns same date when within UTC+5 day', () => {
    // 2026-05-16T10:00:00+05:00 = 2026-05-16T05:00:00Z
    const d = new Date('2026-05-16T05:00:00Z')
    expect(formatMvDate(d)).toBe('2026-05-16')
  })

  it('handles month/day padding', () => {
    // Jan 5
    const d = parseMvDate('2026-01-05')
    expect(formatMvDate(d)).toBe('2026-01-05')
  })
})

describe('todayMv', () => {
  it('returns a YYYY-MM-DD string', () => {
    const today = todayMv()
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('parseMvDate', () => {
  it('parses to start of day in MV timezone', () => {
    // 2026-05-16T00:00:00+05:00 = 2026-05-15T19:00:00Z
    const d = parseMvDate('2026-05-16')
    expect(d.getTime()).toBe(new Date('2026-05-15T19:00:00Z').getTime())
  })
})

describe('endOfMvDay', () => {
  it('returns end of day in MV timezone', () => {
    // 2026-05-16T23:59:59.999+05:00 = 2026-05-16T18:59:59.999Z
    const d = endOfMvDay('2026-05-16')
    expect(d.getTime()).toBe(new Date('2026-05-16T18:59:59.999Z').getTime())
  })
})

describe('isInMvRange', () => {
  it('returns true when date is within range', () => {
    expect(isInMvRange('2026-03-15', '2026-03-01', '2026-03-31')).toBe(true)
  })

  it('returns true on boundary dates', () => {
    expect(isInMvRange('2026-03-01', '2026-03-01', '2026-03-31')).toBe(true)
    expect(isInMvRange('2026-03-31', '2026-03-01', '2026-03-31')).toBe(true)
  })

  it('returns false outside range', () => {
    expect(isInMvRange('2026-02-28', '2026-03-01', '2026-03-31')).toBe(false)
    expect(isInMvRange('2026-04-01', '2026-03-01', '2026-03-31')).toBe(false)
  })
})

describe('mvYearMonth', () => {
  it('extracts year and month', () => {
    expect(mvYearMonth('2026-05-16')).toEqual({ year: 2026, month: 5 })
    expect(mvYearMonth('2000-01-31')).toEqual({ year: 2000, month: 1 })
  })
})

describe('startOfMvMonth', () => {
  it('returns first day of the month', () => {
    expect(startOfMvMonth('2026-05-16')).toBe('2026-05-01')
    expect(startOfMvMonth('2026-12-31')).toBe('2026-12-01')
  })
})

describe('endOfMvMonth', () => {
  it('returns last day of February (non-leap)', () => {
    expect(endOfMvMonth('2026-02-15')).toBe('2026-02-28')
  })

  it('returns last day of February (leap year)', () => {
    expect(endOfMvMonth('2024-02-15')).toBe('2024-02-29')
  })

  it('returns last day of 31-day months', () => {
    expect(endOfMvMonth('2026-05-01')).toBe('2026-05-31')
    expect(endOfMvMonth('2026-01-01')).toBe('2026-01-31')
  })

  it('returns last day of 30-day months', () => {
    expect(endOfMvMonth('2026-04-01')).toBe('2026-04-30')
    expect(endOfMvMonth('2026-06-01')).toBe('2026-06-30')
  })
})

describe('addDays', () => {
  it('adds days to a date', () => {
    expect(addDays('2026-05-16', 5)).toBe('2026-05-21')
  })

  it('rolls over month boundary', () => {
    expect(addDays('2026-05-31', 1)).toBe('2026-06-01')
  })

  it('rolls over year boundary', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('works with negative days (subtracting)', () => {
    expect(addDays('2026-05-16', -5)).toBe('2026-05-11')
  })

  it('zero days returns same date', () => {
    expect(addDays('2026-05-16', 0)).toBe('2026-05-16')
  })
})

describe('daysBetween', () => {
  it('is positive when to is after from (overdue case)', () => {
    expect(daysBetween('2026-05-01', '2026-05-08')).toBe(7)
  })

  it('is negative when to is before from', () => {
    expect(daysBetween('2026-05-08', '2026-05-01')).toBe(-7)
  })

  it('is zero for the same date', () => {
    expect(daysBetween('2026-05-16', '2026-05-16')).toBe(0)
  })

  it('crosses a month boundary correctly', () => {
    expect(daysBetween('2026-05-30', '2026-06-02')).toBe(3)
  })
})

describe('addMonths', () => {
  it('adds whole months within a year', () => {
    expect(addMonths('2026-03-15', 2)).toBe('2026-05-15')
  })

  it('rolls over year boundary', () => {
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15')
  })

  it('subtracts months with a negative n', () => {
    expect(addMonths('2026-03-15', -1)).toBe('2026-02-15')
  })
})

describe('advanceByFrequency', () => {
  it('weekly adds 7 days', () => {
    expect(advanceByFrequency('2026-05-16', 'weekly')).toBe('2026-05-23')
  })

  it('monthly adds 1 month', () => {
    expect(advanceByFrequency('2026-05-16', 'monthly')).toBe('2026-06-16')
  })

  it('quarterly adds 3 months', () => {
    expect(advanceByFrequency('2026-05-16', 'quarterly')).toBe('2026-08-16')
  })

  it('yearly adds 12 months', () => {
    expect(advanceByFrequency('2026-05-16', 'yearly')).toBe('2027-05-16')
  })
})
