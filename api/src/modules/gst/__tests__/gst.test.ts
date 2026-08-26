import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDatabase } from '../../../db/test-db.js'
import postgres from 'postgres'
import * as argon2 from 'argon2'
import jwt from 'jsonwebtoken'

// ─── Container setup ──────────────────────────────────────────────────────────

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

async function seedBusiness(periodType: 'monthly' | 'quarterly' = 'monthly') {
  const { db: appDb } = await import('../../../db/client.js')
  const schema = await import('../../../db/schema/index.js')

  const [business] = await appDb
    .insert(schema.businesses)
    .values({
      name: `GST Test Biz ${Date.now()}`,
      tin: null,
      gstPeriodType: periodType,
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
      email: `gst+${Date.now()}+${Math.random()}@example.com`,
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

// Seed MIRA rates for a business (mirrors the prod seed)
async function seedMiraRates(businessId: string, userId: string) {
  const { db: appDb } = await import('../../../db/client.js')
  const schema = await import('../../../db/schema/index.js')

  await appDb.insert(schema.gstRates).values([
    {
      businessId,
      category: 'general_8',
      rate: '0.0800',
      validFrom: '2023-01-01',
      validTo: null,
      createdBy: userId,
      updatedBy: userId,
    },
    {
      businessId,
      category: 'tourism_16',
      rate: '0.1600',
      validFrom: '2023-01-01',
      validTo: '2025-06-30',
      createdBy: userId,
      updatedBy: userId,
    },
    {
      businessId,
      category: 'tourism_17',
      rate: '0.1700',
      validFrom: '2025-07-01',
      validTo: null,
      createdBy: userId,
      updatedBy: userId,
    },
    {
      businessId,
      category: 'zero',
      rate: '0.0000',
      validFrom: '2023-01-01',
      validTo: null,
      createdBy: userId,
      updatedBy: userId,
    },
    {
      businessId,
      category: 'exempt',
      rate: '0.0000',
      validFrom: '2023-01-01',
      validTo: null,
      createdBy: userId,
      updatedBy: userId,
    },
  ])
}

function authHeaders(token: string) {
  return { 'Content-Type': 'application/json', Cookie: `session=${token}` }
}

// ─── Rate resolution: 2025-07-01 boundary ────────────────────────────────────

describe('gst — rateAt across 2025-07-01 boundary', () => {
  it('resolves tourism_16 at 0.16 on 2025-06-30', async () => {
    const { business, user } = await seedBusiness()
    await seedMiraRates(business.id, user.id)
    const svc = await import('../service.js')

    const rate = await svc.rateAt(business.id, 'tourism_16', '2025-06-30')
    expect(rate.toFixed(4)).toBe('0.1600')
  })

  it('resolves tourism_17 at 0.17 on 2025-07-01', async () => {
    const { business, user } = await seedBusiness()
    await seedMiraRates(business.id, user.id)
    const svc = await import('../service.js')

    const rate = await svc.rateAt(business.id, 'tourism_17', '2025-07-01')
    expect(rate.toFixed(4)).toBe('0.1700')
  })

  it('tourism_16 does not apply on or after 2025-07-01', async () => {
    const { business, user } = await seedBusiness()
    await seedMiraRates(business.id, user.id)
    const svc = await import('../service.js')

    // No tourism_16 row covers 2025-07-01 (validTo = 2025-06-30)
    await expect(svc.rateAt(business.id, 'tourism_16', '2025-07-01')).rejects.toThrow(
      'No GST rate found',
    )
  })

  it('tourism_17 does not apply before 2025-07-01', async () => {
    const { business, user } = await seedBusiness()
    await seedMiraRates(business.id, user.id)
    const svc = await import('../service.js')

    // No tourism_17 row covers 2025-06-30 (validFrom = 2025-07-01)
    await expect(svc.rateAt(business.id, 'tourism_17', '2025-06-30')).rejects.toThrow(
      'No GST rate found',
    )
  })

  it('general_8 resolves 0.08 across the boundary', async () => {
    const { business, user } = await seedBusiness()
    await seedMiraRates(business.id, user.id)
    const svc = await import('../service.js')

    const before = await svc.rateAt(business.id, 'general_8', '2025-06-30')
    const after = await svc.rateAt(business.id, 'general_8', '2025-07-01')
    expect(before.toFixed(4)).toBe('0.0800')
    expect(after.toFixed(4)).toBe('0.0800')
  })

  it('zero and exempt resolve 0.00', async () => {
    const { business, user } = await seedBusiness()
    await seedMiraRates(business.id, user.id)
    const svc = await import('../service.js')

    const z = await svc.rateAt(business.id, 'zero', '2026-01-01')
    const e = await svc.rateAt(business.id, 'exempt', '2026-01-01')
    expect(z.toFixed(4)).toBe('0.0000')
    expect(e.toFixed(4)).toBe('0.0000')
  })

  it('throws NotFoundError when no rate row exists', async () => {
    const { business } = await seedBusiness()
    // no rates seeded
    const svc = await import('../service.js')

    await expect(svc.rateAt(business.id, 'general_8', '2026-01-01')).rejects.toThrow(
      svc.NotFoundError,
    )
  })
})

// ─── Period auto-creation ─────────────────────────────────────────────────────

describe('gst — period auto-creation', () => {
  it('auto-creates monthly period on first assertPeriodOpen', async () => {
    const { business, user, appDb, schema } = await seedBusiness('monthly')
    const svc = await import('../service.js')
    const { eq } = await import('drizzle-orm')

    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }
    await svc.assertPeriodOpen(business.id, '2026-03-15', ctx)

    const periods = await appDb
      .select()
      .from(schema.gstPeriods)
      .where(eq(schema.gstPeriods.businessId, business.id))

    expect(periods).toHaveLength(1)
    expect(periods[0]?.periodStart).toBe('2026-03-01')
    expect(periods[0]?.periodEnd).toBe('2026-03-31')
    expect(periods[0]?.periodType).toBe('monthly')
    expect(periods[0]?.status).toBe('open')
  })

  it('auto-creates quarterly period for Q1', async () => {
    const { business, user } = await seedBusiness('quarterly')
    const svc = await import('../service.js')
    const { db: appDb } = await import('../../../db/client.js')
    const schema = await import('../../../db/schema/index.js')
    const { eq } = await import('drizzle-orm')

    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }
    await svc.assertPeriodOpen(business.id, '2026-02-10', ctx)

    const [period] = await appDb
      .select()
      .from(schema.gstPeriods)
      .where(eq(schema.gstPeriods.businessId, business.id))

    expect(period?.periodStart).toBe('2026-01-01')
    expect(period?.periodEnd).toBe('2026-03-31')
    expect(period?.periodType).toBe('quarterly')
  })

  it('auto-creates quarterly period for Q4', async () => {
    const { business, user } = await seedBusiness('quarterly')
    const svc = await import('../service.js')
    const { db: appDb } = await import('../../../db/client.js')
    const schema = await import('../../../db/schema/index.js')
    const { eq } = await import('drizzle-orm')

    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }
    await svc.assertPeriodOpen(business.id, '2025-11-20', ctx)

    const [period] = await appDb
      .select()
      .from(schema.gstPeriods)
      .where(eq(schema.gstPeriods.businessId, business.id))

    expect(period?.periodStart).toBe('2025-10-01')
    expect(period?.periodEnd).toBe('2025-12-31')
  })

  it('reuses existing period on second call', async () => {
    const { business, user, appDb, schema } = await seedBusiness('monthly')
    const svc = await import('../service.js')
    const { eq } = await import('drizzle-orm')

    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }
    await svc.assertPeriodOpen(business.id, '2026-04-05', ctx)
    await svc.assertPeriodOpen(business.id, '2026-04-20', ctx) // same month

    const periods = await appDb
      .select()
      .from(schema.gstPeriods)
      .where(eq(schema.gstPeriods.businessId, business.id))

    expect(periods).toHaveLength(1)
  })
})

// ─── Period-lock rejection ────────────────────────────────────────────────────

describe('gst — assertPeriodOpen rejects locked period', () => {
  it('throws PeriodLockedError when period is locked', async () => {
    const { business, user, appDb, schema } = await seedBusiness('monthly')
    const svc = await import('../service.js')
    const { eq } = await import('drizzle-orm')
    const { db } = await import('../../../db/client.js')

    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }

    // Auto-create the period
    await svc.assertPeriodOpen(business.id, '2026-01-10', ctx)

    // Lock it directly in the DB
    const [period] = await appDb
      .select()
      .from(schema.gstPeriods)
      .where(eq(schema.gstPeriods.businessId, business.id))
    if (!period) throw new Error('period not found')

    await db
      .update(schema.gstPeriods)
      .set({ status: 'locked', lockedAt: new Date(), lockedBy: user.id, updatedBy: user.id })
      .where(eq(schema.gstPeriods.id, period.id))

    // Should now throw
    await expect(svc.assertPeriodOpen(business.id, '2026-01-15', ctx)).rejects.toThrow(
      svc.PeriodLockedError,
    )
  })

  it('allows open period after unlock', async () => {
    const { business, user, appDb, schema } = await seedBusiness('monthly')
    const svc = await import('../service.js')
    const { eq } = await import('drizzle-orm')

    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }

    // Create and lock via service (lock must use existing period)
    await svc.assertPeriodOpen(business.id, '2026-02-10', ctx)

    const [period] = await appDb
      .select()
      .from(schema.gstPeriods)
      .where(eq(schema.gstPeriods.businessId, business.id))
    if (!period) throw new Error('period not found')

    // Lock via route service function
    await svc.lockPeriod(business.id, period.id, 'MIRA-REF-001', ctx)

    // Unlock
    await svc.unlockPeriod(business.id, period.id, 'Error in filing', ctx)

    // Now assertPeriodOpen should not throw
    await expect(svc.assertPeriodOpen(business.id, '2026-02-15', ctx)).resolves.toBeUndefined()
  })
})

// ─── Route-level tests ────────────────────────────────────────────────────────

describe('gst — GET /gst/rates', () => {
  it('returns seeded rates', async () => {
    const { app } = await import('../../../server.js')
    const { business, user, token } = await seedBusiness()
    await seedMiraRates(business.id, user.id)

    const res = await app.request('/gst/rates', { headers: authHeaders(token) })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Array<{ category: string; rate: string }>
    expect(Array.isArray(body)).toBe(true)
    expect(body.some((r) => r.category === 'general_8')).toBe(true)
    expect(body.some((r) => r.category === 'tourism_17')).toBe(true)
  })

  it('returns 401 without auth', async () => {
    const { app } = await import('../../../server.js')
    const res = await app.request('/gst/rates')
    expect(res.status).toBe(401)
  })
})

describe('gst — POST /gst/rates (admin only)', () => {
  it('admin can create a new rate', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness()

    const res = await app.request('/gst/rates', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ category: 'general_8', rate: '0.0900', validFrom: '2030-01-01' }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { category: string; rate: string; validFrom: string }
    expect(body.category).toBe('general_8')
    expect(body.rate).toBe('0.0900')
  })

  it('returns 400 for invalid rate format', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness()

    const res = await app.request('/gst/rates', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ category: 'general_8', rate: 'abc', validFrom: '2030-01-01' }),
    })
    expect(res.status).toBe(400)
  })
})

describe('gst — GET /gst/periods', () => {
  it('returns empty array when no periods exist', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness()

    const res = await app.request('/gst/periods', { headers: authHeaders(token) })
    expect(res.status).toBe(200)
    const body = (await res.json()) as unknown[]
    expect(Array.isArray(body)).toBe(true)
    expect(body).toHaveLength(0)
  })
})

describe('gst — lock / unlock period routes', () => {
  it('locks a period via POST /gst/periods/:id/lock', async () => {
    const { app } = await import('../../../server.js')
    const { business, user, token } = await seedBusiness()
    const svc = await import('../service.js')

    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }
    await svc.assertPeriodOpen(business.id, '2026-05-10', ctx)
    const periods = await svc.listPeriods(business.id)
    const periodId = periods[0]?.id
    if (!periodId) throw new Error('no period')

    const res = await app.request(`/gst/periods/${periodId}/lock`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ miraReturnRef: 'MIRA-2026-05' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string; miraReturnRef: string }
    expect(body.status).toBe('locked')
    expect(body.miraReturnRef).toBe('MIRA-2026-05')
  })

  it('returns 422 when locking an already-locked period', async () => {
    const { app } = await import('../../../server.js')
    const { business, user, token } = await seedBusiness()
    const svc = await import('../service.js')

    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }
    await svc.assertPeriodOpen(business.id, '2026-06-05', ctx)
    const periods = await svc.listPeriods(business.id)
    const periodId = periods[0]?.id
    if (!periodId) throw new Error('no period')

    await app.request(`/gst/periods/${periodId}/lock`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ miraReturnRef: 'MIRA-2026-06' }),
    })

    // Second lock attempt
    const res = await app.request(`/gst/periods/${periodId}/lock`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ miraReturnRef: 'MIRA-2026-06-DUP' }),
    })
    expect(res.status).toBe(422)
  })

  it('admin can unlock a locked period', async () => {
    const { app } = await import('../../../server.js')
    const { business, user, token } = await seedBusiness()
    const svc = await import('../service.js')

    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }
    await svc.assertPeriodOpen(business.id, '2026-07-20', ctx)
    const periods = await svc.listPeriods(business.id)
    const periodId = periods[0]?.id
    if (!periodId) throw new Error('no period')

    await svc.lockPeriod(business.id, periodId, 'MIRA-REF', ctx)

    const res = await app.request(`/gst/periods/${periodId}/unlock`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ reason: 'Incorrect filing, re-submitting' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('open')
  })

  it('returns 404 for unknown period id', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness()

    const res = await app.request('/gst/periods/00000000-0000-0000-0000-000000000000/lock', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ miraReturnRef: 'MIRA-X' }),
    })
    expect(res.status).toBe(404)
  })
})

// ─── buildReturn end-to-end ───────────────────────────────────────────────────

async function seedReturnFixture() {
  const { business, user, token, appDb, schema } = await seedBusiness('monthly')
  await seedMiraRates(business.id, user.id)

  // Customer
  const [customer] = await appDb
    .insert(schema.customers)
    .values({
      businessId: business.id,
      name: 'Test Customer',
      tin: null,
      email: null,
      phone: null,
      address: null,
      creditTermsDays: '30',
      notes: null,
      createdBy: user.id,
      updatedBy: user.id,
    })
    .returning()
  if (!customer) throw new Error('seed: no customer')

  // Supplier (ABC Supplies, TIN 1234567)
  const [supplier] = await appDb
    .insert(schema.suppliers)
    .values({
      businessId: business.id,
      name: 'ABC Supplies',
      tin: '1234567',
      email: null,
      phone: null,
      address: null,
      paymentTermsDays: '30',
      notes: null,
      createdBy: user.id,
      updatedBy: user.id,
    })
    .returning()
  if (!supplier) throw new Error('seed: no supplier')

  // Invoice 1 (issued 2026-03-10):
  //   Line A: general_8, net=1000.00, gst=80.00, total=1080.00
  //   Line B: zero,      net=200.00,  gst=0.00,  total=200.00
  const [inv1] = await appDb
    .insert(schema.invoices)
    .values({
      businessId: business.id,
      customerId: customer.id,
      invoiceNumber: 'INV-001',
      status: 'issued',
      issueDate: '2026-03-10',
      dueDate: '2026-04-10',
      subtotal: '1200.00',
      gstAmount: '80.00',
      total: '1280.00',
      paidAmount: '0.00',
      createdBy: user.id,
      updatedBy: user.id,
    })
    .returning()
  if (!inv1) throw new Error('seed: no inv1')

  // MVR-denominated (exchangeRate 1) — *Mvr columns mirror gstAmount/lineTotal
  // exactly, same as a real issue() would produce (Phase 30, UPGRADE.md
  // G-10). The GST builder now sums the Mvr columns, not the document-
  // currency ones.
  await appDb.insert(schema.invoiceLines).values([
    {
      businessId: business.id,
      invoiceId: inv1.id,
      description: 'General goods',
      qty: '2',
      unitPrice: '500.00',
      gstCategory: 'general_8',
      gstRate: '0.0800',
      gstAmount: '80.00',
      lineTotal: '1080.00',
      gstAmountMvr: '80.00',
      lineTotalMvr: '1080.00',
      sortOrder: 0,
      createdBy: user.id,
      updatedBy: user.id,
    },
    {
      businessId: business.id,
      invoiceId: inv1.id,
      description: 'Zero-rated item',
      qty: '1',
      unitPrice: '200.00',
      gstCategory: 'zero',
      gstRate: '0.0000',
      gstAmount: '0.00',
      lineTotal: '200.00',
      gstAmountMvr: '0.00',
      lineTotalMvr: '200.00',
      sortOrder: 1,
      createdBy: user.id,
      updatedBy: user.id,
    },
  ])

  // Invoice 2 (issued 2026-03-20): tourism_17, net=1000.00, gst=170.00
  const [inv2] = await appDb
    .insert(schema.invoices)
    .values({
      businessId: business.id,
      customerId: customer.id,
      invoiceNumber: 'INV-002',
      status: 'issued',
      issueDate: '2026-03-20',
      dueDate: '2026-04-20',
      subtotal: '1000.00',
      gstAmount: '170.00',
      total: '1170.00',
      paidAmount: '0.00',
      createdBy: user.id,
      updatedBy: user.id,
    })
    .returning()
  if (!inv2) throw new Error('seed: no inv2')

  await appDb.insert(schema.invoiceLines).values({
    businessId: business.id,
    invoiceId: inv2.id,
    description: 'Tourism service (post-2025-07-01 rate)',
    qty: '1',
    unitPrice: '1000.00',
    gstCategory: 'tourism_17',
    gstRate: '0.1700',
    gstAmount: '170.00',
    lineTotal: '1170.00',
    gstAmountMvr: '170.00',
    lineTotalMvr: '1170.00',
    sortOrder: 0,
    createdBy: user.id,
    updatedBy: user.id,
  })

  // Credit Note (issued 2026-03-15, general_8, net=100.00, gst=8.00)
  const [cn1] = await appDb
    .insert(schema.creditNotes)
    .values({
      businessId: business.id,
      invoiceId: inv1.id,
      customerId: customer.id,
      creditNoteNumber: 'CN-001',
      status: 'issued',
      issueDate: '2026-03-15',
      subtotal: '100.00',
      gstAmount: '8.00',
      total: '108.00',
      reason: 'Partial return',
      createdBy: user.id,
      updatedBy: user.id,
    })
    .returning()
  if (!cn1) throw new Error('seed: no cn1')

  await appDb.insert(schema.creditNoteLines).values({
    businessId: business.id,
    creditNoteId: cn1.id,
    description: 'Partial return',
    qty: '1',
    unitPrice: '100.00',
    gstCategory: 'general_8',
    gstRate: '0.0800',
    gstAmount: '8.00',
    lineTotal: '108.00',
    gstAmountMvr: '8.00',
    lineTotalMvr: '108.00',
    sortOrder: 0,
    createdBy: user.id,
    updatedBy: user.id,
  })

  // Bill (confirmed 2026-03-12, ABC Supplies, general_8, net=500.00, gst=40.00)
  const [bill1] = await appDb
    .insert(schema.bills)
    .values({
      businessId: business.id,
      supplierId: supplier.id,
      billNumber: 'BILL-001',
      supplierRef: 'SUP-REF-001',
      status: 'confirmed',
      billDate: '2026-03-12',
      dueDate: '2026-04-12',
      subtotal: '500.00',
      inputGstAmount: '40.00',
      total: '540.00',
      paidAmount: '0.00',
      createdBy: user.id,
      updatedBy: user.id,
    })
    .returning()
  if (!bill1) throw new Error('seed: no bill1')

  await appDb.insert(schema.billLines).values({
    businessId: business.id,
    billId: bill1.id,
    description: 'Office supplies',
    qty: '5',
    unitCost: '100.00',
    gstCategory: 'general_8',
    gstRate: '0.0800',
    gstAmount: '40.00',
    lineTotal: '540.00',
    sortOrder: 0,
    createdBy: user.id,
    updatedBy: user.id,
  })

  // GST period for March 2026
  const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }
  const svcMod = await import('../service.js')
  await svcMod.assertPeriodOpen(business.id, '2026-03-10', ctx)
  const periods = await svcMod.listPeriods(business.id)
  const period = periods[0]
  if (!period) throw new Error('seed: no period')

  return { business, user, token, appDb, schema, period, ctx }
}

describe('gst — buildReturn', () => {
  it('produces correct MIRA 205 and 206 summaries with manually-computed totals', async () => {
    const { business, period, ctx } = await seedReturnFixture()
    const svcMod = await import('../service.js')

    const gstReturn = await svcMod.buildReturn(business.id, period.id, ctx)

    expect(gstReturn.periodId).toBe(period.id)

    const summary = gstReturn.summaryJson as {
      mira205: {
        taxableSuppliesStandardRate: string
        outputTax: string
        zeroRatedSupplies: string
        totalOutputTax: string
        inputTax: string
        netTaxPayable: string
      }
      mira206: {
        taxableSupplies17: string
        outputTax17: string
        totalOutputTax: string
        netTaxPayable: string
      }
      inputTaxRows: Array<{
        supplierTin: string
        supplierName: string
        totalPurchases: string
        inputGst: string
      }>
    }

    // MIRA 205 (general_8):
    // Output: inv1 general_8 net=1000.00, gst=80.00
    // Less CN: net=100.00, gst=8.00  → net=900.00, tax=72.00
    // Zero-rated: inv1 zero net=200.00 (no CN) → 200.00
    // Input: bill general_8 gst=40.00
    // Net payable: 72.00 - 40.00 = 32.00
    expect(summary.mira205).toBeTruthy()
    expect(summary.mira205.taxableSuppliesStandardRate).toBe('900.00')
    expect(summary.mira205.outputTax).toBe('72.00')
    expect(summary.mira205.zeroRatedSupplies).toBe('200.00')
    expect(summary.mira205.totalOutputTax).toBe('72.00')
    expect(summary.mira205.inputTax).toBe('40.00')
    expect(summary.mira205.netTaxPayable).toBe('32.00')

    // MIRA 206 (tourism_17):
    // Output: inv2 tourism_17 net=1000.00, gst=170.00 (no CN)
    // Input: no tourism bills → 0.00
    // Net payable: 170.00
    expect(summary.mira206).toBeTruthy()
    expect(summary.mira206.taxableSupplies17).toBe('1000.00')
    expect(summary.mira206.outputTax17).toBe('170.00')
    expect(summary.mira206.totalOutputTax).toBe('170.00')
    expect(summary.mira206.netTaxPayable).toBe('170.00')

    // Input Tax Statement: one supplier row
    expect(summary.inputTaxRows).toHaveLength(1)
    expect(summary.inputTaxRows[0]?.supplierTin).toBe('1234567')
    expect(summary.inputTaxRows[0]?.supplierName).toBe('ABC Supplies')
    expect(summary.inputTaxRows[0]?.totalPurchases).toBe('500.00')
    expect(summary.inputTaxRows[0]?.inputGst).toBe('40.00')
  })

  it('stores the ITS CSV file reference and marks period as built', async () => {
    const { business, period, ctx, appDb, schema } = await seedReturnFixture()
    const svcMod = await import('../service.js')
    const { eq } = await import('drizzle-orm')

    const gstReturn = await svcMod.buildReturn(business.id, period.id, ctx)

    // Files array has ITS entry
    const storedFiles = gstReturn.files as Array<{ kind: string; fileId: string }>
    expect(storedFiles).toHaveLength(1)
    expect(storedFiles[0]?.kind).toBe('its')

    // Period status updated to 'built'
    const [updatedPeriod] = await appDb
      .select()
      .from(schema.gstPeriods)
      .where(eq(schema.gstPeriods.id, period.id))
    expect(updatedPeriod?.status).toBe('built')
  })

  it('writes audit row for gst.return_built', async () => {
    const { business, period, ctx, appDb, schema } = await seedReturnFixture()
    const svcMod = await import('../service.js')
    const { and, eq } = await import('drizzle-orm')

    await svcMod.buildReturn(business.id, period.id, ctx)

    const logs = await appDb
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.businessId, business.id),
          eq(schema.auditLogs.action, 'gst.return_built'),
        ),
      )
    expect(logs.length).toBeGreaterThan(0)
    expect(logs[0]?.entityType).toBe('gst_return')
  })

  it('getLatestReturn returns the built return', async () => {
    const { business, period, ctx } = await seedReturnFixture()
    const svcMod = await import('../service.js')

    const built = await svcMod.buildReturn(business.id, period.id, ctx)
    const latest = await svcMod.getLatestReturn(business.id, period.id)

    expect(latest).not.toBeNull()
    expect(latest?.id).toBe(built.id)
  })

  it('produces mira205=null and mira206=null for a period with no activity', async () => {
    const { business, user } = await seedBusiness('monthly')
    const svcMod = await import('../service.js')

    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }
    await svcMod.assertPeriodOpen(business.id, '2026-04-01', ctx)
    const periods = await svcMod.listPeriods(business.id)
    const period = periods[0]
    if (!period) throw new Error('no period')

    const gstReturn = await svcMod.buildReturn(business.id, period.id, ctx)
    const summary = gstReturn.summaryJson as { mira205: null; mira206: null }
    expect(summary.mira205).toBeNull()
    expect(summary.mira206).toBeNull()
  })

  it('GET /gst/periods/:id/return returns built status and ITS file URL', async () => {
    const { app } = await import('../../../server.js')
    const { business, period, ctx, token } = await seedReturnFixture()
    const svcMod = await import('../service.js')

    await svcMod.buildReturn(business.id, period.id, ctx)

    const res = await app.request(`/gst/periods/${period.id}/return`, {
      headers: authHeaders(token),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      status: string
      files: Array<{ kind: string; url: string }>
    }
    expect(body.status).toBe('built')
    expect(Array.isArray(body.files)).toBe(true)
    expect(body.files.some((f) => f.kind === 'its')).toBe(true)
    expect(body.files[0]?.url).toBeTruthy()
  })
})

describe('gst — audit log', () => {
  it('writes audit row when creating a rate', async () => {
    const { app } = await import('../../../server.js')
    const { business, token, appDb, schema } = await seedBusiness()
    const { eq, and } = await import('drizzle-orm')

    await app.request('/gst/rates', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ category: 'general_8', rate: '0.0850', validFrom: '2031-01-01' }),
    })

    const logs = await appDb
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.businessId, business.id),
          eq(schema.auditLogs.action, 'gst.rate_created'),
        ),
      )

    expect(logs.length).toBeGreaterThan(0)
    expect(logs[0]?.entityType).toBe('gst_rate')
  })
})
