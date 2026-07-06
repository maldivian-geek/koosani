import { Queue, QueueEvents } from 'bullmq'
import { redis } from './redis.js'

// Scheduled nightly via reconcileQueue.upsertJobScheduler() in worker/index.ts (Phase 20)
export const reconcileQueue = new Queue('reconcile', { connection: redis })

export const soaExtractQueue = new Queue('soa-extract', { connection: redis })

// PDF generation: invoice, PO, customer/supplier SOA (ARCHITECTURE.md §8, Phase 23).
// Routes enqueue and synchronously await completion (pdfQueueEvents +
// job.waitUntilFinished) so the documented `GET .../pdf → signed URL` contract
// holds, while the actual rendering still runs in the worker process — CPU
// isolation without changing the API shape.
export const pdfQueue = new Queue('pdf', { connection: redis })
export const pdfQueueEvents = new QueueEvents('pdf', { connection: redis })

// GST return building: MIRA 205 / 206 + Input Tax Statement (ARCHITECTURE.md §8)
export const gstQueue = new Queue('gst', { connection: redis })
