import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { setCookie, deleteCookie } from 'hono/cookie'
import { createRedisRateLimiter } from '../../lib/rateLimiter.js'
import { getRealIp } from '../../lib/ip.js'
import { config } from '../../lib/config.js'
import { requirePortalAuth } from '../../middleware/requirePortalAuth.js'
import * as svc from './service.js'
import type { PortalEnv } from '../../types.js'

// SECURITY.md §13.14 — same rate limits as staff magic-link, own key prefixes.
const magicLinkIpLimiter = createRedisRateLimiter('rl:portal-magic-ip', 5, 15 * 60)
const magicLinkEmailLimiter = createRedisRateLimiter('rl:portal-magic-email', 5, 15 * 60)
const verifyLimiter = createRedisRateLimiter('rl:portal-verify', 5, 15 * 60)

const PORTAL_SESSION_COOKIE = 'portal_session'
const COOKIE_TTL_SEC = 2 * 60 * 60 // 2 hours — see SECURITY.md §13.14

function setPortalSessionCookie(c: Parameters<typeof setCookie>[0], token: string): void {
  setCookie(c, PORTAL_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: config.NODE_ENV === 'production',
    sameSite: 'Strict',
    path: '/',
    maxAge: COOKIE_TTL_SEC,
  })
}

function clearPortalSessionCookie(c: Parameters<typeof deleteCookie>[0]): void {
  deleteCookie(c, PORTAL_SESSION_COOKIE, { path: '/' })
}

const MagicLinkRequestBody = z.object({ email: z.string().email() })
const MagicLinkVerifyBody = z.object({ token: z.string().min(1) })

export const portalAuthRoutes = new Hono<PortalEnv>()

// POST /portal/auth/magic-link
portalAuthRoutes.post('/magic-link', zValidator('json', MagicLinkRequestBody), async (c) => {
  const { email } = c.req.valid('json')
  const ip = getRealIp(c)

  const [ipOk, emailOk] = await Promise.all([
    magicLinkIpLimiter(ip),
    magicLinkEmailLimiter(`email:${email.toLowerCase()}`),
  ])
  if (!ipOk || !emailOk) return c.json({ error: 'too_many_requests' }, 429)

  // Fire-and-forget: always return 204 to prevent customer/email enumeration
  svc
    .requestMagicLink(email)
    .catch((err: unknown) => console.error({ err }, 'portal magic-link send failed'))
  return c.body(null, 204)
})

// POST /portal/auth/magic-link/verify
portalAuthRoutes.post('/magic-link/verify', zValidator('json', MagicLinkVerifyBody), async (c) => {
  const { token } = c.req.valid('json')
  const ip = getRealIp(c)
  const ua = c.req.header('user-agent') ?? ''

  const allowed = await verifyLimiter(ip)
  if (!allowed) return c.json({ error: 'too_many_requests' }, 429)

  const result = await svc.verifyMagicLink(token, { ip, ua })
  if (!result.ok) return c.json({ error: 'invalid_token' }, 401)

  setPortalSessionCookie(c, result.jwt)
  // Returns the profile directly (same convention as staff login/verify) so
  // the frontend can populate its store without a follow-up /portal/me call.
  // The service already verified the customer exists (before creating the
  // session — see portalAuth/service.ts's verifyMagicLink), so no separate
  // assertExists call is needed here.
  return c.json(result.customer)
})

// POST /portal/auth/logout
portalAuthRoutes.post('/logout', requirePortalAuth, async (c) => {
  await svc.logout(c.get('portalSid'))
  clearPortalSessionCookie(c)
  return c.body(null, 204)
})
