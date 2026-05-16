import Decimal from 'decimal.js'
import { db } from '../../db/client.js'
import * as repo from './repository.js'
import * as audit from '../audit/service.js'
import type { AuditCtx } from '../audit/service.js'
import type { GstRate, GstPeriod } from './repository.js'
import type { GstRateCreate } from '@koosani/shared'

export type { AuditCtx }
export type { GstRate, GstPeriod }

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
