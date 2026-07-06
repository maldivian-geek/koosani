import { Decimal } from 'decimal.js'

Decimal.set({ rounding: Decimal.ROUND_HALF_UP })

// --- Money helpers (all inputs/outputs are stringified decimals at 2dp) ---

function add(a: string, b: string): string {
  return new Decimal(a).plus(new Decimal(b)).toFixed(2)
}

function sub(a: string, b: string): string {
  return new Decimal(a).minus(new Decimal(b)).toFixed(2)
}

function mul(a: string, b: string): string {
  return new Decimal(a).times(new Decimal(b)).toFixed(2)
}

function round2(a: string | number): string {
  return new Decimal(a).toFixed(2)
}

function negate(a: string): string {
  return new Decimal(a).negated().toFixed(2)
}

function gt(a: string, b: string): boolean {
  return new Decimal(a).greaterThan(new Decimal(b))
}

function gte(a: string, b: string): boolean {
  return new Decimal(a).greaterThanOrEqualTo(new Decimal(b))
}

function lt(a: string, b: string): boolean {
  return new Decimal(a).lessThan(new Decimal(b))
}

function lte(a: string, b: string): boolean {
  return new Decimal(a).lessThanOrEqualTo(new Decimal(b))
}

function eq(a: string, b: string): boolean {
  return new Decimal(a).equals(new Decimal(b))
}

function isZero(a: string): boolean {
  return new Decimal(a).isZero()
}

function isNegative(a: string): boolean {
  return new Decimal(a).isNegative()
}

function sum(values: string[]): string {
  return values.reduce((acc, v) => new Decimal(acc).plus(new Decimal(v)), new Decimal(0)).toFixed(2)
}

export const money = {
  add,
  sub,
  mul,
  round2,
  negate,
  gt,
  gte,
  lt,
  lte,
  eq,
  isZero,
  isNegative,
  sum,
}

// --- Qty helpers (all inputs/outputs are stringified decimals at 4dp) ---

function qAdd(a: string, b: string): string {
  return new Decimal(a).plus(new Decimal(b)).toFixed(4)
}

function qSub(a: string, b: string): string {
  return new Decimal(a).minus(new Decimal(b)).toFixed(4)
}

function qMul(a: string, b: string): string {
  return new Decimal(a).times(new Decimal(b)).toFixed(4)
}

function qRound4(a: string | number): string {
  return new Decimal(a).toFixed(4)
}

function qNegate(a: string): string {
  return new Decimal(a).negated().toFixed(4)
}

function qGt(a: string, b: string): boolean {
  return new Decimal(a).greaterThan(new Decimal(b))
}

function qGte(a: string, b: string): boolean {
  return new Decimal(a).greaterThanOrEqualTo(new Decimal(b))
}

function qLt(a: string, b: string): boolean {
  return new Decimal(a).lessThan(new Decimal(b))
}

function qEq(a: string, b: string): boolean {
  return new Decimal(a).equals(new Decimal(b))
}

function qIsZero(a: string): boolean {
  return new Decimal(a).isZero()
}

function qIsNegative(a: string): boolean {
  return new Decimal(a).isNegative()
}

function qSum(values: string[]): string {
  return values.reduce((acc, v) => new Decimal(acc).plus(new Decimal(v)), new Decimal(0)).toFixed(4)
}

export const qty = {
  add: qAdd,
  sub: qSub,
  mul: qMul,
  round4: qRound4,
  negate: qNegate,
  gt: qGt,
  gte: qGte,
  lt: qLt,
  eq: qEq,
  isZero: qIsZero,
  isNegative: qIsNegative,
  sum: qSum,
}

// --- Exchange rate helpers (Phase 30, UPGRADE.md G-10) ---
// Rates are stringified decimals at 6dp (MVR per 1 unit of foreign currency).
// Converting a document-currency amount to its MVR equivalent always rounds
// to 2dp — money.mul can't be reused directly since its inputs/output are
// both 2dp, which would truncate the rate's precision before multiplying.

function rateRound6(a: string | number | Decimal): string {
  return new Decimal(a).toFixed(6)
}

// amount is a 2dp money string in the document currency; rate is a 6dp
// exchange rate (MVR per unit); result is a 2dp money string in MVR.
function toMvr(amount: string, rate: string): string {
  return new Decimal(amount).times(new Decimal(rate)).toFixed(2)
}

export const exchangeRate = {
  round6: rateRound6,
  toMvr,
}
