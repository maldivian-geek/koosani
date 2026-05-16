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

async function seedBusiness() {
  const { db: appDb } = await import('../../../db/client.js')
  const schema = await import('../../../db/schema/index.js')

  const [business] = await appDb
    .insert(schema.businesses)
    .values({
      name: 'Supplier Biz',
      tin: 'MVR222',
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
      email: `sadmin+${Date.now()}+${Math.random()}@example.com`,
      name: 'Admin',
      role: 'admin',
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

// ─── CRUD ────────────────────────────────────────────────────────────────────

describe('suppliers — CRUD', () => {
  it('creates a supplier and returns 201', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness()

    const res = await app.request('/suppliers', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'Best Supplier', paymentTermsDays: 45 }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; name: string }
    expect(body.name).toBe('Best Supplier')
    expect(body.id).toBeTruthy()
  })

  it('lists suppliers with pagination metadata', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness()

    await app.request('/suppliers', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'S1' }),
    })
    await app.request('/suppliers', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'S2' }),
    })

    const res = await app.request('/suppliers?page=1&pageSize=10', { headers: authHeaders(token) })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; total: number }
    expect(body.total).toBeGreaterThanOrEqual(2)
    expect(Array.isArray(body.items)).toBe(true)
  })

  it('fetches supplier detail with contacts and balance', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness()

    const create = await app.request('/suppliers', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'Detail Supplier' }),
    })
    const created = (await create.json()) as { id: string }

    const res = await app.request(`/suppliers/${created.id}`, { headers: authHeaders(token) })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; contacts: unknown[]; balance: string }
    expect(body.id).toBe(created.id)
    expect(Array.isArray(body.contacts)).toBe(true)
    expect(body.balance).toBe('0.00')
  })

  it('patches a supplier', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness()

    const create = await app.request('/suppliers', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'Old Name' }),
    })
    const created = (await create.json()) as { id: string }

    const res = await app.request(`/suppliers/${created.id}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'New Name' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { name: string }
    expect(body.name).toBe('New Name')
  })

  it('adds a contact to a supplier', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness()

    const create = await app.request('/suppliers', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'Contact Supplier' }),
    })
    const created = (await create.json()) as { id: string }

    const res = await app.request(`/suppliers/${created.id}/contacts`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'Jane Doe', phone: '+960 123 4567' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { name: string }
    expect(body.name).toBe('Jane Doe')
  })
})

// ─── Soft-delete guard ────────────────────────────────────────────────────────

describe('suppliers — soft-delete guard', () => {
  it('deletes a supplier with no balance', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness()

    const create = await app.request('/suppliers', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'Gone' }),
    })
    const created = (await create.json()) as { id: string }

    const del = await app.request(`/suppliers/${created.id}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    })
    expect(del.status).toBe(204)

    const list = await app.request('/suppliers', { headers: authHeaders(token) })
    const body = (await list.json()) as { items: Array<{ id: string }> }
    expect(body.items.find((s) => s.id === created.id)).toBeUndefined()
  })

  it('returns 404 for unknown supplier', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness()
    const res = await app.request('/suppliers/00000000-0000-0000-0000-000000000000', {
      method: 'DELETE',
      headers: authHeaders(token),
    })
    expect(res.status).toBe(404)
  })
})

// ─── Audit log ────────────────────────────────────────────────────────────────

describe('suppliers — audit log', () => {
  it('writes an audit row on create', async () => {
    const { app } = await import('../../../server.js')
    const { token, business } = await seedBusiness()
    const { db: appDb } = await import('../../../db/client.js')
    const schema = await import('../../../db/schema/index.js')
    const { eq, and } = await import('drizzle-orm')

    await app.request('/suppliers', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'Audit Supplier' }),
    })

    const logs = await appDb
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.businessId, business.id),
          eq(schema.auditLogs.action, 'supplier.create'),
        ),
      )

    expect(logs.length).toBeGreaterThan(0)
    expect(logs[0]?.entityType).toBe('supplier')
  })
})
