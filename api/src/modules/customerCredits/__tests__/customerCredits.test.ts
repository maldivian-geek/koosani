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
      name: `Credit Test Biz ${Date.now()}`,
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
      email: `credittest+${Date.now()}+${Math.random()}@example.com`,
      name: 'Credit Tester',
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
      name: 'Credit Test Customer',
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

async function seedIssuedInvoice(businessId: string, customerId: string, userId: string) {
  const invoicingSvc = await import('../../invoicing/service.js')
  const ctx = { userId, businessId, ip: '127.0.0.1', ua: undefined }
  const draft = await invoicingSvc.createDraft(
    businessId,
    {
      customerId,
      lines: [
        { description: 'Widget', qty: '1.0000', unitPrice: '100.00', gstCategory: 'general_8' },
      ],
    },
    ctx,
  )
  return invoicingSvc.issue(businessId, draft.id, ctx)
}

describe('customer credits — advance and refund', () => {
  it('recording an advance increases the balance', async () => {
    const { app } = await import('../../../server.js')
    const { token, customer } = await seedBusiness()

    const res = await app.request(`/customers/${customer.id}/credits/advance`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ amount: '200.00', notes: 'Retainer for Q3' }),
    })
    expect(res.status).toBe(201)

    const balanceRes = await app.request(`/customers/${customer.id}/credits`, {
      headers: authHeaders(token),
    })
    const body = (await balanceRes.json()) as { balance: string }
    expect(body.balance).toBe('200.00')
  })

  it('refund reduces the balance and rejects if insufficient', async () => {
    const { app } = await import('../../../server.js')
    const { token, customer } = await seedBusiness()

    await app.request(`/customers/${customer.id}/credits/advance`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ amount: '100.00' }),
    })

    const refundRes = await app.request(`/customers/${customer.id}/credits/refund`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ amount: '40.00' }),
    })
    expect(refundRes.status).toBe(201)

    const balanceRes = await app.request(`/customers/${customer.id}/credits`, {
      headers: authHeaders(token),
    })
    const body = (await balanceRes.json()) as { balance: string }
    expect(body.balance).toBe('60.00')

    const overRefundRes = await app.request(`/customers/${customer.id}/credits/refund`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ amount: '1000.00' }),
    })
    expect(overRefundRes.status).toBe(422)
  })
})

describe('customer credits — apply to invoice', () => {
  it('applies available credit to reduce an invoice balance', async () => {
    const { app } = await import('../../../server.js')
    const { token, business, user, customer } = await seedBusiness()
    const invoice = await seedIssuedInvoice(business.id, customer.id, user.id)

    await app.request(`/customers/${customer.id}/credits/advance`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ amount: '108.00' }),
    })

    const res = await app.request(`/invoices/${invoice.id}/apply-credit`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ amount: '108.00' }),
    })
    expect(res.status).toBe(201)
    const payment = (await res.json()) as { method: string; amount: string }
    expect(payment.method).toBe('credit')
    expect(payment.amount).toBe('108.00')

    const invRes = await app.request(`/invoices/${invoice.id}`, { headers: authHeaders(token) })
    const updatedInvoice = (await invRes.json()) as { status: string }
    expect(updatedInvoice.status).toBe('paid')

    const balanceRes = await app.request(`/customers/${customer.id}/credits`, {
      headers: authHeaders(token),
    })
    const balanceBody = (await balanceRes.json()) as { balance: string }
    expect(balanceBody.balance).toBe('0.00')
  })

  it('rejects applying more credit than is available', async () => {
    const { app } = await import('../../../server.js')
    const { token, business, user, customer } = await seedBusiness()
    const invoice = await seedIssuedInvoice(business.id, customer.id, user.id)

    const res = await app.request(`/invoices/${invoice.id}/apply-credit`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ amount: '50.00' }),
    })
    expect(res.status).toBe(422)
  })

  it('rejects applying more credit than the invoice has outstanding', async () => {
    const { app } = await import('../../../server.js')
    const { token, business, user, customer } = await seedBusiness()
    const invoice = await seedIssuedInvoice(business.id, customer.id, user.id)

    await app.request(`/customers/${customer.id}/credits/advance`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ amount: '500.00' }),
    })

    const res = await app.request(`/invoices/${invoice.id}/apply-credit`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ amount: '500.00' }),
    })
    expect(res.status).toBe(422)
  })
})

describe('invoice write-off', () => {
  it('writes off the outstanding balance with no cash movement', async () => {
    const { app } = await import('../../../server.js')
    const { token, business, user, customer } = await seedBusiness()
    const invoice = await seedIssuedInvoice(business.id, customer.id, user.id)

    const res = await app.request(`/invoices/${invoice.id}/write-off`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ reason: 'Customer went out of business' }),
    })
    expect(res.status).toBe(201)
    const payment = (await res.json()) as { method: string; amount: string }
    expect(payment.method).toBe('write_off')
    expect(payment.amount).toBe('108.00')

    const invRes = await app.request(`/invoices/${invoice.id}`, { headers: authHeaders(token) })
    const updatedInvoice = (await invRes.json()) as { status: string; paidAmount: string }
    expect(updatedInvoice.status).toBe('paid')
    expect(updatedInvoice.paidAmount).toBe('108.00')

    // No credit was granted — write-off isn't a real payment
    const balanceRes = await app.request(`/customers/${customer.id}/credits`, {
      headers: authHeaders(token),
    })
    const balanceBody = (await balanceRes.json()) as { balance: string }
    expect(balanceBody.balance).toBe('0.00')
  })

  it('rejects writing off an invoice with nothing outstanding', async () => {
    const { app } = await import('../../../server.js')
    const { token, business, user, customer } = await seedBusiness()
    const invoice = await seedIssuedInvoice(business.id, customer.id, user.id)

    await app.request(`/invoices/${invoice.id}/write-off`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ reason: 'first' }),
    })

    const res = await app.request(`/invoices/${invoice.id}/write-off`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ reason: 'second' }),
    })
    expect(res.status).toBe(422)
  })
})
