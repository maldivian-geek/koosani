/**
 * Returns a per-key sliding-window rate limiter.
 * @param windowMs  Window duration in milliseconds
 * @param max       Maximum allowed calls per window per key
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
