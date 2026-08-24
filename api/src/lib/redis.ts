import Redis from 'ioredis'
import { config } from './config.js'

// BullMQ connection. BullMQ requires maxRetriesPerRequest: null on a provided
// ioredis instance (blocking commands must retry indefinitely).
export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  lazyConnect: false,
})

// Rate-limiter connection — separate from the BullMQ client because it must
// FAIL FAST when Redis is unreachable: rate-limiter-flexible only falls over
// to its in-memory insurance limiter when a command REJECTS. With ioredis 6,
// a command on a down connection otherwise sits in the offline queue forever,
// holding every auth request open instead of degrading to the insurance
// limiter (SECURITY.md §Rate Limiting).
export const redisRateLimiter = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 2,
  enableOfflineQueue: false,
  enableReadyCheck: false,
  lazyConnect: false,
})

redis.on('error', (err: Error) => {
  console.error({ err }, 'Redis connection error')
})
redisRateLimiter.on('error', (err: Error) => {
  console.error({ err }, 'Redis (rate limiter) connection error')
})
