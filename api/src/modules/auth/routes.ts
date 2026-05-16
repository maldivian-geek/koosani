import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { setCookie, deleteCookie } from 'hono/cookie'
import {
  RateLimiterRedis,
  RateLimiterMemory,
  type RateLimiterAbstract,
} from 'rate-limiter-flexible'
import { redis } from '../../lib/redis.js'
import { getRealIp } from '../../lib/ip.js'
import { requireAuth, invalidateSessionCache } from '../../middleware/requireAuth.js'
import * as svc from './service.js'
import * as repo from './repository.js'
import {
  loginSchema,
  magicLinkRequestSchema,
  magicLinkVerifySchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  acceptInviteSchema,
} from './schema.js'
import { config } from '../../lib/config.js'
import type { AppEnv } from '../../types.js'

// ─── Rate limiters (SECURITY.md §Rate Limiting) ──────────────────────────────

function makeRedisLimiter(
  keyPrefix: string,
  points: number,
  durationSec: number,
): RateLimiterAbstract {
  return new RateLimiterRedis({
    storeClient: redis,
    keyPrefix,
    points,
    duration: durationSec,
    insuranceLimiter: new RateLimiterMemory({ points, duration: durationSec }),
  })
}

const loginLimiter = makeRedisLimiter('rl:login', 5, 15 * 60)
const magicLinkLimiter = makeRedisLimiter('rl:magic', 5, 15 * 60)
const emailLimiter = makeRedisLimiter('rl:email', 5, 60 * 60)
const forgotPasswordLimiter = makeRedisLimiter('rl:forgot', 5, 15 * 60)
const strictLimiter = makeRedisLimiter('rl:strict', 5, 15 * 60)

async function checkLimiter(limiter: RateLimiterAbstract, key: string): Promise<boolean> {
  try {
    await limiter.consume(key)
    return true
  } catch {
    return false
  }
}

// ─── Cookie helpers ───────────────────────────────────────────────────────────

const SESSION_COOKIE = 'session'
const COOKIE_TTL_SEC = 8 * 60 * 60 // 8 hours

function setSessionCookie(c: Parameters<typeof setCookie>[0], token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'Strict',
    path: '/',
    maxAge: COOKIE_TTL_SEC,
  })
}

function clearSessionCookie(c: Parameters<typeof deleteCookie>[0]): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' })
}

function userResponse(user: ReturnType<typeof svc.toProfile>) {
  return { user, permissions: [] as unknown[] }
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const authRoutes = new Hono<AppEnv>()

// POST /auth/login
authRoutes.post('/login', zValidator('json', loginSchema), async (c) => {
  const { email, password } = c.req.valid('json')
  const ip = getRealIp(c)
  const ua = c.req.header('user-agent') ?? ''

  const allowed = await checkLimiter(loginLimiter, `${ip}:${email}`)
  if (!allowed) return c.json({ error: 'too_many_requests' }, 429)

  const result = await svc.login(email, password, { ip, ua })
  if (!result.ok) return c.json({ error: 'invalid_credentials' }, 401)

  setSessionCookie(c, result.jwt)
  return c.json(userResponse(svc.toProfile(result.user)))
})

// POST /auth/magic-link
authRoutes.post('/magic-link', zValidator('json', magicLinkRequestSchema), async (c) => {
  const { email } = c.req.valid('json')
  const ip = getRealIp(c)

  const [ipOk, emailOk] = await Promise.all([
    checkLimiter(magicLinkLimiter, ip),
    checkLimiter(emailLimiter, `email:${email}`),
  ])
  if (!ipOk || !emailOk) return c.json({ error: 'too_many_requests' }, 429)

  // Fire-and-forget: always return 204 to prevent email enumeration
  svc
    .requestMagicLink(email)
    .catch((err: unknown) => console.error({ err }, 'magic-link send failed'))
  return c.body(null, 204)
})

// POST /auth/magic-link/verify
authRoutes.post('/magic-link/verify', zValidator('json', magicLinkVerifySchema), async (c) => {
  const { token } = c.req.valid('json')
  const ip = getRealIp(c)
  const ua = c.req.header('user-agent') ?? ''

  const allowed = await checkLimiter(strictLimiter, ip)
  if (!allowed) return c.json({ error: 'too_many_requests' }, 429)

  const result = await svc.verifyMagicLink(token, { ip, ua })
  if (!result.ok) return c.json({ error: 'invalid_token' }, 401)

  setSessionCookie(c, result.jwt)
  return c.json(userResponse(svc.toProfile(result.user)))
})

// POST /auth/forgot-password
authRoutes.post('/forgot-password', zValidator('json', forgotPasswordSchema), async (c) => {
  const { email } = c.req.valid('json')
  const ip = getRealIp(c)

  const [ipOk, emailOk] = await Promise.all([
    checkLimiter(forgotPasswordLimiter, ip),
    checkLimiter(emailLimiter, `email:${email}`),
  ])
  if (!ipOk || !emailOk) return c.json({ error: 'too_many_requests' }, 429)

  svc
    .forgotPassword(email)
    .catch((err: unknown) => console.error({ err }, 'forgot-password send failed'))
  return c.body(null, 204)
})

// POST /auth/reset-password
authRoutes.post('/reset-password', zValidator('json', resetPasswordSchema), async (c) => {
  const { token, password } = c.req.valid('json')
  const ip = getRealIp(c)
  const ua = c.req.header('user-agent') ?? ''

  const allowed = await checkLimiter(strictLimiter, ip)
  if (!allowed) return c.json({ error: 'too_many_requests' }, 429)

  const result = await svc.resetPassword(token, password, { ip, ua })
  if (!result.ok) return c.json({ error: 'invalid_token' }, 401)

  clearSessionCookie(c)
  return c.body(null, 204)
})

// POST /auth/accept-invite
authRoutes.post('/accept-invite', zValidator('json', acceptInviteSchema), async (c) => {
  const { token, password } = c.req.valid('json')
  const ip = getRealIp(c)
  const ua = c.req.header('user-agent') ?? ''

  const [ipOk, emailOk] = await Promise.all([
    checkLimiter(strictLimiter, ip),
    checkLimiter(emailLimiter, `invite:${token.slice(0, 8)}`),
  ])
  if (!ipOk || !emailOk) return c.json({ error: 'too_many_requests' }, 429)

  const result = await svc.acceptInvite(token, password, { ip, ua })
  if (!result.ok) return c.json({ error: 'invalid_token' }, 401)

  setSessionCookie(c, result.jwt)
  return c.json(userResponse(svc.toProfile(result.user)))
})

// POST /auth/logout (authenticated)
authRoutes.post('/logout', requireAuth, async (c) => {
  const userId = c.get('userId')
  const sid = c.get('sid')
  const ip = getRealIp(c)
  const ua = c.req.header('user-agent') ?? ''

  const user = await repo.findUserById(userId)
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  invalidateSessionCache(userId, sid)
  await svc.logout(user, sid, { ip, ua })
  clearSessionCookie(c)
  return c.body(null, 204)
})

// POST /auth/logout-all (authenticated)
authRoutes.post('/logout-all', requireAuth, async (c) => {
  const userId = c.get('userId')
  const ip = getRealIp(c)
  const ua = c.req.header('user-agent') ?? ''

  const user = await repo.findUserById(userId)
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  invalidateSessionCache(userId) // clear all cache entries for this user
  await svc.logoutAll(user, { ip, ua })
  clearSessionCookie(c)
  return c.body(null, 204)
})

// POST /auth/logout-others (authenticated)
authRoutes.post('/logout-others', requireAuth, async (c) => {
  const userId = c.get('userId')
  const sid = c.get('sid')
  const ip = getRealIp(c)
  const ua = c.req.header('user-agent') ?? ''

  const user = await repo.findUserById(userId)
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  invalidateSessionCache(userId) // clear all; the current session will re-populate on next request
  await svc.logoutOthers(user, sid, { ip, ua })
  return c.body(null, 204)
})

// GET /me (authenticated)
authRoutes.get('/me', requireAuth, async (c) => {
  const userId = c.get('userId')

  const user = await repo.findUserById(userId)
  if (!user) return c.json({ error: 'unauthorized' }, 401)

  const sessions = await repo.getActiveSessions(userId)
  const sessionsOut = sessions.map((s) => ({
    id: s.id,
    browser: s.browser,
    os: s.os,
    ip: s.ip,
    city: s.city,
    country: s.country,
    lastUsedAt: s.lastUsedAt,
    createdAt: s.createdAt,
    isCurrent: s.id === c.get('sid'),
  }))

  return c.json({
    ...svc.toProfile(user),
    permissions: [] as unknown[],
    sessions: sessionsOut,
  })
})
