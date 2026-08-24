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
  process.env['REDIS_URL'] = process.env['REDIS_URL'] ?? 'redis://localhost:6380'
  process.env['JWT_SECRET'] = JWT_SECRET
  process.env['FRONTEND_URL'] = 'http://localhost:5173'
  process.env['NODE_ENV'] = 'test'
  client = postgres(url, { max: 1 })
}, 60_000)

afterAll(async () => {
  await client?.end()
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function seedBusiness(allowBackorders = false) {
  const { db: appDb } = await import('../../../db/client.js')
  const schema = await import('../../../db/schema/index.js')

  const [business] = await appDb
    .insert(schema.businesses)
    .values({
      name: 'Inv Test Biz',
      tin: null,
      gstPeriodType: 'monthly',
      allowBackorders,
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
      email: `inv+${Date.now()}+${Math.random()}@example.com`,
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

  return { business, user, token, appDb, schema }
}

async function seedItem(businessId: string, userId: string) {
  const { db: appDb } = await import('../../../db/client.js')
  const schema = await import('../../../db/schema/index.js')

  const [item] = await appDb
    .insert(schema.items)
    .values({
      businessId,
      sku: `SKU-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: 'Test Item',
      unit: 'pcs',
      gstCategory: 'general_8',
      createdBy: userId,
      updatedBy: userId,
    })
    .returning()
  if (!item) throw new Error('seed: no item')
  return item
}

function authHeaders(token: string) {
  return {
    'Content-Type': 'application/json',
    Cookie: `session=${token}`,
  }
}

// ─── Movement math & trigger verification ────────────────────────────────────

describe('inventory — movement math', () => {
  it('adjustment updates stock_on_hand via trigger', async () => {
    const { app } = await import('../../../server.js')
    const { business, user, token, appDb, schema } = await seedBusiness()
    const { eq, and } = await import('drizzle-orm')
    const item = await seedItem(business.id, user.id)

    // NUMERIC(15,4) always returns with 4dp
    expect(item.stockOnHand).toBe('0.0000')

    const res = await app.request('/inventory/adjustments', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ itemId: item.id, qty: '10', reason: 'Opening stock' }),
    })
    expect(res.status).toBe(201)

    // Verify trigger updated items.stock_on_hand
    const [updated] = await appDb
      .select({ stockOnHand: schema.items.stockOnHand })
      .from(schema.items)
      .where(and(eq(schema.items.businessId, business.id), eq(schema.items.id, item.id)))

    expect(updated?.stockOnHand).toBe('10.0000')
  })

  it('consecutive adjustments accumulate correctly', async () => {
    const { app } = await import('../../../server.js')
    const { business, user, token, appDb, schema } = await seedBusiness()
    const { eq, and } = await import('drizzle-orm')
    const item = await seedItem(business.id, user.id)

    await app.request('/inventory/adjustments', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ itemId: item.id, qty: '10', reason: 'Opening' }),
    })
    await app.request('/inventory/adjustments', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ itemId: item.id, qty: '-3', reason: 'Write-off' }),
    })

    const [updated] = await appDb
      .select({ stockOnHand: schema.items.stockOnHand })
      .from(schema.items)
      .where(and(eq(schema.items.businessId, business.id), eq(schema.items.id, item.id)))

    expect(updated?.stockOnHand).toBe('7.0000')
  })

  it('recomputeOnHand matches trigger-maintained cache', async () => {
    const { business, user, appDb, schema } = await seedBusiness()
    const { db } = await import('../../../db/client.js')
    const repo = await import('../repository.js')
    const { eq, and } = await import('drizzle-orm')

    const item = await seedItem(business.id, user.id)

    // Insert movements directly to verify trigger and recompute agree
    await db.transaction(async (tx) => {
      await repo.insertMovement(
        {
          businessId: business.id,
          itemId: item.id,
          qty: '15',
          source: 'adjustment',
          reason: 'seed',
          createdBy: user.id,
        },
        tx,
      )
      await repo.insertMovement(
        {
          businessId: business.id,
          itemId: item.id,
          qty: '-5',
          source: 'adjustment',
          reason: 'seed',
          createdBy: user.id,
        },
        tx,
      )
    })

    const [row] = await appDb
      .select({ stockOnHand: schema.items.stockOnHand })
      .from(schema.items)
      .where(and(eq(schema.items.businessId, business.id), eq(schema.items.id, item.id)))

    const computed = await db.transaction(async (tx) =>
      repo.recomputeOnHand(business.id, item.id, tx),
    )

    expect(row?.stockOnHand).toBe('10.0000')
    expect(computed.toFixed(4)).toBe('10.0000')
    expect(row?.stockOnHand).toBe(computed.toFixed(4))
  })
})

// ─── Negative-stock rejection ─────────────────────────────────────────────────

describe('inventory — negative stock rejection', () => {
  it('rejects adjustment that would cause negative stock', async () => {
    const { app } = await import('../../../server.js')
    const { business, user, token } = await seedBusiness()
    const item = await seedItem(business.id, user.id)

    const res = await app.request('/inventory/adjustments', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ itemId: item.id, qty: '-1', reason: 'Would go negative' }),
    })
    expect(res.status).toBe(422)
    const body = (await res.json()) as { error: string }
    expect(body.error).toMatch(/Insufficient stock/)
  })

  it('allows negative adjustment when backorders enabled', async () => {
    const { app } = await import('../../../server.js')
    const { business, user, token } = await seedBusiness(true) // allowBackorders = true
    const item = await seedItem(business.id, user.id)

    const res = await app.request('/inventory/adjustments', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ itemId: item.id, qty: '-5', reason: 'Back-order allowed' }),
    })
    expect(res.status).toBe(201)
  })

  it('returns 422 with zero qty', async () => {
    const { app } = await import('../../../server.js')
    const { business, user, token } = await seedBusiness()
    const item = await seedItem(business.id, user.id)

    const res = await app.request('/inventory/adjustments', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ itemId: item.id, qty: '0', reason: 'Zero qty' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 404 for unknown item', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness()

    const res = await app.request('/inventory/adjustments', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        itemId: '00000000-0000-0000-0000-000000000000',
        qty: '5',
        reason: 'Ghost item',
      }),
    })
    expect(res.status).toBe(404)
  })
})

// ─── Recount diffs ────────────────────────────────────────────────────────────

describe('inventory — recount diffs', () => {
  it('creates adjustments only for items with a diff', async () => {
    const { app } = await import('../../../server.js')
    const { business, user, token, appDb, schema } = await seedBusiness()
    const { eq, and } = await import('drizzle-orm')

    const item1 = await seedItem(business.id, user.id)
    const item2 = await seedItem(business.id, user.id)

    // item1: set stock to 10
    await app.request('/inventory/adjustments', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ itemId: item1.id, qty: '10', reason: 'Opening' }),
    })
    // item2: set stock to 5
    await app.request('/inventory/adjustments', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ itemId: item2.id, qty: '5', reason: 'Opening' }),
    })

    // Stock count: item1 counted=7 (diff=-3), item2 counted=5 (diff=0, no adjustment)
    const res = await app.request('/inventory/stock-count', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        counts: [
          { itemId: item1.id, qty: '7' },
          { itemId: item2.id, qty: '5' },
        ],
      }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { adjustmentsCreated: number }
    expect(body.adjustmentsCreated).toBe(1)

    // Verify item1 is now at 7
    const [row1] = await appDb
      .select({ stockOnHand: schema.items.stockOnHand })
      .from(schema.items)
      .where(and(eq(schema.items.businessId, business.id), eq(schema.items.id, item1.id)))
    expect(row1?.stockOnHand).toBe('7.0000')

    // item2 unchanged at 5
    const [row2] = await appDb
      .select({ stockOnHand: schema.items.stockOnHand })
      .from(schema.items)
      .where(and(eq(schema.items.businessId, business.id), eq(schema.items.id, item2.id)))
    expect(row2?.stockOnHand).toBe('5.0000')
  })

  it('stock count setting to 0 is allowed (write-off all)', async () => {
    const { app } = await import('../../../server.js')
    const { business, user, token } = await seedBusiness()
    const item = await seedItem(business.id, user.id)

    await app.request('/inventory/adjustments', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ itemId: item.id, qty: '20', reason: 'Opening' }),
    })

    const res = await app.request('/inventory/stock-count', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ counts: [{ itemId: item.id, qty: '0' }] }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { adjustmentsCreated: number }
    expect(body.adjustmentsCreated).toBe(1)
  })

  it('returns 404 if stock count references unknown item', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness()

    const res = await app.request('/inventory/stock-count', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        counts: [{ itemId: '00000000-0000-0000-0000-000000000000', qty: '5' }],
      }),
    })
    expect(res.status).toBe(404)
  })
})

// ─── List endpoints ───────────────────────────────────────────────────────────

describe('inventory — list endpoints', () => {
  it('GET /inventory/movements returns paginated movements', async () => {
    const { app } = await import('../../../server.js')
    const { business, user, token } = await seedBusiness()
    const item = await seedItem(business.id, user.id)

    await app.request('/inventory/adjustments', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ itemId: item.id, qty: '5', reason: 'r1' }),
    })
    await app.request('/inventory/adjustments', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ itemId: item.id, qty: '3', reason: 'r2' }),
    })

    const res = await app.request(`/inventory/movements?itemId=${item.id}&page=1&pageSize=10`, {
      headers: authHeaders(token),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; total: number; page: number }
    expect(body.total).toBeGreaterThanOrEqual(2)
    expect(Array.isArray(body.items)).toBe(true)
    expect(body.page).toBe(1)
  })

  it('GET /inventory/on-hand returns items array', async () => {
    const { app } = await import('../../../server.js')
    const { business, user, token } = await seedBusiness()
    await seedItem(business.id, user.id)

    const res = await app.request('/inventory/on-hand', { headers: authHeaders(token) })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<{ itemId: string; stockOnHand: string }>
    expect(Array.isArray(body)).toBe(true)
  })
})

// ─── Audit log ────────────────────────────────────────────────────────────────

describe('inventory — audit log', () => {
  it('writes audit row for adjustment', async () => {
    const { app } = await import('../../../server.js')
    const { business, user, token, appDb, schema } = await seedBusiness()
    const { eq, and } = await import('drizzle-orm')
    const item = await seedItem(business.id, user.id)

    await app.request('/inventory/adjustments', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ itemId: item.id, qty: '8', reason: 'Audit check' }),
    })

    const logs = await appDb
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.businessId, business.id),
          eq(schema.auditLogs.action, 'inventory.adjustment'),
          eq(schema.auditLogs.entityId, item.id),
        ),
      )

    expect(logs.length).toBeGreaterThan(0)
    expect(logs[0]?.entityType).toBe('item')
    expect(logs[0]?.afterJson).toBeTruthy()
  })
})

// ─── Auth guard ───────────────────────────────────────────────────────────────

describe('inventory — auth guard', () => {
  it('returns 401 without session cookie', async () => {
    const { app } = await import('../../../server.js')
    const res = await app.request('/inventory/on-hand')
    expect(res.status).toBe(401)
  })
})
