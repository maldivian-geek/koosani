// Assembles each document's PDF from persisted data. Shared by the `pdf`
// queue (on-demand GET .../pdf) and the `email` queue (attachments) — Phase
// 23/24, UPGRADE.md — so both render identically without duplicating the
// cross-module data-gathering.
import * as invoicing from '../../modules/invoicing/service.js'
import * as poService from '../../modules/po/service.js'
import * as customers from '../../modules/customers/service.js'
import * as suppliers from '../../modules/suppliers/service.js'
import * as purchases from '../../modules/purchases/service.js'
import * as settings from '../../modules/settings/service.js'
import * as estimatesService from '../../modules/estimates/service.js'
import * as customFieldsService from '../../modules/customFields/service.js'
import * as orderListsService from '../../modules/orderLists/service.js'
import { InvoiceDocument } from './InvoiceDocument.js'
import { PoDocument } from './PoDocument.js'
import { SoaDocument } from './SoaDocument.js'
import { EstimateDocument } from './EstimateDocument.js'
import { CreditNoteDocument } from './CreditNoteDocument.js'
import { DeliveryNoteDocument } from './DeliveryNoteDocument.js'
import { OrderListDocument } from './OrderListDocument.js'
import { renderPdfBuffer } from './render.js'
import type { BusinessInfo } from './types.js'
import type { CustomFieldPdfData } from './customFieldsSection.js'

// Shared by every renderer below that supports custom fields (Phase 33c,
// UPGRADE.md G-13/F-24) — fetches defined fields with their values for one
// document and formats them for display (booleans as Yes/No; text/number/
// date render as stored). Unset fields are omitted rather than shown blank.
async function customFieldsFor(
  businessId: string,
  docType: 'invoice' | 'estimate' | 'po' | 'credit_note',
  docId: string,
): Promise<CustomFieldPdfData[]> {
  const fields = await customFieldsService.listValuesForDoc(businessId, docType, docId)
  return fields
    .filter((f) => f.value !== null)
    .map((f) => ({
      label: f.fieldLabel,
      value: f.fieldType === 'boolean' ? (f.value === 'true' ? 'Yes' : 'No') : (f.value as string),
    }))
}

export async function businessInfo(businessId: string): Promise<BusinessInfo> {
  const b = await settings.get(businessId)
  return {
    name: b.name,
    tin: b.tin,
    address: b.address,
    phone: b.phone,
    email: b.email,
    logoUrl: b.logoUrl,
  }
}

export async function renderInvoicePdf(businessId: string, invoiceId: string): Promise<Buffer> {
  const [business, invoice] = await Promise.all([
    businessInfo(businessId),
    invoicing.getInvoice(businessId, invoiceId),
  ])
  const [customer, customFields] = await Promise.all([
    customers.assertExists(invoice.customerId, businessId),
    customFieldsFor(businessId, 'invoice', invoiceId),
  ])

  const element = InvoiceDocument({
    business,
    documentTitle: 'TAX INVOICE',
    number: invoice.invoiceNumber ?? '(draft)',
    issueDate: invoice.issueDate ?? '',
    dueDate: invoice.dueDate,
    billTo: { name: customer.name, tin: customer.tin, address: customer.address },
    lines: invoice.lines.map((l) => ({
      description: l.description,
      qty: l.qty,
      rate: l.unitPrice,
      gstRate: l.gstRate,
      gstAmount: l.gstAmount,
      lineTotal: l.lineTotal,
    })),
    subtotal: invoice.subtotal,
    gstAmount: invoice.gstAmount,
    total: invoice.total,
    balanceDue: (Number(invoice.total) - Number(invoice.paidAmount ?? '0')).toFixed(2),
    notes: invoice.notes,
    customFields,
  })
  return renderPdfBuffer(element)
}

export async function renderPoPdf(businessId: string, poId: string): Promise<Buffer> {
  const [business, po] = await Promise.all([
    businessInfo(businessId),
    poService.getPo(businessId, poId),
  ])
  const [supplier, customFields] = await Promise.all([
    suppliers.getById(businessId, po.supplierId),
    customFieldsFor(businessId, 'po', poId),
  ])

  const element = PoDocument({
    business,
    number: po.poNumber ?? '(draft)',
    orderDate: po.orderDate ?? '',
    expectedDate: po.expectedDate,
    supplier: { name: supplier.name, tin: supplier.tin, address: supplier.address },
    lines: po.lines.map((l) => ({
      description: l.description,
      qtyOrdered: l.qtyOrdered,
      unitCost: l.unitCost,
      lineTotal: l.lineTotal,
    })),
    subtotal: po.subtotal,
    notes: po.notes,
    customFields,
  })
  return renderPdfBuffer(element)
}

export async function renderCustomerSoaPdf(
  businessId: string,
  customerId: string,
  from: string,
  to: string,
): Promise<Buffer> {
  const [business, customer, soa] = await Promise.all([
    businessInfo(businessId),
    customers.assertExists(customerId, businessId),
    customers.buildSoa(businessId, customerId, from, to),
  ])

  const element = SoaDocument({
    business,
    party: { name: customer.name, tin: customer.tin, address: customer.address },
    partyLabel: 'Customer',
    from,
    to,
    openingBalance: soa.openingBalance,
    entries: soa.entries.map((e) => ({
      date: e.date,
      type: e.type,
      ref: e.ref,
      debit: e.debit,
      credit: e.credit,
      balance: e.balance,
    })),
    closingBalance: soa.closingBalance,
  })
  return renderPdfBuffer(element)
}

export async function renderSupplierSoaPdf(
  businessId: string,
  supplierId: string,
  from: string,
  to: string,
): Promise<Buffer> {
  const [business, supplier, soa] = await Promise.all([
    businessInfo(businessId),
    suppliers.getById(businessId, supplierId),
    purchases.buildSupplierSoa(businessId, supplierId, from, to),
  ])

  const element = SoaDocument({
    business,
    party: { name: supplier.name, tin: supplier.tin, address: supplier.address },
    partyLabel: 'Supplier',
    from,
    to,
    openingBalance: null,
    entries: soa.entries.map((e) => ({
      date: e.date,
      type: e.type,
      ref: e.ref,
      debit: e.debit,
      credit: e.credit,
      balance: e.balance,
    })),
    closingBalance: soa.closingBalance,
  })
  return renderPdfBuffer(element)
}

export async function renderEstimatePdf(businessId: string, estimateId: string): Promise<Buffer> {
  const [business, estimate] = await Promise.all([
    businessInfo(businessId),
    estimatesService.getEstimate(businessId, estimateId),
  ])
  const [customer, customFields] = await Promise.all([
    customers.assertExists(estimate.customerId, businessId),
    customFieldsFor(businessId, 'estimate', estimateId),
  ])

  const element = EstimateDocument({
    business,
    number: estimate.estimateNumber ?? '(draft)',
    issueDate: estimate.issueDate ?? '',
    expiryDate: estimate.expiryDate,
    billTo: { name: customer.name, tin: customer.tin, address: customer.address },
    lines: estimate.lines.map((l) => ({
      description: l.description,
      qty: l.qty,
      rate: l.unitPrice,
      gstRate: l.gstRate,
      gstAmount: l.gstAmount,
      lineTotal: l.lineTotal,
    })),
    subtotal: estimate.subtotal,
    gstAmount: estimate.gstAmount,
    total: estimate.total,
    notes: estimate.notes,
    customFields,
  })
  return renderPdfBuffer(element)
}

export async function renderCreditNotePdf(
  businessId: string,
  creditNoteId: string,
): Promise<Buffer> {
  const [business, cn] = await Promise.all([
    businessInfo(businessId),
    invoicing.getCreditNote(businessId, creditNoteId),
  ])
  const [customer, invoice, customFields] = await Promise.all([
    customers.assertExists(cn.customerId, businessId),
    cn.invoiceId ? invoicing.getInvoice(businessId, cn.invoiceId) : null,
    customFieldsFor(businessId, 'credit_note', creditNoteId),
  ])

  const element = CreditNoteDocument({
    business,
    number: cn.creditNoteNumber ?? '(draft)',
    issueDate: cn.issueDate ?? '',
    againstInvoiceNumber: invoice?.invoiceNumber ?? '—',
    billTo: { name: customer.name, tin: customer.tin, address: customer.address },
    lines: cn.lines.map((l) => ({
      description: l.description,
      qty: l.qty,
      rate: l.unitPrice,
      gstRate: l.gstRate,
      gstAmount: l.gstAmount,
      lineTotal: l.lineTotal,
    })),
    subtotal: cn.subtotal,
    gstAmount: cn.gstAmount,
    total: cn.total,
    reason: cn.reason ?? '',
    customFields,
  })
  return renderPdfBuffer(element)
}

export async function renderDeliveryNotePdf(
  businessId: string,
  deliveryNoteId: string,
): Promise<Buffer> {
  const [business, dn] = await Promise.all([
    businessInfo(businessId),
    invoicing.getDeliveryNote(businessId, deliveryNoteId),
  ])
  const [customer, invoice] = await Promise.all([
    customers.assertExists(dn.customerId, businessId),
    invoicing.getInvoice(businessId, dn.invoiceId),
  ])

  const element = DeliveryNoteDocument({
    business,
    number: dn.deliveryNoteNumber,
    issueDate: dn.issueDate,
    againstInvoiceNumber: invoice.invoiceNumber ?? '—',
    deliverTo: { name: customer.name, tin: customer.tin, address: customer.address },
    lines: dn.lines.map((l) => ({ description: l.description, qty: l.qty })),
    notes: dn.notes,
  })
  return renderPdfBuffer(element)
}

export async function renderOrderListPdf(businessId: string, orderListId: string): Promise<Buffer> {
  const [business, orderList] = await Promise.all([
    businessInfo(businessId),
    orderListsService.getOrderList(businessId, orderListId),
  ])

  const element = OrderListDocument({
    business,
    title: orderList.title,
    notes: orderList.notes,
    lines: orderList.lines.map((l) => ({
      position: l.position,
      itemName: l.itemName,
      systemItemName: l.systemItemName,
      qty: l.qty,
      uom: l.uom,
      note: l.note,
      additionalNote: l.additionalNote,
      paymentStatus: l.paymentStatus,
      stockStatus: l.stockStatus,
    })),
  })
  return renderPdfBuffer(element)
}
