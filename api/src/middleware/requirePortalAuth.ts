import type { MiddlewareHandler } from 'hono'
import { getCookie } from 'hono/cookie'
import { verifyPortalToken, getSession, touchSession } from '../modules/portalAuth/service.js'
import type { PortalEnv } from '../types.js'

// Deliberately separate from requireAuth.ts (SECURITY.md §13.14) — different
// cookie, different JWT secret, different session table. No 30-second cache
// like staff auth: portal traffic volume is much lower, so the DB round trip
// per request is an acceptable, simpler trade-off.

export const requirePortalAuth: MiddlewareHandler<PortalEnv> = async (c, next) => {
  const token = getCookie(c, 'portal_session')
  if (!token) return c.json({ error: 'unauthorized' }, 401)

  const payload = verifyPortalToken(token)
  if (!payload) return c.json({ error: 'unauthorized' }, 401)

  const session = await getSession(payload.sid)
  if (!session || !session.isActive) return c.json({ error: 'unauthorized' }, 401)
  // Reject a stolen JWT with swapped sid, same defense as staff auth (SECURITY.md §JWT)
  if (session.customerId !== payload.customerId || session.businessId !== payload.businessId) {
    return c.json({ error: 'unauthorized' }, 401)
  }

  touchSession(payload.sid)

  c.set('portalBusinessId', payload.businessId)
  c.set('portalCustomerId', payload.customerId)
  c.set('portalSid', payload.sid)

  await next()
}
