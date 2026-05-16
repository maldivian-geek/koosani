import { describe, it, expect } from 'vitest'
import { gstFor, sumGstLines, GST_RATES } from './gst.js'

describe('gstFor — 8% general GST', () => {
  it('computes correctly for a round figure', () => {
    const result = gstFor('100.00', GST_RATES['general_8']!)
    expect(result.gst).toBe('8.00')
    expect(result.gross).toBe('108.00')
  })

  it('rounds per-line to 2dp (ROUND_HALF_UP)', () => {
    // 10.01 * 0.08 = 0.8008 → rounds to 0.80
    const r = gstFor('10.01', '0.08')
    expect(r.gst).toBe('0.80')
    expect(r.gross).toBe('10.81')
  })

  it('handles zero taxable value', () => {
    const r = gstFor('0.00', '0.08')
    expect(r.gst).toBe('0.00')
    expect(r.gross).toBe('0.00')
  })
})

describe('gstFor — 17% tourism GST', () => {
  it('computes correctly', () => {
    const r = gstFor('500.00', GST_RATES['tourism_17']!)
    expect(r.gst).toBe('85.00')
    expect(r.gross).toBe('585.00')
  })

  it('rounds fractional result to 2dp', () => {
    // 1.00 * 0.17 = 0.17 exactly
    const r = gstFor('1.00', '0.17')
    expect(r.gst).toBe('0.17')
    // 3.00 * 0.17 = 0.51
    const r2 = gstFor('3.00', '0.17')
    expect(r2.gst).toBe('0.51')
    // 7.00 * 0.17 = 1.19
    const r3 = gstFor('7.00', '0.17')
    expect(r3.gst).toBe('1.19')
  })
})

describe('gstFor — zero / exempt rate', () => {
  it('returns zero gst for zero-rated items', () => {
    const r = gstFor('250.00', GST_RATES['zero']!)
    expect(r.gst).toBe('0.00')
    expect(r.gross).toBe('250.00')
  })

  it('returns zero gst for exempt items', () => {
    const r = gstFor('100.00', GST_RATES['exempt']!)
    expect(r.gst).toBe('0.00')
    expect(r.gross).toBe('100.00')
  })
})

describe('per-line vs. aggregate rounding — ARCHITECTURE.md §4.1', () => {
  it('per-line sum differs from round-then-sum for the classic 3-thirds example', () => {
    // 3 lines of 33.33 each at 8%
    // Per-line: each gst = 33.33 * 0.08 = 2.6664 → 2.67 each → total = 8.01
    // Wrong way: sum 3*33.33 = 99.99, then * 0.08 = 7.9992 → 8.00
    const lines = [gstFor('33.33', '0.08'), gstFor('33.33', '0.08'), gstFor('33.33', '0.08')]
    const totalGst = lines
      .map((l) => parseFloat(l.gst))
      .reduce((a, b) => a + b, 0)
      .toFixed(2)
    expect(totalGst).toBe('8.01')
    // Wrong aggregate would be 8.00; per-line is 8.01 — we deliberately choose per-line
    expect(totalGst).not.toBe('8.00')
  })
})

describe('sumGstLines', () => {
  it('aggregates multiple lines', () => {
    const lines = [
      { taxable: '100.00', gst: '8.00' },
      { taxable: '200.00', gst: '16.00' },
      { taxable: '50.00', gst: '4.00' },
    ]
    const result = sumGstLines(lines)
    expect(result.totalTaxable).toBe('350.00')
    expect(result.totalGst).toBe('28.00')
    expect(result.totalGross).toBe('378.00')
  })

  it('handles empty array', () => {
    const result = sumGstLines([])
    expect(result.totalTaxable).toBe('0.00')
    expect(result.totalGst).toBe('0.00')
    expect(result.totalGross).toBe('0.00')
  })

  it('handles mixed GST categories in one document', () => {
    const line1 = gstFor('1000.00', '0.08') // general 8%
    const line2 = gstFor('500.00', '0.17') // tourism 17%
    const line3 = gstFor('200.00', '0.00') // exempt
    const result = sumGstLines([
      { taxable: '1000.00', gst: line1.gst },
      { taxable: '500.00', gst: line2.gst },
      { taxable: '200.00', gst: line3.gst },
    ])
    expect(result.totalTaxable).toBe('1700.00')
    expect(result.totalGst).toBe('165.00') // 80 + 85 + 0
    expect(result.totalGross).toBe('1865.00')
  })
})

describe('GST_RATES constant', () => {
  it('has expected keys and values', () => {
    expect(GST_RATES['general_8']).toBe('0.08')
    expect(GST_RATES['tourism_16']).toBe('0.16')
    expect(GST_RATES['tourism_17']).toBe('0.17')
    expect(GST_RATES['zero']).toBe('0.00')
    expect(GST_RATES['exempt']).toBe('0.00')
  })
})
