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
      name: `Recur Test Biz ${Date.now()}`,
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
      email: `recurtest+${Date.now()}+${Math.random()}@example.com`,
      name: 'Recur Tester',
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

  await appDb.insert(schema.gstRates).values({
    businessId: business.id,
    category: 'general_8',
    rate: '0.0800',
    validFrom: '2023-01-01',
    validTo: null,
    createdBy: user.id,
    updatedBy: user.id,
  })

  const [customer] = await appDb
    .insert(schema.customers)
    .values({
      businessId: business.id,
      name: 'Recur Test Customer',
      tin: null,
      email: null,
      phone: null,
      address: null,
      creditTermsDays: '30',
      creditLimit: null,
      notes: null,
      createdBy: user.id,
      updatedBy: user.id,
    })
    .returning()
  if (!customer) throw new Error('seed: no customer')

  return { business, user, token, customer }
}

function authHeaders(token: string) {
  return { 'Content-Type': 'application/json', Cookie: `session=${token}` }
}

async function createProfile(
  token: string,
  customerId: string,
  overrides: Record<string, unknown> = {},
) {
  const { app } = await import('../../../server.js')
  const res = await app.request('/recurrence-profiles', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      customerId,
      name: 'Monthly retainer',
      frequency: 'monthly',
      startDate: '2026-01-01',
      lines: [
        { description: 'Retainer', qty: '1.0000', unitPrice: '100.00', gstCategory: 'general_8' },
      ],
      ...overrides,
    }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string; nextRunDate: string; autoIssue: boolean }
}

describe('recurrence — profile CRUD', () => {
  it('creates a profile with nextRunDate defaulted to startDate', async () => {
    const { token, customer } = await seedBusiness()
    const profile = await createProfile(token, customer.id)
    expect(profile.nextRunDate).toBe('2026-01-01')
  })

  it('rejects an endDate before startDate', async () => {
    const { app } = await import('../../../server.js')
    const { token, customer } = await seedBusiness()
    const res = await app.request('/recurrence-profiles', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        customerId: customer.id,
        name: 'Bad profile',
        frequency: 'monthly',
        startDate: '2026-01-01',
        endDate: '2025-12-01',
        lines: [{ description: 'X', qty: '1.0000', unitPrice: '10.00', gstCategory: 'general_8' }],
      }),
    })
    expect(res.status).toBe(422)
  })

  it('patches active/off to pause a profile', async () => {
    const { app } = await import('../../../server.js')
    const { token, customer } = await seedBusiness()
    const profile = await createProfile(token, customer.id)

    const res = await app.request(`/recurrence-profiles/${profile.id}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ active: false }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { active: boolean }
    expect(body.active).toBe(false)
  })
})

describe('recurrence — generation', () => {
  it('is a no-op when nextRunDate is in the future', async () => {
    const { app } = await import('../../../server.js')
    const { token, customer } = await seedBusiness()
    const profile = await createProfile(token, customer.id, { startDate: '2099-01-01' })

    const res = await app.request(`/recurrence-profiles/${profile.id}/generate`, {
      method: 'POST',
      headers: authHeaders(token),
    })
    expect(res.status).toBe(422)
  })

  it('generates a draft invoice, links it back, and advances nextRunDate by one month', async () => {
    const { app } = await import('../../../server.js')
    const { token, customer } = await seedBusiness()
    const profile = await createProfile(token, customer.id, { startDate: '2020-01-01' })

    const res = await app.request(`/recurrence-profiles/${profile.id}/generate`, {
      method: 'POST',
      headers: authHeaders(token),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { profile: { nextRunDate: string }; invoiceId: string }
    expect(body.profile.nextRunDate).toBe('2020-02-01')

    const invRes = await app.request(`/invoices/${body.invoiceId}`, { headers: authHeaders(token) })
    const invoice = (await invRes.json()) as {
      status: string
      recurrenceProfileId: string
      total: string
    }
    expect(invoice.status).toBe('draft')
    expect(invoice.recurrenceProfileId).toBe(profile.id)
    expect(invoice.total).toBe('108.00')
  })

  it('auto-issues when autoIssue is set', async () => {
    const { app } = await import('../../../server.js')
    const { token, customer } = await seedBusiness()
    const profile = await createProfile(token, customer.id, {
      startDate: '2020-01-01',
      autoIssue: true,
    })

    const res = await app.request(`/recurrence-profiles/${profile.id}/generate`, {
      method: 'POST',
      headers: authHeaders(token),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { invoiceId: string }

    const invRes = await app.request(`/invoices/${body.invoiceId}`, { headers: authHeaders(token) })
    const invoice = (await invRes.json()) as { status: string; invoiceNumber: string | null }
    expect(invoice.status).toBe('issued')
    expect(invoice.invoiceNumber).toBeTruthy()
  })

  it('generating twice in a row only produces one invoice (nextRunDate already advanced)', async () => {
    const { app } = await import('../../../server.js')
    const { todayMv } = await import('@koosani/shared')
    const { token, customer } = await seedBusiness()
    // startDate = today: exactly one cycle is due right now; after generating,
    // nextRunDate advances a full month into the future, so a second call in
    // the same run must be a no-op rather than a duplicate invoice.
    const profile = await createProfile(token, customer.id, { startDate: todayMv() })

    const first = await app.request(`/recurrence-profiles/${profile.id}/generate`, {
      method: 'POST',
      headers: authHeaders(token),
    })
    expect(first.status).toBe(201)

    const second = await app.request(`/recurrence-profiles/${profile.id}/generate`, {
      method: 'POST',
      headers: authHeaders(token),
    })
    expect(second.status).toBe(422) // not due again until next month
  })
})
