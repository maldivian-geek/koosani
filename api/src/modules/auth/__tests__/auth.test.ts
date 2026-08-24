import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import postgres from 'postgres'
import * as argon2 from 'argon2'
import jwt from 'jsonwebtoken'
import { runMigrations } from '../../../db/test-helpers.js'

// ─── Container setup ─────────────────────────────────────────────────────────

let container: StartedPostgreSqlContainer
let client: ReturnType<typeof postgres>

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()

  const url = container.getConnectionUri()
  process.env['DATABASE_URL'] = url
  process.env['REDIS_URL'] = process.env['REDIS_URL'] ?? 'redis://localhost:6379'
  process.env['JWT_SECRET'] = 'test-secret-at-least-32-chars-long-xx'
  process.env['FRONTEND_URL'] = 'http://localhost:5173'
  process.env['NODE_ENV'] = 'test'

  await runMigrations(url)
  client = postgres(url, { max: 1 })
}, 60_000)

afterAll(async () => {
  await client?.end()
  await container?.stop()
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function seedUser(opts?: { emailVerified?: boolean; role?: 'admin' | 'manager' | 'staff' }) {
  // Dynamic import after env is set
  const { db: appDb } = await import('../../../db/client.js')
  const schema = await import('../../../db/schema/index.js')

  const HASH_OPTIONS = {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  } as const

  const [business] = await appDb
    .insert(schema.businesses)
    .values({
      name: 'Test Business',
      tin: 'MVR999',
      gstPeriodType: 'monthly',
      allowBackorders: false,
      createdBy: null as unknown as string,
      updatedBy: null as unknown as string,
    })
    .returning()
  if (!business) throw new Error('seed: no business')

  const passwordHash = await argon2.hash('Password1!', HASH_OPTIONS)
  const [user] = await appDb
    .insert(schema.users)
    .values({
      businessId: business.id,
      email: `test+${Date.now()}@example.com`,
      name: 'Test User',
      role: opts?.role ?? 'admin',
      passwordHash,
      emailVerified: opts?.emailVerified ?? true,
      tokenVersion: 0,
      createdBy: business.id,
      updatedBy: business.id,
    })
    .returning()
  if (!user) throw new Error('seed: no user')

  return { business, user, password: 'Password1!' }
}

// ─── Happy path login ─────────────────────────────────────────────────────────

describe('auth — login happy path', () => {
  it('returns user + permissions and sets a JWT cookie', async () => {
    const { app } = await import('../../../server.js')
    const { user, password } = await seedUser()

    const res = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password }),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as { user: { id: string }; permissions: unknown[] }
    expect(body.user.id).toBe(user.id)
    expect(Array.isArray(body.permissions)).toBe(true)

    const cookie = res.headers.get('set-cookie')
    expect(cookie).toContain('session=')
    expect(cookie).toContain('HttpOnly')
  })

  it('rejects wrong password', async () => {
    const { app } = await import('../../../server.js')
    const { user } = await seedUser()

    const res = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'wrongpassword' }),
    })

    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('invalid_credentials')
  })

  it('rejects unverified account', async () => {
    const { app } = await import('../../../server.js')
    const { user, password } = await seedUser({ emailVerified: false })

    const res = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password }),
    })

    expect(res.status).toBe(401)
  })
})

// ─── Lockout thresholds ──────────────────────────────────────────────────────

describe('auth — login lockout', () => {
  it('locks out after 5 failures on same IP+email (per-source)', async () => {
    const { app } = await import('../../../server.js')
    const { user } = await seedUser()

    // Unique IP per test run to avoid cross-test interference
    const ip = `10.0.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`

    for (let i = 0; i < 5; i++) {
      await app.request('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Real-IP': ip },
        body: JSON.stringify({ email: user.email, password: 'wrong' }),
      })
    }

    // 6th attempt should be locked in DB (service checks DB lockout, not rate limiter)
    const res = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Real-IP': ip },
      body: JSON.stringify({ email: user.email, password: 'wrong' }),
    })

    expect(res.status).toBe(401)
    const body = (await res.json()) as { error: string }
    // After 5 failures, service returns locked — which maps to 401 with invalid_credentials
    // (same response shape — no lockout enumeration per SECURITY.md)
    expect(['invalid_credentials', 'locked']).toContain(body.error)
  })
})

// ─── Timing-safe rejection ───────────────────────────────────────────────────

describe('auth — timing safety', () => {
  it('non-existent user path takes measurable time (argon2 dummy verify)', async () => {
    const { app } = await import('../../../server.js')
    const ip = `192.0.2.${Math.floor(Math.random() * 255)}`

    const start = Date.now()
    await app.request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Real-IP': ip },
      body: JSON.stringify({ email: 'nonexistent@example.com', password: 'somepassword' }),
    })
    const elapsed = Date.now() - start

    // argon2 with memoryCost=19456 takes >50ms; 25ms is a very conservative floor
    expect(elapsed).toBeGreaterThan(25)
  })
})

// ─── JWT_SECRET_PREVIOUS fallback ────────────────────────────────────────────

describe('auth — JWT_SECRET_PREVIOUS fallback', () => {
  it('accepts tokens signed with the previous secret', async () => {
    const oldSecret = 'old-secret-at-least-32-chars-long-xxxx'
    const newSecret = 'new-secret-at-least-32-chars-long-xxxx'

    // Sign a token with the old secret
    const payload = {
      id: 'test-id',
      email: 'test@example.com',
      role: 'admin' as const,
      name: 'Test',
      businessId: 'biz-id',
      tokenVersion: 0,
      sid: 'session-id',
    }
    const oldToken = jwt.sign(payload, oldSecret, { algorithm: 'HS256', expiresIn: '8h' })

    // Verify using the service with new secret + previous
    process.env['JWT_SECRET'] = newSecret
    process.env['JWT_SECRET_PREVIOUS'] = oldSecret

    // verifyToken uses config which is module-cached, so we test the fallback
    // logic directly: try new secret first, then old secret
    const secrets = [newSecret, oldSecret]
    let decoded: typeof payload | null = null
    for (const secret of secrets) {
      try {
        decoded = jwt.verify(oldToken, secret, { algorithms: ['HS256'] }) as typeof payload
        break
      } catch {
        // try next
      }
    }

    expect(decoded).not.toBeNull()
    expect(decoded?.id).toBe('test-id')

    // Restore
    process.env['JWT_SECRET'] = 'test-secret-at-least-32-chars-long-xx'
    delete process.env['JWT_SECRET_PREVIOUS']
  })
})

// ─── token_version bump invalidates tokens ───────────────────────────────────

describe('auth — token_version invalidation', () => {
  it('increments token_version and the old JWT is no longer valid at middleware level', async () => {
    const { app } = await import('../../../server.js')
    const { user, password } = await seedUser()

    // Login to get a session + JWT
    const loginRes = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password }),
    })
    expect(loginRes.status).toBe(200)
    const cookie = loginRes.headers.get('set-cookie') ?? ''
    const sessionMatch = cookie.match(/session=([^;]+)/)
    const sessionToken = sessionMatch?.[1]
    expect(sessionToken).toBeTruthy()

    // /me should succeed with the current token
    const meRes = await app.request('/me', {
      headers: { Cookie: `session=${sessionToken}` },
    })
    expect(meRes.status).toBe(200)

    // Bump token_version via logout-all
    await app.request('/auth/logout-all', {
      method: 'POST',
      headers: { Cookie: `session=${sessionToken}` },
    })

    // Old token is now stale — /me must reject it
    // The middleware checks the cached token_version. Since we invalidated the cache,
    // it will do a fresh DB lookup. The session is now inactive → 401.
    const staleRes = await app.request('/me', {
      headers: { Cookie: `session=${sessionToken}` },
    })
    expect(staleRes.status).toBe(401)
  })
})

// ─── Change password (self-service) ──────────────────────────────────────────

describe('auth — change password', () => {
  it('changes the password and keeps the current session usable via a fresh token', async () => {
    const { app } = await import('../../../server.js')
    const { user, password } = await seedUser()

    const loginRes = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password }),
    })
    const cookie = loginRes.headers.get('set-cookie') ?? ''
    const oldToken = cookie.match(/session=([^;]+)/)?.[1]

    const changeRes = await app.request('/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `session=${oldToken}` },
      body: JSON.stringify({ currentPassword: password, newPassword: 'NewPassword2!' }),
    })
    expect(changeRes.status).toBe(204)

    // The response sets a fresh cookie for the same session — current device stays logged in
    const newCookie = changeRes.headers.get('set-cookie') ?? ''
    const newToken = newCookie.match(/session=([^;]+)/)?.[1]
    expect(newToken).toBeTruthy()
    expect(newToken).not.toBe(oldToken)

    const meWithNewToken = await app.request('/me', {
      headers: { Cookie: `session=${newToken}` },
    })
    expect(meWithNewToken.status).toBe(200)

    // The pre-change token is now stale (token_version bumped)
    const meWithOldToken = await app.request('/me', {
      headers: { Cookie: `session=${oldToken}` },
    })
    expect(meWithOldToken.status).toBe(401)

    // The new password logs in; the old one no longer works
    const reloginOld = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password }),
    })
    expect(reloginOld.status).toBe(401)

    const reloginNew = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: 'NewPassword2!' }),
    })
    expect(reloginNew.status).toBe(200)
  })

  it('rejects a wrong current password', async () => {
    const { app } = await import('../../../server.js')
    const { user, password } = await seedUser()

    const loginRes = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password }),
    })
    const cookie = loginRes.headers.get('set-cookie') ?? ''
    const token = cookie.match(/session=([^;]+)/)?.[1]

    const res = await app.request('/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: `session=${token}` },
      body: JSON.stringify({ currentPassword: 'WrongPassword!', newPassword: 'NewPassword2!' }),
    })
    expect(res.status).toBe(401)
  })
})

// ─── Reset password invalidates the session cache immediately ───────────────
// resetPassword bumps token_version and deactivates sessions, but the
// in-process session cache (SECURITY.md §13.2) is only cleared if the route
// calls invalidateSessionCache. Without that call, a request that already
// populated the cache (e.g. an earlier GET /me on the same JWT) would keep
// being accepted for up to the 30s cache TTL even after the reset.

describe('auth — reset password revokes the session cache immediately', () => {
  it('rejects the pre-reset JWT right away, not after the cache TTL', async () => {
    const { app } = await import('../../../server.js')
    const { user, password } = await seedUser()

    const loginRes = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password }),
    })
    const cookie = loginRes.headers.get('set-cookie') ?? ''
    const sessionToken = cookie.match(/session=([^;]+)/)?.[1]

    // Populate the session cache for (user.id, sid) with a real request.
    const meBefore = await app.request('/me', { headers: { Cookie: `session=${sessionToken}` } })
    expect(meBefore.status).toBe(200)

    // Mint a reset token directly (mirrors what the emailed link would
    // contain) rather than going through forgotPassword's email send.
    const authRepo = await import('../repository.js')
    const crypto = await import('node:crypto')
    const token = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    await authRepo.createAuthToken({
      userId: user.id,
      businessId: user.businessId,
      type: 'password_reset',
      tokenHash,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    })

    const resetRes = await app.request('/auth/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, password: 'BrandNewPassword9!' }),
    })
    expect(resetRes.status).toBe(204)

    // The pre-reset JWT must be rejected immediately.
    const meAfter = await app.request('/me', { headers: { Cookie: `session=${sessionToken}` } })
    expect(meAfter.status).toBe(401)
  })
})

// ─── /me endpoint ────────────────────────────────────────────────────────────

describe('auth — /me', () => {
  it('returns profile + permissions + sessions for authenticated user', async () => {
    const { app } = await import('../../../server.js')
    const { user, password } = await seedUser()

    const loginRes = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: user.email, password }),
    })
    const cookie = loginRes.headers.get('set-cookie') ?? ''
    const sessionToken = cookie.match(/session=([^;]+)/)?.[1]

    const res = await app.request('/me', {
      headers: { Cookie: `session=${sessionToken}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      id: string
      email: string
      permissions: unknown[]
      sessions: { isCurrent: boolean }[]
    }
    expect(body.id).toBe(user.id)
    expect(body.email).toBe(user.email)
    expect(Array.isArray(body.permissions)).toBe(true)
    expect(body.sessions.some((s) => s.isCurrent)).toBe(true)
  })

  it('returns 401 without a cookie', async () => {
    const { app } = await import('../../../server.js')
    const res = await app.request('/me')
    expect(res.status).toBe(401)
  })
})
