import { logger } from './lib/logger.js'
import { redis } from './lib/redis.js'
import { registerWorkers } from './worker/index.js'

// Worker process entrypoint (ARCHITECTURE.md §1, §8) — separate from server.ts.
// Run via `pnpm --filter @koosani/api worker` (prod) or `dev:worker` (dev).

async function main(): Promise<void> {
  const workers = await registerWorkers()
  logger.info({ queues: Object.keys(workers) }, 'Worker process started')

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Worker process shutting down')
    await Promise.all(Object.values(workers).map((w) => w.close()))
    await redis.quit()
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'Worker process failed to start')
  process.exit(1)
})
