import { registerReconcileWorker } from './reconcile.js'

// Call this from the worker entrypoint process (not the API server).
// Phase 11 will wire scheduling via reconcileQueue.upsertJobScheduler().
export function registerWorkers() {
  return {
    reconcile: registerReconcileWorker(),
  }
}
