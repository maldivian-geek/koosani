import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDatabase } from '../../../db/test-db.js'
import postgres from 'postgres'
import * as argon2 from 'argon2'
import jwt from 'jsonwebtoken'

// ─── Container setup ─────────────────────────────────────────────────────────

let client: ReturnType<typeof postgres>

const JWT_SECRET = 'test-secret-at-least-32-chars-long-xx'

beforeAll(async () => {
  const url = await createTestDatabase()
  process.env['DATABASE_URL'] = url
  process.env['REDIS_URL'] = process.env['REDIS_URL'] ?? 'redis://localhost:6380/1'
  process.env['JWT_SECRET'] = JWT_SECRET
  process.env['FRONTEND_URL'] = 'http://localhost:5173'
  process.env['NODE_ENV'] = 'test'
  client = postgres(url, { max: 1 })
}, 60_000)

afterAll(async () => {
  await client?.end()
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function seedBusiness() {
  const { db: appDb } = await import('../../../db/client.js')
  const schema = await import('../../../db/schema/index.js')

  const [business] = await appDb
    .insert(schema.businesses)
    .values({
      name: 'Test Biz',
      tin: 'MVR111',
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
      email: `admin+${Date.now()}+${Math.random()}@example.com`,
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

  // Create a session — session.id is used as sid in the JWT
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

  return { business, user, session, token }
}

function authHeaders(token: string) {
  return {
    'Content-Type': 'application/json',
    Cookie: `session=${token}`,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('customers — CRUD', () => {
  it('creates a customer and returns 201', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness()

    const res = await app.request('/customers', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'Acme Corp', email: 'acme@example.com', creditTermsDays: 30 }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; name: string }
    expect(body.name).toBe('Acme Corp')
    expect(body.id).toBeTruthy()
  })

  it('lists customers with pagination metadata', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness()

    await app.request('/customers', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'Customer A' }),
    })
    await app.request('/customers', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'Customer B' }),
    })

    const res = await app.request('/customers?page=1&pageSize=10', {
      headers: authHeaders(token),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; total: number; page: number }
    expect(body.total).toBeGreaterThanOrEqual(2)
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.page).toBe(1)
  })

  it('fetches a single customer with contacts and balance', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness()

    const create = await app.request('/customers', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'Detail Test' }),
    })
    const created = (await create.json()) as { id: string }

    const res = await app.request(`/customers/${created.id}`, {
      headers: authHeaders(token),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; contacts: unknown[]; balance: string }
    expect(body.id).toBe(created.id)
    expect(Array.isArray(body.contacts)).toBe(true)
    expect(body.balance).toBe('0.00')
  })

  it('patches a customer and returns updated row', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness()

    const create = await app.request('/customers', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'Before Patch' }),
    })
    const created = (await create.json()) as { id: string }

    const res = await app.request(`/customers/${created.id}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'After Patch' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { name: string }
    expect(body.name).toBe('After Patch')
  })

  it('adds a contact to a customer', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness()

    const create = await app.request('/customers', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'Contact Owner' }),
    })
    const created = (await create.json()) as { id: string }

    const res = await app.request(`/customers/${created.id}/contacts`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'John Doe', email: 'john@example.com', isPrimary: true }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { name: string; isPrimary: boolean }
    expect(body.name).toBe('John Doe')
    expect(body.isPrimary).toBe(true)
  })
})

describe('customers — soft-delete guard', () => {
  it('soft-deletes a customer with no balance and returns 204', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness()

    const create = await app.request('/customers', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'To Delete' }),
    })
    const created = (await create.json()) as { id: string }

    const del = await app.request(`/customers/${created.id}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    })
    expect(del.status).toBe(204)

    // Deleted customer does not appear in default (active) list
    const list = await app.request('/customers', { headers: authHeaders(token) })
    const body = (await list.json()) as { items: Array<{ id: string }> }
    expect(body.items.find((c) => c.id === created.id)).toBeUndefined()
  })

  it('returns 404 for unknown customer', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness()
    const res = await app.request('/customers/00000000-0000-0000-0000-000000000000', {
      method: 'DELETE',
      headers: authHeaders(token),
    })
    expect(res.status).toBe(404)
  })
})

describe('customers — audit log', () => {
  it('writes an audit row when a customer is created', async () => {
    const { app } = await import('../../../server.js')
    const { token, business } = await seedBusiness()
    const { db: appDb } = await import('../../../db/client.js')
    const schema = await import('../../../db/schema/index.js')
    const { eq, and } = await import('drizzle-orm')

    await app.request('/customers', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'Audit Test Customer' }),
    })

    const logs = await appDb
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.businessId, business.id),
          eq(schema.auditLogs.action, 'customer.create'),
        ),
      )

    expect(logs.length).toBeGreaterThan(0)
    expect(logs[0]?.entityType).toBe('customer')
    expect(logs[0]?.beforeJson).toBeNull()
    expect(logs[0]?.afterJson).toBeTruthy()
  })

  it('writes an audit row when a customer is deleted', async () => {
    const { app } = await import('../../../server.js')
    const { token, business } = await seedBusiness()
    const { db: appDb } = await import('../../../db/client.js')
    const schema = await import('../../../db/schema/index.js')
    const { eq, and } = await import('drizzle-orm')

    const create = await app.request('/customers', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'Delete Audit' }),
    })
    const created = (await create.json()) as { id: string }

    await app.request(`/customers/${created.id}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    })

    const logs = await appDb
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.businessId, business.id),
          eq(schema.auditLogs.action, 'customer.delete'),
          eq(schema.auditLogs.entityId, created.id),
        ),
      )

    expect(logs.length).toBe(1)
    expect(logs[0]?.afterJson).toBeNull()
  })
})

describe('customers — auth guard', () => {
  it('returns 401 without a session cookie', async () => {
    const { app } = await import('../../../server.js')
    const res = await app.request('/customers')
    expect(res.status).toBe(401)
  })
})
