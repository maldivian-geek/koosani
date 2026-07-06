import { Worker } from 'bullmq'
import { redis } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import { todayMv, daysBetween } from '@koosani/shared'
import * as invoicing from '../modules/invoicing/service.js'
import * as settings from '../modules/settings/service.js'
import * as emailLogsRepo from '../modules/emailLogs/repository.js'
import * as invRepo from '../modules/inventory/repository.js'
import { emailQueue } from '../lib/queues.js'

// Daily dunning scan (Phase 24, UPGRADE.md G-4). For each business's
// reminderScheduleDays (e.g. -3/0/7/14 relative to due date), find invoices
// whose day-offset matches exactly today, and fire a reminder email — once
// per (invoice, offset) ever, enforced by invoice_reminders_sent's unique
// index via emailLogsRepo.markReminderSent.

async function scanBusiness(businessId: string): Promise<number> {
  const business = await settings.get(businessId)
  const today = todayMv()
  const candidates = await invoicing.listReminderCandidates(businessId)

  let fired = 0
  for (const invoice of candidates) {
    if (!invoice.dueDate) continue
    const offset = daysBetween(invoice.dueDate, today)
    if (!business.reminderScheduleDays.includes(offset)) continue

    const isNew = await emailLogsRepo.markReminderSent(businessId, invoice.id, offset)
    if (!isNew) continue // already sent for this exact offset

    await emailQueue.add('reminder', {
      kind: 'reminder',
      businessId,
      invoiceId: invoice.id,
      offsetDays: offset,
    })
    fired++
  }
  return fired
}

export function registerRemindersWorker(): Worker {
  return new Worker(
    'reminders',
    async (job) => {
      const { businessId } = (job.data ?? {}) as { businessId?: string }
      const businessIds = businessId ? [businessId] : await invRepo.listAllBusinessIds()

      let totalFired = 0
      for (const bid of businessIds) {
        totalFired += await scanBusiness(bid)
      }

      logger.info(
        { businessesScanned: businessIds.length, remindersFired: totalFired },
        'Reminders scan complete',
      )
      return { businessesScanned: businessIds.length, remindersFired: totalFired }
    },
    { connection: redis },
  )
}
