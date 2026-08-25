import { Worker } from 'bullmq'
import { redis } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import { ocrImage } from '../lib/ocr-engine.js'
import { wordsToTsv } from '../lib/order-list-ocr.js'
import { parseImportText, type ParsedImport } from '../lib/order-list-import.js'

// Order-list "import from image" OCR (Phase 36, ARCHITECTURE.md §4.16). Runs
// at concurrency 1 — OCR is CPU-heavy, same reasoning as the pdf worker's
// per-worker concurrency limit (SECURITY.md §13.7). The image never touches
// disk or object storage: it arrives base64-encoded in the job payload
// (transient — decoded in-process and discarded once the job finishes).

export type ExtractJobData = { imageBase64: string }

export function registerExtractWorker(): Worker<ExtractJobData> {
  return new Worker<ExtractJobData>(
    'extract',
    async (job): Promise<ParsedImport> => {
      const buffer = Buffer.from(job.data.imageBase64, 'base64')
      const words = await ocrImage(buffer)
      const tsv = wordsToTsv(words)
      const result = parseImportText(tsv)
      logger.info(
        { lineCount: result.lines.length, skipped: result.skipped },
        'Order list image extract complete',
      )
      return result
    },
    { connection: redis, concurrency: 1 },
  )
}
