import { Worker } from 'bullmq'
import Decimal from 'decimal.js'
import { redis } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import { db } from '../db/client.js'
import * as repo from '../modules/inventory/repository.js'

// Nightly reconcile: verifies items.stock_on_hand matches SUM(stock_movements.qty).
// Registered here; Phase 11 will schedule it via reconcileQueue.upsertJobScheduler().

export function registerReconcileWorker(): Worker {
  return new Worker(
    'reconcile',
    async (job) => {
      const { businessId } = job.data as { businessId: string }

      const allItems = await repo.listActiveItemIds(businessId)

      let discrepancies = 0

      for (const item of allItems) {
        const computed = await db.transaction(async (tx) =>
          repo.recomputeOnHand(businessId, item.id, tx),
        )
        const cached = new Decimal(item.stockOnHand)

        if (!computed.equals(cached)) {
          logger.warn(
            {
              businessId,
              itemId: item.id,
              sku: item.sku,
              computed: computed.toFixed(4),
              cached: cached.toFixed(4),
            },
            'Stock on hand mismatch detected — manual correction required',
          )
          discrepancies++
        }
      }

      logger.info(
        { businessId, itemsChecked: allItems.length, discrepancies },
        'Reconcile job complete',
      )

      return { itemsChecked: allItems.length, discrepancies }
    },
    { connection: redis },
  )
}
