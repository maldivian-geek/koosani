import { Worker } from 'bullmq'
import { redis } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import * as gst from '../modules/gst/service.js'

export function registerGstWorker(): Worker {
  return new Worker(
    'gst',
    async (job) => {
      const { businessId, periodId, userId, ip } = job.data as {
        businessId: string
        periodId: string
        userId: string
        ip: string
      }

      const ctx = { userId, businessId, ip, ua: undefined as string | undefined }

      logger.info({ businessId, periodId, jobId: job.id }, 'GST return build started')

      const gstReturn = await gst.buildReturn(businessId, periodId, ctx)

      logger.info(
        { businessId, periodId, returnId: gstReturn.id },
        'GST return build complete',
      )

      return { returnId: gstReturn.id }
    },
    { connection: redis },
  )
}
