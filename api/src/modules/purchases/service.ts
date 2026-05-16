import Decimal from 'decimal.js'
import { db } from '../../db/client.js'
import * as repo from './repository.js'
import * as audit from '../audit/service.js'
import * as gst from '../gst/service.js'
import * as inventory from '../inventory/service.js'
import type { AuditCtx } from '../audit/service.js'
import type { Bill, BillLine, PaymentMade, ListBillParams } from './repository.js'
import type {
  BillDraftCreate,
  BillDraftPatch,
  BillPaymentCreate,
  SoaExtractLine,
} from '@koosani/shared'
import { gstFor, sumGstLines, todayMv } from '@koosani/shared'

export type { AuditCtx, Bill, BillLine, PaymentMade, ListBillParams }

// ─── Error types ──────────────────────────────────────────────────────────────

export class NotFoundError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'NotFoundError'
  }
}

export class ValidationError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'ValidationError'
  }
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

type LineAmounts = { gstRate: string; gstAmount: string; lineTotal: string }

function computeLineAmounts(qty: string, unitCost: string, rate: string): LineAmounts {
  const taxableValue = new Decimal(qty).times(unitCost).toFixed(2)
  const { gst, gross } = gstFor(taxableValue, rate)
  return { gstRate: rate, gstAmount: gst, lineTotal: gross }
}

export type Totals = { subtotal: string; inputGstAmount: string; total: string }

export function computeTotals(
  lines: Array<{ qty: string; unitCost: string; gstAmount: string }>,
): Totals {
  const { totalTaxable, totalGst, totalGross } = sumGstLines(
    lines.map((l) => ({
      taxable: new Decimal(l.qty).times(l.unitCost).toFixed(2),
      gst: l.gstAmount,
    })),
  )
  return { subtotal: totalTaxable, inputGstAmount: totalGst, total: totalGross }
}

// ─── createDraft ──────────────────────────────────────────────────────────────

export async function createDraft(
  businessId: string,
  data: BillDraftCreate,
  ctx: AuditCtx,
): Promise<Bill & { lines: BillLine[] }> {
  return db.transaction(async (tx) => {
    const today = todayMv()

    const lineInputs = await Promise.all(
      data.lines.map(async (l, idx) => {
        const rate = await gst.rateAt(businessId, l.gstCategory, today)
        const { gstRate, gstAmount, lineTotal } = computeLineAmounts(
          l.qty,
          l.unitCost,
          rate.toString(),
        )
        return {
          businessId,
          billId: '' as string, // replaced after bill insert
          itemId: l.itemId ?? null,
          description: l.description,
          qty: l.qty,
          unitCost: l.unitCost,
          gstCategory: l.gstCategory,
          gstRate,
          gstAmount,
          lineTotal,
          sortOrder: l.sortOrder ?? idx,
          createdBy: ctx.userId,
          updatedBy: ctx.userId,
        }
      }),
    )

    const totals = computeTotals(lineInputs)

    const bill = await repo.insertBill(
      {
        businessId,
        supplierId: data.supplierId,
        supplierRef: data.supplierRef ?? null,
        billDate: data.billDate ?? null,
        dueDate: data.dueDate ?? null,
        notes: data.notes ?? null,
        subtotal: totals.subtotal,
        inputGstAmount: totals.inputGstAmount,
        total: totals.total,
        status: 'draft',
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      },
      tx,
    )

    const lines = await repo.insertBillLines(
      lineInputs.map((l) => ({ ...l, billId: bill.id })),
      tx,
    )

    await audit.record(
      'bill.draft_created',
      'bill',
      bill.id,
      {},
      bill as Record<string, unknown>,
      ctx,
      tx,
    )

    return { ...bill, lines }
  })
}

// ─── patchDraft ───────────────────────────────────────────────────────────────

export async function patchDraft(
  businessId: string,
  id: string,
  data: BillDraftPatch,
  ctx: AuditCtx,
): Promise<Bill & { lines: BillLine[] }> {
  return db.transaction(async (tx) => {
    const bill = await repo.getById(businessId, id, tx)
    if (!bill) throw new NotFoundError(`Bill ${id} not found`)
    if (bill.status !== 'draft') throw new ValidationError('Only draft bills can be patched')

    const before = { ...bill }

    let lines: BillLine[] = await repo.getLinesByBill(businessId, id, tx)

    if (data.lines !== undefined) {
      const today = todayMv()
      const lineInputs = await Promise.all(
        data.lines.map(async (l, idx) => {
          const rate = await gst.rateAt(businessId, l.gstCategory, today)
          const { gstRate, gstAmount, lineTotal } = computeLineAmounts(
            l.qty,
            l.unitCost,
            rate.toString(),
          )
          return {
            businessId,
            billId: id,
            itemId: l.itemId ?? null,
            description: l.description,
            qty: l.qty,
            unitCost: l.unitCost,
            gstCategory: l.gstCategory,
            gstRate,
            gstAmount,
            lineTotal,
            sortOrder: l.sortOrder ?? idx,
            createdBy: ctx.userId,
            updatedBy: ctx.userId,
          }
        }),
      )

      await repo.deleteLinesByBill(businessId, id, tx)
      lines = await repo.insertBillLines(lineInputs, tx)
    }

    const totals = computeTotals(lines)

    const updated = await repo.updateBill(
      businessId,
      id,
      {
        ...(data.supplierRef !== undefined ? { supplierRef: data.supplierRef } : {}),
        ...(data.billDate !== undefined ? { billDate: data.billDate } : {}),
        ...(data.dueDate !== undefined ? { dueDate: data.dueDate } : {}),
        ...(data.notes !== undefined ? { notes: data.notes } : {}),
        subtotal: totals.subtotal,
        inputGstAmount: totals.inputGstAmount,
        total: totals.total,
        updatedBy: ctx.userId,
      },
      tx,
    )

    await audit.record(
      'bill.draft_patched',
      'bill',
      id,
      before as Record<string, unknown>,
      updated as Record<string, unknown>,
      ctx,
      tx,
    )

    return { ...updated, lines }
  })
}

// ─── confirmBill ──────────────────────────────────────────────────────────────
// Allocates bill number, re-snapshots GST at billDate, commits stock (grn source),
// period-locks, audits.

export async function confirmBill(
  businessId: string,
  billId: string,
  ctx: AuditCtx,
): Promise<Bill> {
  return db.transaction(async (tx) => {
    const bill = await repo.getById(businessId, billId, tx)
    if (!bill) throw new NotFoundError(`Bill ${billId} not found`)
    if (bill.status !== 'draft') throw new ValidationError('Only draft bills can be confirmed')

    const billDate = bill.billDate ?? todayMv()
    await gst.assertPeriodOpen(businessId, billDate, ctx)

    const lines = await repo.getLinesByBill(businessId, billId, tx)

    // Re-snapshot GST at billDate
    const snapshotted = await Promise.all(
      lines.map(async (l) => {
        const rate = await gst.rateAt(businessId, l.gstCategory, billDate)
        const { gstRate, gstAmount, lineTotal } = computeLineAmounts(
          l.qty,
          l.unitCost,
          rate.toString(),
        )
        return { line: l, gstRate, gstAmount, lineTotal }
      }),
    )

    for (const { line, gstRate, gstAmount, lineTotal } of snapshotted) {
      await repo.updateBillLine(line.id, { gstRate, gstAmount, lineTotal }, tx)
    }

    const updatedLines = snapshotted.map(({ line, gstRate, gstAmount, lineTotal }) => ({
      ...line,
      gstRate,
      gstAmount,
      lineTotal,
    }))
    const totals = computeTotals(updatedLines)

    // Commit stock movements — goods received increase stock (positive qty, grn source)
    for (const line of lines) {
      if (line.itemId) {
        await inventory.applyMovement(
          businessId,
          line.itemId,
          line.qty,
          'grn',
          billId,
          null,
          ctx,
          tx,
        )
      }
    }

    const billNumber = await repo.allocateBillNumber(businessId, tx)

    const confirmed = await repo.updateBill(
      businessId,
      billId,
      {
        status: 'confirmed',
        billDate,
        billNumber,
        subtotal: totals.subtotal,
        inputGstAmount: totals.inputGstAmount,
        total: totals.total,
        updatedBy: ctx.userId,
      },
      tx,
    )

    await audit.record(
      'bill.confirmed',
      'bill',
      billId,
      { status: 'draft' },
      { status: 'confirmed', billNumber, billDate, total: totals.total },
      ctx,
      tx,
    )

    return confirmed
  })
}

// ─── getBill ──────────────────────────────────────────────────────────────────

export async function getBill(
  businessId: string,
  billId: string,
): Promise<Bill & { lines: BillLine[]; payments: PaymentMade[] }> {
  const bill = await repo.getById(businessId, billId)
  if (!bill) throw new NotFoundError(`Bill ${billId} not found`)
  const [lines, payments] = await Promise.all([
    repo.getLinesByBill(businessId, billId),
    repo.getPaymentsByBill(businessId, billId),
  ])
  return { ...bill, lines, payments }
}

// ─── listBills ────────────────────────────────────────────────────────────────

export async function listBills(
  businessId: string,
  params: ListBillParams,
): Promise<{ rows: Bill[]; total: number }> {
  return repo.listBills(businessId, params)
}

// ─── addPayment ───────────────────────────────────────────────────────────────

export async function addPayment(
  businessId: string,
  billId: string,
  data: BillPaymentCreate,
  ctx: AuditCtx,
): Promise<PaymentMade> {
  return db.transaction(async (tx) => {
    const bill = await repo.getById(businessId, billId, tx)
    if (!bill) throw new NotFoundError(`Bill ${billId} not found`)
    if (bill.status === 'draft')
      throw new ValidationError('Cannot pay a draft bill — confirm first')
    if (bill.status === 'paid') throw new ValidationError('Bill is already fully paid')

    await gst.assertPeriodOpen(businessId, data.paidAt, ctx)

    const payment = await repo.insertPayment(
      {
        businessId,
        billId,
        supplierId: bill.supplierId,
        amount: data.amount,
        method: data.method,
        reference: data.ref ?? null,
        paidAt: data.paidAt,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      },
      tx,
    )

    const paidAmount = await repo.sumActivePayments(businessId, billId, tx)
    const paid = new Decimal(paidAmount)
    const total = new Decimal(bill.total)
    const newStatus = paid.gte(total) ? 'paid' : 'partially_paid'

    await repo.updateBill(
      businessId,
      billId,
      { paidAmount, status: newStatus, updatedBy: ctx.userId },
      tx,
    )

    await audit.record(
      'bill.payment_added',
      'bill',
      billId,
      { paidAmount: bill.paidAmount },
      { paidAmount, paymentId: payment.id },
      ctx,
      tx,
    )

    return payment
  })
}

// ─── reversePayment ───────────────────────────────────────────────────────────

export async function reversePayment(
  businessId: string,
  billId: string,
  paymentId: string,
  ctx: AuditCtx,
): Promise<void> {
  return db.transaction(async (tx) => {
    const bill = await repo.getById(businessId, billId, tx)
    if (!bill) throw new NotFoundError(`Bill ${billId} not found`)

    const payment = await repo.getPaymentById(businessId, paymentId, tx)
    if (!payment) throw new NotFoundError(`Payment ${paymentId} not found`)
    if (payment.billId !== billId) throw new ValidationError('Payment does not belong to this bill')
    if (payment.reversedAt) throw new ValidationError('Payment is already reversed')

    await repo.markPaymentReversed(businessId, paymentId, tx)

    const paidAmount = await repo.sumActivePayments(businessId, billId, tx)
    const paid = new Decimal(paidAmount)
    const total = new Decimal(bill.total)
    const newStatus = paid.gte(total) ? 'paid' : paid.gt(0) ? 'partially_paid' : 'confirmed'

    await repo.updateBill(
      businessId,
      billId,
      { paidAmount, status: newStatus, updatedBy: ctx.userId },
      tx,
    )

    await audit.record(
      'bill.payment_reversed',
      'bill',
      billId,
      { paymentId, amount: payment.amount },
      { paidAmount },
      ctx,
      tx,
    )
  })
}

// ─── buildSupplierSoa ─────────────────────────────────────────────────────────

export type SoaEntry = {
  date: string
  type: 'bill' | 'payment'
  ref: string
  description: string
  debit: string
  credit: string
  balance: string
}

export async function buildSupplierSoa(
  businessId: string,
  supplierId: string,
  from: string,
  to: string,
): Promise<{ entries: SoaEntry[]; closingBalance: string }> {
  const [billRows, paymentRows] = await Promise.all([
    repo.soaBills(businessId, supplierId, from, to),
    repo.soaPayments(businessId, supplierId, from, to),
  ])

  type RawEntry = {
    date: string
    type: 'bill' | 'payment'
    ref: string
    description: string
    debit: Decimal
    credit: Decimal
  }

  const entries: RawEntry[] = [
    ...billRows.map((b) => ({
      date: b.billDate ?? b.createdAt.toISOString().slice(0, 10),
      type: 'bill' as const,
      ref: b.billNumber ?? b.id,
      description: b.supplierRef ? `Bill — ${b.supplierRef}` : 'Bill',
      debit: new Decimal(b.total),
      credit: new Decimal(0),
    })),
    ...paymentRows.map((p) => ({
      date: p.paidAt,
      type: 'payment' as const,
      ref: p.reference ?? p.id,
      description: `Payment — ${p.method}`,
      debit: new Decimal(0),
      credit: new Decimal(p.amount),
    })),
  ]

  entries.sort((a, b) => a.date.localeCompare(b.date))

  let balance = new Decimal(0)
  const result: SoaEntry[] = entries.map((e) => {
    balance = balance.plus(e.debit).minus(e.credit)
    return {
      date: e.date,
      type: e.type,
      ref: e.ref,
      description: e.description,
      debit: e.debit.toFixed(2),
      credit: e.credit.toFixed(2),
      balance: balance.toFixed(2),
    }
  })

  return { entries: result, closingBalance: balance.toFixed(2) }
}

// ─── matchSoaLine ─────────────────────────────────────────────────────────────

export async function matchSoaLine(
  businessId: string,
  supplierId: string,
  line: SoaExtractLine,
): Promise<Bill | null> {
  // Match within ±14 days of the line date
  const dt = new Date(line.date)
  const from = new Date(dt)
  from.setDate(from.getDate() - 14)
  const to = new Date(dt)
  to.setDate(to.getDate() + 14)

  return repo.findMatchingBill(
    businessId,
    supplierId,
    line.ref,
    line.amount,
    from.toISOString().slice(0, 10),
    to.toISOString().slice(0, 10),
  )
}
