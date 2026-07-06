import {
  RateLimiterRedis,
  RateLimiterMemory,
  type RateLimiterAbstract,
} from 'rate-limiter-flexible'
import { redis } from './redis.js'

/**
 * Returns a per-key sliding-window rate limiter.
 * @param windowMs  Window duration in milliseconds
 * @param max       Maximum allowed calls per window per key
 *
 * @deprecated in-process only — resets per instance/restart and does not share
 * state across multiple API processes (UPGRADE.md F-7). Use
 * `createRedisRateLimiter` for anything financially sensitive; kept for call
 * sites not yet migrated.
 */
export function createRateLimiter(windowMs: number, max: number): (key: string) => boolean {
  const windows = new Map<string, { count: number; resetAt: number }>()

  return function check(key: string): boolean {
    const now = Date.now()
    const w = windows.get(key)
    if (!w || now > w.resetAt) {
      windows.set(key, { count: 1, resetAt: now + windowMs })
      return true
    }
    if (w.count >= max) return false
    w.count++
    return true
  }
}

/**
 * Redis-backed sliding-window limiter shared across all API instances
 * (UPGRADE.md F-7). Falls back to an in-process `RateLimiterMemory` if Redis
 * is briefly unreachable, matching the pattern already used in auth/routes.ts.
 *
 * @param keyPrefix  Unique namespace for this limiter (e.g. 'rl:invoice-pdf')
 * @param points     Maximum allowed calls per window per key
 * @param durationSec Window duration in seconds
 */
export function createRedisRateLimiter(
  keyPrefix: string,
  points: number,
  durationSec: number,
): (key: string) => Promise<boolean> {
  const limiter: RateLimiterAbstract = new RateLimiterRedis({
    storeClient: redis,
    keyPrefix,
    points,
    duration: durationSec,
    insuranceLimiter: new RateLimiterMemory({ points, duration: durationSec }),
  })

  return async function check(key: string): Promise<boolean> {
    try {
      await limiter.consume(key)
      return true
    } catch {
      return false
    }
  }
}
