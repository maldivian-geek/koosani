import Decimal from 'decimal.js'
import { db } from '../../db/client.js'
import * as repo from './repository.js'
import * as audit from '../audit/service.js'
import * as gst from '../gst/service.js'
import * as customers from '../customers/service.js'
import * as invoicing from '../invoicing/service.js'
import * as settings from '../settings/service.js'
import * as exchangeRates from '../exchangeRates/service.js'
import { emailQueue } from '../../lib/queues.js'
import type { AuditCtx, AuditRecordCtx } from '../audit/service.js'
import type {
  Estimate,
  EstimateLine,
  ListEstimateParams,
  EstimateWithCustomer,
} from './repository.js'
import type { EstimateDraftCreate, EstimateDraftPatch, CurrencyCode } from '@koosani/shared'
import { gstFor, sumGstLines, todayMv, addDays, money, exchangeRate } from '@koosani/shared'

export type {
  AuditCtx,
  AuditRecordCtx,
  Estimate,
  EstimateLine,
  ListEstimateParams,
  EstimateWithCustomer,
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

// ─── Pure helpers ─────────────────────────────────────────────────────────────
// GST here is computed for display only — no period lock, no snapshotting
// against a locked period the way invoice lines are (UPGRADE.md G-5: "no GST
// period interaction until converted").

type LineAmounts = { gstRate: string; gstAmount: string; lineTotal: string }

function computeLineAmounts(qty: string, unitPrice: string, rate: string): LineAmounts {
  const taxableValue = new Decimal(qty).times(unitPrice).toFixed(2)
  const { gst: gstAmt, gross } = gstFor(taxableValue, rate)
  return { gstRate: rate, gstAmount: gstAmt, lineTotal: gross }
}

export type Totals = { subtotal: string; gstAmount: string; total: string }

export function computeTotals(
  lines: Array<{ qty: string; unitPrice: string; gstAmount: string }>,
): Totals {
  const { totalTaxable, totalGst, totalGross } = sumGstLines(
    lines.map((l) => ({
      taxable: new Decimal(l.qty).times(l.unitPrice).toFixed(2),
      gst: l.gstAmount,
    })),
  )
  return { subtotal: totalTaxable, gstAmount: totalGst, total: totalGross }
}

// Multi-currency (Phase 30, UPGRADE.md G-10) — mirrors invoicing's own
// computeLineMvr/computeMvrTotals (ARCHITECTURE.md §4.10).
type LineMvr = { gstAmountMvr: string; lineTotalMvr: string }

function computeLineMvr(gstAmount: string, lineTotal: string, rate: string): LineMvr {
  return {
    gstAmountMvr: exchangeRate.toMvr(gstAmount, rate),
    lineTotalMvr: exchangeRate.toMvr(lineTotal, rate),
  }
}

type MvrTotals = { subtotalMvr: string; gstAmountMvr: string; totalMvr: string }

function computeMvrTotals(lines: Array<LineMvr>): MvrTotals {
  const gstAmountMvr = money.sum(lines.map((l) => l.gstAmountMvr))
  const totalMvr = money.sum(lines.map((l) => l.lineTotalMvr))
  const subtotalMvr = money.sub(totalMvr, gstAmountMvr)
  return { subtotalMvr, gstAmountMvr, totalMvr }
}

// ─── createDraft ──────────────────────────────────────────────────────────────

export async function createDraft(
  businessId: string,
  data: EstimateDraftCreate,
  ctx: AuditCtx,
): Promise<Estimate & { lines: EstimateLine[] }> {
  const customer = await customers.assertExists(data.customerId, businessId)
  const currency: CurrencyCode = data.currency ?? customer.currency

  return db.transaction(async (tx) => {
    const today = todayMv()
    const rate = await exchangeRates.rateAt(businessId, currency, today)
    const rateStr = exchangeRate.round6(rate)

    const lineInputs = await Promise.all(
      data.lines.map(async (l, idx) => {
        const gstRateVal = await gst.rateAt(businessId, l.gstCategory, today)
        const { gstRate, gstAmount, lineTotal } = computeLineAmounts(
          l.qty,
          l.unitPrice,
          gstRateVal.toString(),
        )
        const { gstAmountMvr, lineTotalMvr } = computeLineMvr(gstAmount, lineTotal, rateStr)
        return {
          businessId,
          estimateId: '' as string,
          itemId: l.itemId ?? null,
          description: l.description,
          qty: l.qty,
          unitPrice: l.unitPrice,
          gstCategory: l.gstCategory,
          gstRate,
          gstAmount,
          lineTotal,
          gstAmountMvr,
          lineTotalMvr,
          sortOrder: l.sortOrder ?? idx,
          createdBy: ctx.userId,
        }
      }),
    )

    const totals = computeTotals(lineInputs)
    const mvrTotals = computeMvrTotals(lineInputs)

    let expiryDate = data.expiryDate ?? null
    if (!expiryDate) {
      const business = await settings.get(businessId)
      expiryDate = addDays(today, business.defaultEstimateValidityDays)
    }

    const estimate = await repo.insertEstimate(
      {
        businessId,
        customerId: data.customerId,
        expiryDate,
        notes: data.notes ?? null,
        subtotal: totals.subtotal,
        gstAmount: totals.gstAmount,
        total: totals.total,
        currency,
        exchangeRate: rateStr,
        subtotalMvr: mvrTotals.subtotalMvr,
        gstAmountMvr: mvrTotals.gstAmountMvr,
        totalMvr: mvrTotals.totalMvr,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      },
      tx,
    )

    const lines = await repo.insertLines(
      lineInputs.map((l) => ({ ...l, estimateId: estimate.id })),
      tx,
    )

    await audit.record(
      'estimate.draft_created',
      'estimate',
      estimate.id,
      null,
      { customerId: data.customerId, total: totals.total, currency, lineCount: lines.length },
      ctx,
      tx,
    )

    return { ...estimate, lines }
  })
}

// ─── getEstimate ──────────────────────────────────────────────────────────────

export async function getEstimate(
  businessId: string,
  id: string,
): Promise<Estimate & { lines: EstimateLine[]; customerName: string }> {
  const estimate = await repo.getById(businessId, id)
  if (!estimate) throw new NotFoundError(`Estimate ${id} not found`)
  const [lines, customer] = await Promise.all([
    repo.getLinesByEstimate(businessId, id),
    customers.assertExists(estimate.customerId, businessId),
  ])
  return { ...estimate, lines, customerName: customer.name }
}

// ─── listEstimates ────────────────────────────────────────────────────────────

export async function listEstimates(
  businessId: string,
  params: ListEstimateParams,
): Promise<{ rows: EstimateWithCustomer[]; total: number }> {
  return repo.listEstimates(businessId, params)
}

export async function listExpiryCandidates(businessId: string): Promise<Estimate[]> {
  return repo.listExpiryCandidates(businessId)
}

// ─── patchDraft ───────────────────────────────────────────────────────────────

export async function patchDraft(
  businessId: string,
  id: string,
  data: EstimateDraftPatch,
  ctx: AuditCtx,
): Promise<Estimate & { lines: EstimateLine[] }> {
  return db.transaction(async (tx) => {
    const before = await repo.getById(businessId, id, tx)
    if (!before) throw new NotFoundError(`Estimate ${id} not found`)
    if (before.status !== 'draft') throw new ValidationError('Only draft estimates can be edited')

    let lines = await repo.getLinesByEstimate(businessId, id, tx)

    const today = todayMv()
    // Refreshed on every patch, same rationale as invoicing.patchDraft — a
    // manually-entered rate after draft creation should show in the preview.
    const rate = await exchangeRates.rateAt(businessId, before.currency, today)
    const rateStr = exchangeRate.round6(rate)

    if (data.lines) {
      await repo.deleteLinesByEstimate(businessId, id, tx)
      const lineInputs = await Promise.all(
        data.lines.map(async (l, idx) => {
          const gstRateVal = await gst.rateAt(businessId, l.gstCategory, today)
          const { gstRate, gstAmount, lineTotal } = computeLineAmounts(
            l.qty,
            l.unitPrice,
            gstRateVal.toString(),
          )
          const { gstAmountMvr, lineTotalMvr } = computeLineMvr(gstAmount, lineTotal, rateStr)
          return {
            businessId,
            estimateId: id,
            itemId: l.itemId ?? null,
            description: l.description,
            qty: l.qty,
            unitPrice: l.unitPrice,
            gstCategory: l.gstCategory,
            gstRate,
            gstAmount,
            lineTotal,
            gstAmountMvr,
            lineTotalMvr,
            sortOrder: l.sortOrder ?? idx,
            createdBy: ctx.userId,
          }
        }),
      )
      lines = await repo.insertLines(lineInputs, tx)
    }

    const totals = computeTotals(lines)
    const mvrTotals = computeMvrTotals(
      lines.map((l) => computeLineMvr(l.gstAmount, l.lineTotal, rateStr)),
    )

    const updated = await repo.updateEstimate(
      businessId,
      id,
      {
        ...(data.expiryDate !== undefined ? { expiryDate: data.expiryDate } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        subtotal: totals.subtotal,
        gstAmount: totals.gstAmount,
        total: totals.total,
        exchangeRate: rateStr,
        subtotalMvr: mvrTotals.subtotalMvr,
        gstAmountMvr: mvrTotals.gstAmountMvr,
        totalMvr: mvrTotals.totalMvr,
        updatedBy: ctx.userId,
      },
      tx,
    )

    await audit.record(
      'estimate.draft_patched',
      'estimate',
      id,
      before as Record<string, unknown>,
      updated as Record<string, unknown>,
      ctx,
      tx,
    )

    return { ...updated, lines }
  })
}

// ─── send ─────────────────────────────────────────────────────────────────────
// Allocates the estimate number, transitions draft -> sent, emails the customer.

export async function send(businessId: string, id: string, ctx: AuditCtx): Promise<Estimate> {
  const updated = await db.transaction(async (tx) => {
    const estimate = await repo.getById(businessId, id, tx)
    if (!estimate) throw new NotFoundError(`Estimate ${id} not found`)
    if (estimate.status !== 'draft') throw new ValidationError('Only draft estimates can be sent')

    const estimateNumber = await repo.allocateEstimateNumber(businessId, tx)
    const issueDate = todayMv()

    const result = await repo.updateEstimate(
      businessId,
      id,
      { status: 'sent', estimateNumber, issueDate, updatedBy: ctx.userId },
      tx,
    )

    await audit.record(
      'estimate.sent',
      'estimate',
      id,
      { status: 'draft' },
      { status: 'sent', estimateNumber },
      ctx,
      tx,
    )

    return result
  })

  await emailQueue.add('estimate', {
    kind: 'estimate',
    businessId,
    estimateId: id,
    userId: ctx.userId,
  })

  return updated
}

// ─── markAccepted / markDeclined ──────────────────────────────────────────────
// Called either by staff (recording what the customer said by phone/email) or
// by the customer portal itself (Phase 28, UPGRADE.md G-8) — the portal route
// passes ctx.userId: null (no staff actor) after verifying the estimate
// belongs to the authenticated portal session's customer. `updated_by` is a
// NOT NULL column with no "no one" representation, so a null actor falls back
// to the estimate's own creator for that column specifically; the audit log's
// actor (which does support null) still correctly shows no staff involvement.

async function transitionStatus(
  businessId: string,
  id: string,
  from: Estimate['status'][],
  to: Estimate['status'],
  action: string,
  ctx: AuditRecordCtx,
): Promise<Estimate> {
  return db.transaction(async (tx) => {
    const estimate = await repo.getById(businessId, id, tx)
    if (!estimate) throw new NotFoundError(`Estimate ${id} not found`)
    if (!from.includes(estimate.status)) {
      throw new ValidationError(`Cannot ${action} an estimate with status ${estimate.status}`)
    }

    const updated = await repo.updateEstimate(
      businessId,
      id,
      { status: to, updatedBy: ctx.userId ?? estimate.createdBy },
      tx,
    )

    await audit.record(
      `estimate.${action}`,
      'estimate',
      id,
      { status: estimate.status },
      { status: to },
      ctx,
      tx,
    )

    return updated
  })
}

export async function markAccepted(
  businessId: string,
  id: string,
  ctx: AuditRecordCtx,
): Promise<Estimate> {
  return transitionStatus(businessId, id, ['sent'], 'accepted', 'accepted', ctx)
}

export async function markDeclined(
  businessId: string,
  id: string,
  ctx: AuditRecordCtx,
): Promise<Estimate> {
  return transitionStatus(businessId, id, ['sent'], 'declined', 'declined', ctx)
}

export async function markExpired(
  businessId: string,
  id: string,
  ctx: AuditCtx,
): Promise<Estimate> {
  return transitionStatus(businessId, id, ['sent'], 'expired', 'expired', ctx)
}

// ─── convertToInvoice ─────────────────────────────────────────────────────────
// Copies lines into a new draft invoice (its own GST rates snapshotted fresh
// at draft-creation time by invoicing.createDraft — not copied verbatim from
// the estimate, since rates may have changed since the estimate was priced).
// The resulting invoice is a DRAFT: issuing it (and the stock/GST-period
// checks that come with that) is a separate, explicit step.

export async function convertToInvoice(
  businessId: string,
  id: string,
  ctx: AuditCtx,
): Promise<{ estimate: Estimate; invoiceId: string }> {
  const estimate = await repo.getById(businessId, id)
  if (!estimate) throw new NotFoundError(`Estimate ${id} not found`)
  if (estimate.convertedAt) throw new ValidationError('This estimate has already been converted')
  if (estimate.status !== 'sent' && estimate.status !== 'accepted') {
    throw new ValidationError('Only a sent or accepted estimate can be converted to an invoice')
  }

  const lines = await repo.getLinesByEstimate(businessId, id)

  const invoice = await invoicing.createDraft(
    businessId,
    {
      customerId: estimate.customerId,
      notes: estimate.notes ?? undefined,
      // Carries the estimate's own currency through explicitly — the new
      // invoice still re-snapshots its own exchange rate fresh (Phase 30,
      // UPGRADE.md G-10), same "re-price, don't copy stale snapshots"
      // philosophy already applied to GST rates here.
      currency: estimate.currency,
      lines: lines.map((l) => ({
        itemId: l.itemId ?? undefined,
        description: l.description,
        qty: l.qty,
        unitPrice: l.unitPrice,
        gstCategory: l.gstCategory,
        sortOrder: l.sortOrder,
      })),
    },
    ctx,
  )

  return db.transaction(async (tx) => {
    await invoicing.setEstimateLink(businessId, invoice.id, id, tx)

    const updated = await repo.updateEstimate(
      businessId,
      id,
      {
        status: estimate.status === 'sent' ? 'accepted' : estimate.status,
        convertedAt: new Date(),
        updatedBy: ctx.userId,
      },
      tx,
    )

    await audit.record(
      'estimate.converted',
      'estimate',
      id,
      { convertedAt: null },
      { convertedAt: updated.convertedAt, invoiceId: invoice.id },
      ctx,
      tx,
    )

    return { estimate: updated, invoiceId: invoice.id }
  })
}
