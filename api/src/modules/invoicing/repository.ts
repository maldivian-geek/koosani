import { and, count, desc, eq, gte, ilike, isNull, lte, ne, or, sql } from 'drizzle-orm'
import { db } from '../../db/client.js'
import { allocateDocumentNumber } from '../../db/numbering.js'
import type { DbTx } from '../../db/client.js'
import {
  invoices,
  invoiceLines,
  paymentsReceived,
  creditNotes,
  creditNoteLines,
  deliveryNotes,
  deliveryNoteLines,
  customers,
} from '../../db/schema/index.js'
import type {
  Invoice,
  NewInvoice,
  InvoiceLine,
  PaymentReceived,
  CreditNote,
  DeliveryNote,
  DeliveryNoteLine,
} from '../../db/schema/index.js'

export type { Invoice, InvoiceLine, PaymentReceived, CreditNote, DeliveryNote, DeliveryNoteLine }
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

// Candidates for the daily reminders scan (Phase 24, UPGRADE.md G-4) — issued
// or partially-paid, opted in, with a due date. The cron computes the actual
// day-offset match; this just narrows the scan to invoices that could match.
export async function listReminderCandidates(businessId: string): Promise<Invoice[]> {
  return db
    .select()
    .from(invoices)
    .where(
      and(
        eq(invoices.businessId, businessId),
        eq(invoices.remindersEnabled, true),
        or(eq(invoices.status, 'issued'), eq(invoices.status, 'partially_paid')),
        sql`${invoices.dueDate} IS NOT NULL`,
      ),
    )
}

export type ListInvoiceParams = {
  status: string | undefined
  customerId: string | undefined
  from: string | undefined
  to: string | undefined
  q: string | undefined
  page: number
  pageSize: number
  // Excludes draft invoices regardless of `status` — used by the customer
  // portal (SECURITY.md §13.14), which must never surface internal
  // working-state documents. Staff-facing callers never set this.
  excludeDraft?: boolean
}

export async function listInvoices(
  businessId: string,
  params: ListInvoiceParams,
): Promise<{ rows: Invoice[]; total: number }> {
  const where = and(
    eq(invoices.businessId, businessId),
    params.status ? eq(invoices.status, params.status as Invoice['status']) : undefined,
    params.excludeDraft ? ne(invoices.status, 'draft') : undefined,
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
  // Multi-currency (Phase 30, UPGRADE.md G-10)
  gstAmountMvr: string
  lineTotalMvr: string
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
  data: {
    gstRate: string
    gstAmount: string
    lineTotal: string
    gstAmountMvr: string
    lineTotalMvr: string
  },
  tx: DbTx,
): Promise<void> {
  await tx
    .update(invoiceLines)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(invoiceLines.id, id))
}

// ─── Invoice number sequence (no-gap, advisory-locked) ───────────────────────
// Format: {businesses.invoice_number_prefix}000001 (default INV-000001, Phase
// 22 — UPGRADE.md G-15). Advisory lock serializes concurrent issues per business.

export async function allocateInvoiceNumber(businessId: string, tx: DbTx): Promise<string> {
  return allocateDocumentNumber(
    tx,
    businessId,
    ':invoice',
    'invoices',
    'invoice_number',
    'invoice_number_prefix',
  )
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
  // Multi-currency (Phase 30, UPGRADE.md G-10) — exchange rate at paidAt and
  // this payment's own MVR-equivalent (used for the credit ledger and
  // realized gain/loss, both MVR-only). Defaults matching 'MVR' documents.
  exchangeRate?: string
  amountMvr?: string
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
  tx?: DbTx,
): Promise<PaymentReceived | null> {
  const q = tx ?? db
  const [row] = await q
    .select()
    .from(paymentsReceived)
    .where(and(eq(paymentsReceived.businessId, businessId), eq(paymentsReceived.id, id)))
  return row ?? null
}

// Locks the payment row until the caller's tx commits, so two concurrent
// reversal requests for the same payment cannot both pass the reversedAt
// check before either commits (UPGRADE.md F-17).
export async function getPaymentByIdForUpdate(
  businessId: string,
  id: string,
  tx: DbTx,
): Promise<PaymentReceived | null> {
  const [row] = await tx
    .select()
    .from(paymentsReceived)
    .where(and(eq(paymentsReceived.businessId, businessId), eq(paymentsReceived.id, id)))
    .for('update')
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

// Locks every active (non-reversed) payment on the invoice until the caller's
// tx commits — used by voidInvoice (UPGRADE.md F-14) so a concurrent
// reversal/void of the same payment can't race past either's checks.
export async function listActivePaymentsByInvoiceForUpdate(
  businessId: string,
  invoiceId: string,
  tx: DbTx,
): Promise<PaymentReceived[]> {
  return tx
    .select()
    .from(paymentsReceived)
    .where(
      and(
        eq(paymentsReceived.businessId, businessId),
        eq(paymentsReceived.invoiceId, invoiceId),
        isNull(paymentsReceived.reversedAt),
      ),
    )
    .for('update')
}

// Guards on reversedAt IS NULL so a double-reversal race is a no-op update
// rather than a second reversal (UPGRADE.md F-17). Returns false if the
// payment was already reversed (by a concurrent request or otherwise).
export async function markPaymentReversed(id: string, tx: DbTx): Promise<boolean> {
  const rows = await tx
    .update(paymentsReceived)
    .set({ reversedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(paymentsReceived.id, id), isNull(paymentsReceived.reversedAt)))
    .returning({ id: paymentsReceived.id })
  return rows.length > 0
}

// Recomputes invoice.paid_amount (and its MVR-equivalent) from the live sum of
// payment rows (including reversals).
export async function syncPaidAmount(
  businessId: string,
  invoiceId: string,
  tx: DbTx,
): Promise<{ paidAmount: string; paidAmountMvr: string }> {
  const [row] = await tx
    .select({
      paidAmount: sql<string>`COALESCE(SUM(amount), '0')`,
      paidAmountMvr: sql<string>`COALESCE(SUM(amount_mvr), '0')`,
    })
    .from(paymentsReceived)
    .where(
      and(
        eq(paymentsReceived.businessId, businessId),
        eq(paymentsReceived.invoiceId, invoiceId),
        isNull(paymentsReceived.reversedAt),
      ),
    )
  return { paidAmount: row?.paidAmount ?? '0', paidAmountMvr: row?.paidAmountMvr ?? '0' }
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
  // Multi-currency (Phase 30, UPGRADE.md G-10)
  currency?: CreditNote['currency']
  exchangeRate?: string
  subtotalMvr?: string
  gstAmountMvr?: string
  totalMvr?: string
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

// Joined with customers for display (Phase 33's standalone CN list UI,
// UPGRADE.md G-13/F-24) — a bare customerId isn't useful in a list view.
export type CreditNoteWithCustomer = CreditNote & { customerName: string }

export async function listCreditNotes(
  businessId: string,
  params: { customerId: string | undefined; from: string | undefined; to: string | undefined },
): Promise<CreditNoteWithCustomer[]> {
  return db
    .select({
      id: creditNotes.id,
      businessId: creditNotes.businessId,
      invoiceId: creditNotes.invoiceId,
      customerId: creditNotes.customerId,
      customerName: customers.name,
      creditNoteNumber: creditNotes.creditNoteNumber,
      status: creditNotes.status,
      issueDate: creditNotes.issueDate,
      subtotal: creditNotes.subtotal,
      gstAmount: creditNotes.gstAmount,
      total: creditNotes.total,
      currency: creditNotes.currency,
      exchangeRate: creditNotes.exchangeRate,
      subtotalMvr: creditNotes.subtotalMvr,
      gstAmountMvr: creditNotes.gstAmountMvr,
      totalMvr: creditNotes.totalMvr,
      reason: creditNotes.reason,
      createdAt: creditNotes.createdAt,
      updatedAt: creditNotes.updatedAt,
      createdBy: creditNotes.createdBy,
      updatedBy: creditNotes.updatedBy,
    })
    .from(creditNotes)
    .innerJoin(customers, eq(creditNotes.customerId, customers.id))
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
  // Multi-currency (Phase 30, UPGRADE.md G-10)
  gstAmountMvr?: string
  lineTotalMvr?: string
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
// Format: {businesses.credit_note_number_prefix}000001 (default CN-000001).
// Same advisory-lock pattern as invoice numbers.

export async function allocateCreditNoteNumber(businessId: string, tx: DbTx): Promise<string> {
  return allocateDocumentNumber(
    tx,
    businessId,
    ':cn',
    'credit_notes',
    'credit_note_number',
    'credit_note_number_prefix',
  )
}

// ─── Delivery notes (Phase 33, UPGRADE.md G-13/F-24) ─────────────────────────

export async function allocateDeliveryNoteNumber(businessId: string, tx: DbTx): Promise<string> {
  return allocateDocumentNumber(
    tx,
    businessId,
    ':dn',
    'delivery_notes',
    'delivery_note_number',
    'delivery_note_number_prefix',
  )
}

type NewDeliveryNote = {
  businessId: string
  invoiceId: string
  customerId: string
  deliveryNoteNumber: string
  issueDate: string
  notes?: string | null
  createdBy: string
}

export async function insertDeliveryNote(data: NewDeliveryNote, tx: DbTx): Promise<DeliveryNote> {
  const [row] = await tx
    .insert(deliveryNotes)
    .values({ ...data, updatedBy: data.createdBy })
    .returning()
  if (!row) throw new Error('insertDeliveryNote: no row returned')
  return row
}

type NewDeliveryNoteLine = {
  businessId: string
  deliveryNoteId: string
  itemId?: string | null
  description: string
  qty: string
  sortOrder?: number
}

export async function insertDeliveryNoteLines(
  lines: NewDeliveryNoteLine[],
  tx: DbTx,
): Promise<DeliveryNoteLine[]> {
  if (lines.length === 0) return []
  return tx.insert(deliveryNoteLines).values(lines).returning()
}

export async function getDeliveryNoteById(
  businessId: string,
  id: string,
  tx?: DbTx,
): Promise<DeliveryNote | null> {
  const q = tx ?? db
  const [row] = await q
    .select()
    .from(deliveryNotes)
    .where(and(eq(deliveryNotes.businessId, businessId), eq(deliveryNotes.id, id)))
  return row ?? null
}

export async function getDeliveryNoteLinesByDn(
  businessId: string,
  deliveryNoteId: string,
  tx?: DbTx,
): Promise<DeliveryNoteLine[]> {
  const q = tx ?? db
  return q
    .select()
    .from(deliveryNoteLines)
    .where(
      and(
        eq(deliveryNoteLines.businessId, businessId),
        eq(deliveryNoteLines.deliveryNoteId, deliveryNoteId),
      ),
    )
    .orderBy(deliveryNoteLines.sortOrder)
}

export type DeliveryNoteWithCustomer = DeliveryNote & { customerName: string }

export async function listDeliveryNotes(
  businessId: string,
  params: { customerId: string | undefined },
): Promise<DeliveryNoteWithCustomer[]> {
  return db
    .select({
      id: deliveryNotes.id,
      businessId: deliveryNotes.businessId,
      invoiceId: deliveryNotes.invoiceId,
      customerId: deliveryNotes.customerId,
      customerName: customers.name,
      deliveryNoteNumber: deliveryNotes.deliveryNoteNumber,
      issueDate: deliveryNotes.issueDate,
      notes: deliveryNotes.notes,
      createdAt: deliveryNotes.createdAt,
      updatedAt: deliveryNotes.updatedAt,
      createdBy: deliveryNotes.createdBy,
      updatedBy: deliveryNotes.updatedBy,
    })
    .from(deliveryNotes)
    .innerJoin(customers, eq(deliveryNotes.customerId, customers.id))
    .where(
      and(
        eq(deliveryNotes.businessId, businessId),
        params.customerId ? eq(deliveryNotes.customerId, params.customerId) : undefined,
      ),
    )
    .orderBy(desc(deliveryNotes.createdAt))
}

export async function listDeliveryNotesByInvoice(
  businessId: string,
  invoiceId: string,
): Promise<DeliveryNote[]> {
  return db
    .select()
    .from(deliveryNotes)
    .where(and(eq(deliveryNotes.businessId, businessId), eq(deliveryNotes.invoiceId, invoiceId)))
    .orderBy(desc(deliveryNotes.createdAt))
}
