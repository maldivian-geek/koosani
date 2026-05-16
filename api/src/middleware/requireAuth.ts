import type { Context, Next } from 'hono'
import { getCookie } from 'hono/cookie'
import { verifyToken } from '../modules/auth/service.js'
import { getSession, touchSession } from '../modules/auth/repository.js'
import type { JwtPayload } from '../modules/auth/service.js'

// 30-second in-process cache for token_version + session validity per (user_id, sid)
// (SECURITY.md §13.2)
type CacheEntry = {
  tokenVersion: number
  isActive: boolean
  userId: string
  cachedAt: number
}

const sessionCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 30_000

function cacheKey(userId: string, sid: string): string {
  return `${userId}:${sid}`
}

export function invalidateSessionCache(userId: string, sid?: string): void {
  if (sid) {
    sessionCache.delete(cacheKey(userId, sid))
  } else {
    // Invalidate all entries for this user
    for (const key of sessionCache.keys()) {
      if (key.startsWith(`${userId}:`)) sessionCache.delete(key)
    }
  }
}

export type AuthVariables = {
  userId: string
  businessId: string
  role: 'admin' | 'manager' | 'staff'
  name: string
  email: string
  sid: string
  ip: string
  jwtPayload: JwtPayload
}

export async function requireAuth(c: Context, next: Next): Promise<Response | void> {
  const token = getCookie(c, 'session')
  if (!token) return c.json({ error: 'unauthorized' }, 401)

  const payload = verifyToken(token)
  if (!payload) return c.json({ error: 'unauthorized' }, 401)

  const key = cacheKey(payload.id, payload.sid)
  const now = Date.now()
  const cached = sessionCache.get(key)

  let tokenVersion: number
  let isActive: boolean
  let sessionUserId: string

  if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
    tokenVersion = cached.tokenVersion
    isActive = cached.isActive
    sessionUserId = cached.userId
  } else {
    const session = await getSession(payload.sid)
    if (!session) return c.json({ error: 'unauthorized' }, 401)

    tokenVersion = payload.tokenVersion
    isActive = session.isActive
    sessionUserId = session.userId

    sessionCache.set(key, {
      tokenVersion: payload.tokenVersion,
      isActive: session.isActive,
      userId: session.userId,
      cachedAt: now,
    })
  }

  // Reject stale token_version or inactive session
  if (payload.tokenVersion !== tokenVersion) {
    sessionCache.delete(key)
    return c.json({ error: 'unauthorized' }, 401)
  }
  if (!isActive) {
    sessionCache.delete(key)
    return c.json({ error: 'unauthorized' }, 401)
  }
  // Reject a stolen JWT with swapped sid (SECURITY.md §JWT)
  if (sessionUserId !== payload.id) {
    sessionCache.delete(key)
    return c.json({ error: 'unauthorized' }, 401)
  }

  // Touch session (throttled, fire-and-forget)
  touchSession(payload.sid)

  c.set('userId', payload.id)
  c.set('businessId', payload.businessId)
  c.set('role', payload.role)
  c.set('name', payload.name)
  c.set('email', payload.email)
  c.set('sid', payload.sid)
  c.set('jwtPayload', payload)

  await next()
}
