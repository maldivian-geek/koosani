import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { setCookie, deleteCookie } from 'hono/cookie'
import {
  RateLimiterRedis,
  RateLimiterMemory,
  type RateLimiterAbstract,
} from 'rate-limiter-flexible'
import { ChangePasswordBody } from '@koosani/shared'
import { redisRateLimiter } from '../../lib/redis.js'
import { getRealIp } from '../../lib/ip.js'
import { requireAuth, invalidateSessionCache } from '../../middleware/requireAuth.js'
import { requireRole } from '../../middleware/authorize.js'
import * as svc from './service.js'
import * as repo from './repository.js'
import * as permissions from '../permissions/service.js'
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
    storeClient: redisRateLimiter,
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

// Returns the user's explicit permission grants (SECURITY.md §Authorization
// Model) — role-based defaults (admin bypasses everything; manager gets
// add/edit/delete by default) are policy the frontend/backend apply on top
// of this list, not part of it.
async function userResponse(user: ReturnType<typeof svc.toProfile>) {
  const perms = await permissions.listForUser(user.id)
  return { user, permissions: perms }
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
  return c.json(await userResponse(svc.toProfile(result.user)))
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
  return c.json(await userResponse(svc.toProfile(result.user)))
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

  // resetPassword already bumped token_version and deactivated sessions
  // (SECURITY.md §Password Reset Flow); clear the in-process session cache
  // too so that takes effect immediately rather than after the 30s window
  // (SECURITY.md §13.2) — same pattern as logout/logout-all/change-password.
  invalidateSessionCache(result.userId)
  clearSessionCookie(c)
  return c.body(null, 204)
})

// POST /auth/accept-invite
authRoutes.post('/accept-invite', zValidator('json', acceptInviteSchema), async (c) => {
  const { token, password } = c.req.valid('json')
  const ip = getRealIp(c)
  const ua = c.req.header('user-agent') ?? ''

  // Per-IP only (SECURITY.md §Rate Limiting). A second limiter keyed on the
  // token itself would be attacker-controlled (not a real per-email limit —
  // the request carries only token+password, no email) and would lock out a
  // legitimate invitee retrying the same link. Per-email limiting isn't
  // possible here pre-consumption; strictLimiter is the real defense.
  const ipOk = await checkLimiter(strictLimiter, ip)
  if (!ipOk) return c.json({ error: 'too_many_requests' }, 429)

  const result = await svc.acceptInvite(token, password, { ip, ua })
  if (!result.ok) return c.json({ error: 'invalid_token' }, 401)

  setSessionCookie(c, result.jwt)
  return c.json(await userResponse(svc.toProfile(result.user)))
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

  const perms = await permissions.listForUser(userId)

  return c.json({
    ...svc.toProfile(user),
    permissions: perms,
    sessions: sessionsOut,
  })
})

// POST /auth/change-password (authenticated, self-service)
authRoutes.post(
  '/change-password',
  requireAuth,
  zValidator('json', ChangePasswordBody),
  async (c) => {
    const { currentPassword, newPassword } = c.req.valid('json')
    const userId = c.get('userId')
    const sid = c.get('sid')
    const ip = getRealIp(c)
    const ua = c.req.header('user-agent') ?? ''

    const user = await repo.findUserById(userId)
    if (!user) return c.json({ error: 'unauthorized' }, 401)

    const result = await svc.changePassword(user, sid, currentPassword, newPassword, { ip, ua })
    if (!result.ok) return c.json({ error: result.reason }, 401)

    invalidateSessionCache(userId) // token_version changed for every session of this user
    setSessionCookie(c, result.jwt)
    return c.body(null, 204)
  },
)

// GET /admin/activity (admin only) — SECURITY.md §Auth Event Logging
const ActivityQuery = z.object({
  event: z
    .enum([
      'login_success',
      'login_failed',
      'logout',
      'logout_all',
      'logout_others',
      'magic_link_used',
      'password_changed',
      'password_reset',
      'emergency_jwt_rotation',
    ])
    .optional(),
  userId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})

authRoutes.get(
  '/admin/activity',
  requireAuth,
  requireRole('admin'),
  zValidator('query', ActivityQuery),
  async (c) => {
    const q = c.req.valid('query')
    const { rows, total } = await repo.listActivity(c.get('businessId'), {
      event: q.event,
      userId: q.userId,
      page: q.page,
      pageSize: q.pageSize,
    })
    return c.json({ items: rows, total, page: q.page, pageSize: q.pageSize })
  },
)
