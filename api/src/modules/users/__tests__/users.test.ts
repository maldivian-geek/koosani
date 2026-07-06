import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import postgres from 'postgres'
import * as argon2 from 'argon2'
import jwt from 'jsonwebtoken'
import { runMigrations } from '../../../db/test-helpers.js'

let container: StartedPostgreSqlContainer
let client: ReturnType<typeof postgres>

const JWT_SECRET = 'test-secret-at-least-32-chars-long-xx'

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  const url = container.getConnectionUri()
  process.env['DATABASE_URL'] = url
  process.env['REDIS_URL'] = process.env['REDIS_URL'] ?? 'redis://localhost:6379'
  process.env['JWT_SECRET'] = JWT_SECRET
  process.env['FRONTEND_URL'] = 'http://localhost:5173'
  process.env['NODE_ENV'] = 'test'
  await runMigrations(url)
  client = postgres(url, { max: 1 })
}, 60_000)

afterAll(async () => {
  await client?.end()
  await container?.stop()
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
