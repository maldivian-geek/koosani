import { and, count, desc, eq, gte, ilike, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'
import { db } from '../../db/client.js'
import type { DbTx } from '../../db/client.js'
import {
  invoices,
  invoiceLines,
  paymentsReceived,
  creditNotes,
  creditNoteLines,
} from '../../db/schema/index.js'
import type {
  Invoice,
  NewInvoice,
  InvoiceLine,
  PaymentReceived,
  CreditNote,
} from '../../db/schema/index.js'

export type { Invoice, InvoiceLine, PaymentReceived, CreditNote }
export type CreditNoteLine = typeof creditNoteLines.$inferSelect

// ─── Invoice reads ────────────────────────────────────────────────────────────

export async function getById(businessId: string, id: string, tx?: DbTx): Promise<Invoice | null> {
  const q = tx ?? db
  const [row] = await q
    .select()
    .from(invoices)
    .where(and(eq(invoices.businessId, businessId), eq(invoices.id, id)))
  return row ?? null
}

export async function getLinesByInvoice(
  businessId: string,
  invoiceId: string,
  tx?: DbTx,
): Promise<InvoiceLine[]> {
  const q = tx ?? db
  return q
    .select()
    .from(invoiceLines)
    .where(and(eq(invoiceLines.businessId, businessId), eq(invoiceLines.invoiceId, invoiceId)))
    .orderBy(invoiceLines.sortOrder)
}

export type ListInvoiceParams = {
  status: string | undefined
  customerId: string | undefined
  from: string | undefined
  to: string | undefined
  q: string | undefined
  page: number
  pageSize: number
}

export async function listInvoices(
  businessId: string,
  params: ListInvoiceParams,
): Promise<{ rows: Invoice[]; total: number }> {
  const where = and(
    eq(invoices.businessId, businessId),
    params.status ? eq(invoices.status, params.status as Invoice['status']) : undefined,
    params.customerId ? eq(invoices.customerId, params.customerId) : undefined,
    params.from ? gte(invoices.issueDate, params.from) : undefined,
    params.to ? lte(invoices.issueDate, params.to) : undefined,
    params.q
      ? or(ilike(invoices.invoiceNumber, `%${params.q}%`), ilike(invoices.notes, `%${params.q}%`))
      : undefined,
  )

  const [totalRow, rows] = await Promise.all([
    db.select({ total: count() }).from(invoices).where(where),
    db
      .select()
      .from(invoices)
      .where(where)
      .orderBy(desc(invoices.createdAt))
      .limit(params.pageSize)
      .offset((params.page - 1) * params.pageSize),
  ])

  return { rows, total: totalRow[0]?.total ?? 0 }
}

// ─── Invoice writes ───────────────────────────────────────────────────────────

export async function insertInvoice(
  data: Omit<NewInvoice, 'id' | 'createdAt' | 'updatedAt'>,
  tx: DbTx,
): Promise<Invoice> {
  const [row] = await tx.insert(invoices).values(data).returning()
  if (!row) throw new Error('insertInvoice: no row returned')
  return row
}

export async function updateInvoice(
  businessId: string,
  id: string,
  data: Partial<Omit<NewInvoice, 'id' | 'businessId' | 'createdAt' | 'createdBy'>>,
  tx: DbTx,
): Promise<Invoice> {
  const [row] = await tx
    .update(invoices)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(invoices.businessId, businessId), eq(invoices.id, id)))
    .returning()
  if (!row) throw new Error('updateInvoice: no row returned')
  return row
}

// ─── Invoice lines ────────────────────────────────────────────────────────────

type NewLine = {
  businessId: string
  invoiceId: string
  itemId?: string | null
  description: string
  qty: string
  unitPrice: string
  gstCategory: InvoiceLine['gstCategory']
  gstRate: string
  gstAmount: string
  lineTotal: string
  sortOrder?: number
  createdBy: string
}

export async function insertLines(lines: NewLine[], tx: DbTx): Promise<InvoiceLine[]> {
  if (lines.length === 0) return []
  return tx
    .insert(invoiceLines)
    .values(lines.map((l) => ({ ...l, updatedBy: l.createdBy })))
    .returning()
}

export async function deleteLinesByInvoice(
  businessId: string,
  invoiceId: string,
  tx: DbTx,
): Promise<void> {
  await tx
    .delete(invoiceLines)
    .where(and(eq(invoiceLines.businessId, businessId), eq(invoiceLines.invoiceId, invoiceId)))
}

export async function updateInvoiceLine(
  id: string,
  data: { gstRate: string; gstAmount: string; lineTotal: string },
  tx: DbTx,
): Promise<void> {
  await tx
    .update(invoiceLines)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(invoiceLines.id, id))
}

// ─── Invoice number sequence (no-gap, advisory-locked) ───────────────────────
// Format: INV-000001. Advisory lock serializes concurrent issues for the same business.

export async function allocateInvoiceNumber(businessId: string, tx: DbTx): Promise<string> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${businessId} || ':invoice'))`)
  const [row] = await tx
    .select({
      maxNum: sql<string>`COALESCE(MAX(CAST(SUBSTRING(invoice_number, 5) AS INTEGER)), 0)`,
    })
    .from(invoices)
    .where(and(eq(invoices.businessId, businessId), isNotNull(invoices.invoiceNumber)))
  const next = Number(row?.maxNum ?? '0') + 1
  return `INV-${String(next).padStart(6, '0')}`
}

// ─── Payments received ────────────────────────────────────────────────────────

type NewPayment = {
  businessId: string
  invoiceId: string
  customerId: string
  amount: string
  method: string
  reference?: string | null
  paidAt: string
  reversalOfId?: string | null
  createdBy: string
}

export async function insertPayment(data: NewPayment, tx: DbTx): Promise<PaymentReceived> {
  const [row] = await tx
    .insert(paymentsReceived)
    .values({ ...data, updatedBy: data.createdBy })
    .returning()
  if (!row) throw new Error('insertPayment: no row returned')
  return row
}

export async function getPaymentById(
  businessId: string,
  id: string,
): Promise<PaymentReceived | null> {
  const [row] = await db
    .select()
    .from(paymentsReceived)
    .where(and(eq(paymentsReceived.businessId, businessId), eq(paymentsReceived.id, id)))
  return row ?? null
}

export async function listPaymentsByInvoice(
  businessId: string,
  invoiceId: string,
): Promise<PaymentReceived[]> {
  return db
    .select()
    .from(paymentsReceived)
    .where(
      and(eq(paymentsReceived.businessId, businessId), eq(paymentsReceived.invoiceId, invoiceId)),
    )
    .orderBy(paymentsReceived.paidAt)
}

export async function markPaymentReversed(id: string, tx: DbTx): Promise<void> {
  await tx
    .update(paymentsReceived)
    .set({ reversedAt: new Date(), updatedAt: new Date() })
    .where(eq(paymentsReceived.id, id))
}

// Recomputes invoice.paid_amount from the live sum of payment rows (including reversals).
export async function syncPaidAmount(
  businessId: string,
  invoiceId: string,
  tx: DbTx,
): Promise<string> {
  const [row] = await tx
    .select({ total: sql<string>`COALESCE(SUM(amount), '0')` })
    .from(paymentsReceived)
    .where(
      and(
        eq(paymentsReceived.businessId, businessId),
        eq(paymentsReceived.invoiceId, invoiceId),
        isNull(paymentsReceived.reversedAt),
      ),
    )
  return row?.total ?? '0'
}

// ─── Credit notes ─────────────────────────────────────────────────────────────

type NewCreditNote = {
  businessId: string
  invoiceId?: string | null
  customerId: string
  creditNoteNumber?: string | null
  status: CreditNote['status']
  issueDate?: string | null
  subtotal: string
  gstAmount: string
  total: string
  reason?: string | null
  createdBy: string
}

type UpdateCreditNoteData = {
  status?: CreditNote['status']
  creditNoteNumber?: string | null
  issueDate?: string | null
  subtotal?: string
  gstAmount?: string
  total?: string
  reason?: string | null
  updatedBy?: string
}

export async function insertCreditNote(data: NewCreditNote, tx: DbTx): Promise<CreditNote> {
  const [row] = await tx
    .insert(creditNotes)
    .values({ ...data, updatedBy: data.createdBy })
    .returning()
  if (!row) throw new Error('insertCreditNote: no row returned')
  return row
}

export async function getCreditNoteById(
  businessId: string,
  id: string,
  tx?: DbTx,
): Promise<CreditNote | null> {
  const q = tx ?? db
  const [row] = await q
    .select()
    .from(creditNotes)
    .where(and(eq(creditNotes.businessId, businessId), eq(creditNotes.id, id)))
  return row ?? null
}

export async function getCreditNoteLinesByCn(
  businessId: string,
  creditNoteId: string,
  tx?: DbTx,
): Promise<CreditNoteLine[]> {
  const q = tx ?? db
  return q
    .select()
    .from(creditNoteLines)
    .where(
      and(
        eq(creditNoteLines.businessId, businessId),
        eq(creditNoteLines.creditNoteId, creditNoteId),
      ),
    )
    .orderBy(creditNoteLines.sortOrder)
}

export async function listCreditNotesByInvoice(
  businessId: string,
  invoiceId: string,
): Promise<CreditNote[]> {
  return db
    .select()
    .from(creditNotes)
    .where(and(eq(creditNotes.businessId, businessId), eq(creditNotes.invoiceId, invoiceId)))
    .orderBy(creditNotes.createdAt)
}

export async function listCreditNotes(
  businessId: string,
  params: { customerId: string | undefined; from: string | undefined; to: string | undefined },
): Promise<CreditNote[]> {
  return db
    .select()
    .from(creditNotes)
    .where(
      and(
        eq(creditNotes.businessId, businessId),
        params.customerId ? eq(creditNotes.customerId, params.customerId) : undefined,
        params.from ? gte(creditNotes.issueDate, params.from) : undefined,
        params.to ? lte(creditNotes.issueDate, params.to) : undefined,
      ),
    )
    .orderBy(desc(creditNotes.createdAt))
}

export async function updateCreditNote(
  businessId: string,
  id: string,
  data: UpdateCreditNoteData,
  tx: DbTx,
): Promise<CreditNote> {
  const [row] = await tx
    .update(creditNotes)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(creditNotes.businessId, businessId), eq(creditNotes.id, id)))
    .returning()
  if (!row) throw new Error('updateCreditNote: no row returned')
  return row
}

type NewCreditNoteLine = {
  businessId: string
  creditNoteId: string
  itemId?: string | null
  description: string
  qty: string
  unitPrice: string
  gstCategory: InvoiceLine['gstCategory']
  gstRate: string
  gstAmount: string
  lineTotal: string
  sortOrder?: number
  createdBy: string
}

export async function insertCreditNoteLines(
  lines: NewCreditNoteLine[],
  tx: DbTx,
): Promise<CreditNoteLine[]> {
  if (lines.length === 0) return []
  return tx
    .insert(creditNoteLines)
    .values(lines.map((l) => ({ ...l, updatedBy: l.createdBy })))
    .returning()
}

export async function deleteCreditNoteLinesByCn(
  businessId: string,
  creditNoteId: string,
  tx: DbTx,
): Promise<void> {
  await tx
    .delete(creditNoteLines)
    .where(
      and(
        eq(creditNoteLines.businessId, businessId),
        eq(creditNoteLines.creditNoteId, creditNoteId),
      ),
    )
}

// ─── Credit note number sequence ──────────────────────────────────────────────
// Format: CN-000001. Same advisory-lock pattern as invoice numbers.

export async function allocateCreditNoteNumber(businessId: string, tx: DbTx): Promise<string> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${businessId} || ':cn'))`)
  const [row] = await tx
    .select({
      maxNum: sql<string>`COALESCE(MAX(CAST(SUBSTRING(credit_note_number, 4) AS INTEGER)), 0)`,
    })
    .from(creditNotes)
    .where(and(eq(creditNotes.businessId, businessId), isNotNull(creditNotes.creditNoteNumber)))
  const next = Number(row?.maxNum ?? '0') + 1
  return `CN-${String(next).padStart(6, '0')}`
}
