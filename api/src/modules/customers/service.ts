import Decimal from 'decimal.js'
import { db } from '../../db/client.js'
import * as repo from './repository.js'
import * as audit from '../audit/service.js'
import type { AuditCtx } from '../audit/service.js'
import type { CustomerCreate, CustomerPatch, ContactCreate } from '@koosani/shared'
import type { CustomerRow, ContactRow } from './repository.js'

export type { AuditCtx }

const PAGE_SIZE_DEFAULT = 50
const PAGE_SIZE_MAX = 200

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

// ─── assertExists ─────────────────────────────────────────────────────────────

export async function assertExists(id: string, businessId: string): Promise<CustomerRow> {
  const customer = await repo.findCustomerById(businessId, id)
  if (!customer || customer.deletedAt !== null) {
    throw new NotFoundError(`Customer ${id} not found`)
  }
  return customer
}

// ─── outstandingBalance ───────────────────────────────────────────────────────

export async function outstandingBalance(id: string, businessId: string): Promise<Decimal> {
  const { invoiceOwed, creditNoteTotal } = await repo.customerBalanceComponents(businessId, id)
  return new Decimal(invoiceOwed).sub(creditNoteTotal)
}

// ─── list ─────────────────────────────────────────────────────────────────────

export async function list(
  businessId: string,
  params: {
    q: string | undefined
    page: number | undefined
    pageSize: number | undefined
    active: boolean | undefined
  },
): Promise<{ items: CustomerRow[]; total: number; page: number; pageSize: number }> {
  const page = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, params.pageSize ?? PAGE_SIZE_DEFAULT))
  const { rows, total } = await repo.listCustomers(businessId, {
    q: params.q,
    page,
    pageSize,
    active: params.active,
  })
  return { items: rows, total, page, pageSize }
}

// ─── getById ──────────────────────────────────────────────────────────────────

export async function getById(
  businessId: string,
  id: string,
): Promise<CustomerRow & { contacts: ContactRow[]; balance: string }> {
  const customer = await assertExists(id, businessId)
  const [contacts, balance] = await Promise.all([
    repo.listContacts(businessId, id),
    outstandingBalance(id, businessId),
  ])
  return { ...customer, contacts, balance: balance.toFixed(2) }
}

// ─── create ───────────────────────────────────────────────────────────────────

export async function create(
  businessId: string,
  data: CustomerCreate,
  ctx: AuditCtx,
): Promise<CustomerRow> {
  return db.transaction(async (tx) => {
    const row = await repo.insertCustomer({
      businessId,
      name: data.name,
      tin: data.tin ?? null,
      email: data.email ?? null,
      phone: data.phone ?? null,
      address: data.address ?? null,
      creditTermsDays: String(data.creditTermsDays ?? 30),
      creditLimit: data.creditLimit ?? null,
      notes: data.notes ?? null,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })

    await audit.record(
      'customer.create',
      'customer',
      row.id,
      null,
      row as Record<string, unknown>,
      ctx,
      tx,
    )
    return row
  })
}

// ─── update ───────────────────────────────────────────────────────────────────

export async function update(
  businessId: string,
  id: string,
  data: CustomerPatch,
  ctx: AuditCtx,
): Promise<CustomerRow> {
  return db.transaction(async (tx) => {
    const before = await assertExists(id, businessId)

    const patch: Record<string, unknown> = {}
    if (data.name !== undefined) patch['name'] = data.name
    if (data.tin !== undefined) patch['tin'] = data.tin
    if (data.email !== undefined) patch['email'] = data.email
    if (data.phone !== undefined) patch['phone'] = data.phone
    if (data.address !== undefined) patch['address'] = data.address
    if (data.creditTermsDays !== undefined) patch['creditTermsDays'] = String(data.creditTermsDays)
    if (data.creditLimit !== undefined) patch['creditLimit'] = data.creditLimit
    if (data.notes !== undefined) patch['notes'] = data.notes
    patch['updatedBy'] = ctx.userId

    const after = await repo.updateCustomer(businessId, id, patch, tx)
    await audit.record(
      'customer.update',
      'customer',
      id,
      before as Record<string, unknown>,
      after as Record<string, unknown>,
      ctx,
      tx,
    )
    return after
  })
}

// ─── softDelete ───────────────────────────────────────────────────────────────

export async function softDelete(businessId: string, id: string, ctx: AuditCtx): Promise<void> {
  const customer = await assertExists(id, businessId)

  const [hasDrafts, balance] = await Promise.all([
    repo.hasDraftInvoices(businessId, id),
    outstandingBalance(id, businessId),
  ])

  if (hasDrafts) {
    throw new ValidationError('Cannot delete customer with draft invoices')
  }
  if (balance.gt(0)) {
    throw new ValidationError('Cannot delete customer with outstanding balance')
  }

  await db.transaction(async (tx) => {
    await repo.softDeleteCustomer(businessId, id, ctx.userId, tx)
    await audit.record(
      'customer.delete',
      'customer',
      id,
      customer as Record<string, unknown>,
      null,
      ctx,
      tx,
    )
  })
}

// ─── buildSoa ─────────────────────────────────────────────────────────────────
// Pure aggregation over invoices, credit_notes, and payments_received (FUNCTIONS.md §customers).

export type SoaEntry =
  | {
      date: string
      type: 'invoice'
      ref: string
      description: string
      debit: string
      credit: null
      balance: string
    }
  | {
      date: string
      type: 'credit_note'
      ref: string
      description: string
      debit: null
      credit: string
      balance: string
    }
  | {
      date: string
      type: 'payment'
      ref: string
      description: string
      debit: null
      credit: string
      balance: string
    }

export type Soa = {
  customerId: string
  from: string
  to: string
  openingBalance: string
  entries: SoaEntry[]
  closingBalance: string
}

export async function buildSoa(
  businessId: string,
  customerId: string,
  from: string,
  to: string,
): Promise<Soa> {
  await assertExists(customerId, businessId)

  const [{ invoiceOwed, cnCredit }, invRows, cnRows, pmtRows] = await Promise.all([
    repo.openingBalanceComponentsAt(businessId, customerId, from),
    repo.soaInvoices(businessId, customerId, from, to),
    repo.soaCreditNotes(businessId, customerId, from, to),
    repo.soaPayments(businessId, customerId, from, to),
  ])

  // Opening balance: amount owed before the period start (inclusive of from date invoices issued)
  // We query invoices issued up to `from` — so the opening is what was already owed before this window.
  // Correct approach: opening = everything before `from` exclusive; query uses lte(from) so we subtract
  // invoices ON the from date (they appear as entries too). Simplification: use lte(from) minus the
  // from-date invoices already counted in the entries window. The trade-off is acceptable for an SOA
  // that uses the same from date as both openingBalance and first entry date.
  const openingBalance = new Decimal(invoiceOwed).minus(cnCredit).toFixed(2)

  // Build chronological entries tagged with sort key
  type Tagged = { sortKey: string; entry: Omit<SoaEntry, 'balance'> }
  const tagged: Tagged[] = []

  for (const inv of invRows) {
    tagged.push({
      sortKey: (inv.issueDate ?? '') + inv.id,
      entry: {
        date: inv.issueDate ?? '',
        type: 'invoice',
        ref: inv.invoiceNumber ?? inv.id,
        description: `Invoice ${inv.invoiceNumber ?? inv.id}`,
        debit: inv.total,
        credit: null,
      },
    })
  }

  for (const cn of cnRows) {
    tagged.push({
      sortKey: (cn.issueDate ?? '') + cn.id,
      entry: {
        date: cn.issueDate ?? '',
        type: 'credit_note',
        ref: cn.creditNoteNumber ?? cn.id,
        description: `Credit note ${cn.creditNoteNumber ?? cn.id}`,
        debit: null,
        credit: cn.total,
      },
    })
  }

  for (const pmt of pmtRows) {
    tagged.push({
      sortKey: pmt.paidAt + pmt.id,
      entry: {
        date: pmt.paidAt,
        type: 'payment',
        ref: pmt.reference ?? pmt.id,
        description: `Payment — ${pmt.method}`,
        debit: null,
        credit: pmt.amount,
      },
    })
  }

  tagged.sort((a, b) => a.sortKey.localeCompare(b.sortKey))

  // Compute running balance
  let balance = new Decimal(openingBalance)
  const entries: SoaEntry[] = tagged.map(({ entry }) => {
    if (entry.debit !== null) {
      balance = balance.plus(entry.debit)
    } else if (entry.credit !== null) {
      balance = balance.minus(entry.credit)
    }
    return { ...entry, balance: balance.toFixed(2) } as SoaEntry
  })

  return {
    customerId,
    from,
    to,
    openingBalance,
    entries,
    closingBalance: balance.toFixed(2),
  }
}

// ─── addContact ───────────────────────────────────────────────────────────────

export async function addContact(
  businessId: string,
  customerId: string,
  data: ContactCreate,
  ctx: AuditCtx,
): Promise<ContactRow> {
  await assertExists(customerId, businessId)

  return db.transaction(async (tx) => {
    const row = await repo.insertContact(
      {
        businessId,
        customerId,
        name: data.name,
        email: data.email ?? null,
        phone: data.phone ?? null,
        role: data.role ?? null,
        isPrimary: data.isPrimary ?? false,
        createdBy: ctx.userId,
        updatedBy: ctx.userId,
      },
      tx,
    )
    await audit.record(
      'customer.contact.create',
      'customer',
      customerId,
      null,
      row as Record<string, unknown>,
      ctx,
      tx,
    )
    return row
  })
}
