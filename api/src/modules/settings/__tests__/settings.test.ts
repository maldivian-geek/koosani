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
  process.env['REDIS_URL'] = process.env['REDIS_URL'] ?? 'redis://localhost:6380/1'
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
      name: `Settings Test Biz ${Date.now()}`,
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
      email: `settingsmod+${role}+${Date.now()}+${Math.random()}@example.com`,
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

describe('settings — business profile', () => {
  it('returns default numbering prefixes matching the previously hard-coded values', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness()

    const res = await app.request('/settings', { headers: authHeaders(token) })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['invoiceNumberPrefix']).toBe('INV-')
    expect(body['creditNoteNumberPrefix']).toBe('CN-')
    expect(body['billNumberPrefix']).toBe('BILL-')
    expect(body['poNumberPrefix']).toBe('PO-')
    expect(body['defaultCreditTermsDays']).toBe(30)
  })

  it('rejects a non-admin from updating settings', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness('manager')

    const res = await app.request('/settings', {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'Should not work' }),
    })
    expect(res.status).toBe(403)
  })

  it('admin can update the profile and numbering prefixes', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness('admin')

    const res = await app.request('/settings', {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({
        name: 'Renamed Business',
        invoiceNumberPrefix: 'INVOICE-',
        defaultCreditTermsDays: 45,
      }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['name']).toBe('Renamed Business')
    expect(body['invoiceNumberPrefix']).toBe('INVOICE-')
    expect(body['defaultCreditTermsDays']).toBe(45)
  })

  it('a new customer created without explicit terms uses the business default', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness('admin')

    await app.request('/settings', {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ defaultCreditTermsDays: 60 }),
    })

    const res = await app.request('/customers', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'Default Terms Customer' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { creditTermsDays: string | number }
    expect(String(body.creditTermsDays)).toBe('60')
  })
})
