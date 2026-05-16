import Decimal from 'decimal.js'
import { db } from '../../db/client.js'
import * as repo from './repository.js'
import * as audit from '../audit/service.js'
import * as gst from '../gst/service.js'
import * as inventory from '../inventory/service.js'
import * as customers from '../customers/service.js'
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
} from '@koosani/shared'
import { gstFor, sumGstLines, todayMv } from '@koosani/shared'

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

// ─── assertNotLocked ──────────────────────────────────────────────────────────
// Wraps gst.assertPeriodOpen (FUNCTIONS.md §invoicing).

export async function assertNotLocked(
  businessId: string,
  date: string,
  ctx: AuditCtx,
): Promise<void> {
  await gst.assertPeriodOpen(businessId, date, ctx)
}

// ─── createDraft ──────────────────────────────────────────────────────────────
// Creates invoice + lines. Uses today's MV date for preliminary GST rate snapshot
// (preview only; rates are re-snapshotted against issueDate on issue).

export async function createDraft(
  businessId: string,
  data: InvoiceDraftCreate,
  ctx: AuditCtx,
): Promise<Invoice & { lines: InvoiceLine[] }> {
  await customers.assertExists(data.customerId, businessId)

  return db.transaction(async (tx) => {
    const today = todayMv()

    const lineInputs = await Promise.all(
      data.lines.map(async (l, idx) => {
        const rate = await gst.rateAt(businessId, l.gstCategory, today)
        const { gstRate, gstAmount, lineTotal } = computeLineAmounts(
          l.qty,
          l.unitPrice,
          rate.toString(),
        )
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
          sortOrder: l.sortOrder ?? idx,
          createdBy: ctx.userId,
        }
      }),
    )

    const totals = computeTotals(lineInputs)

    const invoice = await repo.insertInvoice(
      {
        businessId,
        customerId: data.customerId,
        dueDate: data.dueDate ?? null,
        notes: data.notes ?? null,
        subtotal: totals.subtotal,
        gstAmount: totals.gstAmount,
        total: totals.total,
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
      { customerId: data.customerId, total: totals.total, lineCount: lines.length },
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

    if (data.lines !== undefined) {
      const today = todayMv()
      const lineInputs = await Promise.all(
        data.lines.map(async (l, idx) => {
          const rate = await gst.rateAt(businessId, l.gstCategory, today)
          const { gstRate, gstAmount, lineTotal } = computeLineAmounts(
            l.qty,
            l.unitPrice,
            rate.toString(),
          )
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
            sortOrder: l.sortOrder ?? idx,
            createdBy: ctx.userId,
          }
        }),
      )

      await repo.deleteLinesByInvoice(businessId, id, tx)
      lines = await repo.insertLines(lineInputs, tx)
    }

    const totals = computeTotals(lines)

    const updated = await repo.updateInvoice(
      businessId,
      id,
      {
        ...(data.dueDate !== undefined ? { dueDate: data.dueDate } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        subtotal: totals.subtotal,
        gstAmount: totals.gstAmount,
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
    await gst.assertPeriodOpen(businessId, issueDate, ctx)

    const lines = await repo.getLinesByInvoice(businessId, invoiceId, tx)

    // Re-snapshot GST rates at issueDate — the trigger hasn't fired yet (still draft)
    const snapshotted = await Promise.all(
      lines.map(async (l) => {
        const rate = await gst.rateAt(businessId, l.gstCategory, issueDate)
        const { gstRate, gstAmount, lineTotal } = computeLineAmounts(
          l.qty,
          l.unitPrice,
          rate.toString(),
        )
        return { line: l, gstRate, gstAmount, lineTotal }
      }),
    )

    for (const { line, gstRate, gstAmount, lineTotal } of snapshotted) {
      await repo.updateInvoiceLine(line.id, { gstRate, gstAmount, lineTotal }, tx)
    }

    const updatedLines = snapshotted.map(({ line, gstRate, gstAmount, lineTotal }) => ({
      ...line,
      gstRate,
      gstAmount,
      lineTotal,
    }))
    const totals = computeTotals(updatedLines)

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
    await gst.assertPeriodOpen(businessId, today, ctx)

    const lines = await repo.getLinesByInvoice(businessId, invoiceId, tx)

    // Create a reversing credit note mirroring the invoice
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
      { status: invoice.status },
      { status: 'voided', reason, reversedByCn: cn.id },
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
  return db.transaction(async (tx) => {
    const invoice = await repo.getById(businessId, invoiceId, tx)
    if (!invoice) throw new NotFoundError(`Invoice ${invoiceId} not found`)
    if (invoice.status !== 'issued' && invoice.status !== 'partially_paid') {
      throw new ValidationError('Payments can only be added to issued invoices')
    }

    await gst.assertPeriodOpen(businessId, data.paidAt, ctx)

    const payment = await repo.insertPayment(
      {
        businessId,
        invoiceId,
        customerId: invoice.customerId,
        amount: data.amount,
        method: data.method,
        reference: data.ref ?? null,
        paidAt: data.paidAt,
        createdBy: ctx.userId,
      },
      tx,
    )

    const paidAmount = await repo.syncPaidAmount(businessId, invoiceId, tx)
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
      { paidAmount, status: newStatus, updatedBy: ctx.userId },
      tx,
    )

    await audit.record(
      'invoice.payment_added',
      'invoice',
      invoiceId,
      { paidAmount: invoice.paidAmount, status: invoice.status },
      { paidAmount, status: newStatus, paymentId: payment.id },
      ctx,
      tx,
    )

    return payment
  })
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

    const payment = await repo.getPaymentById(businessId, paymentId)
    if (!payment || payment.invoiceId !== invoiceId) {
      throw new NotFoundError(`Payment ${paymentId} not found on invoice ${invoiceId}`)
    }
    if (payment.reversedAt !== null) {
      throw new ValidationError('Payment is already reversed')
    }

    await repo.markPaymentReversed(paymentId, tx)

    const paidAmount = await repo.syncPaidAmount(businessId, invoiceId, tx)
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
      { paidAmount, status: newStatus, updatedBy: ctx.userId },
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

    const lineInputs = await Promise.all(
      data.lines.map(async (l, idx) => {
        const rate = await gst.rateAt(businessId, l.gstCategory, today)
        const { gstRate, gstAmount, lineTotal } = computeLineAmounts(
          l.qty,
          l.unitPrice,
          rate.toString(),
        )
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
          sortOrder: l.sortOrder ?? idx,
          createdBy: ctx.userId,
        }
      }),
    )

    const totals = computeTotals(lineInputs)

    const cn = await repo.insertCreditNote(
      {
        businessId,
        invoiceId: data.invoiceId,
        customerId: invoice.customerId,
        status: 'draft',
        subtotal: totals.subtotal,
        gstAmount: totals.gstAmount,
        total: totals.total,
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
    await gst.assertPeriodOpen(businessId, today, ctx)

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
