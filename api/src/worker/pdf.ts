import { Worker } from 'bullmq'
import { redis } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import * as filesService from '../modules/files/service.js'
import {
  renderInvoicePdf,
  renderPoPdf,
  renderCustomerSoaPdf,
  renderSupplierSoaPdf,
  renderEstimatePdf,
} from '../lib/pdf/build.js'

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
  | { kind: 'estimate'; businessId: string; estimateId: string; userId: string }

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
          buffer = await renderInvoicePdf(businessId, job.data.invoiceId)
          filename = `invoice-${job.data.invoiceId}.pdf`
          entityType = 'invoice'
          entityId = job.data.invoiceId
          break
        case 'po':
          buffer = await renderPoPdf(businessId, job.data.poId)
          filename = `po-${job.data.poId}.pdf`
          entityType = 'po'
          entityId = job.data.poId
          break
        case 'customer-soa':
          buffer = await renderCustomerSoaPdf(
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
          buffer = await renderSupplierSoaPdf(
            businessId,
            job.data.supplierId,
            job.data.from,
            job.data.to,
          )
          filename = `supplier-soa-${job.data.supplierId}-${job.data.from}-${job.data.to}.pdf`
          entityType = 'supplier_soa'
          entityId = job.data.supplierId
          break
        case 'estimate':
          buffer = await renderEstimatePdf(businessId, job.data.estimateId)
          filename = `estimate-${job.data.estimateId}.pdf`
          entityType = 'estimate'
          entityId = job.data.estimateId
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
