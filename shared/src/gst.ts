import { z } from 'zod'
import { GstCategory, IsoDate } from './primitives.js'
import { Decimal } from 'decimal.js'

// Request schema for creating a new GST rate row (FUNCTIONS.md §gst)
export const GstRateCreate = z.object({
  category: GstCategory,
  // Decimal fraction: 0.0800 for 8%, 0.1700 for 17%
  rate: z.string().regex(/^\d+(\.\d{1,4})?$/, 'Rate must be a decimal fraction (e.g. "0.0800")'),
  validFrom: IsoDate,
})
export type GstRateCreate = z.infer<typeof GstRateCreate>

Decimal.set({ rounding: Decimal.ROUND_HALF_UP })

export interface GstLineResult {
  /** GST amount rounded to 2dp per ARCHITECTURE.md §4.1 */
  gst: string
  /** taxableValue + gst */
  gross: string
}

/**
 * Compute GST for a single invoice/bill line.
 *
 * Rule (ARCHITECTURE.md §4.1): round to 2dp PER LINE then sum.
 * Never sum taxable values first and round once — that diverges from MIRA's expectation.
 *
 * @param taxableValue  Net (pre-tax) line value as stringified decimal
 * @param rate          Rate as a decimal fraction, e.g. '0.08' for 8%, '0.17' for 17%
 */
export function gstFor(taxableValue: string, rate: string): GstLineResult {
  const tv = new Decimal(taxableValue)
  const r = new Decimal(rate)
  const gst = tv.times(r).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
  const gross = tv.plus(gst)
  return {
    gst: gst.toFixed(2),
    gross: gross.toFixed(2),
  }
}

export interface GstSummary {
  totalTaxable: string
  totalGst: string
  totalGross: string
}

/**
 * Aggregate pre-computed per-line results into document totals.
 * Inputs are already per-line-rounded strings from gstFor().
 */
export function sumGstLines(lines: Array<{ taxable: string; gst: string }>): GstSummary {
  let totalTaxable = new Decimal(0)
  let totalGst = new Decimal(0)

  for (const line of lines) {
    totalTaxable = totalTaxable.plus(new Decimal(line.taxable))
    totalGst = totalGst.plus(new Decimal(line.gst))
  }

  return {
    totalTaxable: totalTaxable.toFixed(2),
    totalGst: totalGst.toFixed(2),
    totalGross: totalTaxable.plus(totalGst).toFixed(2),
  }
}

/** GST rate fractions keyed by GstCategory. Used with gstFor(). */
export const GST_RATES: Record<string, string> = {
  general_8: '0.08',
  tourism_16: '0.16',
  tourism_17: '0.17',
  zero: '0.00',
  exempt: '0.00',
}
