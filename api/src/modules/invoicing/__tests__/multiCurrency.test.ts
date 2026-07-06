import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import postgres from 'postgres'
import { runMigrations } from '../../../db/test-helpers.js'

// Phase 30, UPGRADE.md G-10 — see ARCHITECTURE.md §4.10. Covers the FX-
// specific behavior layered onto invoicing: currency snapshot at
// draft-creation, re-snapshot at issue, realized gain/loss on payment, and
// the MVR-only boundary on the customer credit ledger.

let container: StartedPostgreSqlContainer
let client: ReturnType<typeof postgres>

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  const url = container.getConnectionUri()
  process.env['DATABASE_URL'] = url
  process.env['REDIS_URL'] = process.env['REDIS_URL'] ?? 'redis://localhost:6379'
  process.env['JWT_SECRET'] = 'test-secret-at-least-32-chars-long-xx'
  process.env['FRONTEND_URL'] = 'http://localhost:5173'
  process.env['NODE_ENV'] = 'test'
  await runMigrations(url)
  client = postgres(url, { max: 1 })
}, 60_000)

afterAll(async () => {
  await client?.end()
  await container?.stop()
})

async function seedBusiness() {
  const { db: appDb } = await import('../../../db/client.js')
  const schema = await import('../../../db/schema/index.js')

  const [business] = await appDb
    .insert(schema.businesses)
    .values({
      name: `FX Invoicing Test Biz ${Date.now()}-${Math.random()}`,
      tin: null,
      gstPeriodType: 'monthly',
      allowBackorders: true,
      createdBy: null as unknown as string,
      updatedBy: null as unknown as string,
    })
    .returning()
  if (!business) throw new Error('seed: no business')

  const [user] = await appDb
    .insert(schema.users)
    .values({
      businessId: business.id,
      email: `fxinv+${Date.now()}+${Math.random()}@example.com`,
      name: 'Admin',
      role: 'admin',
      passwordHash: null,
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

  return { business, user }
}

async function seedCustomer(businessId: string, userId: string, currency: 'MVR' | 'USD' = 'MVR') {
  const { db: appDb } = await import('../../../db/client.js')
  const schema = await import('../../../db/schema/index.js')
  const [customer] = await appDb
    .insert(schema.customers)
    .values({
      businessId,
      name: 'FX Test Customer',
      tin: null,
      email: null,
      phone: null,
      address: null,
      creditTermsDays: '30',
      creditLimit: null,
      notes: null,
      currency,
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

describe('multi-currency — invoice draft creation and issue', () => {
  it('computes MVR-equivalent totals at draft creation using the recorded rate', async () => {
    const { business, user } = await seedBusiness()
    const customer = await seedCustomer(business.id, user.id, 'USD')
    const fxSvc = await import('../../exchangeRates/service.js')
    await fxSvc.recordRate(business.id, 'USD', '15.00', '2020-01-01', user.id)

    const invoicingSvc = await import('../service.js')
    const draft = await invoicingSvc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [
          { description: 'Widget', qty: '1.0000', unitPrice: '100.00', gstCategory: 'general_8' },
        ],
      },
      ctxFor(user.id, business.id),
    )

    expect(draft.currency).toBe('USD')
    expect(draft.exchangeRate).toBe('15.000000')
    expect(draft.total).toBe('108.00') // 100 + 8% GST, in USD
    expect(draft.totalMvr).toBe('1620.00') // 108 * 15
    expect(draft.lines[0]?.lineTotalMvr).toBe('1620.00')
  })

  it('re-snapshots the exchange rate at issue time, not the draft-creation rate', async () => {
    const { business, user } = await seedBusiness()
    const customer = await seedCustomer(business.id, user.id, 'USD')
    const fxSvc = await import('../../exchangeRates/service.js')
    // Rate in effect when the draft is created
    await fxSvc.recordRate(business.id, 'USD', '15.00', '2020-01-01', user.id)

    const invoicingSvc = await import('../service.js')
    const draft = await invoicingSvc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [
          { description: 'Widget', qty: '1.0000', unitPrice: '100.00', gstCategory: 'general_8' },
        ],
      },
      ctxFor(user.id, business.id),
    )
    expect(draft.totalMvr).toBe('1620.00') // at 15.00

    // Rate moves before issue
    const today = new Date().toISOString().slice(0, 10)
    await fxSvc.recordRate(business.id, 'USD', '15.50', today, user.id)

    const issued = await invoicingSvc.issue(business.id, draft.id, ctxFor(user.id, business.id))
    expect(issued.exchangeRate).toBe('15.500000')
    expect(issued.totalMvr).toBe('1674.00') // 108 * 15.50, not 15.00
  })

  it("defaults to the customer's own currency when none is specified", async () => {
    const { business, user } = await seedBusiness()
    const customer = await seedCustomer(business.id, user.id, 'USD')
    const fxSvc = await import('../../exchangeRates/service.js')
    await fxSvc.recordRate(business.id, 'USD', '15.00', '2020-01-01', user.id)

    const invoicingSvc = await import('../service.js')
    const draft = await invoicingSvc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [
          { description: 'Widget', qty: '1.0000', unitPrice: '10.00', gstCategory: 'general_8' },
        ],
      },
      ctxFor(user.id, business.id),
    )
    expect(draft.currency).toBe('USD')
  })

  it('throws when issuing a foreign-currency invoice with no recorded exchange rate', async () => {
    const { business, user } = await seedBusiness()
    const customer = await seedCustomer(business.id, user.id, 'USD')
    // No rate recorded at all
    const invoicingSvc = await import('../service.js')
    await expect(
      invoicingSvc.createDraft(
        business.id,
        {
          customerId: customer.id,
          lines: [
            { description: 'Widget', qty: '1.0000', unitPrice: '10.00', gstCategory: 'general_8' },
          ],
        },
        ctxFor(user.id, business.id),
      ),
    ).rejects.toThrow(/exchange rate/)
  })
})

describe('multi-currency — payments, realized gain/loss, and the MVR-only credit ledger', () => {
  it('records a realized gain when the payment-date rate is more favorable than the issue-date rate', async () => {
    const { business, user } = await seedBusiness()
    const customer = await seedCustomer(business.id, user.id, 'USD')
    const fxSvc = await import('../../exchangeRates/service.js')
    await fxSvc.recordRate(business.id, 'USD', '15.00', '2026-01-01', user.id)

    const invoicingSvc = await import('../service.js')
    const draft = await invoicingSvc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [
          { description: 'Widget', qty: '1.0000', unitPrice: '100.00', gstCategory: 'general_8' },
        ],
      },
      ctxFor(user.id, business.id),
    )
    const issued = await invoicingSvc.issue(business.id, draft.id, ctxFor(user.id, business.id))
    expect(issued.totalMvr).toBe('1620.00') // 108 USD * 15.00

    // Rate moves favorably before payment
    await fxSvc.recordRate(business.id, 'USD', '15.50', '2026-01-15', user.id)
    const payment = await invoicingSvc.addPayment(
      business.id,
      issued.id,
      { amount: '108.00', method: 'bank_transfer', paidAt: '2026-01-15' },
      ctxFor(user.id, business.id),
    )
    expect(payment.amountMvr).toBe('1674.00') // 108 * 15.50

    const gainLossRows = await fxSvc.listGainLossByInvoice(business.id, issued.id)
    expect(gainLossRows).toHaveLength(1)
    expect(gainLossRows[0]?.amount).toBe('54.00') // 1674.00 - 1620.00 gain
  })

  it('MVR invoices never generate a realized gain/loss row (exchangeRate always 1)', async () => {
    const { business, user } = await seedBusiness()
    const customer = await seedCustomer(business.id, user.id, 'MVR')
    const invoicingSvc = await import('../service.js')
    const draft = await invoicingSvc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [
          { description: 'Widget', qty: '1.0000', unitPrice: '100.00', gstCategory: 'general_8' },
        ],
      },
      ctxFor(user.id, business.id),
    )
    const issued = await invoicingSvc.issue(business.id, draft.id, ctxFor(user.id, business.id))
    await invoicingSvc.addPayment(
      business.id,
      issued.id,
      { amount: '108.00', method: 'bank_transfer', paidAt: '2026-01-15' },
      ctxFor(user.id, business.id),
    )

    const fxSvc = await import('../../exchangeRates/service.js')
    const gainLossRows = await fxSvc.listGainLossByInvoice(business.id, issued.id)
    expect(gainLossRows).toHaveLength(0)
  })

  it('grants an overpayment on a foreign-currency invoice as MVR-equivalent credit, not the raw document-currency amount', async () => {
    const { business, user } = await seedBusiness()
    const customer = await seedCustomer(business.id, user.id, 'USD')
    const fxSvc = await import('../../exchangeRates/service.js')
    await fxSvc.recordRate(business.id, 'USD', '15.00', '2026-01-01', user.id)

    const invoicingSvc = await import('../service.js')
    const draft = await invoicingSvc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [
          { description: 'Widget', qty: '1.0000', unitPrice: '100.00', gstCategory: 'general_8' },
        ],
      },
      ctxFor(user.id, business.id),
    )
    const issued = await invoicingSvc.issue(business.id, draft.id, ctxFor(user.id, business.id))

    // Overpay by 10 USD at the same 15.00 rate
    await invoicingSvc.addPayment(
      business.id,
      issued.id,
      { amount: '118.00', method: 'bank_transfer', paidAt: '2026-01-01' },
      ctxFor(user.id, business.id),
    )

    const customerCreditsSvc = await import('../../customerCredits/service.js')
    const balance = await customerCreditsSvc.getBalance(business.id, customer.id)
    // customer_credits is MVR-only — 10 USD overpayment at 15.00 = 150.00 MVR,
    // never '10.00' (which would be treating USD as if it were MVR).
    expect(balance).toBe('150.00')
  })

  it('rejects applying customer credit to a non-MVR invoice', async () => {
    const { business, user } = await seedBusiness()
    const customer = await seedCustomer(business.id, user.id, 'USD')
    const fxSvc = await import('../../exchangeRates/service.js')
    await fxSvc.recordRate(business.id, 'USD', '15.00', '2026-01-01', user.id)

    const customerCreditsSvc = await import('../../customerCredits/service.js')
    await customerCreditsSvc.recordAdvance(
      business.id,
      customer.id,
      '500.00',
      'test advance',
      ctxFor(user.id, business.id),
    )

    const invoicingSvc = await import('../service.js')
    const draft = await invoicingSvc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [
          { description: 'Widget', qty: '1.0000', unitPrice: '100.00', gstCategory: 'general_8' },
        ],
      },
      ctxFor(user.id, business.id),
    )
    const issued = await invoicingSvc.issue(business.id, draft.id, ctxFor(user.id, business.id))

    await expect(
      invoicingSvc.applyCreditToInvoice(
        business.id,
        issued.id,
        '50.00',
        ctxFor(user.id, business.id),
      ),
    ).rejects.toThrow(invoicingSvc.ValidationError)
  })

  it('voiding a foreign-currency invoice with an active payment grants MVR-equivalent credit', async () => {
    const { business, user } = await seedBusiness()
    const customer = await seedCustomer(business.id, user.id, 'USD')
    const fxSvc = await import('../../exchangeRates/service.js')
    await fxSvc.recordRate(business.id, 'USD', '15.00', '2026-01-01', user.id)

    const invoicingSvc = await import('../service.js')
    const draft = await invoicingSvc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [
          { description: 'Widget', qty: '1.0000', unitPrice: '100.00', gstCategory: 'general_8' },
        ],
      },
      ctxFor(user.id, business.id),
    )
    const issued = await invoicingSvc.issue(business.id, draft.id, ctxFor(user.id, business.id))
    // Partial payment — leaves the invoice 'partially_paid' (voidInvoice
    // rejects 'paid' invoices), still enough to exercise the credit grant.
    await invoicingSvc.addPayment(
      business.id,
      issued.id,
      { amount: '50.00', method: 'bank_transfer', paidAt: '2026-01-01' },
      ctxFor(user.id, business.id),
    )

    await invoicingSvc.voidInvoice(
      business.id,
      issued.id,
      'customer request',
      ctxFor(user.id, business.id),
    )

    const customerCreditsSvc = await import('../../customerCredits/service.js')
    const balance = await customerCreditsSvc.getBalance(business.id, customer.id)
    // 50 USD * 15.00 = 750.00 MVR credit, not '50.00'
    expect(balance).toBe('750.00')
  })
})
