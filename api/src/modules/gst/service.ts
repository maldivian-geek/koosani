import Decimal from 'decimal.js'
import { db } from '../../db/client.js'
import * as repo from './repository.js'
import * as filesService from '../files/service.js'
import * as audit from '../audit/service.js'
import type { AuditCtx } from '../audit/service.js'
import type { GstRate, GstPeriod, GstReturn, PeriodLineAgg } from './repository.js'
import type { GstRateCreate } from '@koosani/shared'

export type { AuditCtx }
export type { GstRate, GstPeriod, GstReturn }

// ─── Error types ──────────────────────────────────────────────────────────────

export class PeriodLockedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PeriodLockedError'
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ValidationError'
  }
}

// ─── Period bound computation ─────────────────────────────────────────────────

function computePeriodBounds(
  date: string,
  periodType: 'monthly' | 'quarterly',
): { periodStart: string; periodEnd: string } {
  const [yearStr, monthStr] = date.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr) - 1 // 0-based

  if (periodType === 'monthly') {
    const start = new Date(Date.UTC(year, month, 1))
    // Day 0 of next month = last day of this month
    const end = new Date(Date.UTC(year, month + 1, 0))
    return {
      periodStart: start.toISOString().slice(0, 10),
      periodEnd: end.toISOString().slice(0, 10),
    }
  }

  // Quarterly: Q1=Jan-Mar, Q2=Apr-Jun, Q3=Jul-Sep, Q4=Oct-Dec
  const quarter = Math.floor(month / 3)
  const startMonth = quarter * 3
  const start = new Date(Date.UTC(year, startMonth, 1))
  const end = new Date(Date.UTC(year, startMonth + 3, 0))
  return {
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
  }
}

// ─── rateAt ───────────────────────────────────────────────────────────────────
// Resolves the GST rate active on a given date for a given category.
// Throws NotFoundError if no rate row covers this date (rates must be seeded).

export async function rateAt(
  businessId: string,
  category: GstRate['category'],
  date: string,
): Promise<Decimal> {
  const row = await repo.getRateAt(businessId, category, date)
  if (!row) {
    throw new NotFoundError(`No GST rate found for category '${category}' on date '${date}'`)
  }
  return new Decimal(row.rate)
}

// ─── assertPeriodOpen ─────────────────────────────────────────────────────────
// Finds or auto-creates the GST period containing `date`.
// Throws PeriodLockedError if that period is locked (ARCHITECTURE.md §4.4).
// Called by invoicing and purchases on issue/confirm.

export async function assertPeriodOpen(
  businessId: string,
  date: string,
  ctx: AuditCtx,
): Promise<void> {
  const period = await getOrCreatePeriod(businessId, date, ctx)
  if (period.status === 'locked') {
    throw new PeriodLockedError(
      `GST period ${period.periodStart}–${period.periodEnd} is locked. Late entries must use today's date.`,
    )
  }
}

async function getOrCreatePeriod(
  businessId: string,
  date: string,
  ctx: AuditCtx,
): Promise<GstPeriod> {
  const existing = await repo.getPeriodForDate(businessId, date)
  if (existing) return existing

  const periodType = await repo.getBusinessPeriodType(businessId)
  const { periodStart, periodEnd } = computePeriodBounds(date, periodType)

  return db.transaction(async (tx) => {
    return repo.upsertPeriod(
      { businessId, periodStart, periodEnd, periodType, createdBy: ctx.userId },
      tx,
    )
  })
}

// ─── getPeriodById ────────────────────────────────────────────────────────────

export async function getPeriodById(businessId: string, id: string): Promise<GstPeriod | null> {
  return repo.getPeriodById(businessId, id)
}

// ─── listPeriods ──────────────────────────────────────────────────────────────

export async function listPeriods(businessId: string): Promise<GstPeriod[]> {
  return repo.listPeriods(businessId)
}

// ─── listRates ────────────────────────────────────────────────────────────────

export async function listRates(businessId: string): Promise<GstRate[]> {
  return repo.listRates(businessId)
}

// ─── createRate ───────────────────────────────────────────────────────────────

export async function createRate(
  businessId: string,
  data: GstRateCreate,
  ctx: AuditCtx,
): Promise<GstRate> {
  return db.transaction(async (tx) => {
    const rate = await repo.insertRate(
      {
        businessId,
        category: data.category,
        rate: data.rate,
        validFrom: data.validFrom,
        createdBy: ctx.userId,
      },
      tx,
    )
    await audit.record(
      'gst.rate_created',
      'gst_rate',
      rate.id,
      null,
      { category: data.category, rate: data.rate, validFrom: data.validFrom },
      ctx,
      tx,
    )
    return rate
  })
}

// ─── lockPeriod ───────────────────────────────────────────────────────────────

export async function lockPeriod(
  businessId: string,
  periodId: string,
  miraReturnRef: string,
  ctx: AuditCtx,
): Promise<GstPeriod> {
  const existing = await repo.getPeriodById(businessId, periodId)
  if (!existing) throw new NotFoundError(`GST period ${periodId} not found`)
  if (existing.status === 'locked') throw new ValidationError('Period is already locked')

  return db.transaction(async (tx) => {
    const period = await repo.lockPeriod(periodId, miraReturnRef, ctx.userId, tx)
    await audit.record(
      'gst.period_locked',
      'gst_period',
      periodId,
      { status: existing.status },
      { status: 'locked', miraReturnRef },
      ctx,
      tx,
    )
    return period
  })
}

// ─── getLatestReturn ──────────────────────────────────────────────────────────

export async function getLatestReturn(
  businessId: string,
  periodId: string,
): Promise<GstReturn | null> {
  return repo.getLatestReturnForPeriod(businessId, periodId)
}

// ─── buildReturn ──────────────────────────────────────────────────────────────
// Aggregates issued invoices, credit notes, and confirmed bills for the period.
// Produces MIRA 205 (general sector), MIRA 206 (tourism sector), and an
// Input Tax Statement CSV. Snapshot stored in gst_returns; CSV uploaded via
// files module; signed URLs returned from GET /gst/periods/:id/return.
//
// MIRAconnect has no public API — files are exported for manual upload.
// (ARCHITECTURE.md §3)

interface Mira205 {
  periodStart: string
  periodEnd: string
  generatedAt: string
  taxableSuppliesStandardRate: string
  outputTax: string
  zeroRatedSupplies: string
  exemptSupplies: string
  totalSupplies: string
  totalOutputTax: string
  inputTax: string
  netTaxPayable: string
}

interface Mira206 {
  periodStart: string
  periodEnd: string
  generatedAt: string
  taxableSupplies16: string
  outputTax16: string
  taxableSupplies17: string
  outputTax17: string
  zeroRatedSupplies: string
  exemptSupplies: string
  totalSupplies: string
  totalOutputTax: string
  inputTax: string
  netTaxPayable: string
}

interface InputTaxRow {
  supplierTin: string
  supplierName: string
  totalPurchases: string
  inputGst: string
}

function byCat(
  rows: PeriodLineAgg[],
  category: string,
): { net: Decimal; gst: Decimal } {
  const row = rows.find((r) => r.category === category)
  return {
    net: row ? new Decimal(row.netAmount) : new Decimal(0),
    gst: row ? new Decimal(row.gstAmount) : new Decimal(0),
  }
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

export async function buildReturn(
  businessId: string,
  periodId: string,
  ctx: AuditCtx,
): Promise<GstReturn> {
  const period = await repo.getPeriodById(businessId, periodId)
  if (!period) throw new NotFoundError(`GST period ${periodId} not found`)

  const { periodStart, periodEnd } = period

  // Read persisted amounts only — no rate recomputation (ARCHITECTURE.md §3)
  const [invLines, cnLines, billLines] = await Promise.all([
    repo.getInvoiceLinesForPeriod(businessId, periodStart, periodEnd),
    repo.getCreditNoteLinesForPeriod(businessId, periodStart, periodEnd),
    repo.getBillLinesForPeriod(businessId, periodStart, periodEnd),
  ])

  // ─── MIRA 205 (general sector) ───────────────────────────────────────────────
  const g8Out = byCat(invLines, 'general_8')
  const g8Cn = byCat(cnLines, 'general_8')
  const zeroOut = byCat(invLines, 'zero')
  const zeroCn = byCat(cnLines, 'zero')
  const exOut = byCat(invLines, 'exempt')
  const exCn = byCat(cnLines, 'exempt')

  const m205TaxableNet = g8Out.net.minus(g8Cn.net)
  const m205OutputTax = g8Out.gst.minus(g8Cn.gst)
  const m205Zero = zeroOut.net.minus(zeroCn.net)
  const m205Exempt = exOut.net.minus(exCn.net)
  const m205TotalSupplies = m205TaxableNet.plus(m205Zero).plus(m205Exempt)

  const g8BillGst = billLines
    .filter((b) => b.category === 'general_8')
    .reduce((acc, b) => acc.plus(new Decimal(b.gstAmount)), new Decimal(0))
  const m205NetPayable = m205OutputTax.minus(g8BillGst)

  const hasGeneral =
    !m205TaxableNet.isZero() || !m205Zero.isZero() || !m205Exempt.isZero() || !g8BillGst.isZero()

  const mira205: Mira205 | null = hasGeneral
    ? {
        periodStart,
        periodEnd,
        generatedAt: new Date().toISOString(),
        taxableSuppliesStandardRate: m205TaxableNet.toFixed(2),
        outputTax: m205OutputTax.toFixed(2),
        zeroRatedSupplies: m205Zero.toFixed(2),
        exemptSupplies: m205Exempt.toFixed(2),
        totalSupplies: m205TotalSupplies.toFixed(2),
        totalOutputTax: m205OutputTax.toFixed(2),
        inputTax: g8BillGst.toFixed(2),
        netTaxPayable: m205NetPayable.toFixed(2),
      }
    : null

  // ─── MIRA 206 (tourism sector) ───────────────────────────────────────────────
  const t16Out = byCat(invLines, 'tourism_16')
  const t16Cn = byCat(cnLines, 'tourism_16')
  const t17Out = byCat(invLines, 'tourism_17')
  const t17Cn = byCat(cnLines, 'tourism_17')

  const m206Taxable16 = t16Out.net.minus(t16Cn.net)
  const m206Tax16 = t16Out.gst.minus(t16Cn.gst)
  const m206Taxable17 = t17Out.net.minus(t17Cn.net)
  const m206Tax17 = t17Out.gst.minus(t17Cn.gst)
  const m206TotalTaxable = m206Taxable16.plus(m206Taxable17)
  const m206TotalTax = m206Tax16.plus(m206Tax17)

  const tourismBillGst = billLines
    .filter((b) => b.category === 'tourism_16' || b.category === 'tourism_17')
    .reduce((acc, b) => acc.plus(new Decimal(b.gstAmount)), new Decimal(0))
  const m206NetPayable = m206TotalTax.minus(tourismBillGst)

  const hasTourism = !m206TotalTaxable.isZero() || !tourismBillGst.isZero()

  const mira206: Mira206 | null = hasTourism
    ? {
        periodStart,
        periodEnd,
        generatedAt: new Date().toISOString(),
        taxableSupplies16: m206Taxable16.toFixed(2),
        outputTax16: m206Tax16.toFixed(2),
        taxableSupplies17: m206Taxable17.toFixed(2),
        outputTax17: m206Tax17.toFixed(2),
        zeroRatedSupplies: '0.00',
        exemptSupplies: '0.00',
        totalSupplies: m206TotalTaxable.toFixed(2),
        totalOutputTax: m206TotalTax.toFixed(2),
        inputTax: tourismBillGst.toFixed(2),
        netTaxPayable: m206NetPayable.toFixed(2),
      }
    : null

  // ─── Input Tax Statement ──────────────────────────────────────────────────────
  // One row per supplier; aggregates all categories (general + tourism).
  const supplierTotals = new Map<
    string,
    { name: string; tin: string | null; net: Decimal; gst: Decimal }
  >()
  for (const line of billLines) {
    const entry = supplierTotals.get(line.supplierId) ?? {
      name: line.supplierName,
      tin: line.supplierTin,
      net: new Decimal(0),
      gst: new Decimal(0),
    }
    entry.net = entry.net.plus(new Decimal(line.netAmount))
    entry.gst = entry.gst.plus(new Decimal(line.gstAmount))
    supplierTotals.set(line.supplierId, entry)
  }

  const itsRows: InputTaxRow[] = Array.from(supplierTotals.values()).map((s) => ({
    supplierTin: s.tin ?? '',
    supplierName: s.name,
    totalPurchases: s.net.toFixed(2),
    inputGst: s.gst.toFixed(2),
  }))

  const csvContent = [
    'Supplier TIN,Supplier Name,Total Purchases (MVR),Input GST (MVR)',
    ...itsRows.map(
      (r) =>
        `${csvEscape(r.supplierTin)},${csvEscape(r.supplierName)},${r.totalPurchases},${r.inputGst}`,
    ),
  ].join('\n')

  const itsFile = await filesService.uploadFile(
    businessId,
    Buffer.from(csvContent, 'utf-8'),
    `gst-its-${periodStart}-${periodEnd}.csv`,
    'text/csv',
    ctx,
  )

  const summaryJson = { mira205, mira206, inputTaxRows: itsRows }
  const fileRefs: Array<{ kind: string; fileId: string }> = [
    { kind: 'its', fileId: itsFile.id },
  ]

  return db.transaction(async (tx) => {
    const gstReturn = await repo.insertGstReturn(
      { businessId, periodId, summaryJson, files: fileRefs, builtBy: ctx.userId },
      tx,
    )
    await repo.markPeriodBuilt(periodId, ctx.userId, tx)
    await audit.record(
      'gst.return_built',
      'gst_return',
      gstReturn.id,
      null,
      { periodId, periodStart, periodEnd },
      ctx,
      tx,
    )
    return gstReturn
  })
}

// ─── unlockPeriod ─────────────────────────────────────────────────────────────
// Admin only; fully audited (FUNCTIONS.md §gst).

export async function unlockPeriod(
  businessId: string,
  periodId: string,
  reason: string,
  ctx: AuditCtx,
): Promise<GstPeriod> {
  const existing = await repo.getPeriodById(businessId, periodId)
  if (!existing) throw new NotFoundError(`GST period ${periodId} not found`)
  if (existing.status !== 'locked') throw new ValidationError('Period is not locked')

  return db.transaction(async (tx) => {
    const period = await repo.unlockPeriod(periodId, ctx.userId, tx)
    await audit.record(
      'gst.period_unlocked',
      'gst_period',
      periodId,
      { status: 'locked', miraReturnRef: existing.miraReturnRef },
      { status: 'open', reason },
      ctx,
      tx,
    )
    return period
  })
}
