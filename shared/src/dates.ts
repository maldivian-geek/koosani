/** Maldives standard timezone — UTC+5, no DST. */
export const MV_TZ = 'Indian/Maldives'

// Reuse a single formatter instance for performance.
const _fmt = new Intl.DateTimeFormat('en', {
  timeZone: MV_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

/**
 * Format a Date as YYYY-MM-DD in Maldives timezone.
 */
export function formatMvDate(date: Date): string {
  const parts = _fmt.formatToParts(date)
  const year = parts.find((p) => p.type === 'year')!.value
  const month = parts.find((p) => p.type === 'month')!.value
  const day = parts.find((p) => p.type === 'day')!.value
  return `${year}-${month}-${day}`
}

/**
 * Today's date as YYYY-MM-DD in Maldives timezone.
 */
export function todayMv(): string {
  return formatMvDate(new Date())
}

/**
 * Parse a YYYY-MM-DD string as the start of that day in Maldives timezone.
 * Maldives is always UTC+5 (no DST), so midnight MV = 19:00 UTC the previous day.
 */
export function parseMvDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00+05:00`)
}

/**
 * Parse a YYYY-MM-DD string as end of that day (23:59:59.999) in Maldives timezone.
 */
export function endOfMvDay(isoDate: string): Date {
  return new Date(`${isoDate}T23:59:59.999+05:00`)
}

/**
 * True if `date` (YYYY-MM-DD) falls within [from, to] inclusive.
 * All three values must be YYYY-MM-DD strings comparable lexicographically.
 */
export function isInMvRange(date: string, from: string, to: string): boolean {
  return date >= from && date <= to
}

/**
 * Extract year and month number from a YYYY-MM-DD string.
 */
export function mvYearMonth(isoDate: string): { year: number; month: number } {
  const [yearStr, monthStr] = isoDate.split('-')
  return { year: parseInt(yearStr!, 10), month: parseInt(monthStr!, 10) }
}

/**
 * Return the first day of the month containing `isoDate` as YYYY-MM-DD.
 */
export function startOfMvMonth(isoDate: string): string {
  const { year, month } = mvYearMonth(isoDate)
  return `${year}-${String(month).padStart(2, '0')}-01`
}

/**
 * Return the last day of the month containing `isoDate` as YYYY-MM-DD.
 */
export function endOfMvMonth(isoDate: string): string {
  const { year, month } = mvYearMonth(isoDate)
  const lastDay = new Date(year, month, 0).getDate()
  return `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
}

/**
 * Add `n` days to a YYYY-MM-DD string, returning a new YYYY-MM-DD.
 * Operates on the calendar date; does not involve tz conversion.
 */
export function addDays(isoDate: string, n: number): string {
  const d = parseMvDate(isoDate)
  d.setUTCDate(d.getUTCDate() + n)
  return formatMvDate(d)
}
