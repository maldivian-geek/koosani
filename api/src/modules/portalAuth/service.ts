import jwt from 'jsonwebtoken'
import { randomBytes, createHash } from 'node:crypto'
import { config } from '../../lib/config.js'
import { geoLookup } from '../../lib/geo.js'
import { sendEmail } from '../../lib/mailer.js'
import * as repo from './repository.js'
import * as customers from '../customers/service.js'
import type { PortalSession } from './repository.js'

// Customer portal auth (Phase 28, UPGRADE.md G-8) — see SECURITY.md §13.14.
// Deliberately parallel to, but never sharing code paths with, modules/auth:
// portal identities are customers, not users; magic-link only, no passwords.

export type PortalJwtPayload = {
  type: 'portal'
  businessId: string
  customerId: string
  sid: string
}

const PORTAL_JWT_EXPIRY = '2h'

function portalSecret(): string {
  if (!config.PORTAL_JWT_SECRET) {
    throw new Error('PORTAL_JWT_SECRET is not configured — the customer portal is disabled')
  }
  return config.PORTAL_JWT_SECRET
}

export function signPortalToken(payload: PortalJwtPayload): string {
  return jwt.sign(payload, portalSecret(), { algorithm: 'HS256', expiresIn: PORTAL_JWT_EXPIRY })
}

export function verifyPortalToken(token: string): PortalJwtPayload | null {
  try {
    const decoded = jwt.verify(token, portalSecret(), { algorithms: ['HS256'] })
    if (typeof decoded !== 'object' || decoded === null || decoded.type !== 'portal') return null
    return decoded as PortalJwtPayload
  } catch {
    return null
  }
}

function generateToken(): string {
  return randomBytes(32).toString('hex')
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

function parseUserAgent(ua: string): { browser: string | null; os: string | null } {
  const browser = ua.includes('Edg/')
    ? 'Edge'
    : ua.includes('Firefox/')
      ? 'Firefox'
      : ua.includes('Chrome/')
        ? 'Chrome'
        : ua.includes('Safari/')
          ? 'Safari'
          : null

  const os = ua.includes('Windows')
    ? 'Windows'
    : ua.includes('Mac OS')
      ? 'macOS'
      : ua.includes('Android')
        ? 'Android'
        : ua.includes('iPhone') || ua.includes('iPad')
          ? 'iOS'
          : ua.includes('Linux')
            ? 'Linux'
            : null

  return { browser, os }
}

type SessionContext = { ip: string; ua: string }

async function issueSession(
  businessId: string,
  customerId: string,
  ctx: SessionContext,
): Promise<{ sid: string; jwt: string }> {
  const { browser, os } = parseUserAgent(ctx.ua)
  const geo = await geoLookup(ctx.ip)

  const session = await repo.createSession({
    businessId,
    customerId,
    ip: ctx.ip,
    browser,
    os,
    city: geo.city,
    country: geo.country,
  })

  const token = signPortalToken({ type: 'portal', businessId, customerId, sid: session.id })
  return { sid: session.id, jwt: token }
}

// Always returns void regardless of match — same enumeration protection as
// staff magic-link requests. Sends one email per matching (businessId,
// customerId) pair; a customer with the same email at two businesses gets
// two separate emails (SECURITY.md §13.14).
export async function requestMagicLink(email: string): Promise<void> {
  const matches = await repo.findActiveCustomersByEmail(email)

  for (const customer of matches) {
    if (!customer.email) continue
    const token = generateToken()
    const tokenHash = sha256(token)
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000)

    await repo.createToken({
      businessId: customer.businessId,
      customerId: customer.id,
      tokenHash,
      expiresAt,
    })

    const link = `${config.PORTAL_FRONTEND_URL}/auth/verify?token=${token}`
    await sendEmail({
      to: customer.email,
      subject: 'Your sign-in link',
      text: `Click the link below to sign in to your customer portal. It expires in 15 minutes.\n\n${link}\n\nIf you did not request this, ignore this email.`,
      html: `<p>Click the link below to sign in to your customer portal. It expires in 15 minutes.</p><p><a href="${link}">${link}</a></p><p>If you did not request this, ignore this email.</p>`,
    })
  }
}

export type PortalVerifyResult =
  | {
      ok: true
      businessId: string
      customerId: string
      sid: string
      jwt: string
      customer: { id: string; name: string; email: string | null }
    }
  | { ok: false }

export async function verifyMagicLink(
  token: string,
  ctx: SessionContext,
): Promise<PortalVerifyResult> {
  const tokenHash = sha256(token)
  const consumed = await repo.consumeToken(tokenHash)
  if (!consumed) return { ok: false }

  // Verify the customer still exists and isn't soft-deleted BEFORE creating a
  // session — a customer soft-deleted between token issue and verify must not
  // leave an orphaned active session (and previously caused a 500, since the
  // route's own assertExists ran only after the cookie was already set).
  // Cross-module access goes through the customers SERVICE, never its
  // repository (ARCHITECTURE.md §3). Note the argument order:
  // assertExists(id, businessId), not (businessId, id).
  let customer
  try {
    customer = await customers.assertExists(consumed.customerId, consumed.businessId)
  } catch (err) {
    if (err instanceof customers.NotFoundError) return { ok: false }
    throw err
  }

  const { sid, jwt } = await issueSession(consumed.businessId, consumed.customerId, ctx)
  return {
    ok: true,
    businessId: consumed.businessId,
    customerId: consumed.customerId,
    sid,
    jwt,
    customer: { id: customer.id, name: customer.name, email: customer.email },
  }
}

export async function logout(sid: string): Promise<void> {
  await repo.deactivateSession(sid)
}

export async function getSession(sid: string): Promise<PortalSession | null> {
  return repo.getSession(sid)
}

export function touchSession(sid: string): void {
  repo.touchSession(sid)
}
