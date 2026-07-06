import { Worker } from 'bullmq'
import { redis } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import { todayMv, daysBetween } from '@koosani/shared'
import * as invoicing from '../modules/invoicing/service.js'
import * as estimates from '../modules/estimates/service.js'
import * as recurrence from '../modules/recurrence/service.js'
import * as settings from '../modules/settings/service.js'
import * as emailLogsRepo from '../modules/emailLogs/repository.js'
import * as invRepo from '../modules/inventory/repository.js'
import { emailQueue } from '../lib/queues.js'

// Daily cron (08:00 Maldives time — worker/index.ts). Three independent scans
// share this schedule since all are simple daily date-comparisons over the
// same per-business fan-out: payment reminders (Phase 24, UPGRADE.md G-4),
// estimate expiry (Phase 25, UPGRADE.md G-5), and recurring invoice
// generation (Phase 26, UPGRADE.md G-6).

// For each business's reminderScheduleDays (e.g. -3/0/7/14 relative to due
// date), find invoices whose day-offset matches exactly today, and fire a
// reminder email — once per (invoice, offset) ever, enforced by
// invoice_reminders_sent's unique index via emailLogsRepo.markReminderSent.
async function scanReminders(businessId: string): Promise<number> {
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

// Sent estimates past their expiryDate transition to 'expired'. No real
// acting user for a cron-triggered transition, so the audit trail attributes
// it to the estimate's own creator (a defensible "system acting on behalf of
// whoever made this" choice, avoiding a schema change to make AuditCtx.userId
// nullable for this one case).
async function scanEstimateExpiry(businessId: string): Promise<number> {
  const today = todayMv()
  const candidates = await estimates.listExpiryCandidates(businessId)

  let expired = 0
  for (const estimate of candidates) {
    if (!estimate.expiryDate || estimate.expiryDate >= today) continue
    const ctx = {
      userId: estimate.createdBy,
      businessId,
      ip: '127.0.0.1',
      ua: 'reminders-worker',
    }
    await estimates.markExpired(businessId, estimate.id, ctx)
    expired++
  }
  return expired
}

// Generates one invoice per due recurrence profile (nextRunDate <= today,
// active, within its date range). generateFromProfile advances nextRunDate
// under a row lock before creating anything, so a duplicate scan (or two
// concurrent cron ticks) can't double-generate — see service.ts's comment.
// Same "attribute to the profile's own creator" choice as estimate expiry.
async function scanRecurrence(businessId: string): Promise<number> {
  const today = todayMv()
  const candidates = await recurrence.listDueProfiles(businessId, today)

  let generated = 0
  for (const profile of candidates) {
    const ctx = {
      userId: profile.createdBy,
      businessId,
      ip: '127.0.0.1',
      ua: 'reminders-worker',
    }
    const result = await recurrence.generateFromProfile(businessId, profile.id, ctx)
    if (result) generated++
  }
  return generated
}

export function registerRemindersWorker(): Worker {
  return new Worker(
    'reminders',
    async (job) => {
      const { businessId } = (job.data ?? {}) as { businessId?: string }
      const businessIds = businessId ? [businessId] : await invRepo.listAllBusinessIds()

      let totalFired = 0
      let totalExpired = 0
      let totalGenerated = 0
      for (const bid of businessIds) {
        totalFired += await scanReminders(bid)
        totalExpired += await scanEstimateExpiry(bid)
        totalGenerated += await scanRecurrence(bid)
      }

      logger.info(
        {
          businessesScanned: businessIds.length,
          remindersFired: totalFired,
          estimatesExpired: totalExpired,
          invoicesGenerated: totalGenerated,
        },
        'Reminders/expiry/recurrence scan complete',
      )
      return {
        businessesScanned: businessIds.length,
        remindersFired: totalFired,
        estimatesExpired: totalExpired,
        invoicesGenerated: totalGenerated,
      }
    },
    { connection: redis },
  )
}
