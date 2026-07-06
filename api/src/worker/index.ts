import { registerReconcileWorker } from './reconcile.js'
import { registerGstWorker } from './gst.js'
import { soaExtractWorker } from './soa-extract.js'
import { registerPdfWorker } from './pdf.js'
import { registerEmailWorker } from './email.js'
import { registerRemindersWorker } from './reminders.js'
import { reconcileQueue, remindersQueue } from '../lib/queues.js'
import { MV_TZ } from '@koosani/shared'

// Call this from the worker entrypoint process (not the API server).
export async function registerWorkers() {
  // Nightly at 02:00 Maldives time; the job carries no businessId, so the
  // reconcile worker fans out across every business (UPGRADE.md F-21).
  await reconcileQueue.upsertJobScheduler(
    'nightly-reconcile',
    { pattern: '0 2 * * *', tz: MV_TZ },
    { name: 'reconcile', data: {} },
  )

  // Daily at 08:00 Maldives time — a business hour, so any resulting email
  // lands during the day rather than at 2am (Phase 24, UPGRADE.md G-4).
  await remindersQueue.upsertJobScheduler(
    'daily-reminders',
    { pattern: '0 8 * * *', tz: MV_TZ },
    { name: 'reminders', data: {} },
  )

  return {
    reconcile: registerReconcileWorker(),
    gst: registerGstWorker(),
    soaExtract: soaExtractWorker,
    pdf: registerPdfWorker(),
    email: registerEmailWorker(),
    reminders: registerRemindersWorker(),
  }
}
