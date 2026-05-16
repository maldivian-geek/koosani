import { Queue } from 'bullmq'
import { redis } from './redis.js'

// Phase 11 will schedule this with a cron expression via reconcileQueue.upsertJobScheduler(...)
export const reconcileQueue = new Queue('reconcile', { connection: redis })
