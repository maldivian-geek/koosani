import { Worker } from 'bullmq'
import { redis } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import * as invoicing from '../modules/invoicing/service.js'
import * as customers from '../modules/customers/service.js'
import * as emailLogs from '../modules/emailLogs/service.js'
import * as mailer from '../lib/mailer.js'
import { renderInvoicePdf, renderCustomerSoaPdf, businessInfo } from '../lib/pdf/build.js'

export type EmailJobData =
  | { kind: 'invoice'; businessId: string; invoiceId: string; userId: string }
  | { kind: 'receipt'; businessId: string; invoiceId: string; paymentId: string; userId: string }
  | { kind: 'reminder'; businessId: string; invoiceId: string; offsetDays: number }
  | {
      kind: 'statement'
      businessId: string
      customerId: string
      from: string
      to: string
      userId: string
    }

export function registerEmailWorker(): Worker<EmailJobData> {
  return new Worker<EmailJobData>(
    'email',
    async (job) => {
      const data = job.data
      const { businessId } = data
      let toEmail = ''
      let subject = ''
      let entityType = ''
      let entityId = ''

      try {
        switch (data.kind) {
          case 'invoice': {
            const invoice = await invoicing.getInvoice(businessId, data.invoiceId)
            const customer = await customers.assertExists(invoice.customerId, businessId)
            if (!customer.email) throw new Error('Customer has no email on file')
            const business = await businessInfo(businessId)
            const pdf = await renderInvoicePdf(businessId, data.invoiceId)
            const opts = mailer.invoiceEmail({
              to: customer.email,
              businessName: business.name,
              invoiceNumber: invoice.invoiceNumber ?? '(draft)',
              total: invoice.total,
              dueDate: invoice.dueDate,
              pdf,
            })
            toEmail = opts.to
            subject = opts.subject
            entityType = 'invoice'
            entityId = data.invoiceId
            await mailer.sendEmail(opts)
            break
          }
          case 'receipt': {
            const invoice = await invoicing.getInvoice(businessId, data.invoiceId)
            const customer = await customers.assertExists(invoice.customerId, businessId)
            const payment = invoice.payments.find((p) => p.id === data.paymentId)
            if (!customer.email || !payment) {
              throw new Error('Customer has no email on file, or payment not found')
            }
            const business = await businessInfo(businessId)
            const opts = mailer.receiptEmail({
              to: customer.email,
              businessName: business.name,
              invoiceNumber: invoice.invoiceNumber ?? '(draft)',
              amount: payment.amount,
              paidAt: payment.paidAt,
            })
            toEmail = opts.to
            subject = opts.subject
            entityType = 'invoice'
            entityId = data.invoiceId
            await mailer.sendEmail(opts)
            break
          }
          case 'reminder': {
            const invoice = await invoicing.getInvoice(businessId, data.invoiceId)
            const customer = await customers.assertExists(invoice.customerId, businessId)
            if (!customer.email) throw new Error('Customer has no email on file')
            const business = await businessInfo(businessId)
            const balanceDue = (Number(invoice.total) - Number(invoice.paidAmount ?? '0')).toFixed(
              2,
            )
            const opts = mailer.reminderEmail({
              to: customer.email,
              businessName: business.name,
              invoiceNumber: invoice.invoiceNumber ?? '(draft)',
              total: invoice.total,
              balanceDue,
              dueDate: invoice.dueDate ?? '',
              offsetDays: data.offsetDays,
            })
            toEmail = opts.to
            subject = opts.subject
            entityType = 'invoice'
            entityId = data.invoiceId
            await mailer.sendEmail(opts)
            break
          }
          case 'statement': {
            const customer = await customers.assertExists(data.customerId, businessId)
            if (!customer.email) throw new Error('Customer has no email on file')
            const business = await businessInfo(businessId)
            const soa = await customers.buildSoa(businessId, data.customerId, data.from, data.to)
            const pdf = await renderCustomerSoaPdf(businessId, data.customerId, data.from, data.to)
            const opts = mailer.statementEmail({
              to: customer.email,
              businessName: business.name,
              partyName: customer.name,
              from: data.from,
              to_: data.to,
              closingBalance: soa.closingBalance,
              pdf,
            })
            toEmail = opts.to
            subject = opts.subject
            entityType = 'customer_soa'
            entityId = data.customerId
            await mailer.sendEmail(opts)
            break
          }
        }

        await emailLogs.insertLog({
          businessId,
          kind: data.kind,
          entityType,
          entityId,
          toEmail,
          subject,
          status: 'sent',
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        await emailLogs.insertLog({
          businessId,
          kind: data.kind,
          entityType: entityType || data.kind,
          entityId: entityId || data.businessId,
          toEmail: toEmail || '(unknown)',
          subject: subject || '(unknown)',
          status: 'failed',
          errorMessage: message,
        })
        logger.error({ kind: data.kind, businessId, err: message }, 'Email send failed')
        throw err
      }
    },
    { connection: redis },
  )
}
