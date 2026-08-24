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
      name: `FX Test Biz ${Date.now()}-${Math.random()}`,
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
      email: `fxtest+${Date.now()}+${Math.random()}@example.com`,
      name: 'FX Tester',
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

describe('exchangeRates — service.rateAt', () => {
  it('MVR is always rate 1, never requires a stored row', async () => {
    const { business } = await seedBusiness()
    const svc = await import('../service.js')
    const rate = await svc.rateAt(business.id, 'MVR', '2026-01-01')
    expect(rate.toString()).toBe('1')
  })

  it('throws NotFoundError for a foreign currency with no recorded rate', async () => {
    const { business } = await seedBusiness()
    const svc = await import('../service.js')
    await expect(svc.rateAt(business.id, 'USD', '2026-01-01')).rejects.toThrow(svc.NotFoundError)
  })

  it('finds the most recent rate on or before the requested date', async () => {
    const { business, user } = await seedBusiness()
    const svc = await import('../service.js')
    await svc.recordRate(business.id, 'USD', '15.40', '2026-01-01', user.id)
    await svc.recordRate(business.id, 'USD', '15.60', '2026-02-01', user.id)

    const midMonth = await svc.rateAt(business.id, 'USD', '2026-01-15')
    expect(midMonth.toString()).toBe('15.4')

    const afterFeb = await svc.rateAt(business.id, 'USD', '2026-02-15')
    expect(afterFeb.toString()).toBe('15.6')

    await expect(svc.rateAt(business.id, 'USD', '2025-12-01')).rejects.toThrow(svc.NotFoundError)
  })

  it('rejects recording a rate for MVR itself', async () => {
    const { business, user } = await seedBusiness()
    const svc = await import('../service.js')
    await expect(svc.recordRate(business.id, 'MVR', '1', '2026-01-01', user.id)).rejects.toThrow()
  })
})

describe('exchangeRates — routes', () => {
  it('POST /exchange-rates requires admin', async () => {
    const { business, token } = await seedBusiness('staff')
    const { app } = await import('../../../server.js')
    const res = await app.request('/exchange-rates', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ currency: 'USD', rate: '15.42', rateDate: '2026-01-01' }),
    })
    expect(res.status).toBe(403)
    void business
  })

  it('admin can record a rate and list it back', async () => {
    const { token } = await seedBusiness('admin')
    const { app } = await import('../../../server.js')
    const createRes = await app.request('/exchange-rates', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ currency: 'USD', rate: '15.42', rateDate: '2026-01-01' }),
    })
    expect(createRes.status).toBe(201)

    const listRes = await app.request('/exchange-rates?currency=USD', {
      headers: authHeaders(token),
    })
    expect(listRes.status).toBe(200)
    const body = (await listRes.json()) as { items: Array<{ rate: string }> }
    expect(body.items).toHaveLength(1)
    expect(body.items[0]?.rate).toBe('15.420000')
  })
})
