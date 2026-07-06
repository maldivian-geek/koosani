import { Worker } from 'bullmq'
import { redis } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import * as invoicing from '../modules/invoicing/service.js'
import * as poService from '../modules/po/service.js'
import * as customers from '../modules/customers/service.js'
import * as suppliers from '../modules/suppliers/service.js'
import * as purchases from '../modules/purchases/service.js'
import * as settings from '../modules/settings/service.js'
import * as filesService from '../modules/files/service.js'
import { InvoiceDocument } from '../lib/pdf/InvoiceDocument.js'
import { PoDocument } from '../lib/pdf/PoDocument.js'
import { SoaDocument } from '../lib/pdf/SoaDocument.js'
import { renderPdfBuffer } from '../lib/pdf/render.js'
import type { BusinessInfo } from '../lib/pdf/types.js'

export type PdfJobData =
  | { kind: 'invoice'; businessId: string; invoiceId: string; userId: string }
  | { kind: 'po'; businessId: string; poId: string; userId: string }
  | {
      kind: 'customer-soa'
      businessId: string
      customerId: string
      from: string
      to: string
      userId: string
    }
  | {
      kind: 'supplier-soa'
      businessId: string
      supplierId: string
      from: string
      to: string
      userId: string
    }

async function businessInfo(businessId: string): Promise<BusinessInfo> {
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

async function renderInvoice(businessId: string, invoiceId: string): Promise<Buffer> {
  const [business, invoice] = await Promise.all([
    businessInfo(businessId),
    invoicing.getInvoice(businessId, invoiceId),
  ])
  const customer = await customers.assertExists(invoice.customerId, businessId)

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
  })
  return renderPdfBuffer(element)
}

async function renderPo(businessId: string, poId: string): Promise<Buffer> {
  const [business, po] = await Promise.all([
    businessInfo(businessId),
    poService.getPo(businessId, poId),
  ])
  const supplier = await suppliers.getById(businessId, po.supplierId)

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
  })
  return renderPdfBuffer(element)
}

async function renderCustomerSoa(
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

async function renderSupplierSoa(
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

export function registerPdfWorker(): Worker<PdfJobData> {
  return new Worker<PdfJobData>(
    'pdf',
    async (job) => {
      const { businessId, userId } = job.data
      const ctx = { userId, businessId, ip: '127.0.0.1', ua: 'pdf-worker' }

      let buffer: Buffer
      let filename: string
      let entityType: string
      let entityId: string

      switch (job.data.kind) {
        case 'invoice':
          buffer = await renderInvoice(businessId, job.data.invoiceId)
          filename = `invoice-${job.data.invoiceId}.pdf`
          entityType = 'invoice'
          entityId = job.data.invoiceId
          break
        case 'po':
          buffer = await renderPo(businessId, job.data.poId)
          filename = `po-${job.data.poId}.pdf`
          entityType = 'po'
          entityId = job.data.poId
          break
        case 'customer-soa':
          buffer = await renderCustomerSoa(
            businessId,
            job.data.customerId,
            job.data.from,
            job.data.to,
          )
          filename = `customer-soa-${job.data.customerId}-${job.data.from}-${job.data.to}.pdf`
          entityType = 'customer_soa'
          entityId = job.data.customerId
          break
        case 'supplier-soa':
          buffer = await renderSupplierSoa(
            businessId,
            job.data.supplierId,
            job.data.from,
            job.data.to,
          )
          filename = `supplier-soa-${job.data.supplierId}-${job.data.from}-${job.data.to}.pdf`
          entityType = 'supplier_soa'
          entityId = job.data.supplierId
          break
      }

      const file = await filesService.uploadFile(
        businessId,
        buffer,
        filename,
        'application/pdf',
        ctx,
      )
      await filesService.attachToEntity(businessId, file.id, entityType, entityId, ctx)

      logger.info({ kind: job.data.kind, businessId, fileId: file.id }, 'PDF rendered')
      return { fileId: file.id }
    },
    { connection: redis },
  )
}
