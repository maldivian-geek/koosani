import { and, eq, gte, inArray, isNotNull, lte, sql } from 'drizzle-orm'
import { db } from '../../db/client.js'
import {
  invoices,
  invoiceLines,
  creditNotes,
  creditNoteLines,
  bills,
  billLines,
  customers,
  suppliers,
  items,
  stockMovements,
  grnLines,
} from '../../db/schema/index.js'

// ─── Shared constants ─────────────────────────────────────────────────────────

// ─── Result types ─────────────────────────────────────────────────────────────

export interface GroupRow {
  groupKey: string
  label: string
  docCount: string
  subtotal: string
  gstAmount: string
  total: string
}

export interface CreditRow {
  groupKey: string
  subtotal: string
  gstAmount: string
  total: string
}

export interface AgedRow {
  entityId: string
  entityName: string
  docId: string
  docNumber: string | null
  dueDate: string | null
  outstanding: string
}

export interface StockMovementRow {
  itemId: string
  qty: string
  movedAt: Date
  unitCost: string | null
}

export interface ItemRow {
  id: string
  name: string
  sku: string
  stockOnHand: string
  defaultCost: string | null
}

export interface GstLineAgg {
  category: string
  netAmount: string
  gstAmount: string
}

export interface GstBillAgg {
  supplierId: string
  supplierName: string
  supplierTin: string | null
  category: string
  netAmount: string
  gstAmount: string
}

// ─── Sales register ───────────────────────────────────────────────────────────
// Sales-side reports sum the *_mvr line columns, not the document-currency
// ones — reports are always in the business's home currency (ARCHITECTURE.md
// §4.10). A no-op for MVR-only businesses since the Mvr columns equal their
// document-currency counterparts exactly when exchangeRate is 1.

export async function salesInvoicesByCustomer(
  businessId: string,
  from: string,
  to: string,
): Promise<GroupRow[]> {
  return db
    .select({
      groupKey: customers.id,
      label: customers.name,
      docCount: sql<string>`COUNT(DISTINCT ${invoices.id})::text`,
      subtotal: sql<string>`COALESCE(SUM(${invoiceLines.lineTotalMvr} - ${invoiceLines.gstAmountMvr}), '0')`,
      gstAmount: sql<string>`COALESCE(SUM(${invoiceLines.gstAmountMvr}), '0')`,
      total: sql<string>`COALESCE(SUM(${invoiceLines.lineTotalMvr}), '0')`,
    })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
    .innerJoin(customers, eq(invoices.customerId, customers.id))
    .where(
      and(
        eq(invoices.businessId, businessId),
        inArray(invoices.status, ['issued', 'paid', 'partially_paid']),
        isNotNull(invoices.issueDate),
        gte(invoices.issueDate, from),
        lte(invoices.issueDate, to),
      ),
    )
    .groupBy(customers.id, customers.name) as unknown as GroupRow[]
}

export async function salesCNByCustomer(
  businessId: string,
  from: string,
  to: string,
): Promise<CreditRow[]> {
  return db
    .select({
      groupKey: creditNotes.customerId,
      subtotal: sql<string>`COALESCE(SUM(${creditNoteLines.lineTotalMvr} - ${creditNoteLines.gstAmountMvr}), '0')`,
      gstAmount: sql<string>`COALESCE(SUM(${creditNoteLines.gstAmountMvr}), '0')`,
      total: sql<string>`COALESCE(SUM(${creditNoteLines.lineTotalMvr}), '0')`,
    })
    .from(creditNoteLines)
    .innerJoin(creditNotes, eq(creditNoteLines.creditNoteId, creditNotes.id))
    .where(
      and(
        eq(creditNotes.businessId, businessId),
        eq(creditNotes.status, 'issued'),
        isNotNull(creditNotes.issueDate),
        gte(creditNotes.issueDate, from),
        lte(creditNotes.issueDate, to),
      ),
    )
    .groupBy(creditNotes.customerId) as unknown as CreditRow[]
}

export async function salesInvoicesByItem(
  businessId: string,
  from: string,
  to: string,
): Promise<GroupRow[]> {
  return db
    .select({
      groupKey: sql<string>`COALESCE(${invoiceLines.itemId}::text, ${invoiceLines.description})`,
      label: sql<string>`MAX(${invoiceLines.description})`,
      docCount: sql<string>`COUNT(DISTINCT ${invoices.id})::text`,
      subtotal: sql<string>`COALESCE(SUM(${invoiceLines.lineTotalMvr} - ${invoiceLines.gstAmountMvr}), '0')`,
      gstAmount: sql<string>`COALESCE(SUM(${invoiceLines.gstAmountMvr}), '0')`,
      total: sql<string>`COALESCE(SUM(${invoiceLines.lineTotalMvr}), '0')`,
    })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
    .where(
      and(
        eq(invoices.businessId, businessId),
        inArray(invoices.status, ['issued', 'paid', 'partially_paid']),
        isNotNull(invoices.issueDate),
        gte(invoices.issueDate, from),
        lte(invoices.issueDate, to),
      ),
    )
    .groupBy(
      sql`COALESCE(${invoiceLines.itemId}::text, ${invoiceLines.description})`,
    ) as unknown as GroupRow[]
}

export async function salesCNByItem(
  businessId: string,
  from: string,
  to: string,
): Promise<CreditRow[]> {
  return db
    .select({
      groupKey: sql<string>`COALESCE(${creditNoteLines.itemId}::text, ${creditNoteLines.description})`,
      subtotal: sql<string>`COALESCE(SUM(${creditNoteLines.lineTotalMvr} - ${creditNoteLines.gstAmountMvr}), '0')`,
      gstAmount: sql<string>`COALESCE(SUM(${creditNoteLines.gstAmountMvr}), '0')`,
      total: sql<string>`COALESCE(SUM(${creditNoteLines.lineTotalMvr}), '0')`,
    })
    .from(creditNoteLines)
    .innerJoin(creditNotes, eq(creditNoteLines.creditNoteId, creditNotes.id))
    .where(
      and(
        eq(creditNotes.businessId, businessId),
        eq(creditNotes.status, 'issued'),
        isNotNull(creditNotes.issueDate),
        gte(creditNotes.issueDate, from),
        lte(creditNotes.issueDate, to),
      ),
    )
    .groupBy(
      sql`COALESCE(${creditNoteLines.itemId}::text, ${creditNoteLines.description})`,
    ) as unknown as CreditRow[]
}

export async function salesInvoicesByDay(
  businessId: string,
  from: string,
  to: string,
): Promise<GroupRow[]> {
  return db
    .select({
      groupKey: sql<string>`${invoices.issueDate}::text`,
      label: sql<string>`${invoices.issueDate}::text`,
      docCount: sql<string>`COUNT(DISTINCT ${invoices.id})::text`,
      subtotal: sql<string>`COALESCE(SUM(${invoiceLines.lineTotalMvr} - ${invoiceLines.gstAmountMvr}), '0')`,
      gstAmount: sql<string>`COALESCE(SUM(${invoiceLines.gstAmountMvr}), '0')`,
      total: sql<string>`COALESCE(SUM(${invoiceLines.lineTotalMvr}), '0')`,
    })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
    .where(
      and(
        eq(invoices.businessId, businessId),
        inArray(invoices.status, ['issued', 'paid', 'partially_paid']),
        isNotNull(invoices.issueDate),
        gte(invoices.issueDate, from),
        lte(invoices.issueDate, to),
      ),
    )
    .groupBy(invoices.issueDate)
    .orderBy(invoices.issueDate) as unknown as GroupRow[]
}

export async function salesCNByDay(
  businessId: string,
  from: string,
  to: string,
): Promise<CreditRow[]> {
  return db
    .select({
      groupKey: sql<string>`${creditNotes.issueDate}::text`,
      subtotal: sql<string>`COALESCE(SUM(${creditNoteLines.lineTotalMvr} - ${creditNoteLines.gstAmountMvr}), '0')`,
      gstAmount: sql<string>`COALESCE(SUM(${creditNoteLines.gstAmountMvr}), '0')`,
      total: sql<string>`COALESCE(SUM(${creditNoteLines.lineTotalMvr}), '0')`,
    })
    .from(creditNoteLines)
    .innerJoin(creditNotes, eq(creditNoteLines.creditNoteId, creditNotes.id))
    .where(
      and(
        eq(creditNotes.businessId, businessId),
        eq(creditNotes.status, 'issued'),
        isNotNull(creditNotes.issueDate),
        gte(creditNotes.issueDate, from),
        lte(creditNotes.issueDate, to),
      ),
    )
    .groupBy(creditNotes.issueDate) as unknown as CreditRow[]
}

// ─── Purchases register ───────────────────────────────────────────────────────

export async function purchasesBySupplier(
  businessId: string,
  from: string,
  to: string,
): Promise<GroupRow[]> {
  return db
    .select({
      groupKey: suppliers.id,
      label: suppliers.name,
      docCount: sql<string>`COUNT(DISTINCT ${bills.id})::text`,
      subtotal: sql<string>`COALESCE(SUM(${billLines.lineTotal} - ${billLines.gstAmount}), '0')`,
      gstAmount: sql<string>`COALESCE(SUM(${billLines.gstAmount}), '0')`,
      total: sql<string>`COALESCE(SUM(${billLines.lineTotal}), '0')`,
    })
    .from(billLines)
    .innerJoin(bills, eq(billLines.billId, bills.id))
    .innerJoin(suppliers, eq(bills.supplierId, suppliers.id))
    .where(
      and(
        eq(bills.businessId, businessId),
        inArray(bills.status, ['confirmed', 'paid', 'partially_paid']),
        isNotNull(bills.billDate),
        gte(bills.billDate, from),
        lte(bills.billDate, to),
      ),
    )
    .groupBy(suppliers.id, suppliers.name) as unknown as GroupRow[]
}

export async function purchasesByItem(
  businessId: string,
  from: string,
  to: string,
): Promise<GroupRow[]> {
  return db
    .select({
      groupKey: sql<string>`COALESCE(${billLines.itemId}::text, ${billLines.description})`,
      label: sql<string>`MAX(${billLines.description})`,
      docCount: sql<string>`COUNT(DISTINCT ${bills.id})::text`,
      subtotal: sql<string>`COALESCE(SUM(${billLines.lineTotal} - ${billLines.gstAmount}), '0')`,
      gstAmount: sql<string>`COALESCE(SUM(${billLines.gstAmount}), '0')`,
      total: sql<string>`COALESCE(SUM(${billLines.lineTotal}), '0')`,
    })
    .from(billLines)
    .innerJoin(bills, eq(billLines.billId, bills.id))
    .where(
      and(
        eq(bills.businessId, businessId),
        inArray(bills.status, ['confirmed', 'paid', 'partially_paid']),
        isNotNull(bills.billDate),
        gte(bills.billDate, from),
        lte(bills.billDate, to),
      ),
    )
    .groupBy(
      sql`COALESCE(${billLines.itemId}::text, ${billLines.description})`,
    ) as unknown as GroupRow[]
}

export async function purchasesByDay(
  businessId: string,
  from: string,
  to: string,
): Promise<GroupRow[]> {
  return db
    .select({
      groupKey: sql<string>`${bills.billDate}::text`,
      label: sql<string>`${bills.billDate}::text`,
      docCount: sql<string>`COUNT(DISTINCT ${bills.id})::text`,
      subtotal: sql<string>`COALESCE(SUM(${billLines.lineTotal} - ${billLines.gstAmount}), '0')`,
      gstAmount: sql<string>`COALESCE(SUM(${billLines.gstAmount}), '0')`,
      total: sql<string>`COALESCE(SUM(${billLines.lineTotal}), '0')`,
    })
    .from(billLines)
    .innerJoin(bills, eq(billLines.billId, bills.id))
    .where(
      and(
        eq(bills.businessId, businessId),
        inArray(bills.status, ['confirmed', 'paid', 'partially_paid']),
        isNotNull(bills.billDate),
        gte(bills.billDate, from),
        lte(bills.billDate, to),
      ),
    )
    .groupBy(bills.billDate)
    .orderBy(bills.billDate) as unknown as GroupRow[]
}

// ─── Stock valuation ──────────────────────────────────────────────────────────
// Joins stock_movements to grn_lines for GRN inflows so the service can
// compute avg cost and FIFO without a second query.

export async function stockMovementsWithCost(
  businessId: string,
  asOf: string,
): Promise<StockMovementRow[]> {
  return db
    .select({
      itemId: stockMovements.itemId,
      qty: stockMovements.qty,
      movedAt: stockMovements.movedAt,
      unitCost: grnLines.unitCost,
    })
    .from(stockMovements)
    .leftJoin(
      grnLines,
      and(eq(stockMovements.sourceId, grnLines.id), eq(stockMovements.source, 'grn')),
    )
    .where(
      and(
        eq(stockMovements.businessId, businessId),
        sql`${stockMovements.movedAt} < ${asOf}::date + interval '1 day'`,
      ),
    )
    .orderBy(stockMovements.itemId, stockMovements.movedAt) as unknown as StockMovementRow[]
}

export async function allItems(businessId: string): Promise<ItemRow[]> {
  return db
    .select({
      id: items.id,
      name: items.name,
      sku: items.sku,
      stockOnHand: items.stockOnHand,
      defaultCost: items.defaultCost,
    })
    .from(items)
    .where(and(eq(items.businessId, businessId), sql`${items.deletedAt} IS NULL`))
    .orderBy(items.name) as unknown as ItemRow[]
}

// ─── Aged receivables ─────────────────────────────────────────────────────────
// Returns one row per outstanding invoice as of asOf (issue_date <= asOf,
// status is issued or partially_paid with remaining balance > 0).

// Uses total_mvr/paid_amount_mvr, not the document-currency columns — aged
// receivables is a header-level (not line-level) read, and reports are
// always in the business's home currency (ARCHITECTURE.md §4.10). A no-op
// for MVR-only businesses.
export async function agedReceivablesRaw(businessId: string, asOf: string): Promise<AgedRow[]> {
  return db
    .select({
      entityId: customers.id,
      entityName: customers.name,
      docId: invoices.id,
      docNumber: invoices.invoiceNumber,
      dueDate: sql<string | null>`${invoices.dueDate}::text`,
      outstanding: sql<string>`(${invoices.totalMvr} - ${invoices.paidAmountMvr})::text`,
    })
    .from(invoices)
    .innerJoin(customers, eq(invoices.customerId, customers.id))
    .where(
      and(
        eq(invoices.businessId, businessId),
        inArray(invoices.status, ['issued', 'partially_paid']),
        isNotNull(invoices.issueDate),
        lte(invoices.issueDate, asOf),
        // only include invoices where there is actually an outstanding balance
        sql`${invoices.totalMvr} > ${invoices.paidAmountMvr}`,
      ),
    )
    .orderBy(customers.name, invoices.dueDate) as unknown as AgedRow[]
}

// ─── Aged payables ────────────────────────────────────────────────────────────

export async function agedPayablesRaw(businessId: string, asOf: string): Promise<AgedRow[]> {
  return db
    .select({
      entityId: suppliers.id,
      entityName: suppliers.name,
      docId: bills.id,
      docNumber: bills.billNumber,
      dueDate: sql<string | null>`${bills.dueDate}::text`,
      outstanding: sql<string>`(${bills.total} - ${bills.paidAmount})::text`,
    })
    .from(bills)
    .innerJoin(suppliers, eq(bills.supplierId, suppliers.id))
    .where(
      and(
        eq(bills.businessId, businessId),
        inArray(bills.status, ['confirmed', 'partially_paid']),
        isNotNull(bills.billDate),
        lte(bills.billDate, asOf),
        sql`${bills.total} > ${bills.paidAmount}`,
      ),
    )
    .orderBy(suppliers.name, bills.dueDate) as unknown as AgedRow[]
}

// ─── GST summary (live preview, arbitrary date range) ────────────────────────
// Same aggregations as gst.repository but with caller-supplied from/to dates.

export async function gstSummaryInvoiceLines(
  businessId: string,
  from: string,
  to: string,
): Promise<GstLineAgg[]> {
  return db
    .select({
      category: invoiceLines.gstCategory,
      netAmount: sql<string>`COALESCE(SUM(${invoiceLines.lineTotalMvr} - ${invoiceLines.gstAmountMvr}), '0')`,
      gstAmount: sql<string>`COALESCE(SUM(${invoiceLines.gstAmountMvr}), '0')`,
    })
    .from(invoiceLines)
    .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
    .where(
      and(
        eq(invoices.businessId, businessId),
        inArray(invoices.status, ['issued', 'paid', 'partially_paid', 'voided']),
        isNotNull(invoices.issueDate),
        gte(invoices.issueDate, from),
        lte(invoices.issueDate, to),
      ),
    )
    .groupBy(invoiceLines.gstCategory) as unknown as GstLineAgg[]
}

export async function gstSummaryCNLines(
  businessId: string,
  from: string,
  to: string,
): Promise<GstLineAgg[]> {
  return db
    .select({
      category: creditNoteLines.gstCategory,
      netAmount: sql<string>`COALESCE(SUM(${creditNoteLines.lineTotalMvr} - ${creditNoteLines.gstAmountMvr}), '0')`,
      gstAmount: sql<string>`COALESCE(SUM(${creditNoteLines.gstAmountMvr}), '0')`,
    })
    .from(creditNoteLines)
    .innerJoin(creditNotes, eq(creditNoteLines.creditNoteId, creditNotes.id))
    .where(
      and(
        eq(creditNotes.businessId, businessId),
        eq(creditNotes.status, 'issued'),
        isNotNull(creditNotes.issueDate),
        gte(creditNotes.issueDate, from),
        lte(creditNotes.issueDate, to),
      ),
    )
    .groupBy(creditNoteLines.gstCategory) as unknown as GstLineAgg[]
}

export async function gstSummaryBillLines(
  businessId: string,
  from: string,
  to: string,
): Promise<GstBillAgg[]> {
  return db
    .select({
      supplierId: suppliers.id,
      supplierName: suppliers.name,
      supplierTin: suppliers.tin,
      category: billLines.gstCategory,
      netAmount: sql<string>`COALESCE(SUM(${billLines.lineTotal} - ${billLines.gstAmount}), '0')`,
      gstAmount: sql<string>`COALESCE(SUM(${billLines.gstAmount}), '0')`,
    })
    .from(billLines)
    .innerJoin(bills, eq(billLines.billId, bills.id))
    .innerJoin(suppliers, eq(bills.supplierId, suppliers.id))
    .where(
      and(
        eq(bills.businessId, businessId),
        inArray(bills.status, ['confirmed', 'paid', 'partially_paid']),
        isNotNull(bills.billDate),
        gte(bills.billDate, from),
        lte(bills.billDate, to),
      ),
    )
    .groupBy(
      suppliers.id,
      suppliers.name,
      suppliers.tin,
      billLines.gstCategory,
    ) as unknown as GstBillAgg[]
}
