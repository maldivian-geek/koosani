import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDatabase } from '../../../db/test-db.js'
import postgres from 'postgres'
import * as argon2 from 'argon2'
import jwt from 'jsonwebtoken'

let client: ReturnType<typeof postgres>

const JWT_SECRET = 'test-secret-at-least-32-chars-long-xx'

beforeAll(async () => {
  const url = await createTestDatabase()
  process.env['DATABASE_URL'] = url
  process.env['REDIS_URL'] = process.env['REDIS_URL'] ?? 'redis://localhost:6380'
  process.env['JWT_SECRET'] = JWT_SECRET
  process.env['FRONTEND_URL'] = 'http://localhost:5173'
  process.env['NODE_ENV'] = 'test'
  client = postgres(url, { max: 1 })
}, 60_000)

afterAll(async () => {
  await client?.end()
})

async function seedBusiness(role: 'admin' | 'manager' | 'staff' = 'admin') {
  const { db: appDb } = await import('../../../db/client.js')
  const schema = await import('../../../db/schema/index.js')

  const [business] = await appDb
    .insert(schema.businesses)
    .values({
      name: `Users Test Biz ${Date.now()}`,
      tin: null,
      gstPeriodType: 'monthly',
      allowBackorders: false,
      createdBy: null as unknown as string,
      updatedBy: null as unknown as string,
    })
    .returning()
  if (!business) throw new Error('seed: no business')

  const hash = await argon2.hash('Password1!', {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  })
  const [user] = await appDb
    .insert(schema.users)
    .values({
      businessId: business.id,
      email: `usersmod+${role}+${Date.now()}+${Math.random()}@example.com`,
      name: 'Seed User',
      role,
      passwordHash: hash,
      emailVerified: true,
      tokenVersion: 0,
      createdBy: business.id,
      updatedBy: business.id,
    })
    .returning()
  if (!user) throw new Error('seed: no user')

  const [session] = await appDb
    .insert(schema.userSessions)
    .values({
      userId: user.id,
      ip: '127.0.0.1',
      browser: null,
      os: null,
      city: null,
      country: null,
    })
    .returning()
  if (!session) throw new Error('seed: no session')

  const token = jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      businessId: business.id,
      tokenVersion: 0,
      sid: session.id,
    },
    JWT_SECRET,
    { algorithm: 'HS256', expiresIn: '8h' },
  )

  return { business, user, token }
}

function authHeaders(token: string) {
  return { 'Content-Type': 'application/json', Cookie: `session=${token}` }
}

// A second, already-activated user in the same business, with its own real
// login session — used by the token-revocation tests below, which need to
// log in AS the target user (not just create it via invite) so there's a
// live JWT to prove gets rejected.
async function seedActiveUser(businessId: string, role: 'admin' | 'manager' | 'staff') {
  const { db: appDb } = await import('../../../db/client.js')
  const schema = await import('../../../db/schema/index.js')

  const hash = await argon2.hash('Password1!', {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  })
  const [user] = await appDb
    .insert(schema.users)
    .values({
      businessId,
      email: `target+${role}+${Date.now()}+${Math.random()}@example.com`,
      name: 'Target User',
      role,
      passwordHash: hash,
      emailVerified: true,
      tokenVersion: 0,
      createdBy: businessId,
      updatedBy: businessId,
    })
    .returning()
  if (!user) throw new Error('seed: no user')

  return { user, password: 'Password1!' }
}

describe('users — invite + CRUD (admin only)', () => {
  it('creates (invites) a user and returns 201', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness('admin')

    const res = await app.request('/users', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        email: `invitee+${Date.now()}@example.com`,
        name: 'New Staff',
        role: 'staff',
      }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['name']).toBe('New Staff')
    // Never echo the Drizzle row directly (ARCHITECTURE.md §6) — passwordHash
    // must never appear in the response, hashed or not.
    expect(body).not.toHaveProperty('passwordHash')
    expect(body).not.toHaveProperty('tokenVersion')
  })

  it('rejects a non-admin from creating a user', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness('manager')

    const res = await app.request('/users', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        email: `blocked+${Date.now()}@example.com`,
        name: 'Blocked',
        role: 'staff',
      }),
    })

    expect(res.status).toBe(403)
  })

  it('grants explicit permissions via PATCH and they are readable back', async () => {
    const { app } = await import('../../../server.js')
    const { business, token } = await seedBusiness('admin')

    const createRes = await app.request('/users', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        email: `grantee+${Date.now()}@example.com`,
        name: 'Grantee',
        role: 'staff',
      }),
    })
    const created = (await createRes.json()) as { id: string }

    const patchRes = await app.request(`/users/${created.id}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({
        permissions: [{ resource: 'invoices', action: 'add' }],
      }),
    })
    expect(patchRes.status).toBe(200)

    const getRes = await app.request(`/users/${created.id}`, { headers: authHeaders(token) })
    const body = (await getRes.json()) as {
      permissions: Array<{ resource: string; action: string }>
    }
    expect(body.permissions).toEqual([{ resource: 'invoices', action: 'add' }])

    // Replacing with an empty array clears all grants (full-replace semantics)
    const clearRes = await app.request(`/users/${created.id}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ permissions: [] }),
    })
    expect(clearRes.status).toBe(200)
    const afterClear = (await clearRes.json()) as { permissions: unknown[] }
    expect(afterClear.permissions).toEqual([])

    void business
  })

  it('soft-deletes a user and revokes their sessions', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness('admin')

    const createRes = await app.request('/users', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        email: `deleteme+${Date.now()}@example.com`,
        name: 'Delete Me',
        role: 'staff',
      }),
    })
    const created = (await createRes.json()) as { id: string }

    const delRes = await app.request(`/users/${created.id}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    })
    expect(delRes.status).toBe(204)

    const getRes = await app.request(`/users/${created.id}`, { headers: authHeaders(token) })
    expect(getRes.status).toBe(404)
  })

  it('rejects an admin deleting their own account', async () => {
    const { app } = await import('../../../server.js')
    const { user, token } = await seedBusiness('admin')

    const res = await app.request(`/users/${user.id}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    })
    expect(res.status).toBe(422)
  })
})

// ─── Token revocation on role change / delete (SECURITY.md §JWT, §13.2) ──────
// A role change or delete must invalidate every live JWT for that user
// immediately — not after the 30s session-cache window. Each test logs in AS
// the target user (populating the cache via a real request), then performs
// the admin action, then re-uses the target's OLD cookie: if revocation
// didn't work, the stale cache entry would still accept it.

describe('users — role change / delete revoke live tokens immediately', () => {
  it('bumps token_version on a role change and rejects the old JWT right away', async () => {
    const { app } = await import('../../../server.js')
    const { business, token: adminToken } = await seedBusiness('admin')
    const { user: target, password } = await seedActiveUser(business.id, 'staff')

    const loginRes = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: target.email, password }),
    })
    expect(loginRes.status).toBe(200)
    const targetCookie = loginRes.headers.get('set-cookie') ?? ''
    const targetToken = /session=([^;]+)/.exec(targetCookie)?.[1]
    expect(targetToken).toBeTruthy()

    // Populate the session cache for (target.id, sid) with a real request.
    const meBefore = await app.request('/me', { headers: { Cookie: `session=${targetToken}` } })
    expect(meBefore.status).toBe(200)

    const patchRes = await app.request(`/users/${target.id}`, {
      method: 'PATCH',
      headers: authHeaders(adminToken),
      body: JSON.stringify({ role: 'manager' }),
    })
    expect(patchRes.status).toBe(200)

    // Old token must be rejected immediately — not after the 30s cache TTL.
    const meAfter = await app.request('/me', { headers: { Cookie: `session=${targetToken}` } })
    expect(meAfter.status).toBe(401)
  })

  it('does not bump token_version when a PATCH omits role or keeps it unchanged', async () => {
    const { app } = await import('../../../server.js')
    const { business, token: adminToken } = await seedBusiness('admin')
    const { user: target, password } = await seedActiveUser(business.id, 'staff')

    const loginRes = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: target.email, password }),
    })
    const targetCookie = loginRes.headers.get('set-cookie') ?? ''
    const targetToken = /session=([^;]+)/.exec(targetCookie)?.[1]

    const meBefore = await app.request('/me', { headers: { Cookie: `session=${targetToken}` } })
    expect(meBefore.status).toBe(200)

    // Name-only patch — no role field at all.
    const patchName = await app.request(`/users/${target.id}`, {
      method: 'PATCH',
      headers: authHeaders(adminToken),
      body: JSON.stringify({ name: 'Renamed Target' }),
    })
    expect(patchName.status).toBe(200)

    // Same-value role patch — role present but unchanged.
    const patchSameRole = await app.request(`/users/${target.id}`, {
      method: 'PATCH',
      headers: authHeaders(adminToken),
      body: JSON.stringify({ role: 'staff' }),
    })
    expect(patchSameRole.status).toBe(200)

    // Old token is still valid — neither patch should have bumped token_version.
    const meAfter = await app.request('/me', { headers: { Cookie: `session=${targetToken}` } })
    expect(meAfter.status).toBe(200)
  })

  it('bumps token_version on soft-delete and rejects the old JWT right away', async () => {
    const { app } = await import('../../../server.js')
    const { business, token: adminToken } = await seedBusiness('admin')
    const { user: target, password } = await seedActiveUser(business.id, 'staff')

    const loginRes = await app.request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: target.email, password }),
    })
    const targetCookie = loginRes.headers.get('set-cookie') ?? ''
    const targetToken = /session=([^;]+)/.exec(targetCookie)?.[1]

    const meBefore = await app.request('/me', { headers: { Cookie: `session=${targetToken}` } })
    expect(meBefore.status).toBe(200)

    const delRes = await app.request(`/users/${target.id}`, {
      method: 'DELETE',
      headers: authHeaders(adminToken),
    })
    expect(delRes.status).toBe(204)

    const meAfter = await app.request('/me', { headers: { Cookie: `session=${targetToken}` } })
    expect(meAfter.status).toBe(401)
  })
})
