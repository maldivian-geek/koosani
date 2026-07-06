import * as argon2 from 'argon2'
import jwt from 'jsonwebtoken'
import { createHash, randomBytes } from 'node:crypto'
import { config } from '../../lib/config.js'
import { geoLookup } from '../../lib/geo.js'
import { sendEmail, magicLinkEmail, passwordResetEmail } from '../../lib/mailer.js'
import * as repo from './repository.js'
import type { User } from '../../db/schema/index.js'

// ─── Argon2id parameters (OWASP 2024 baseline per SECURITY.md) ───────────────

const HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const

// Pre-computed once at module load — never regenerated per-request (SECURITY.md §Password Hashing)
const DUMMY_HASH_PROMISE: Promise<string> = argon2.hash('__koosani_dummy__', HASH_OPTIONS)

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, HASH_OPTIONS)
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  return argon2.verify(hash, password)
}

// Timing-safe rejection: always runs a real argon2 verify even when user not found
async function dummyVerify(password: string): Promise<void> {
  const hash = await DUMMY_HASH_PROMISE
  await argon2.verify(hash, password).catch(() => {})
}

// ─── JWT ─────────────────────────────────────────────────────────────────────

export type JwtPayload = {
  id: string
  email: string
  role: 'admin' | 'manager' | 'staff'
  name: string
  businessId: string
  tokenVersion: number
  sid: string
}

const JWT_EXPIRY = '8h'

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, config.JWT_SECRET, { algorithm: 'HS256', expiresIn: JWT_EXPIRY })
}

export function verifyToken(token: string): JwtPayload | null {
  const secrets = [config.JWT_SECRET]
  if (config.JWT_SECRET_PREVIOUS) secrets.push(config.JWT_SECRET_PREVIOUS)

  for (const secret of secrets) {
    try {
      const decoded = jwt.verify(token, secret, { algorithms: ['HS256'] })
      return decoded as JwtPayload
    } catch {
      // try next secret
    }
  }
  return null
}

// ─── Token helpers ────────────────────────────────────────────────────────────

export function generateToken(): string {
  return randomBytes(32).toString('hex')
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

// ─── UA parser (simple regex, no runtime dependency) ─────────────────────────

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

// ─── Shared: issue a new session + JWT ───────────────────────────────────────

type SessionContext = { ip: string; ua: string }

export async function issueSession(
  user: User,
  ctx: SessionContext,
): Promise<{ sid: string; jwt: string }> {
  const { browser, os } = parseUserAgent(ctx.ua)
  const geo = await geoLookup(ctx.ip)

  const session = await repo.createSession({
    userId: user.id,
    ip: ctx.ip,
    browser,
    os,
    city: geo.city,
    country: geo.country,
  })

  const payload: JwtPayload = {
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    businessId: user.businessId,
    tokenVersion: user.tokenVersion,
    sid: session.id,
  }

  return { sid: session.id, jwt: signToken(payload) }
}

// ─── Login ───────────────────────────────────────────────────────────────────

const LOGIN_WINDOW_MS = 15 * 60 * 1000 // 15 min
const LOGIN_PER_SOURCE_MAX = 5
const LOGIN_PER_EMAIL_MAX = 20
const EMAIL_WINDOW_MS = 60 * 60 * 1000 // 1 hour

export type LoginResult =
  | { ok: true; user: User; sid: string; jwt: string }
  | { ok: false; reason: 'invalid_credentials' | 'locked' }

export async function login(
  email: string,
  password: string,
  ctx: SessionContext,
): Promise<LoginResult> {
  const emailHash = sha256(email)
  const source = sha256(`${ctx.ip}:${email}`) // combined key for per-source lockout

  // Check lockout BEFORE lookup to avoid user enumeration on the lockout message
  const [sourceCount, emailCount] = await Promise.all([
    repo.countRecentAttempts('source', source, LOGIN_WINDOW_MS),
    repo.countRecentAttempts('emailHash', emailHash, EMAIL_WINDOW_MS),
  ])

  if (sourceCount >= LOGIN_PER_SOURCE_MAX || emailCount >= LOGIN_PER_EMAIL_MAX) {
    await dummyVerify(password) // maintain timing
    return { ok: false, reason: 'locked' }
  }

  const user = await repo.findUserByEmail(email)

  if (!user || !user.passwordHash || !user.emailVerified) {
    await dummyVerify(password)
    await repo.recordLoginAttempt(source, emailHash, ctx.ip)
    repo.maybePurgeStaleAttempts()
    return { ok: false, reason: 'invalid_credentials' }
  }

  const valid = await verifyPassword(user.passwordHash, password)
  if (!valid) {
    await repo.recordLoginAttempt(source, emailHash, ctx.ip)
    await repo.recordAuthLog({
      businessId: user.businessId,
      userId: user.id,
      event: 'login_failed',
      ip: ctx.ip,
      userAgent: ctx.ua,
    })
    repo.maybePurgeStaleAttempts()
    return { ok: false, reason: 'invalid_credentials' }
  }

  const { sid, jwt } = await issueSession(user, ctx)
  await repo.recordAuthLog({
    businessId: user.businessId,
    userId: user.id,
    event: 'login_success',
    ip: ctx.ip,
    userAgent: ctx.ua,
  })

  return { ok: true, user, sid, jwt }
}

// ─── Logout ──────────────────────────────────────────────────────────────────

export async function logout(user: User, sid: string, ctx: SessionContext): Promise<void> {
  await repo.deactivateSession(sid)
  repo.evictTouchThrottle(sid)
  await repo.recordAuthLog({
    businessId: user.businessId,
    userId: user.id,
    event: 'logout',
    ip: ctx.ip,
    userAgent: ctx.ua,
  })
}

export async function logoutAll(user: User, ctx: SessionContext): Promise<void> {
  await repo.deactivateAllUserSessions(user.id)
  await repo.incrementTokenVersion(user.id)
  await repo.recordAuthLog({
    businessId: user.businessId,
    userId: user.id,
    event: 'logout_all',
    ip: ctx.ip,
    userAgent: ctx.ua,
  })
}

export async function logoutOthers(
  user: User,
  currentSid: string,
  ctx: SessionContext,
): Promise<void> {
  await repo.deactivateOtherSessions(user.id, currentSid)
  await repo.recordAuthLog({
    businessId: user.businessId,
    userId: user.id,
    event: 'logout_others',
    ip: ctx.ip,
    userAgent: ctx.ua,
  })
}

// ─── Magic link ───────────────────────────────────────────────────────────────

export async function requestMagicLink(email: string): Promise<void> {
  const user = await repo.findUserByEmail(email)
  // Only send if account exists, is verified, and has a password (SECURITY.md §Magic Link Auth)
  if (!user || !user.emailVerified || !user.passwordHash) return

  const token = generateToken()
  const tokenHash = sha256(token)
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000)

  await repo.createAuthToken({
    userId: user.id,
    businessId: user.businessId,
    type: 'magic_link',
    tokenHash,
    expiresAt,
  })

  const link = `${config.FRONTEND_URL}/auth/magic-link?token=${token}`
  await sendEmail(magicLinkEmail({ to: user.email, link }))
}

export type MagicLinkVerifyResult =
  | { ok: true; user: User; sid: string; jwt: string }
  | { ok: false }

export async function verifyMagicLink(
  token: string,
  ctx: SessionContext,
): Promise<MagicLinkVerifyResult> {
  const tokenHash = sha256(token)
  const row = await repo.consumeAuthToken(tokenHash, 'magic_link')
  if (!row) return { ok: false }

  const user = await repo.findUserById(row.userId)
  if (!user) return { ok: false }

  const { sid, jwt } = await issueSession(user, ctx)
  await repo.recordAuthLog({
    businessId: user.businessId,
    userId: user.id,
    event: 'magic_link_used',
    ip: ctx.ip,
    userAgent: ctx.ua,
  })

  return { ok: true, user, sid, jwt }
}

// ─── Password reset ───────────────────────────────────────────────────────────

const RESET_EXPIRY_MS = 60 * 60 * 1000 // 1 hour
const RESET_COOLDOWN_MS = 10 * 60 * 1000 // 10 min cooldown

export async function forgotPassword(email: string): Promise<void> {
  const user = await repo.findUserByEmail(email)
  if (!user || !user.emailVerified) return

  const hasCooldown = await repo.hasRecentResetToken(user.id, RESET_COOLDOWN_MS)
  if (hasCooldown) return // silently drop — prevents email flooding

  const token = generateToken()
  const tokenHash = sha256(token)
  const expiresAt = new Date(Date.now() + RESET_EXPIRY_MS)

  await repo.createAuthToken({
    userId: user.id,
    businessId: user.businessId,
    type: 'password_reset',
    tokenHash,
    expiresAt,
  })

  const link = `${config.FRONTEND_URL}/auth/reset-password?token=${token}`
  await sendEmail(passwordResetEmail({ to: user.email, link }))
}

export type ResetPasswordResult = { ok: true } | { ok: false; reason: 'invalid_token' }

export async function resetPassword(
  token: string,
  newPassword: string,
  ctx: SessionContext,
): Promise<ResetPasswordResult> {
  const tokenHash = sha256(token)
  const row = await repo.consumeAuthToken(tokenHash, 'password_reset')
  if (!row) return { ok: false, reason: 'invalid_token' }

  const user = await repo.findUserById(row.userId)
  if (!user) return { ok: false, reason: 'invalid_token' }

  const passwordHash = await hashPassword(newPassword)
  await repo.updatePasswordHash(user.id, passwordHash)
  await repo.incrementTokenVersion(user.id) // invalidate all existing sessions
  await repo.deactivateAllUserSessions(user.id)

  await repo.recordAuthLog({
    businessId: user.businessId,
    userId: user.id,
    event: 'password_reset',
    ip: ctx.ip,
    userAgent: ctx.ua,
  })

  return { ok: true }
}

// ─── Change password (self-service, authenticated) ───────────────────────────
// Unlike resetPassword, the user stays logged in on their current device: all
// *other* sessions are revoked, token_version is bumped (invalidating every
// existing JWT including the current one), and a fresh JWT is signed for the
// current session so the caller can keep working without re-authenticating.

export type ChangePasswordResult =
  | { ok: true; jwt: string }
  | { ok: false; reason: 'invalid_current_password' }

export async function changePassword(
  user: User,
  currentSid: string,
  currentPassword: string,
  newPassword: string,
  ctx: SessionContext,
): Promise<ChangePasswordResult> {
  if (!user.passwordHash || !(await verifyPassword(user.passwordHash, currentPassword))) {
    return { ok: false, reason: 'invalid_current_password' }
  }

  const passwordHash = await hashPassword(newPassword)
  await repo.updatePasswordHash(user.id, passwordHash)
  const newVersion = await repo.incrementTokenVersion(user.id)
  await repo.deactivateOtherSessions(user.id, currentSid)

  await repo.recordAuthLog({
    businessId: user.businessId,
    userId: user.id,
    event: 'password_changed',
    ip: ctx.ip,
    userAgent: ctx.ua,
  })

  const jwt = signToken({
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    businessId: user.businessId,
    tokenVersion: newVersion,
    sid: currentSid,
  })

  return { ok: true, jwt }
}

// ─── Accept invite ────────────────────────────────────────────────────────────

export type AcceptInviteResult =
  | { ok: true; user: User; sid: string; jwt: string }
  | { ok: false; reason: 'invalid_token' }

export async function acceptInvite(
  token: string,
  password: string,
  ctx: SessionContext,
): Promise<AcceptInviteResult> {
  const tokenHash = sha256(token)
  const row = await repo.consumeAuthToken(tokenHash, 'invite')
  if (!row) return { ok: false, reason: 'invalid_token' }

  const user = await repo.findUserById(row.userId)
  if (!user) return { ok: false, reason: 'invalid_token' }

  const passwordHash = await hashPassword(password)
  await repo.activateAccount(user.id, passwordHash)

  // Reload user to get updated fields
  const activated = await repo.findUserById(user.id)
  if (!activated) return { ok: false, reason: 'invalid_token' }

  const { sid, jwt } = await issueSession(activated, ctx)
  return { ok: true, user: activated, sid, jwt }
}

// ─── /me ─────────────────────────────────────────────────────────────────────

export type MeProfile = {
  id: string
  email: string
  name: string
  role: 'admin' | 'manager' | 'staff'
  businessId: string
  emailVerified: boolean
}

export function toProfile(user: User): MeProfile {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    businessId: user.businessId,
    emailVerified: user.emailVerified,
  }
}
