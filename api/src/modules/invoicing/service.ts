import Decimal from 'decimal.js'
import { db } from '../../db/client.js'
import type { DbTx } from '../../db/client.js'
import * as repo from './repository.js'
import * as audit from '../audit/service.js'
import * as gst from '../gst/service.js'
import * as inventory from '../inventory/service.js'
import * as customers from '../customers/service.js'
import * as customerCredits from '../customerCredits/service.js'
import * as exchangeRates from '../exchangeRates/service.js'
import { emailQueue } from '../../lib/queues.js'
import type { AuditCtx } from '../audit/service.js'
import type {
  Invoice,
  InvoiceLine,
  PaymentReceived,
  CreditNote,
  CreditNoteLine,
  ListInvoiceParams,
} from './repository.js'
import type {
  InvoiceDraftCreate,
  InvoiceDraftPatch,
  InvoicePaymentCreate,
  CreditNoteCreate,
  CurrencyCode,
} from '@koosani/shared'
import { gstFor, sumGstLines, todayMv, money, exchangeRate } from '@koosani/shared'

export type { AuditCtx, Invoice, InvoiceLine, PaymentReceived, CreditNote, CreditNoteLine }

// ─── Error types ──────────────────────────────────────────────────────────────

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

type LineAmounts = { gstRate: string; gstAmount: string; lineTotal: string }

function computeLineAmounts(qty: string, unitPrice: string, rate: string): LineAmounts {
  const taxableValue = new Decimal(qty).times(unitPrice).toFixed(2)
  const { gst, gross } = gstFor(taxableValue, rate)
  return { gstRate: rate, gstAmount: gst, lineTotal: gross }
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

// ─── Multi-currency helpers (Phase 30, UPGRADE.md G-10) ──────────────────────
// See ARCHITECTURE.md §4.10. Document-currency amounts (subtotal/gstAmount/
// total) are computed by computeTotals above, unchanged; these derive the
// MVR-equivalent snapshot from the same lines' already-converted per-line
// MVR columns, mirroring computeTotals' own shape.

export type LineMvr = { gstAmountMvr: string; lineTotalMvr: string }

export function computeLineMvr(gstAmount: string, lineTotal: string, rate: string): LineMvr {
  return {
    gstAmountMvr: exchangeRate.toMvr(gstAmount, rate),
    lineTotalMvr: exchangeRate.toMvr(lineTotal, rate),
  }
}

export type MvrTotals = { subtotalMvr: string; gstAmountMvr: string; totalMvr: string }

export function computeMvrTotals(lines: Array<LineMvr>): MvrTotals {
  const gstAmountMvr = money.sum(lines.map((l) => l.gstAmountMvr))
  const totalMvr = money.sum(lines.map((l) => l.lineTotalMvr))
  const subtotalMvr = money.sub(totalMvr, gstAmountMvr)
  return { subtotalMvr, gstAmountMvr, totalMvr }
}

// ─── assertNotLocked ──────────────────────────────────────────────────────────
// Wraps gst.assertPeriodOpen (FUNCTIONS.md §invoicing).

export async function assertNotLocked(
  businessId: string,
  date: string,
  ctx: AuditCtx,
): Promise<void> {
  await gst.assertPeriodOpen(businessId, date, ctx)
}
// Note: this standalone wrapper has no tx to thread through — callers already
// inside a transaction should call gst.assertPeriodOpen(..., tx) directly
// (UPGRADE.md F-18).

// ─── createDraft ──────────────────────────────────────────────────────────────
// Creates invoice + lines. Uses today's MV date for preliminary GST rate snapshot
// (preview only; rates are re-snapshotted against issueDate on issue).

export async function createDraft(
  businessId: string,
  data: InvoiceDraftCreate,
  ctx: AuditCtx,
): Promise<Invoice & { lines: InvoiceLine[] }> {
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
          invoiceId: '' as string, // replaced after invoice insert
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

    const invoice = await repo.insertInvoice(
      {
        businessId,
        customerId: data.customerId,
        dueDate: data.dueDate ?? null,
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
      lineInputs.map((l) => ({ ...l, invoiceId: invoice.id })),
      tx,
    )

    await audit.record(
      'invoice.draft_created',
      'invoice',
      invoice.id,
      null,
      { customerId: data.customerId, total: totals.total, currency, lineCount: lines.length },
      ctx,
      tx,
    )

    return { ...invoice, lines }
  })
}

// ─── getInvoice ───────────────────────────────────────────────────────────────

export async function getInvoice(
  businessId: string,
  id: string,
): Promise<
  Invoice & { lines: InvoiceLine[]; payments: PaymentReceived[]; creditNotes: CreditNote[] }
> {
  const invoice = await repo.getById(businessId, id)
  if (!invoice) throw new NotFoundError(`Invoice ${id} not found`)

  const [lines, payments, creditNoteList] = await Promise.all([
    repo.getLinesByInvoice(businessId, id),
    repo.listPaymentsByInvoice(businessId, id),
    repo.listCreditNotesByInvoice(businessId, id),
  ])

  return { ...invoice, lines, payments, creditNotes: creditNoteList }
}

// ─── listInvoices ─────────────────────────────────────────────────────────────

export async function listInvoices(
  businessId: string,
  params: ListInvoiceParams,
): Promise<{ rows: Invoice[]; total: number }> {
  return repo.listInvoices(businessId, params)
}

export async function listReminderCandidates(businessId: string): Promise<Invoice[]> {
  return repo.listReminderCandidates(businessId)
}

// Sets the traceability link back to the estimate this invoice was converted
// from (Phase 25, UPGRADE.md G-5). Callers must supply their own transaction —
// used exclusively by estimates.convertToInvoice, inside its own tx.
export async function setEstimateLink(
  businessId: string,
  invoiceId: string,
  estimateId: string,
  tx: DbTx,
): Promise<void> {
  await repo.updateInvoice(businessId, invoiceId, { estimateId }, tx)
}

// Sets the traceability link back to the recurrence profile that generated
// this invoice (Phase 26, UPGRADE.md G-6). Same pattern as setEstimateLink.
export async function setRecurrenceLink(
  businessId: string,
  invoiceId: string,
  recurrenceProfileId: string,
  tx: DbTx,
): Promise<void> {
  await repo.updateInvoice(businessId, invoiceId, { recurrenceProfileId }, tx)
}

export async function setRemindersEnabled(
  businessId: string,
  invoiceId: string,
  enabled: boolean,
  ctx: AuditCtx,
): Promise<Invoice> {
  return db.transaction(async (tx) => {
    const invoice = await repo.getById(businessId, invoiceId, tx)
    if (!invoice) throw new NotFoundError(`Invoice ${invoiceId} not found`)

    const updated = await repo.updateInvoice(
      businessId,
      invoiceId,
      { remindersEnabled: enabled, updatedBy: ctx.userId },
      tx,
    )

    await audit.record(
      'invoice.reminders_toggled',
      'invoice',
      invoiceId,
      { remindersEnabled: invoice.remindersEnabled },
      { remindersEnabled: enabled },
      ctx,
      tx,
    )

    return updated
  })
}

// ─── patchDraft ───────────────────────────────────────────────────────────────

export async function patchDraft(
  businessId: string,
  id: string,
  data: InvoiceDraftPatch,
  ctx: AuditCtx,
): Promise<Invoice & { lines: InvoiceLine[] }> {
  return db.transaction(async (tx) => {
    const invoice = await repo.getById(businessId, id, tx)
    if (!invoice) throw new NotFoundError(`Invoice ${id} not found`)
    if (invoice.status !== 'draft') throw new ValidationError('Only draft invoices can be patched')

    const before = { ...invoice }

    let lines: InvoiceLine[] = await repo.getLinesByInvoice(businessId, id, tx)

    const today = todayMv()
    // Refreshed on every patch (not just when lines change) — a manual
    // exchange rate entered after this draft was created should still be
    // reflected in the preview totals before issue freezes it for good.
    const rate = await exchangeRates.rateAt(businessId, invoice.currency, today)
    const rateStr = exchangeRate.round6(rate)

    if (data.lines !== undefined) {
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
            invoiceId: id,
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

      await repo.deleteLinesByInvoice(businessId, id, tx)
      lines = await repo.insertLines(lineInputs, tx)
    }

    const totals = computeTotals(lines)
    const mvrTotals = computeMvrTotals(
      lines.map((l) => computeLineMvr(l.gstAmount, l.lineTotal, rateStr)),
    )

    const updated = await repo.updateInvoice(
      businessId,
      id,
      {
        ...(data.dueDate !== undefined ? { dueDate: data.dueDate } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        subtotal: totals.subtotal,
        gstAmount: totals.gstAmount,
        exchangeRate: rateStr,
        subtotalMvr: mvrTotals.subtotalMvr,
        gstAmountMvr: mvrTotals.gstAmountMvr,
        totalMvr: mvrTotals.totalMvr,
        total: totals.total,
        updatedBy: ctx.userId,
      },
      tx,
    )

    await audit.record(
      'invoice.draft_patched',
      'invoice',
      id,
      before as Record<string, unknown>,
      updated as Record<string, unknown>,
      ctx,
      tx,
    )

    return { ...updated, lines }
  })
}

// ─── issue ────────────────────────────────────────────────────────────────────
// Allocates invoice number, snapshots GST rates, commits stock, audits.
// Advisory lock (in allocateInvoiceNumber) serializes concurrent issues per business.

export async function issue(
  businessId: string,
  invoiceId: string,
  ctx: AuditCtx,
): Promise<Invoice> {
  return db.transaction(async (tx) => {
    const invoice = await repo.getById(businessId, invoiceId, tx)
    if (!invoice) throw new NotFoundError(`Invoice ${invoiceId} not found`)
    if (invoice.status !== 'draft') throw new ValidationError('Only draft invoices can be issued')

    const issueDate = todayMv()
    await gst.assertPeriodOpen(businessId, issueDate, ctx, tx)

    const lines = await repo.getLinesByInvoice(businessId, invoiceId, tx)

    // Re-snapshot GST rates AND the exchange rate at issueDate — the invoice
    // is becoming an official financial record now, not at draft-creation
    // time (ARCHITECTURE.md §4.10, mirrors GST rate re-snapshotting below).
    const rate = await exchangeRates.rateAt(businessId, invoice.currency, issueDate)
    const rateStr = exchangeRate.round6(rate)

    const snapshotted = await Promise.all(
      lines.map(async (l) => {
        const gstRateVal = await gst.rateAt(businessId, l.gstCategory, issueDate)
        const { gstRate, gstAmount, lineTotal } = computeLineAmounts(
          l.qty,
          l.unitPrice,
          gstRateVal.toString(),
        )
        const { gstAmountMvr, lineTotalMvr } = computeLineMvr(gstAmount, lineTotal, rateStr)
        return { line: l, gstRate, gstAmount, lineTotal, gstAmountMvr, lineTotalMvr }
      }),
    )

    for (const s of snapshotted) {
      await repo.updateInvoiceLine(
        s.line.id,
        {
          gstRate: s.gstRate,
          gstAmount: s.gstAmount,
          lineTotal: s.lineTotal,
          gstAmountMvr: s.gstAmountMvr,
          lineTotalMvr: s.lineTotalMvr,
        },
        tx,
      )
    }

    const updatedLines = snapshotted.map(({ line, gstRate, gstAmount, lineTotal }) => ({
      ...line,
      gstRate,
      gstAmount,
      lineTotal,
    }))
    const totals = computeTotals(updatedLines)
    const mvrTotals = computeMvrTotals(snapshotted)

    // Check stock before committing any movements
    for (const line of lines) {
      if (line.itemId) {
        const negQty = new Decimal(line.qty).negated().toFixed(4)
        await inventory.assertAvailable(businessId, line.itemId, negQty, tx)
      }
    }

    // Commit stock movements (sales reduce stock)
    for (const line of lines) {
      if (line.itemId) {
        const negQty = new Decimal(line.qty).negated().toFixed(4)
        await inventory.applyMovement(
          businessId,
          line.itemId,
          negQty,
          'invoice',
          invoiceId,
          null,
          ctx,
          tx,
        )
      }
    }

    const invoiceNumber = await repo.allocateInvoiceNumber(businessId, tx)

    const issued = await repo.updateInvoice(
      businessId,
      invoiceId,
      {
        status: 'issued',
        issueDate,
        invoiceNumber,
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
      'invoice.issued',
      'invoice',
      invoiceId,
      { status: 'draft' },
      { status: 'issued', invoiceNumber, issueDate, total: totals.total },
      ctx,
      tx,
    )

    return issued
  })
}

// ─── voidInvoice ─────────────────────────────────────────────────────────────
// Only issued invoices can be voided. Creates a reversing CN auto-issued in the
// same transaction; reverses committed stock.

export async function voidInvoice(
  businessId: string,
  invoiceId: string,
  reason: string,
  ctx: AuditCtx,
): Promise<Invoice> {
  return db.transaction(async (tx) => {
    const invoice = await repo.getById(businessId, invoiceId, tx)
    if (!invoice) throw new NotFoundError(`Invoice ${invoiceId} not found`)
    if (invoice.status !== 'issued' && invoice.status !== 'partially_paid') {
      throw new ValidationError('Only issued invoices can be voided')
    }

    const today = todayMv()
    await gst.assertPeriodOpen(businessId, today, ctx, tx)

    // Money already received on a voided invoice isn't lost — it becomes
    // customer credit (properly resolves UPGRADE.md F-14, replacing Phase
    // 20's interim "reject the void" policy). Each active payment is
    // reversed and its amount granted back as credit, one-for-one.
    const activePayments = await repo.listActivePaymentsByInvoiceForUpdate(
      businessId,
      invoiceId,
      tx,
    )
    for (const payment of activePayments) {
      const reversed = await repo.markPaymentReversed(payment.id, tx)
      if (reversed) {
        // customer_credits is always MVR-denominated (Phase 27 predates
        // multi-currency) — grant the payment's own MVR-equivalent, not its
        // document-currency amount (ARCHITECTURE.md §4.10).
        await customerCredits.creditFromVoidedInvoice(
          businessId,
          invoice.customerId,
          payment.amountMvr,
          invoiceId,
          ctx,
          tx,
        )
      }
    }
    const { paidAmount: paidAmountAfterReversal, paidAmountMvr: paidAmountMvrAfterReversal } =
      await repo.syncPaidAmount(businessId, invoiceId, tx)

    const lines = await repo.getLinesByInvoice(businessId, invoiceId, tx)

    // Create a reversing credit note mirroring the invoice — copies the
    // invoice's own currency/rate/Mvr snapshot verbatim (not re-rated at
    // today), same rationale as copying gstRate/gstAmount/lineTotal below.
    const cn = await repo.insertCreditNote(
      {
        businessId,
        invoiceId,
        customerId: invoice.customerId,
        status: 'draft',
        issueDate: today,
        subtotal: invoice.subtotal,
        gstAmount: invoice.gstAmount,
        total: invoice.total,
        currency: invoice.currency,
        exchangeRate: invoice.exchangeRate,
        subtotalMvr: invoice.subtotalMvr,
        gstAmountMvr: invoice.gstAmountMvr,
        totalMvr: invoice.totalMvr,
        reason,
        createdBy: ctx.userId,
      },
      tx,
    )

    await repo.insertCreditNoteLines(
      lines.map((l, idx) => ({
        businessId,
        creditNoteId: cn.id,
        itemId: l.itemId ?? null,
        description: l.description,
        qty: l.qty,
        unitPrice: l.unitPrice,
        gstCategory: l.gstCategory,
        gstRate: l.gstRate,
        gstAmount: l.gstAmount,
        lineTotal: l.lineTotal,
        gstAmountMvr: l.gstAmountMvr,
        lineTotalMvr: l.lineTotalMvr,
        sortOrder: l.sortOrder ?? idx,
        createdBy: ctx.userId,
      })),
      tx,
    )

    const cnNumber = await repo.allocateCreditNoteNumber(businessId, tx)
    await repo.updateCreditNote(
      businessId,
      cn.id,
      { status: 'issued', creditNoteNumber: cnNumber, issueDate: today, updatedBy: ctx.userId },
      tx,
    )

    // Reverse committed stock (positive qty puts stock back)
    for (const line of lines) {
      if (line.itemId) {
        await inventory.applyMovement(
          businessId,
          line.itemId,
          line.qty,
          'credit_note',
          cn.id,
          null,
          ctx,
          tx,
        )
      }
    }

    const voided = await repo.updateInvoice(
      businessId,
      invoiceId,
      {
        status: 'voided',
        paidAmount: paidAmountAfterReversal,
        paidAmountMvr: paidAmountMvrAfterReversal,
        voidReason: reason,
        voidedAt: new Date(),
        updatedBy: ctx.userId,
      },
      tx,
    )

    await audit.record(
      'invoice.voided',
      'invoice',
      invoiceId,
      { status: invoice.status, paidAmount: invoice.paidAmount },
      {
        status: 'voided',
        reason,
        reversedByCn: cn.id,
        paymentsReversed: activePayments.length,
      },
      ctx,
      tx,
    )

    return voided
  })
}

// ─── addPayment ───────────────────────────────────────────────────────────────

export async function addPayment(
  businessId: string,
  invoiceId: string,
  data: InvoicePaymentCreate,
  ctx: AuditCtx,
): Promise<PaymentReceived> {
  return db
    .transaction(async (tx) => {
      const invoice = await repo.getById(businessId, invoiceId, tx)
      if (!invoice) throw new NotFoundError(`Invoice ${invoiceId} not found`)
      if (invoice.status !== 'issued' && invoice.status !== 'partially_paid') {
        throw new ValidationError('Payments can only be added to issued invoices')
      }

      // paid_amount must never exceed the invoice total (UPGRADE.md F-15).
      // An overpayment is no longer rejected — it's capped at what's actually
      // outstanding on this invoice, and the excess becomes customer credit
      // (properly resolves F-15, replacing Phase 20's "reject" interim policy).
      const outstanding = new Decimal(invoice.total).minus(invoice.paidAmount ?? '0')
      const requestedAmount = new Decimal(data.amount)
      const appliedAmount = Decimal.min(requestedAmount, outstanding)
      const overpaidAmount = requestedAmount.minus(appliedAmount)

      await gst.assertPeriodOpen(businessId, data.paidAt, ctx, tx)

      // Exchange rate at the PAYMENT date, not the invoice's own issue-date
      // rate — the two can differ, and that difference is the realized
      // gain/loss recorded below (ARCHITECTURE.md §4.10).
      const paymentRate = await exchangeRates.rateAt(businessId, invoice.currency, data.paidAt)
      const paymentRateStr = exchangeRate.round6(paymentRate)
      const appliedAmountMvr = exchangeRate.toMvr(appliedAmount.toFixed(2), paymentRateStr)

      const payment = await repo.insertPayment(
        {
          businessId,
          invoiceId,
          customerId: invoice.customerId,
          amount: appliedAmount.toFixed(2),
          method: data.method,
          reference: data.ref ?? null,
          paidAt: data.paidAt,
          exchangeRate: paymentRateStr,
          amountMvr: appliedAmountMvr,
          createdBy: ctx.userId,
        },
        tx,
      )

      // What this applied amount was worth in MVR at the invoice's own
      // (issue-date) rate, vs. what it's actually worth at the payment-date
      // rate — the gap is realized now. Always zero for MVR invoices, since
      // exchangeRate is always 1 on both sides (no special-casing needed).
      const expectedMvr = exchangeRate.toMvr(appliedAmount.toFixed(2), invoice.exchangeRate)
      const gainLoss = money.sub(appliedAmountMvr, expectedMvr)
      await exchangeRates.recordRealizedGainLoss(businessId, invoiceId, payment.id, gainLoss, tx)

      if (overpaidAmount.gt(0)) {
        // customer_credits is always MVR-denominated (Phase 27 predates
        // multi-currency) — grant the MVR-equivalent of the overpayment at
        // the payment-date rate, not the document-currency amount.
        const overpaidAmountMvr = exchangeRate.toMvr(overpaidAmount.toFixed(2), paymentRateStr)
        await customerCredits.creditFromOverpayment(
          businessId,
          invoice.customerId,
          overpaidAmountMvr,
          payment.id,
          ctx,
          tx,
        )
      }

      const { paidAmount, paidAmountMvr } = await repo.syncPaidAmount(businessId, invoiceId, tx)
      const paid = new Decimal(paidAmount)
      const total = new Decimal(invoice.total)

      let newStatus: Invoice['status']
      if (paid.gte(total)) {
        newStatus = 'paid'
      } else if (paid.gt(0)) {
        newStatus = 'partially_paid'
      } else {
        newStatus = 'issued'
      }

      await repo.updateInvoice(
        businessId,
        invoiceId,
        { paidAmount, paidAmountMvr, status: newStatus, updatedBy: ctx.userId },
        tx,
      )

      await audit.record(
        'invoice.payment_added',
        'invoice',
        invoiceId,
        { paidAmount: invoice.paidAmount, status: invoice.status },
        {
          paidAmount,
          status: newStatus,
          paymentId: payment.id,
          overpaidAmount: overpaidAmount.gt(0) ? overpaidAmount.toFixed(2) : undefined,
        },
        ctx,
        tx,
      )

      return payment
    })
    .then(async (payment) => {
      // Fire-and-forget "thank you" receipt (Phase 24, UPGRADE.md G-3). Not part
      // of the transaction above — a failed/delayed send should never roll back
      // a recorded payment. Skipped for write-offs (Phase 27) — no real money
      // moved, so a "thank you for your payment" email would be misleading.
      if (payment.method !== 'write_off') {
        await emailQueue.add('receipt', {
          kind: 'receipt',
          businessId,
          invoiceId,
          paymentId: payment.id,
          userId: ctx.userId,
        })
      }
      return payment
    })
}

// ─── applyCreditToInvoice ─────────────────────────────────────────────────────
// Consumes the customer's existing credit balance (from an overpayment,
// advance, or voided invoice) against this invoice's outstanding balance
// (UPGRADE.md Phase 27, G-7). Recorded as a payments_received row
// (method: 'credit') so it flows through the exact same paidAmount/status
// sync as a cash payment.

export async function applyCreditToInvoice(
  businessId: string,
  invoiceId: string,
  amount: string,
  ctx: AuditCtx,
): Promise<PaymentReceived> {
  return db.transaction(async (tx) => {
    const invoice = await repo.getById(businessId, invoiceId, tx)
    if (!invoice) throw new NotFoundError(`Invoice ${invoiceId} not found`)
    if (invoice.status !== 'issued' && invoice.status !== 'partially_paid') {
      throw new ValidationError('Credit can only be applied to issued invoices')
    }
    // customer_credits is always MVR-denominated (Phase 27 predates
    // multi-currency) — applying it to a foreign-currency invoice would mix
    // an MVR balance with a document-currency outstanding amount with no
    // correct conversion semantics. Not supported in this phase
    // (ARCHITECTURE.md §4.10); write off or record a same-currency payment
    // instead.
    if (invoice.currency !== 'MVR') {
      throw new ValidationError('Customer credit can only be applied to MVR-denominated invoices')
    }

    const outstanding = new Decimal(invoice.total).minus(invoice.paidAmount ?? '0')
    const requested = new Decimal(amount)
    if (requested.lte(0)) throw new ValidationError('Amount must be greater than zero')
    if (requested.gt(outstanding)) {
      throw new ValidationError(
        `Amount exceeds the outstanding balance of ${outstanding.toFixed(2)}`,
      )
    }

    const today = todayMv()
    await gst.assertPeriodOpen(businessId, today, ctx, tx)

    // Debits the ledger first — throws if the balance is insufficient, before
    // anything else is written. Re-thrown as invoicing's own ValidationError:
    // customerCredits.ValidationError is a distinct class, so the route's
    // `instanceof svc.ValidationError` check wouldn't otherwise catch it.
    try {
      await customerCredits.applyToInvoice(
        businessId,
        invoice.customerId,
        invoiceId,
        amount,
        ctx,
        tx,
      )
    } catch (err) {
      if (err instanceof customerCredits.ValidationError) throw new ValidationError(err.message)
      throw err
    }

    const payment = await repo.insertPayment(
      {
        businessId,
        invoiceId,
        customerId: invoice.customerId,
        amount: requested.toFixed(2),
        method: 'credit',
        reference: null,
        paidAt: today,
        // invoice.currency is guaranteed 'MVR' here (guarded above)
        exchangeRate: '1',
        amountMvr: requested.toFixed(2),
        createdBy: ctx.userId,
      },
      tx,
    )

    const { paidAmount, paidAmountMvr } = await repo.syncPaidAmount(businessId, invoiceId, tx)
    const paid = new Decimal(paidAmount)
    const total = new Decimal(invoice.total)

    let newStatus: Invoice['status']
    if (paid.gte(total)) {
      newStatus = 'paid'
    } else if (paid.gt(0)) {
      newStatus = 'partially_paid'
    } else {
      newStatus = 'issued'
    }

    await repo.updateInvoice(
      businessId,
      invoiceId,
      { paidAmount, paidAmountMvr, status: newStatus, updatedBy: ctx.userId },
      tx,
    )

    await audit.record(
      'invoice.credit_applied',
      'invoice',
      invoiceId,
      { paidAmount: invoice.paidAmount, status: invoice.status },
      { paidAmount, status: newStatus, paymentId: payment.id, amount: requested.toFixed(2) },
      ctx,
      tx,
    )

    return payment
  })
}

// ─── writeOffInvoice ──────────────────────────────────────────────────────────
// Bad-debt write-off (UPGRADE.md Phase 27, G-7): closes out the remaining
// outstanding balance with no cash movement. Reuses addPayment's exact
// paidAmount/status-sync logic via method: 'write_off' — see there for why
// the receipt email is skipped for this method.

export async function writeOffInvoice(
  businessId: string,
  invoiceId: string,
  reason: string,
  ctx: AuditCtx,
): Promise<PaymentReceived> {
  const invoice = await repo.getById(businessId, invoiceId)
  if (!invoice) throw new NotFoundError(`Invoice ${invoiceId} not found`)
  if (invoice.status !== 'issued' && invoice.status !== 'partially_paid') {
    throw new ValidationError('Only issued invoices can be written off')
  }
  const outstanding = new Decimal(invoice.total).minus(invoice.paidAmount ?? '0')
  if (outstanding.lte(0)) throw new ValidationError('Nothing outstanding to write off')

  return addPayment(
    businessId,
    invoiceId,
    { amount: outstanding.toFixed(2), method: 'write_off', ref: reason, paidAt: todayMv() },
    ctx,
  )
}

// ─── reversePayment ───────────────────────────────────────────────────────────

export async function reversePayment(
  businessId: string,
  invoiceId: string,
  paymentId: string,
  ctx: AuditCtx,
): Promise<void> {
  return db.transaction(async (tx) => {
    const invoice = await repo.getById(businessId, invoiceId, tx)
    if (!invoice) throw new NotFoundError(`Invoice ${invoiceId} not found`)

    // Locked read: holds the row until this tx commits so a concurrent
    // reversal of the same payment cannot also pass this check (F-17).
    const payment = await repo.getPaymentByIdForUpdate(businessId, paymentId, tx)
    if (!payment || payment.invoiceId !== invoiceId) {
      throw new NotFoundError(`Payment ${paymentId} not found on invoice ${invoiceId}`)
    }
    if (payment.reversedAt !== null) {
      throw new ValidationError('Payment is already reversed')
    }

    // A reversal is itself a financial mutation dated as of today — it must
    // respect the period lock like every other mutation (F-11).
    await gst.assertPeriodOpen(businessId, todayMv(), ctx, tx)

    const reversed = await repo.markPaymentReversed(paymentId, tx)
    if (!reversed) throw new ValidationError('Payment is already reversed')

    const { paidAmount, paidAmountMvr } = await repo.syncPaidAmount(businessId, invoiceId, tx)
    const paid = new Decimal(paidAmount)
    const total = new Decimal(invoice.total)

    let newStatus: Invoice['status']
    if (invoice.status === 'voided') {
      newStatus = 'voided'
    } else if (paid.gte(total)) {
      newStatus = 'paid'
    } else if (paid.gt(0)) {
      newStatus = 'partially_paid'
    } else {
      newStatus = 'issued'
    }

    await repo.updateInvoice(
      businessId,
      invoiceId,
      { paidAmount, paidAmountMvr, status: newStatus, updatedBy: ctx.userId },
      tx,
    )

    await audit.record(
      'invoice.payment_reversed',
      'invoice',
      invoiceId,
      { paidAmount: invoice.paidAmount, status: invoice.status, paymentId },
      { paidAmount, status: newStatus },
      ctx,
      tx,
    )
  })
}

// ─── createCreditNote ─────────────────────────────────────────────────────────
// Creates a draft credit note against an issued invoice. Lines are provided by
// the caller (may be a partial credit — different lines/qty than the original).

export async function createCreditNote(
  businessId: string,
  data: CreditNoteCreate,
  ctx: AuditCtx,
): Promise<CreditNote & { lines: CreditNoteLine[] }> {
  const invoice = await repo.getById(businessId, data.invoiceId)
  if (!invoice) throw new NotFoundError(`Invoice ${data.invoiceId} not found`)
  if (
    invoice.status !== 'issued' &&
    invoice.status !== 'partially_paid' &&
    invoice.status !== 'paid'
  ) {
    throw new ValidationError('Credit notes can only be raised against issued invoices')
  }

  return db.transaction(async (tx) => {
    const today = todayMv()
    // Credits the source invoice's own currency, always — a credit note
    // can't be raised in a different currency than what it's crediting.
    // Rated fresh at today (not copied from the invoice), same rationale as
    // the GST rate below: rates may have moved since the invoice was issued.
    const rate = await exchangeRates.rateAt(businessId, invoice.currency, today)
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
          creditNoteId: '' as string, // replaced after CN insert
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

    const cn = await repo.insertCreditNote(
      {
        businessId,
        invoiceId: data.invoiceId,
        customerId: invoice.customerId,
        status: 'draft',
        subtotal: totals.subtotal,
        gstAmount: totals.gstAmount,
        total: totals.total,
        currency: invoice.currency,
        exchangeRate: rateStr,
        subtotalMvr: mvrTotals.subtotalMvr,
        gstAmountMvr: mvrTotals.gstAmountMvr,
        totalMvr: mvrTotals.totalMvr,
        reason: data.reason,
        createdBy: ctx.userId,
      },
      tx,
    )

    const lines = await repo.insertCreditNoteLines(
      lineInputs.map((l) => ({ ...l, creditNoteId: cn.id })),
      tx,
    )

    await audit.record(
      'credit_note.draft_created',
      'credit_note',
      cn.id,
      null,
      { invoiceId: data.invoiceId, total: totals.total, lineCount: lines.length },
      ctx,
      tx,
    )

    return { ...cn, lines }
  })
}

// ─── listCreditNotes ─────────────────────────────────────────────────────────

export async function listCreditNotes(
  businessId: string,
  params: { customerId: string | undefined; from: string | undefined; to: string | undefined },
): Promise<CreditNote[]> {
  return repo.listCreditNotes(businessId, params)
}

// ─── issueCreditNote ──────────────────────────────────────────────────────────
// Allocates CN number, reverses stock, and marks CN as issued.

export async function issueCreditNote(
  businessId: string,
  creditNoteId: string,
  ctx: AuditCtx,
): Promise<CreditNote> {
  return db.transaction(async (tx) => {
    const cn = await repo.getCreditNoteById(businessId, creditNoteId, tx)
    if (!cn) throw new NotFoundError(`Credit note ${creditNoteId} not found`)
    if (cn.status !== 'draft') throw new ValidationError('Only draft credit notes can be issued')

    const today = todayMv()
    await gst.assertPeriodOpen(businessId, today, ctx, tx)

    const lines = await repo.getCreditNoteLinesByCn(businessId, creditNoteId, tx)

    // Reverse stock for item lines (positive qty puts stock back)
    for (const line of lines) {
      if (line.itemId) {
        await inventory.applyMovement(
          businessId,
          line.itemId,
          line.qty,
          'credit_note',
          creditNoteId,
          null,
          ctx,
          tx,
        )
      }
    }

    const cnNumber = await repo.allocateCreditNoteNumber(businessId, tx)

    const issued = await repo.updateCreditNote(
      businessId,
      creditNoteId,
      { status: 'issued', creditNoteNumber: cnNumber, issueDate: today, updatedBy: ctx.userId },
      tx,
    )

    await audit.record(
      'credit_note.issued',
      'credit_note',
      creditNoteId,
      { status: 'draft' },
      { status: 'issued', creditNoteNumber: cnNumber, issueDate: today },
      ctx,
      tx,
    )

    return issued
  })
}
