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

async function seedBusiness() {
  const { db: appDb } = await import('../../../db/client.js')
  const schema = await import('../../../db/schema/index.js')

  const [business] = await appDb
    .insert(schema.businesses)
    .values({
      name: 'Items Biz',
      tin: 'MVR333',
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
      email: `iadmin+${Date.now()}+${Math.random()}@example.com`,
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

const baseItem = {
  sku: 'ITEM-001',
  name: 'Test Widget',
  unit: 'pcs',
  gstCategory: 'general_8',
  defaultPrice: '100.00',
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

describe('items — CRUD', () => {
  it('creates an item and returns 201', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness()

    const res = await app.request('/items', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ ...baseItem, sku: `SKU-${Date.now()}` }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as { id: string; name: string; stockOnHand: string }
    expect(body.name).toBe('Test Widget')
    expect(body.id).toBeTruthy()
  })

  it('rejects duplicate SKU within same business', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness()

    const sku = `DUP-${Date.now()}`
    await app.request('/items', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ ...baseItem, sku }),
    })

    const res = await app.request('/items', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ ...baseItem, sku }),
    })
    expect(res.status).toBe(422)
  })

  it('lists items with pagination', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness()

    await app.request('/items', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ ...baseItem, sku: `L1-${Date.now()}` }),
    })
    await app.request('/items', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ ...baseItem, sku: `L2-${Date.now()}` }),
    })

    const res = await app.request('/items?page=1&pageSize=10', { headers: authHeaders(token) })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; total: number }
    expect(body.total).toBeGreaterThanOrEqual(2)
  })

  it('fetches item detail with stockOnHand', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness()

    const create = await app.request('/items', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ ...baseItem, sku: `DET-${Date.now()}` }),
    })
    const created = (await create.json()) as { id: string }

    const res = await app.request(`/items/${created.id}`, { headers: authHeaders(token) })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { id: string; stockOnHand: string }
    expect(body.id).toBe(created.id)
    expect(body.stockOnHand).toBe('0.0000')
  })

  it('patches an item', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness()

    const create = await app.request('/items', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ ...baseItem, sku: `P1-${Date.now()}` }),
    })
    const created = (await create.json()) as { id: string }

    const res = await app.request(`/items/${created.id}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'Renamed Widget' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { name: string }
    expect(body.name).toBe('Renamed Widget')
  })

  it('requires a reason when changing GST category', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness()

    const create = await app.request('/items', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ ...baseItem, sku: `GST-${Date.now()}`, gstCategory: 'general_8' }),
    })
    const created = (await create.json()) as { id: string }

    // No reason → should be rejected
    const badRes = await app.request(`/items/${created.id}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ gstCategory: 'zero' }),
    })
    expect(badRes.status).toBe(422)

    // With reason → should succeed
    const goodRes = await app.request(`/items/${created.id}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({
        gstCategory: 'zero',
        gstCategoryChangeReason: 'Reclassified per MIRA ruling',
      }),
    })
    expect(goodRes.status).toBe(200)
    const body = (await goodRes.json()) as { gstCategory: string }
    expect(body.gstCategory).toBe('zero')
  })

  it('round-trips customerItemName through create and patch (Phase 34)', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness()

    const create = await app.request('/items', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        ...baseItem,
        sku: `CIN-${Date.now()}`,
        customerItemName: "Acme Corp's part #4471",
      }),
    })
    expect(create.status).toBe(201)
    const created = (await create.json()) as { id: string; customerItemName: string | null }
    expect(created.customerItemName).toBe("Acme Corp's part #4471")

    const patch = await app.request(`/items/${created.id}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ customerItemName: 'Renamed customer ref' }),
    })
    expect(patch.status).toBe(200)
    const patched = (await patch.json()) as { customerItemName: string | null }
    expect(patched.customerItemName).toBe('Renamed customer ref')

    const get = await app.request(`/items/${created.id}`, { headers: authHeaders(token) })
    const fetched = (await get.json()) as { customerItemName: string | null }
    expect(fetched.customerItemName).toBe('Renamed customer ref')
  })

  it('creates and lists item categories', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness()

    const create = await app.request('/item-categories', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'Electronics' }),
    })
    expect(create.status).toBe(201)

    const list = await app.request('/item-categories', { headers: authHeaders(token) })
    expect(list.status).toBe(200)
    const body = (await list.json()) as unknown[]
    expect(Array.isArray(body)).toBe(true)
  })
})

// ─── Soft-delete guard ────────────────────────────────────────────────────────

describe('items — soft-delete guard', () => {
  it('soft-deletes an item with zero stock', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness()

    const create = await app.request('/items', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ ...baseItem, sku: `DEL-${Date.now()}` }),
    })
    const created = (await create.json()) as { id: string }

    const del = await app.request(`/items/${created.id}`, {
      method: 'DELETE',
      headers: authHeaders(token),
    })
    expect(del.status).toBe(204)

    const list = await app.request('/items', { headers: authHeaders(token) })
    const body = (await list.json()) as { items: Array<{ id: string }> }
    expect(body.items.find((i) => i.id === created.id)).toBeUndefined()
  })

  it('returns 404 for unknown item', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness()
    const res = await app.request('/items/00000000-0000-0000-0000-000000000000', {
      method: 'DELETE',
      headers: authHeaders(token),
    })
    expect(res.status).toBe(404)
  })
})

// ─── Audit log ────────────────────────────────────────────────────────────────

describe('items — audit log', () => {
  it('writes an audit row on item create', async () => {
    const { app } = await import('../../../server.js')
    const { token, business } = await seedBusiness()
    const { db: appDb } = await import('../../../db/client.js')
    const schema = await import('../../../db/schema/index.js')
    const { eq, and } = await import('drizzle-orm')

    await app.request('/items', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ ...baseItem, sku: `AUD-${Date.now()}` }),
    })

    const logs = await appDb
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.businessId, business.id),
          eq(schema.auditLogs.action, 'item.create'),
        ),
      )

    expect(logs.length).toBeGreaterThan(0)
    expect(logs[0]?.entityType).toBe('item')
  })
})
