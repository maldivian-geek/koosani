import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDatabase } from '../../../db/test-db.js'
import postgres from 'postgres'
import * as argon2 from 'argon2'
import jwt from 'jsonwebtoken'

// Phase 31, UPGRADE.md G-11 — see ARCHITECTURE.md §4.11.

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
      name: `Expense Test Biz ${Date.now()}-${Math.random()}`,
      tin: null,
      gstPeriodType: 'monthly',
      allowBackorders: true,
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
      email: `exp+${Date.now()}+${Math.random()}@example.com`,
      name: 'Tester',
      role,
      passwordHash: hash,
      emailVerified: true,
      tokenVersion: 0,
      createdBy: business.id,
      updatedBy: business.id,
    })
    .returning()
  if (!user) throw new Error('seed: no user')

  await appDb.insert(schema.gstRates).values({
    businessId: business.id,
    category: 'general_8',
    rate: '0.0800',
    validFrom: '2023-01-01',
    validTo: null,
    createdBy: user.id,
    updatedBy: user.id,
  })

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

async function seedCustomer(businessId: string, userId: string) {
  const { db: appDb } = await import('../../../db/client.js')
  const schema = await import('../../../db/schema/index.js')
  const [customer] = await appDb
    .insert(schema.customers)
    .values({
      businessId,
      name: 'Expense Test Customer',
      tin: null,
      email: null,
      phone: null,
      address: null,
      creditTermsDays: '30',
      creditLimit: null,
      notes: null,
      createdBy: userId,
      updatedBy: userId,
    })
    .returning()
  if (!customer) throw new Error('seed: no customer')
  return customer
}

function ctxFor(userId: string, businessId: string) {
  return { userId, businessId, ip: '127.0.0.1', ua: undefined }
}

function authHeaders(token: string) {
  return { 'Content-Type': 'application/json', Cookie: `session=${token}` }
}

describe('expenses — createExpense', () => {
  it('computes GST forward from the net amount', async () => {
    const { business, user } = await seedBusiness()
    const svc = await import('../service.js')
    const expense = await svc.createExpense(
      business.id,
      {
        category: 'Office Supplies',
        expenseDate: '2026-01-15',
        amount: '100.00',
        gstCategory: 'general_8',
      },
      ctxFor(user.id, business.id),
    )
    expect(expense.gstAmount).toBe('8.00')
    expect(expense.total).toBe('108.00')
    expect(expense.gstRate).toBe('0.0800')
  })

  it('rejects billable=true without a customerId', async () => {
    const { business, user } = await seedBusiness()
    const svc = await import('../service.js')
    await expect(
      svc.createExpense(
        business.id,
        {
          category: 'Travel',
          expenseDate: '2026-01-15',
          amount: '50.00',
          gstCategory: 'general_8',
          billable: true,
        },
        ctxFor(user.id, business.id),
      ),
    ).rejects.toThrow()
  })

  it('accepts billable=true with a customerId', async () => {
    const { business, user } = await seedBusiness()
    const customer = await seedCustomer(business.id, user.id)
    const svc = await import('../service.js')
    const expense = await svc.createExpense(
      business.id,
      {
        category: 'Travel',
        expenseDate: '2026-01-15',
        amount: '50.00',
        gstCategory: 'general_8',
        billable: true,
        customerId: customer.id,
      },
      ctxFor(user.id, business.id),
    )
    expect(expense.billable).toBe(true)
    expect(expense.customerId).toBe(customer.id)
    expect(expense.invoicedAt).toBeNull()
  })
})

describe('expenses — update/delete guarded once invoiced', () => {
  it('allows editing and deleting an uninvoiced expense', async () => {
    const { business, user } = await seedBusiness()
    const svc = await import('../service.js')
    const expense = await svc.createExpense(
      business.id,
      { category: 'Fuel', expenseDate: '2026-01-15', amount: '30.00', gstCategory: 'general_8' },
      ctxFor(user.id, business.id),
    )
    const updated = await svc.updateExpense(
      business.id,
      expense.id,
      { amount: '40.00' },
      ctxFor(user.id, business.id),
    )
    expect(updated.amount).toBe('40.00')
    expect(updated.gstAmount).toBe('3.20') // recomputed

    await svc.deleteExpense(business.id, expense.id, ctxFor(user.id, business.id))
    await expect(svc.getExpense(business.id, expense.id)).rejects.toThrow(svc.NotFoundError)
  })

  it('rejects editing or deleting an expense once invoiced', async () => {
    const { business, user } = await seedBusiness()
    const customer = await seedCustomer(business.id, user.id)
    const svc = await import('../service.js')
    const expense = await svc.createExpense(
      business.id,
      {
        category: 'Travel',
        expenseDate: '2026-01-15',
        amount: '50.00',
        gstCategory: 'general_8',
        billable: true,
        customerId: customer.id,
      },
      ctxFor(user.id, business.id),
    )

    await svc.markInvoiced(
      business.id,
      [expense.id],
      crypto.randomUUID(),
      ctxFor(user.id, business.id),
    )

    await expect(
      svc.updateExpense(business.id, expense.id, { amount: '99.00' }, ctxFor(user.id, business.id)),
    ).rejects.toThrow(svc.ValidationError)
    await expect(
      svc.deleteExpense(business.id, expense.id, ctxFor(user.id, business.id)),
    ).rejects.toThrow(svc.ValidationError)
  })
})

describe('expenses — billable → invoice line flow', () => {
  it('lists uninvoiced billable expenses for a customer and excludes them once invoiced', async () => {
    const { business, user } = await seedBusiness()
    const customer = await seedCustomer(business.id, user.id)
    const svc = await import('../service.js')

    const e1 = await svc.createExpense(
      business.id,
      {
        category: 'Travel',
        expenseDate: '2026-01-10',
        amount: '50.00',
        gstCategory: 'general_8',
        billable: true,
        customerId: customer.id,
      },
      ctxFor(user.id, business.id),
    )
    await svc.createExpense(
      business.id,
      {
        category: 'Office Supplies',
        expenseDate: '2026-01-11',
        amount: '20.00',
        gstCategory: 'general_8',
      },
      ctxFor(user.id, business.id),
    ) // not billable — should not appear

    let billable = await svc.listUninvoicedBillable(business.id, customer.id)
    expect(billable).toHaveLength(1)
    expect(billable[0]?.id).toBe(e1.id)

    await svc.markInvoiced(business.id, [e1.id], crypto.randomUUID(), ctxFor(user.id, business.id))

    billable = await svc.listUninvoicedBillable(business.id, customer.id)
    expect(billable).toHaveLength(0)
  })

  it('rejects marking a non-billable expense as invoiced', async () => {
    const { business, user } = await seedBusiness()
    const svc = await import('../service.js')
    const expense = await svc.createExpense(
      business.id,
      {
        category: 'Office Supplies',
        expenseDate: '2026-01-11',
        amount: '20.00',
        gstCategory: 'general_8',
      },
      ctxFor(user.id, business.id),
    )
    await expect(
      svc.markInvoiced(
        business.id,
        [expense.id],
        crypto.randomUUID(),
        ctxFor(user.id, business.id),
      ),
    ).rejects.toThrow(svc.ValidationError)
  })

  it('rejects double-invoicing the same expense', async () => {
    const { business, user } = await seedBusiness()
    const customer = await seedCustomer(business.id, user.id)
    const svc = await import('../service.js')
    const expense = await svc.createExpense(
      business.id,
      {
        category: 'Travel',
        expenseDate: '2026-01-10',
        amount: '50.00',
        gstCategory: 'general_8',
        billable: true,
        customerId: customer.id,
      },
      ctxFor(user.id, business.id),
    )
    await svc.markInvoiced(
      business.id,
      [expense.id],
      crypto.randomUUID(),
      ctxFor(user.id, business.id),
    )
    await expect(
      svc.markInvoiced(
        business.id,
        [expense.id],
        crypto.randomUUID(),
        ctxFor(user.id, business.id),
      ),
    ).rejects.toThrow(svc.ValidationError)
  })
})

describe('expenses — routes', () => {
  it('rejects creating an expense without the expenses:add permission', async () => {
    const { business, token } = await seedBusiness('staff')
    const { app } = await import('../../../server.js')
    const res = await app.request('/expenses', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        category: 'Fuel',
        expenseDate: '2026-01-15',
        amount: '30.00',
        gstCategory: 'general_8',
      }),
    })
    expect(res.status).toBe(403)
    void business
  })

  it('admin can create, list, and fetch an expense via HTTP', async () => {
    const { token } = await seedBusiness('admin')
    const { app } = await import('../../../server.js')

    const createRes = await app.request('/expenses', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        category: 'Fuel',
        expenseDate: '2026-01-15',
        amount: '30.00',
        gstCategory: 'general_8',
      }),
    })
    expect(createRes.status).toBe(201)
    const created = (await createRes.json()) as { id: string }

    const listRes = await app.request('/expenses', { headers: authHeaders(token) })
    expect(listRes.status).toBe(200)
    const body = (await listRes.json()) as { items: unknown[]; total: number }
    expect(body.total).toBe(1)

    const getRes = await app.request(`/expenses/${created.id}`, { headers: authHeaders(token) })
    expect(getRes.status).toBe(200)
  })
})
