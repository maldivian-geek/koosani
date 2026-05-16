import Redis from 'ioredis'
import { config } from './config.js'

export const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null, // required by BullMQ; safe for rate-limiter-flexible too
  enableReadyCheck: false,
  lazyConnect: false,
})

redis.on('error', (err: Error) => {
  console.error({ err }, 'Redis connection error')
})
