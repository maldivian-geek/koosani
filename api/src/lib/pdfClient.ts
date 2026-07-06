import { pdfQueue, pdfQueueEvents } from './queues.js'
import type { PdfJobData } from '../worker/pdf.js'

const WAIT_TIMEOUT_MS = 20_000

// Enqueues a PDF render job and synchronously waits for it to finish, so the
// documented `GET .../pdf → signed URL` contract holds even though the actual
// rendering happens in the worker process (CPU isolation — ARCHITECTURE.md
// §8, SECURITY.md §13.7). Throws if rendering doesn't finish within 20s.
export async function renderAndWaitForFile(data: PdfJobData): Promise<string> {
  const job = await pdfQueue.add(data.kind, data)
  const result = (await job.waitUntilFinished(pdfQueueEvents, WAIT_TIMEOUT_MS)) as {
    fileId: string
  }
  return result.fileId
}
