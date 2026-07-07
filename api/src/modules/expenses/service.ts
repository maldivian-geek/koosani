import { db } from '../../db/client.js'
import * as repo from './repository.js'
import * as audit from '../audit/service.js'
import * as gst from '../gst/service.js'
import * as customers from '../customers/service.js'
import * as suppliers from '../suppliers/service.js'
import * as filesSvc from '../files/service.js'
import { gstFor } from '@koosani/shared'
import type { AuditCtx } from '../audit/service.js'
import type { Expense, ListExpenseParams } from './repository.js'
import type { ExpenseCreate, ExpensePatch } from '@koosani/shared'

export type { AuditCtx, Expense, ListExpenseParams }

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

// ─── createExpense ────────────────────────────────────────────────────────────
// GST computed forward from the net amount, same convention as invoice/bill
// lines (ARCHITECTURE.md §4.1) — informational/reporting only, does NOT feed
// MIRA input tax (that remains the supplier-bill pathway; ARCHITECTURE.md §4.11).

export async function createExpense(
  businessId: string,
  data: ExpenseCreate,
  ctx: AuditCtx,
): Promise<Expense> {
  // Also enforced by ExpenseCreate's Zod refine at the route boundary, but
  // repeated here since this is a real business invariant, not just input
  // shape — a direct service-to-service caller must not be able to bypass it.
  if (data.billable && !data.customerId) {
    throw new ValidationError('customerId is required when billable is true')
  }

  if (data.supplierId) await suppliers.assertExists(data.supplierId, businessId)
  if (data.customerId) await customers.assertExists(data.customerId, businessId)

  const rate = await gst.rateAt(businessId, data.gstCategory, data.expenseDate)
  const { gst: gstAmount, gross: total } = gstFor(data.amount, rate.toString())

  return db.transaction(async (tx) => {
    const expense = await repo.insertExpense(
      {
        businessId,
        category: data.category,
        description: data.description ?? null,
        supplierId: data.supplierId ?? null,
        expenseDate: data.expenseDate,
        amount: data.amount,
        gstCategory: data.gstCategory,
        gstRate: rate.toString(),
        gstAmount,
        total,
        paymentMethod: data.paymentMethod ?? null,
        billable: data.billable ?? false,
        customerId: data.customerId ?? null,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      },
      tx,
    )

    await audit.record(
      'expense.create',
      'expense',
      expense.id,
      null,
      { category: data.category, amount: data.amount, total },
      ctx,
      tx,
    )

    return expense
  })
}

// ─── getExpense / listExpenses ────────────────────────────────────────────────

export async function getExpense(businessId: string, id: string): Promise<Expense> {
  const expense = await repo.getById(businessId, id)
  if (!expense) throw new NotFoundError(`Expense ${id} not found`)
  return expense
}

export async function listExpenses(
  businessId: string,
  params: ListExpenseParams,
): Promise<{ rows: Expense[]; total: number }> {
  return repo.listExpenses(businessId, params)
}

export async function listUninvoicedBillable(
  businessId: string,
  customerId: string,
): Promise<Expense[]> {
  return repo.listUninvoicedBillable(businessId, customerId)
}

// ─── updateExpense / deleteExpense ────────────────────────────────────────────
// Editable/deletable only until invoiced — once an expense has been added to
// an invoice as a line item, changing its amount/category would silently
// desync the two (ARCHITECTURE.md §4.11).

export async function updateExpense(
  businessId: string,
  id: string,
  data: ExpensePatch,
  ctx: AuditCtx,
): Promise<Expense> {
  return db.transaction(async (tx) => {
    const before = await repo.getById(businessId, id, tx)
    if (!before) throw new NotFoundError(`Expense ${id} not found`)
    if (before.invoicedAt) {
      throw new ValidationError(
        'This expense has already been added to an invoice and can no longer be edited',
      )
    }

    if (data.supplierId) await suppliers.assertExists(data.supplierId, businessId)
    if (data.customerId) await customers.assertExists(data.customerId, businessId)

    const nextBillable = data.billable ?? before.billable
    const nextCustomerId = data.customerId !== undefined ? data.customerId : before.customerId
    if (nextBillable && !nextCustomerId) {
      throw new ValidationError('customerId is required when billable is true')
    }

    const nextAmount = data.amount ?? before.amount
    const nextGstCategory = data.gstCategory ?? before.gstCategory
    const nextDate = data.expenseDate ?? before.expenseDate

    let gstRate = before.gstRate
    let gstAmount = before.gstAmount
    let total = before.total
    if (
      data.amount !== undefined ||
      data.gstCategory !== undefined ||
      data.expenseDate !== undefined
    ) {
      const rate = await gst.rateAt(businessId, nextGstCategory, nextDate)
      const computed = gstFor(nextAmount, rate.toString())
      gstRate = rate.toString()
      gstAmount = computed.gst
      total = computed.gross
    }

    const updated = await repo.updateExpense(
      businessId,
      id,
      {
        ...(data.category !== undefined ? { category: data.category } : {}),
        ...(data.description !== undefined ? { description: data.description } : {}),
        ...(data.supplierId !== undefined ? { supplierId: data.supplierId } : {}),
        ...(data.expenseDate !== undefined ? { expenseDate: data.expenseDate } : {}),
        ...(data.amount !== undefined ? { amount: data.amount } : {}),
        ...(data.gstCategory !== undefined ? { gstCategory: data.gstCategory } : {}),
        gstRate,
        gstAmount,
        total,
        ...(data.paymentMethod !== undefined ? { paymentMethod: data.paymentMethod } : {}),
        ...(data.billable !== undefined ? { billable: data.billable } : {}),
        ...(data.customerId !== undefined ? { customerId: data.customerId } : {}),
        updatedBy: ctx.userId,
      },
      tx,
    )

    await audit.record(
      'expense.update',
      'expense',
      id,
      before as Record<string, unknown>,
      updated as Record<string, unknown>,
      ctx,
      tx,
    )

    return updated
  })
}

export async function deleteExpense(businessId: string, id: string, ctx: AuditCtx): Promise<void> {
  return db.transaction(async (tx) => {
    const expense = await repo.getById(businessId, id, tx)
    if (!expense) throw new NotFoundError(`Expense ${id} not found`)
    if (expense.invoicedAt) {
      throw new ValidationError(
        'This expense has already been added to an invoice and cannot be deleted',
      )
    }

    await repo.deleteExpense(businessId, id, tx)
    await audit.record(
      'expense.delete',
      'expense',
      id,
      expense as Record<string, unknown>,
      null,
      ctx,
      tx,
    )
  })
}

// ─── Receipt attachment ───────────────────────────────────────────────────────

export async function attachReceipt(
  businessId: string,
  id: string,
  fileBuffer: Buffer,
  fileName: string,
  mimeType: string,
  ctx: AuditCtx,
): Promise<Expense> {
  const expense = await repo.getById(businessId, id)
  if (!expense) throw new NotFoundError(`Expense ${id} not found`)

  const file = await filesSvc.uploadFile(businessId, fileBuffer, fileName, mimeType, ctx)
  return db.transaction(async (tx) => {
    await filesSvc.attachToEntity(businessId, file.id, 'expense', id, ctx, tx)
    return repo.updateExpense(businessId, id, { receiptFileId: file.id, updatedBy: ctx.userId }, tx)
  })
}

// ─── markInvoiced ─────────────────────────────────────────────────────────────
// Called once the caller (a route, not the invoicing module — expenses and
// invoicing don't reference each other's services, ARCHITECTURE.md §3) has
// created an invoice draft from these expenses' amounts. Locks the rows so
// two concurrent "add to invoice" requests can't both consume the same
// expense.

export async function markInvoiced(
  businessId: string,
  expenseIds: string[],
  invoiceId: string,
  ctx: AuditCtx,
): Promise<void> {
  return db.transaction(async (tx) => {
    const rows = await repo.getManyForUpdate(businessId, expenseIds, tx)
    if (rows.length !== expenseIds.length) {
      throw new NotFoundError('One or more expenses were not found')
    }
    for (const row of rows) {
      if (row.invoicedAt) {
        throw new ValidationError(`Expense ${row.id} has already been added to an invoice`)
      }
      if (!row.billable) {
        throw new ValidationError(`Expense ${row.id} is not marked billable`)
      }
    }

    const invoicedAt = new Date()
    for (const row of rows) {
      await repo.updateExpense(
        businessId,
        row.id,
        { invoiceId, invoicedAt, updatedBy: ctx.userId },
        tx,
      )
    }

    await audit.record(
      'expense.marked_invoiced',
      'invoice',
      invoiceId,
      null,
      { expenseIds },
      ctx,
      tx,
    )
  })
}
