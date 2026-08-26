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

async function seedBusiness() {
  const { db: appDb } = await import('../../../db/client.js')
  const schema = await import('../../../db/schema/index.js')

  const [business] = await appDb
    .insert(schema.businesses)
    .values({
      name: `Est Test Biz ${Date.now()}`,
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
      email: `esttest+${Date.now()}+${Math.random()}@example.com`,
      name: 'Est Tester',
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
      name: 'Est Test Customer',
      tin: null,
      email: 'customer@example.com',
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

async function createDraft(token: string, customerId: string) {
  const { app } = await import('../../../server.js')
  const res = await app.request('/estimates', {
    method: 'POST',
    headers: authHeaders(token),
    body: JSON.stringify({
      customerId,
      lines: [
        { description: 'Widget', qty: '2.0000', unitPrice: '100.00', gstCategory: 'general_8' },
      ],
    }),
  })
  expect(res.status).toBe(201)
  return (await res.json()) as { id: string; total: string; status: string }
}

describe('estimates — draft lifecycle', () => {
  it('creates a draft with computed GST totals', async () => {
    const { token, customer } = await seedBusiness()
    const draft = await createDraft(token, customer.id)
    expect(draft.status).toBe('draft')
    expect(draft.total).toBe('216.00')
  })

  it('rejects patching a non-draft estimate', async () => {
    const { app } = await import('../../../server.js')
    const { token, customer } = await seedBusiness()
    const draft = await createDraft(token, customer.id)

    await app.request(`/estimates/${draft.id}/send`, {
      method: 'POST',
      headers: authHeaders(token),
    })

    const res = await app.request(`/estimates/${draft.id}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ notes: 'should fail' }),
    })
    expect(res.status).toBe(422)
  })
})

describe('estimates — send / accept / decline', () => {
  it('allocates a sequential estimate number on send, defaulting to EST- prefix', async () => {
    const { app } = await import('../../../server.js')
    const { token, customer } = await seedBusiness()
    const draft = await createDraft(token, customer.id)

    const res = await app.request(`/estimates/${draft.id}/send`, {
      method: 'POST',
      headers: authHeaders(token),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; estimateNumber: string }
    expect(body.status).toBe('sent')
    expect(body.estimateNumber).toBe('EST-000001')
  })

  it('rejects accepting a draft estimate (must be sent first)', async () => {
    const { app } = await import('../../../server.js')
    const { token, customer } = await seedBusiness()
    const draft = await createDraft(token, customer.id)

    const res = await app.request(`/estimates/${draft.id}/accept`, {
      method: 'POST',
      headers: authHeaders(token),
    })
    expect(res.status).toBe(422)
  })

  it('accepts a sent estimate', async () => {
    const { app } = await import('../../../server.js')
    const { token, customer } = await seedBusiness()
    const draft = await createDraft(token, customer.id)
    await app.request(`/estimates/${draft.id}/send`, {
      method: 'POST',
      headers: authHeaders(token),
    })

    const res = await app.request(`/estimates/${draft.id}/accept`, {
      method: 'POST',
      headers: authHeaders(token),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('accepted')
  })

  it('declines a sent estimate', async () => {
    const { app } = await import('../../../server.js')
    const { token, customer } = await seedBusiness()
    const draft = await createDraft(token, customer.id)
    await app.request(`/estimates/${draft.id}/send`, {
      method: 'POST',
      headers: authHeaders(token),
    })

    const res = await app.request(`/estimates/${draft.id}/decline`, {
      method: 'POST',
      headers: authHeaders(token),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('declined')
  })
})

describe('estimates — convert to invoice', () => {
  it('copies lines into a new draft invoice and links back via estimateId', async () => {
    const { app } = await import('../../../server.js')
    const { token, customer } = await seedBusiness()
    const draft = await createDraft(token, customer.id)
    await app.request(`/estimates/${draft.id}/send`, {
      method: 'POST',
      headers: authHeaders(token),
    })

    const res = await app.request(`/estimates/${draft.id}/convert`, {
      method: 'POST',
      headers: authHeaders(token),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as {
      estimate: { status: string; convertedAt: string }
      invoiceId: string
    }
    expect(body.estimate.status).toBe('accepted')
    expect(body.estimate.convertedAt).toBeTruthy()

    const invRes = await app.request(`/invoices/${body.invoiceId}`, { headers: authHeaders(token) })
    expect(invRes.status).toBe(200)
    const invoice = (await invRes.json()) as {
      status: string
      estimateId: string
      total: string
      lines: Array<{ description: string }>
    }
    expect(invoice.status).toBe('draft')
    expect(invoice.estimateId).toBe(draft.id)
    expect(invoice.total).toBe('216.00')
    expect(invoice.lines).toHaveLength(1)
  })

  it('rejects converting the same estimate twice', async () => {
    const { app } = await import('../../../server.js')
    const { token, customer } = await seedBusiness()
    const draft = await createDraft(token, customer.id)
    await app.request(`/estimates/${draft.id}/send`, {
      method: 'POST',
      headers: authHeaders(token),
    })
    await app.request(`/estimates/${draft.id}/convert`, {
      method: 'POST',
      headers: authHeaders(token),
    })

    const res = await app.request(`/estimates/${draft.id}/convert`, {
      method: 'POST',
      headers: authHeaders(token),
    })
    expect(res.status).toBe(422)
  })

  it('rejects converting a declined estimate', async () => {
    const { app } = await import('../../../server.js')
    const { token, customer } = await seedBusiness()
    const draft = await createDraft(token, customer.id)
    await app.request(`/estimates/${draft.id}/send`, {
      method: 'POST',
      headers: authHeaders(token),
    })
    await app.request(`/estimates/${draft.id}/decline`, {
      method: 'POST',
      headers: authHeaders(token),
    })

    const res = await app.request(`/estimates/${draft.id}/convert`, {
      method: 'POST',
      headers: authHeaders(token),
    })
    expect(res.status).toBe(422)
  })
})
