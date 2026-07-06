import { Worker } from 'bullmq'
import Decimal from 'decimal.js'
import { redis } from '../lib/redis.js'
import { logger } from '../lib/logger.js'
import { db } from '../db/client.js'
import * as repo from '../modules/inventory/repository.js'

// Nightly reconcile: verifies items.stock_on_hand matches SUM(stock_movements.qty).
// The scheduler (registerWorkers, via reconcileQueue.upsertJobScheduler) enqueues
// a job with no businessId — this fans out across every business (UPGRADE.md
// F-21). A businessId in job.data (e.g. from a manual/test-triggered job) scopes
// the check to just that one business.

async function reconcileBusiness(
  businessId: string,
): Promise<{ itemsChecked: number; discrepancies: number }> {
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

  return { itemsChecked: allItems.length, discrepancies }
}

export function registerReconcileWorker(): Worker {
  return new Worker(
    'reconcile',
    async (job) => {
      const { businessId } = (job.data ?? {}) as { businessId?: string }
      const businessIds = businessId ? [businessId] : await repo.listAllBusinessIds()

      let itemsChecked = 0
      let discrepancies = 0

      for (const bid of businessIds) {
        const result = await reconcileBusiness(bid)
        itemsChecked += result.itemsChecked
        discrepancies += result.discrepancies
      }

      logger.info(
        { businessesChecked: businessIds.length, itemsChecked, discrepancies },
        'Reconcile job complete',
      )

      return { businessesChecked: businessIds.length, itemsChecked, discrepancies }
    },
    { connection: redis },
  )
}
