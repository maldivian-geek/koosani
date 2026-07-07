import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import postgres from 'postgres'
import * as argon2 from 'argon2'
import jwt from 'jsonwebtoken'
import { runMigrations } from '../../../db/test-helpers.js'

// ─── Container setup ──────────────────────────────────────────────────────────

let container: StartedPostgreSqlContainer
let client: ReturnType<typeof postgres>

const JWT_SECRET = 'test-secret-at-least-32-chars-long-xx'

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  const url = container.getConnectionUri()
  process.env['DATABASE_URL'] = url
  process.env['REDIS_URL'] = process.env['REDIS_URL'] ?? 'redis://localhost:6379'
  process.env['JWT_SECRET'] = JWT_SECRET
  process.env['FRONTEND_URL'] = 'http://localhost:5173'
  process.env['NODE_ENV'] = 'test'
  await runMigrations(url)
  client = postgres(url, { max: 1 })
}, 60_000)

afterAll(async () => {
  await client?.end()
  await container?.stop()
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function seedBusiness(allowBackorders = true) {
  const { db: appDb } = await import('../../../db/client.js')
  const schema = await import('../../../db/schema/index.js')

  const [business] = await appDb
    .insert(schema.businesses)
    .values({
      name: `Inv Test Biz ${Date.now()}`,
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

async function seedRates(businessId: string, userId: string) {
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

async function seedCustomer(businessId: string, userId: string) {
  const { db: appDb } = await import('../../../db/client.js')
  const schema = await import('../../../db/schema/index.js')
  const [customer] = await appDb
    .insert(schema.customers)
    .values({
      businessId,
      name: 'Test Customer',
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

async function seedItem(businessId: string, userId: string, gstCategory = 'general_8') {
  const { db: appDb } = await import('../../../db/client.js')
  const schema = await import('../../../db/schema/index.js')
  const [item] = await appDb
    .insert(schema.items)
    .values({
      businessId,
      sku: `SKU-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: 'Test Item',
      unit: 'pcs',
      gstCategory: gstCategory as 'general_8',
      createdBy: userId,
      updatedBy: userId,
    })
    .returning()
  if (!item) throw new Error('seed: no item')
  return item
}

async function addStock(businessId: string, itemId: string, qty: string, userId: string) {
  const { db: appDb } = await import('../../../db/client.js')
  const schema = await import('../../../db/schema/index.js')
  await appDb.insert(schema.stockMovements).values({
    businessId,
    itemId,
    qty,
    source: 'adjustment',
    sourceId: null,
    reason: 'Test stock',
    createdBy: userId,
  })
}

function authHeaders(token: string) {
  return { 'Content-Type': 'application/json', Cookie: `session=${token}` }
}

// ─── computeTotals (pure math) ────────────────────────────────────────────────

describe('computeTotals', () => {
  it('calculates mixed GST categories correctly', async () => {
    const { computeTotals } = await import('../service.js')

    // Line 1: 5 units @ 100.00 with general_8 (8% GST)
    // taxableValue = 500.00, gst = 40.00, lineTotal = 540.00
    // Line 2: 3 units @ 200.00 with zero (0% GST)
    // taxableValue = 600.00, gst = 0.00, lineTotal = 600.00
    const totals = computeTotals([
      { qty: '5.0000', unitPrice: '100.00', gstAmount: '40.00' },
      { qty: '3.0000', unitPrice: '200.00', gstAmount: '0.00' },
    ])

    expect(totals.subtotal).toBe('1100.00')
    expect(totals.gstAmount).toBe('40.00')
    expect(totals.total).toBe('1140.00')
  })

  it('rounds per-line GST before summing', async () => {
    const { computeTotals } = await import('../service.js')
    const { gstFor } = await import('@koosani/shared')

    // Verify gstFor rounds correctly before summing
    const line1 = gstFor('33.33', '0.08') // 33.33 * 0.08 = 2.6664 → rounds to 2.67
    const line2 = gstFor('33.33', '0.08') // same
    // sum of per-line gst = 2.67 + 2.67 = 5.34 (NOT 4 * 33.33 * 0.08 = 5.33)

    const totals = computeTotals([
      { qty: '1.0000', unitPrice: '33.33', gstAmount: line1.gst },
      { qty: '1.0000', unitPrice: '33.33', gstAmount: line2.gst },
    ])

    expect(totals.gstAmount).toBe('5.34') // per-line rounding, not aggregate rounding
  })
})

// ─── Service layer ────────────────────────────────────────────────────────────

describe('createDraft', () => {
  it('creates invoice and lines with preliminary GST rates', async () => {
    const { business, user } = await seedBusiness()
    await seedRates(business.id, user.id)
    const customer = await seedCustomer(business.id, user.id)

    const svc = await import('../service.js')
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }

    const result = await svc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [
          { description: 'Widget', qty: '5.0000', unitPrice: '100.00', gstCategory: 'general_8' },
        ],
      },
      ctx,
    )

    expect(result.status).toBe('draft')
    expect(result.invoiceNumber).toBeNull()
    expect(result.lines).toHaveLength(1)
    expect(result.total).toBe('540.00') // 500 + 40 GST
    expect(result.gstAmount).toBe('40.00')
    expect(result.subtotal).toBe('500.00')
  })

  it('throws NotFoundError for unknown customer', async () => {
    const { business, user } = await seedBusiness()
    await seedRates(business.id, user.id)

    const svc = await import('../service.js')
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }

    await expect(
      svc.createDraft(
        business.id,
        {
          customerId: '00000000-0000-0000-0000-000000000000',
          lines: [
            { description: 'X', qty: '1.0000', unitPrice: '10.00', gstCategory: 'general_8' },
          ],
        },
        ctx,
      ),
    ).rejects.toThrow('not found')
  })
})

describe('issue', () => {
  it('allocates invoice number, snapshots GST, commits stock', async () => {
    const { business, user } = await seedBusiness(false)
    await seedRates(business.id, user.id)
    const customer = await seedCustomer(business.id, user.id)
    const item = await seedItem(business.id, user.id)
    await addStock(business.id, item.id, '20.0000', user.id)

    const svc = await import('../service.js')
    const invRepo = await import('../repository.js')
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }

    const draft = await svc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [
          {
            itemId: item.id,
            description: 'Widget',
            qty: '5.0000',
            unitPrice: '100.00',
            gstCategory: 'general_8',
          },
        ],
      },
      ctx,
    )

    const issued = await svc.issue(business.id, draft.id, ctx)

    expect(issued.status).toBe('issued')
    expect(issued.invoiceNumber).toMatch(/^INV-\d{6}$/)
    expect(issued.issueDate).toBeTruthy()

    // Check lines have snapshotted gstRate
    const lines = await invRepo.getLinesByInvoice(business.id, issued.id)
    expect(lines[0]?.gstRate).toBe('0.0800')

    // Verify a second call is rejected (stock committed exactly once guard)
    await expect(svc.issue(business.id, draft.id, ctx)).rejects.toThrow('Only draft')
  })

  it('allocates sequential invoice numbers', async () => {
    const { business, user } = await seedBusiness()
    await seedRates(business.id, user.id)
    const customer = await seedCustomer(business.id, user.id)

    const svc = await import('../service.js')
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }

    const lineSpec = {
      description: 'X',
      qty: '1.0000',
      unitPrice: '10.00',
      gstCategory: 'general_8' as const,
    }
    const d1 = await svc.createDraft(
      business.id,
      { customerId: customer.id, lines: [lineSpec] },
      ctx,
    )
    const d2 = await svc.createDraft(
      business.id,
      { customerId: customer.id, lines: [lineSpec] },
      ctx,
    )

    const [i1, i2] = await Promise.all([
      svc.issue(business.id, d1.id, ctx),
      svc.issue(business.id, d2.id, ctx),
    ])

    // Numbers must be unique and sequential (advisory lock ensures no collision)
    const nums = [i1.invoiceNumber, i2.invoiceNumber].map((n) => Number(n!.slice(4)))
    expect(new Set(nums).size).toBe(2)
    expect(Math.max(...nums) - Math.min(...nums)).toBe(1)
  })

  it('rejects issue if period is locked', async () => {
    const { business, user } = await seedBusiness()
    await seedRates(business.id, user.id)
    const customer = await seedCustomer(business.id, user.id)

    const svc = await import('../service.js')
    const gstSvc = await import('../../gst/service.js')
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }

    const draft = await svc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [{ description: 'X', qty: '1.0000', unitPrice: '10.00', gstCategory: 'general_8' }],
      },
      ctx,
    )

    // Force-create and lock the current period
    const today = (await import('@koosani/shared')).todayMv()
    await gstSvc.assertPeriodOpen(business.id, today, ctx)
    const periods = await gstSvc.listPeriods(business.id)
    await gstSvc.lockPeriod(business.id, periods[0]!.id, 'MIRA-001', ctx)

    await expect(svc.issue(business.id, draft.id, ctx)).rejects.toThrow('locked')
  })

  it('rejects if stock would go negative', async () => {
    const { business, user } = await seedBusiness(false) // no backorders
    await seedRates(business.id, user.id)
    const customer = await seedCustomer(business.id, user.id)
    const item = await seedItem(business.id, user.id)
    // Only 2 units on hand; invoice asks for 5

    const svc = await import('../service.js')
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }

    const draft = await svc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [
          {
            itemId: item.id,
            description: 'Widget',
            qty: '5.0000',
            unitPrice: '100.00',
            gstCategory: 'general_8',
          },
        ],
      },
      ctx,
    )

    await expect(svc.issue(business.id, draft.id, ctx)).rejects.toThrow('Insufficient stock')
  })
})

describe('voidInvoice', () => {
  it('creates reversing CN, reverses stock, marks invoice voided', async () => {
    const { business, user } = await seedBusiness(false)
    await seedRates(business.id, user.id)
    const customer = await seedCustomer(business.id, user.id)
    const item = await seedItem(business.id, user.id)
    await addStock(business.id, item.id, '20.0000', user.id)

    const svc = await import('../service.js')
    const invRepo = await import('../repository.js')
    const { db: appDb } = await import('../../../db/client.js')
    const schema = await import('../../../db/schema/index.js')
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }

    const draft = await svc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [
          {
            itemId: item.id,
            description: 'Widget',
            qty: '5.0000',
            unitPrice: '100.00',
            gstCategory: 'general_8',
          },
        ],
      },
      ctx,
    )
    const issued = await svc.issue(business.id, draft.id, ctx)
    const voided = await svc.voidInvoice(business.id, issued.id, 'Test void', ctx)

    expect(voided.status).toBe('voided')
    expect(voided.voidReason).toBe('Test void')

    // Credit note was created and issued
    const cns = await invRepo.listCreditNotesByInvoice(business.id, issued.id)
    expect(cns).toHaveLength(1)
    expect(cns[0]!.status).toBe('issued')
    expect(cns[0]!.creditNoteNumber).toMatch(/^CN-\d{6}$/)
    expect(cns[0]!.total).toBe(issued.total)

    // Stock was returned: 20 original - 5 sold + 5 reversed = 20
    const { eq: eqFn, and: andFn } = await import('drizzle-orm')
    const [itemRow] = await appDb
      .select({ stockOnHand: schema.items.stockOnHand })
      .from(schema.items)
      .where(andFn(eqFn(schema.items.businessId, business.id), eqFn(schema.items.id, item.id)))
    expect(itemRow?.stockOnHand).toBe('20.0000')
  })

  it('rejects voiding a draft invoice', async () => {
    const { business, user } = await seedBusiness()
    await seedRates(business.id, user.id)
    const customer = await seedCustomer(business.id, user.id)

    const svc = await import('../service.js')
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }

    const draft = await svc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [{ description: 'X', qty: '1.0000', unitPrice: '10.00', gstCategory: 'general_8' }],
      },
      ctx,
    )

    await expect(svc.voidInvoice(business.id, draft.id, 'reason', ctx)).rejects.toThrow(
      'Only issued',
    )
  })

  // UPGRADE.md F-14 — money already received must be reversed before voiding
  it('voids an invoice with active payments by reversing them and granting customer credit (UPGRADE.md F-14)', async () => {
    const { business, user } = await seedBusiness()
    await seedRates(business.id, user.id)
    const customer = await seedCustomer(business.id, user.id)

    const svc = await import('../service.js')
    const creditsSvc = await import('../../customerCredits/service.js')
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }
    const { todayMv } = await import('@koosani/shared')

    const draft = await svc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [{ description: 'X', qty: '1.0000', unitPrice: '100.00', gstCategory: 'general_8' }],
      },
      ctx,
    )
    const issued = await svc.issue(business.id, draft.id, ctx)
    const payment = await svc.addPayment(
      business.id,
      issued.id,
      { amount: '50.00', method: 'cash', paidAt: todayMv() },
      ctx,
    )

    const voided = await svc.voidInvoice(business.id, issued.id, 'reason', ctx)
    expect(voided.status).toBe('voided')
    expect(voided.paidAmount).toBe('0.00')

    // The payment was reversed, not left dangling against a voided document
    const invoiceAfter = await svc.getInvoice(business.id, issued.id)
    const reversedPayment = invoiceAfter.payments.find((p) => p.id === payment.id)
    expect(reversedPayment?.reversedAt).not.toBeNull()

    // And the customer was made whole via a credit ledger entry, not left short
    const balance = await creditsSvc.getBalance(business.id, customer.id)
    expect(balance).toBe('50.00')
    const ledger = await creditsSvc.listLedger(business.id, customer.id)
    expect(ledger).toHaveLength(1)
    expect(ledger[0]?.kind).toBe('voided_invoice')
    expect(ledger[0]?.amount).toBe('50.00')
  })
})

describe('addPayment / reversePayment', () => {
  it('marks invoice paid and reverts on reversal', async () => {
    const { business, user } = await seedBusiness()
    await seedRates(business.id, user.id)
    const customer = await seedCustomer(business.id, user.id)

    const svc = await import('../service.js')
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }
    const { todayMv } = await import('@koosani/shared')
    const today = todayMv()

    const draft = await svc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [{ description: 'X', qty: '1.0000', unitPrice: '100.00', gstCategory: 'general_8' }],
      },
      ctx,
    )
    const issued = await svc.issue(business.id, draft.id, ctx)

    const payment = await svc.addPayment(
      business.id,
      issued.id,
      {
        amount: '108.00',
        method: 'bank_transfer',
        paidAt: today,
      },
      ctx,
    )

    expect(payment.amount).toBe('108.00')

    const invoiceAfterPay = await svc.getInvoice(business.id, issued.id)
    expect(invoiceAfterPay.status).toBe('paid')
    expect(invoiceAfterPay.paidAmount).toBe('108.00')

    // Reverse the payment
    await svc.reversePayment(business.id, issued.id, payment.id, ctx)
    const invoiceAfterReversal = await svc.getInvoice(business.id, issued.id)
    expect(invoiceAfterReversal.status).toBe('issued')
    expect(invoiceAfterReversal.paidAmount).toBe('0.00')
  })

  it('marks partial payment as partially_paid', async () => {
    const { business, user } = await seedBusiness()
    await seedRates(business.id, user.id)
    const customer = await seedCustomer(business.id, user.id)

    const svc = await import('../service.js')
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }
    const { todayMv } = await import('@koosani/shared')

    const draft = await svc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [{ description: 'X', qty: '1.0000', unitPrice: '100.00', gstCategory: 'general_8' }],
      },
      ctx,
    )
    const issued = await svc.issue(business.id, draft.id, ctx)

    await svc.addPayment(
      business.id,
      issued.id,
      { amount: '50.00', method: 'cash', paidAt: todayMv() },
      ctx,
    )
    const after = await svc.getInvoice(business.id, issued.id)
    expect(after.status).toBe('partially_paid')
    expect(after.paidAmount).toBe('50.00')
  })

  // UPGRADE.md F-15 — paid_amount must never exceed the invoice total, but an
  // overpayment is no longer rejected: it's capped at outstanding and the
  // excess becomes customer credit (properly resolves F-15, Phase 27).
  it('caps an overpayment at the outstanding balance and credits the excess', async () => {
    const { business, user } = await seedBusiness()
    await seedRates(business.id, user.id)
    const customer = await seedCustomer(business.id, user.id)

    const svc = await import('../service.js')
    const creditsSvc = await import('../../customerCredits/service.js')
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }
    const { todayMv } = await import('@koosani/shared')

    const draft = await svc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [{ description: 'X', qty: '1.0000', unitPrice: '100.00', gstCategory: 'general_8' }],
      },
      ctx,
    )
    const issued = await svc.issue(business.id, draft.id, ctx)

    const payment = await svc.addPayment(
      business.id,
      issued.id,
      { amount: '999.00', method: 'cash', paidAt: todayMv() },
      ctx,
    )
    // The invoice's own payment record never exceeds what was outstanding (108.00)
    expect(payment.amount).toBe('108.00')

    const after = await svc.getInvoice(business.id, issued.id)
    expect(after.status).toBe('paid')
    expect(after.paidAmount).toBe('108.00')

    // The 891.00 excess became available credit, not a rejected payment
    const balance = await creditsSvc.getBalance(business.id, customer.id)
    expect(balance).toBe('891.00')
  })

  // UPGRADE.md F-17 — a payment cannot be reversed twice
  it('rejects reversing an already-reversed payment', async () => {
    const { business, user } = await seedBusiness()
    await seedRates(business.id, user.id)
    const customer = await seedCustomer(business.id, user.id)

    const svc = await import('../service.js')
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }
    const { todayMv } = await import('@koosani/shared')

    const draft = await svc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [{ description: 'X', qty: '1.0000', unitPrice: '100.00', gstCategory: 'general_8' }],
      },
      ctx,
    )
    const issued = await svc.issue(business.id, draft.id, ctx)
    const payment = await svc.addPayment(
      business.id,
      issued.id,
      { amount: '108.00', method: 'cash', paidAt: todayMv() },
      ctx,
    )

    await svc.reversePayment(business.id, issued.id, payment.id, ctx)
    await expect(svc.reversePayment(business.id, issued.id, payment.id, ctx)).rejects.toThrow(
      svc.ValidationError,
    )
  })

  // UPGRADE.md F-11 — a reversal is a financial mutation like any other and
  // must respect the GST period lock
  it('rejects reversing a payment once the period is locked', async () => {
    const { business, user } = await seedBusiness()
    await seedRates(business.id, user.id)
    const customer = await seedCustomer(business.id, user.id)

    const svc = await import('../service.js')
    const gstSvc = await import('../../gst/service.js')
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }
    const { todayMv } = await import('@koosani/shared')

    const draft = await svc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [{ description: 'X', qty: '1.0000', unitPrice: '100.00', gstCategory: 'general_8' }],
      },
      ctx,
    )
    const issued = await svc.issue(business.id, draft.id, ctx)
    const payment = await svc.addPayment(
      business.id,
      issued.id,
      { amount: '108.00', method: 'cash', paidAt: todayMv() },
      ctx,
    )

    const periods = await gstSvc.listPeriods(business.id)
    await gstSvc.lockPeriod(business.id, periods[0]!.id, 'MIRA-001', ctx)

    await expect(svc.reversePayment(business.id, issued.id, payment.id, ctx)).rejects.toThrow(
      'locked',
    )
  })
})

// ─── Route tests ─────────────────────────────────────────────────────────────

describe('POST /invoices', () => {
  it('creates a draft invoice and returns 201', async () => {
    const { app } = await import('../../../server.js')
    const { business, user, token } = await seedBusiness()
    await seedRates(business.id, user.id)
    const customer = await seedCustomer(business.id, user.id)

    const res = await app.request('/invoices', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        customerId: customer.id,
        lines: [
          { description: 'Widget', qty: '1.0000', unitPrice: '100.00', gstCategory: 'general_8' },
        ],
      }),
    })

    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['status']).toBe('draft')
    expect(body['invoiceNumber']).toBeNull()
  })

  it('requires auth', async () => {
    const { app } = await import('../../../server.js')
    const res = await app.request('/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customerId: 'x', lines: [] }),
    })
    expect(res.status).toBe(401)
  })

  it('validates body', async () => {
    const { app } = await import('../../../server.js')
    const { business, user, token } = await seedBusiness()
    await seedRates(business.id, user.id)

    const res = await app.request('/invoices', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ customerId: 'not-a-uuid', lines: [] }),
    })
    expect(res.status).toBe(400)
  })
})

describe('GET /invoices/:id', () => {
  it('returns invoice with lines, payments, creditNotes', async () => {
    const { app } = await import('../../../server.js')
    const { business, user, token } = await seedBusiness()
    await seedRates(business.id, user.id)
    const customer = await seedCustomer(business.id, user.id)

    // Create via service
    const svc = await import('../service.js')
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }
    const draft = await svc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [{ description: 'X', qty: '1.0000', unitPrice: '50.00', gstCategory: 'zero' }],
      },
      ctx,
    )

    const res = await app.request(`/invoices/${draft.id}`, { headers: authHeaders(token) })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['id']).toBe(draft.id)
    expect(Array.isArray(body['lines'])).toBe(true)
    expect(Array.isArray(body['payments'])).toBe(true)
    expect(Array.isArray(body['creditNotes'])).toBe(true)
  })

  it('returns 404 for unknown invoice', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness()
    const res = await app.request('/invoices/00000000-0000-0000-0000-000000000000', {
      headers: authHeaders(token),
    })
    expect(res.status).toBe(404)
  })
})

describe('POST /invoices/:id/issue', () => {
  it('issues a draft invoice and returns it with a number', async () => {
    const { app } = await import('../../../server.js')
    const { business, user, token } = await seedBusiness()
    await seedRates(business.id, user.id)
    const customer = await seedCustomer(business.id, user.id)

    const svc = await import('../service.js')
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }
    const draft = await svc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [{ description: 'Y', qty: '2.0000', unitPrice: '50.00', gstCategory: 'zero' }],
      },
      ctx,
    )

    const res = await app.request(`/invoices/${draft.id}/issue`, {
      method: 'POST',
      headers: authHeaders(token),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['status']).toBe('issued')
    expect(typeof body['invoiceNumber']).toBe('string')
  })

  it('returns 422 when issuing an already-issued invoice', async () => {
    const { app } = await import('../../../server.js')
    const { business, user, token } = await seedBusiness()
    await seedRates(business.id, user.id)
    const customer = await seedCustomer(business.id, user.id)

    const svc = await import('../service.js')
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }
    const draft = await svc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [{ description: 'Z', qty: '1.0000', unitPrice: '10.00', gstCategory: 'exempt' }],
      },
      ctx,
    )
    await svc.issue(business.id, draft.id, ctx)

    const res = await app.request(`/invoices/${draft.id}/issue`, {
      method: 'POST',
      headers: authHeaders(token),
    })
    expect(res.status).toBe(422)
  })
})

describe('PATCH /invoices/:id', () => {
  it('updates notes and recomputes totals when lines change', async () => {
    const { app } = await import('../../../server.js')
    const { business, user, token } = await seedBusiness()
    await seedRates(business.id, user.id)
    const customer = await seedCustomer(business.id, user.id)

    const svc = await import('../service.js')
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }
    const draft = await svc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [{ description: 'Old', qty: '1.0000', unitPrice: '10.00', gstCategory: 'zero' }],
      },
      ctx,
    )

    const res = await app.request(`/invoices/${draft.id}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({
        notes: 'Updated',
        lines: [{ description: 'New', qty: '3.0000', unitPrice: '100.00', gstCategory: 'zero' }],
      }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['notes']).toBe('Updated')
    expect(body['total']).toBe('300.00')
  })

  it('returns 422 when patching an issued invoice', async () => {
    const { app } = await import('../../../server.js')
    const { business, user, token } = await seedBusiness()
    await seedRates(business.id, user.id)
    const customer = await seedCustomer(business.id, user.id)

    const svc = await import('../service.js')
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }
    const draft = await svc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [{ description: 'X', qty: '1.0000', unitPrice: '10.00', gstCategory: 'exempt' }],
      },
      ctx,
    )
    await svc.issue(business.id, draft.id, ctx)

    const res = await app.request(`/invoices/${draft.id}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ notes: 'Hack attempt' }),
    })
    expect(res.status).toBe(422)
  })
})

describe('POST /invoices/:id/void', () => {
  it('voids an issued invoice and returns voided status', async () => {
    const { app } = await import('../../../server.js')
    const { business, user, token } = await seedBusiness()
    await seedRates(business.id, user.id)
    const customer = await seedCustomer(business.id, user.id)

    const svc = await import('../service.js')
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }
    const draft = await svc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [{ description: 'X', qty: '1.0000', unitPrice: '100.00', gstCategory: 'zero' }],
      },
      ctx,
    )
    await svc.issue(business.id, draft.id, ctx)

    const res = await app.request(`/invoices/${draft.id}/void`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ reason: 'Wrong customer' }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['status']).toBe('voided')
    expect(body['voidReason']).toBe('Wrong customer')
  })
})

describe('POST /invoices/:id/payments', () => {
  it('records a payment and returns 201', async () => {
    const { app } = await import('../../../server.js')
    const { business, user, token } = await seedBusiness()
    await seedRates(business.id, user.id)
    const customer = await seedCustomer(business.id, user.id)
    const { todayMv } = await import('@koosani/shared')

    const svc = await import('../service.js')
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }
    const draft = await svc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [{ description: 'X', qty: '1.0000', unitPrice: '100.00', gstCategory: 'zero' }],
      },
      ctx,
    )
    await svc.issue(business.id, draft.id, ctx)

    const res = await app.request(`/invoices/${draft.id}/payments`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ amount: '100.00', method: 'cash', paidAt: todayMv() }),
    })
    expect(res.status).toBe(201)
    const body = (await res.json()) as Record<string, unknown>
    expect(body['amount']).toBe('100.00')
  })
})

describe('credit notes', () => {
  it('creates and issues a standalone credit note', async () => {
    const { app } = await import('../../../server.js')
    const { business, user, token } = await seedBusiness()
    await seedRates(business.id, user.id)
    const customer = await seedCustomer(business.id, user.id)

    const svc = await import('../service.js')
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }
    const draft = await svc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [{ description: 'X', qty: '2.0000', unitPrice: '100.00', gstCategory: 'zero' }],
      },
      ctx,
    )
    await svc.issue(business.id, draft.id, ctx)

    // Create CN via route
    const createRes = await app.request('/credit-notes', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        invoiceId: draft.id,
        reason: 'Partial return',
        lines: [
          { description: 'Partial', qty: '1.0000', unitPrice: '100.00', gstCategory: 'zero' },
        ],
      }),
    })
    expect(createRes.status).toBe(201)
    const cn = (await createRes.json()) as Record<string, unknown>
    expect(cn['status']).toBe('draft')

    // Issue CN via route
    const issueRes = await app.request(`/credit-notes/${cn['id']}/issue`, {
      method: 'POST',
      headers: authHeaders(token),
    })
    expect(issueRes.status).toBe(200)
    const issuedCn = (await issueRes.json()) as Record<string, unknown>
    expect(issuedCn['status']).toBe('issued')
    expect(typeof issuedCn['creditNoteNumber']).toBe('string')
    expect((issuedCn['creditNoteNumber'] as string).startsWith('CN-')).toBe(true)
  })

  it('GET /credit-notes returns list', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness()

    const res = await app.request('/credit-notes', { headers: authHeaders(token) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })

  it('GET /credit-notes/:id returns the credit note with its lines', async () => {
    const { app } = await import('../../../server.js')
    const { business, user, token } = await seedBusiness()
    await seedRates(business.id, user.id)
    const customer = await seedCustomer(business.id, user.id)

    const svc = await import('../service.js')
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }
    const draft = await svc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [{ description: 'X', qty: '2.0000', unitPrice: '100.00', gstCategory: 'zero' }],
      },
      ctx,
    )
    await svc.issue(business.id, draft.id, ctx)

    const createRes = await app.request('/credit-notes', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        invoiceId: draft.id,
        reason: 'Damaged goods',
        lines: [
          { description: 'Damaged item', qty: '1.0000', unitPrice: '100.00', gstCategory: 'zero' },
        ],
      }),
    })
    const cn = (await createRes.json()) as Record<string, unknown>

    const getRes = await app.request(`/credit-notes/${cn['id']}`, { headers: authHeaders(token) })
    expect(getRes.status).toBe(200)
    const body = (await getRes.json()) as Record<string, unknown>
    expect(body['id']).toBe(cn['id'])
    expect(Array.isArray(body['lines'])).toBe(true)
    expect((body['lines'] as unknown[]).length).toBe(1)

    const notFoundRes = await app.request(`/credit-notes/${crypto.randomUUID()}`, {
      headers: authHeaders(token),
    })
    expect(notFoundRes.status).toBe(404)
  })

  it('GET /credit-notes list includes the customer name', async () => {
    const { app } = await import('../../../server.js')
    const { business, user, token } = await seedBusiness()
    await seedRates(business.id, user.id)
    const customer = await seedCustomer(business.id, user.id)

    const svc = await import('../service.js')
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }
    const draft = await svc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [{ description: 'X', qty: '1.0000', unitPrice: '50.00', gstCategory: 'zero' }],
      },
      ctx,
    )
    await svc.issue(business.id, draft.id, ctx)
    await app.request('/credit-notes', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        invoiceId: draft.id,
        reason: 'Test',
        lines: [{ description: 'X', qty: '1.0000', unitPrice: '50.00', gstCategory: 'zero' }],
      }),
    })

    const res = await app.request(`/credit-notes?customerId=${customer.id}`, {
      headers: authHeaders(token),
    })
    const body = (await res.json()) as Array<Record<string, unknown>>
    expect(body.length).toBeGreaterThan(0)
    expect(body[0]!['customerName']).toBe(customer.name)
  })

  it('rejects CN against draft invoice', async () => {
    const { app } = await import('../../../server.js')
    const { business, user, token } = await seedBusiness()
    await seedRates(business.id, user.id)
    const customer = await seedCustomer(business.id, user.id)

    const svc = await import('../service.js')
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }
    const draft = await svc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [{ description: 'X', qty: '1.0000', unitPrice: '10.00', gstCategory: 'exempt' }],
      },
      ctx,
    )

    const res = await app.request('/credit-notes', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        invoiceId: draft.id,
        reason: 'Should fail',
        lines: [{ description: 'X', qty: '1.0000', unitPrice: '10.00', gstCategory: 'exempt' }],
      }),
    })
    expect(res.status).toBe(422)
  })
})

describe('immutability after issue', () => {
  it('PATCH on an issued invoice returns 422', async () => {
    const { app } = await import('../../../server.js')
    const { business, user, token } = await seedBusiness()
    await seedRates(business.id, user.id)
    const customer = await seedCustomer(business.id, user.id)

    const svc = await import('../service.js')
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }
    const draft = await svc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [{ description: 'X', qty: '1.0000', unitPrice: '10.00', gstCategory: 'general_8' }],
      },
      ctx,
    )
    await svc.issue(business.id, draft.id, ctx)

    const res = await app.request(`/invoices/${draft.id}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ notes: 'Immutability violation attempt' }),
    })
    expect(res.status).toBe(422)
  })

  it('second issue of same invoice returns 422', async () => {
    const { app } = await import('../../../server.js')
    const { business, user, token } = await seedBusiness()
    await seedRates(business.id, user.id)
    const customer = await seedCustomer(business.id, user.id)

    const svc = await import('../service.js')
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }
    const draft = await svc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [{ description: 'X', qty: '1.0000', unitPrice: '10.00', gstCategory: 'zero' }],
      },
      ctx,
    )
    await svc.issue(business.id, draft.id, ctx)

    const res = await app.request(`/invoices/${draft.id}/issue`, {
      method: 'POST',
      headers: authHeaders(token),
    })
    expect(res.status).toBe(422)
  })
})
