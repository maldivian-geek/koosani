import { extractQueue, extractQueueEvents } from './queues.js'
import type { ExtractJobData } from '../worker/extract.js'
import type { ParsedImport } from './order-list-import.js'

// OCR takes several seconds — longer than the 20s PDF-render timeout
// (lib/pdfClient.ts) — so this waits up to 60s.
const WAIT_TIMEOUT_MS = 60_000

// Enqueues an image-extract OCR job and synchronously waits for it to finish,
// mirroring lib/pdfClient.ts's renderAndWaitForFile — the route's contract
// (`POST .../lines/extract-image` → `{ lines, skipped }`) stays a single
// request/response even though the actual OCR runs in the worker process.
export async function extractAndWait(data: ExtractJobData): Promise<ParsedImport> {
  const job = await extractQueue.add('extract', data)
  return (await job.waitUntilFinished(extractQueueEvents, WAIT_TIMEOUT_MS)) as ParsedImport
}
