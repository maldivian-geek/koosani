import { Worker } from 'bullmq'
import { redis } from '../lib/redis.js'
import { storage } from '../lib/storage.js'
import { parseCsv, parsePdf } from '../lib/soa-parser.js'
import * as purchases from '../modules/purchases/service.js'
import * as filesRepo from '../modules/files/repository.js'

export const soaExtractWorker = new Worker(
  'soa-extract',
  async (job) => {
    const { businessId, supplierId, fileId } = job.data as {
      businessId: string
      supplierId: string
      fileId: string
    }

    const file = await filesRepo.findById(businessId, fileId)
    if (!file) throw new Error(`File ${fileId} not found`)

    const buffer = await storage.get(file.storageKey)

    const isCsv = file.mimeType === 'text/csv' || file.mimeType === 'application/vnd.ms-excel'

    const lines = isCsv ? parseCsv(buffer.toString('utf-8')) : await parsePdf(buffer)

    const matches = await Promise.all(
      lines.map(async (line) => {
        const bill = await purchases.matchSoaLine(businessId, supplierId, line)
        return { line, billId: bill?.id ?? null }
      }),
    )

    return { matches }
  },
  { connection: redis },
)
