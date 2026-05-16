import { Queue } from 'bullmq'
import { redis } from './redis.js'

// Phase 11 will schedule this with a cron expression via reconcileQueue.upsertJobScheduler(...)
export const reconcileQueue = new Queue('reconcile', { connection: redis })

export const soaExtractQueue = new Queue('soa-extract', { connection: redis })

// PDF generation: invoice, credit note, PO, SOA (ARCHITECTURE.md §8)
export const pdfQueue = new Queue('pdf', { connection: redis })

// GST return building: MIRA 205 / 206 + Input Tax Statement (ARCHITECTURE.md §8)
export const gstQueue = new Queue('gst', { connection: redis })
