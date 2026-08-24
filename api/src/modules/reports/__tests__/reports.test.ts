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

// ─── Seed helpers ─────────────────────────────────────────────────────────────

async function seedBusiness() {
  const { db: appDb } = await import('../../../db/client.js')
  const schema = await import('../../../db/schema/index.js')

  const [business] = await appDb
    .insert(schema.businesses)
    .values({
      name: `Reports Test Biz ${Date.now()}`,
      tin: null,
      gstPeriodType: 'monthly',
      allowBackorders: true, // avoids stock-check failures in invoicing
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
      email: `rpt+${Date.now()}+${Math.random()}@example.com`,
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
  const [c] = await appDb
    .insert(schema.customers)
    .values({
      businessId,
      name: 'Test Customer',
      tin: null,
      email: null,
      phone: null,
      address: null,
      notes: null,
      createdBy: userId,
      updatedBy: userId,
    })
    .returning()
  if (!c) throw new Error('seed: no customer')
  return c
}

async function seedSupplier(businessId: string, userId: string) {
  const { db: appDb } = await import('../../../db/client.js')
  const schema = await import('../../../db/schema/index.js')
  const [s] = await appDb
    .insert(schema.suppliers)
    .values({
      businessId,
      name: 'Test Supplier',
      tin: '1234567',
      email: null,
      phone: null,
      address: null,
      notes: null,
      createdBy: userId,
      updatedBy: userId,
    })
    .returning()
  if (!s) throw new Error('seed: no supplier')
  return s
}

async function seedItem(businessId: string, userId: string, sku: string, defaultCost = '50.00') {
  const { db: appDb } = await import('../../../db/client.js')
  const schema = await import('../../../db/schema/index.js')
  const [item] = await appDb
    .insert(schema.items)
    .values({
      businessId,
      sku,
      name: `Item ${sku}`,
      unit: 'ea',
      gstCategory: 'general_8',
      defaultPrice: '100.00',
      defaultCost,
      notes: null,
      createdBy: userId,
      updatedBy: userId,
    })
    .returning()
  if (!item) throw new Error('seed: no item')
  return item
}

// ─── Sales register ───────────────────────────────────────────────────────────

describe('reports: sales register', () => {
  it('groupBy=customer — nets invoices minus credit notes', async () => {
    const { business, user } = await seedBusiness()
    await seedRates(business.id, user.id)
    const customer = await seedCustomer(business.id, user.id)
    await seedItem(business.id, user.id, 'SALES-A')

    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: 'test' }

    const { createDraft, issue, createCreditNote, issueCreditNote } =
      await import('../../invoicing/service.js')

    // Invoice 1: qty=10, unitPrice=100, general_8 → subtotal=1000, gst=80, total=1080
    const d1 = await createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [
          { description: 'Widget', qty: '10.0000', unitPrice: '100.00', gstCategory: 'general_8' },
        ],
      },
      ctx,
    )
    await issue(business.id, d1.id, ctx)

    // Invoice 2: qty=5, unitPrice=200, general_8 → subtotal=1000, gst=80, total=1080
    const d2 = await createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [
          { description: 'Widget', qty: '5.0000', unitPrice: '200.00', gstCategory: 'general_8' },
        ],
      },
      ctx,
    )
    const inv2 = await issue(business.id, d2.id, ctx)

    // Credit note against invoice 2: qty=1, unitPrice=200 → taxable=200, gst=16, total=216
    const draftCn = await createCreditNote(
      business.id,
      {
        invoiceId: inv2.id,
        reason: 'Customer return',
        lines: [
          {
            description: 'Widget return',
            qty: '1.0000',
            unitPrice: '200.00',
            gstCategory: 'general_8',
          },
        ],
      },
      ctx,
    )
    await issueCreditNote(business.id, draftCn.id, ctx)

    const { salesReport } = await import('../service.js')
    const today = new Date().toISOString().slice(0, 10)
    const rows = await salesReport(business.id, '2020-01-01', today, 'customer')

    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row.groupKey).toBe(customer.id)
    expect(row.docCount).toBe(2)
    // gross subtotal 2000 − CN 200 = 1800
    expect(row.subtotal).toBe('1800.00')
    // gross gst 160 − CN gst 16 = 144
    expect(row.gstAmount).toBe('144.00')
    // gross total 2160 − CN total 216 = 1944
    expect(row.total).toBe('1944.00')
  })

  it('groupBy=item — groups by description/item', async () => {
    const { business, user } = await seedBusiness()
    await seedRates(business.id, user.id)
    const customer = await seedCustomer(business.id, user.id)
    await seedItem(business.id, user.id, 'ITEM-ALPHA')

    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: 'test' }
    const { createDraft, issue } = await import('../../invoicing/service.js')

    const draft = await createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [
          { description: 'Alpha', qty: '3.0000', unitPrice: '100.00', gstCategory: 'general_8' },
          { description: 'Beta', qty: '2.0000', unitPrice: '50.00', gstCategory: 'general_8' },
        ],
      },
      ctx,
    )
    await issue(business.id, draft.id, ctx)

    const { salesReport } = await import('../service.js')
    const today = new Date().toISOString().slice(0, 10)
    const rows = await salesReport(business.id, '2020-01-01', today, 'item')

    expect(rows.length).toBeGreaterThanOrEqual(2)
    const alphaRow = rows.find((r) => r.label === 'Alpha')
    const betaRow = rows.find((r) => r.label === 'Beta')
    expect(alphaRow).toBeDefined()
    expect(betaRow).toBeDefined()
    // Alpha: 3 × 100 = 300 taxable, gst=24, total=324
    expect(alphaRow!.subtotal).toBe('300.00')
    expect(alphaRow!.gstAmount).toBe('24.00')
    // Beta: 2 × 50 = 100 taxable, gst=8, total=108
    expect(betaRow!.subtotal).toBe('100.00')
    expect(betaRow!.gstAmount).toBe('8.00')
  })

  it('groupBy=day — groups by issue date', async () => {
    const { business, user } = await seedBusiness()
    await seedRates(business.id, user.id)
    const customer = await seedCustomer(business.id, user.id)

    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: 'test' }
    const { createDraft, issue } = await import('../../invoicing/service.js')

    const draft = await createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [
          { description: 'Widget', qty: '1.0000', unitPrice: '500.00', gstCategory: 'general_8' },
        ],
      },
      ctx,
    )
    await issue(business.id, draft.id, ctx)

    const { salesReport } = await import('../service.js')
    const today = new Date().toISOString().slice(0, 10)
    const rows = await salesReport(business.id, today, today, 'day')

    expect(rows.length).toBeGreaterThanOrEqual(1)
    const todayRow = rows.find((r) => r.groupKey === today)
    expect(todayRow).toBeDefined()
    expect(todayRow!.subtotal).not.toBe('0.00')
  })

  it('salesReportCsv — returns CSV with correct headers', async () => {
    const { salesReportCsv } = await import('../service.js')
    const csv = salesReportCsv(
      [
        {
          groupKey: 'id1',
          label: 'Customer A',
          docCount: 2,
          subtotal: '1000.00',
          gstAmount: '80.00',
          total: '1080.00',
        },
      ],
      'customer',
    )
    expect(csv).toContain('Customer,Invoices,Subtotal (MVR),GST (MVR),Total (MVR)')
    expect(csv).toContain('Customer A,2,1000.00,80.00,1080.00')
  })
})

// ─── Purchases register ───────────────────────────────────────────────────────

describe('reports: purchases register', () => {
  it('groupBy=supplier — aggregates confirmed bills', async () => {
    const { business, user } = await seedBusiness()
    await seedRates(business.id, user.id)
    const supplier = await seedSupplier(business.id, user.id)

    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: 'test' }
    const { createDraft, confirmBill } = await import('../../purchases/service.js')

    // Bill 1: qty=10, unitCost=50, general_8 → subtotal=500, gst=40, total=540
    const d1 = await createDraft(
      business.id,
      {
        supplierId: supplier.id,
        lines: [
          { description: 'Supply', qty: '10.0000', unitCost: '50.00', gstCategory: 'general_8' },
        ],
      },
      ctx,
    )
    await confirmBill(business.id, d1.id, ctx)

    // Bill 2: qty=5, unitCost=100, general_8 → subtotal=500, gst=40, total=540
    const d2 = await createDraft(
      business.id,
      {
        supplierId: supplier.id,
        lines: [
          { description: 'Supply', qty: '5.0000', unitCost: '100.00', gstCategory: 'general_8' },
        ],
      },
      ctx,
    )
    await confirmBill(business.id, d2.id, ctx)

    const { purchasesReport } = await import('../service.js')
    const today = new Date().toISOString().slice(0, 10)
    const rows = await purchasesReport(business.id, '2020-01-01', today, 'supplier')

    expect(rows.length).toBeGreaterThanOrEqual(1)
    const supplierRow = rows.find((r) => r.groupKey === supplier.id)
    expect(supplierRow).toBeDefined()
    expect(supplierRow!.docCount).toBe(2)
    // 500 + 500 = 1000 subtotal
    expect(supplierRow!.subtotal).toBe('1000.00')
    expect(supplierRow!.gstAmount).toBe('80.00')
    expect(supplierRow!.total).toBe('1080.00')
  })

  it('groupBy=item — groups confirmed bill lines by item/description', async () => {
    const { business, user } = await seedBusiness()
    await seedRates(business.id, user.id)
    const supplier = await seedSupplier(business.id, user.id)

    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: 'test' }
    const { createDraft, confirmBill } = await import('../../purchases/service.js')

    const d = await createDraft(
      business.id,
      {
        supplierId: supplier.id,
        lines: [
          {
            description: 'Raw Material',
            qty: '20.0000',
            unitCost: '10.00',
            gstCategory: 'general_8',
          },
          { description: 'Packaging', qty: '100.0000', unitCost: '1.00', gstCategory: 'exempt' },
        ],
      },
      ctx,
    )
    await confirmBill(business.id, d.id, ctx)

    const { purchasesReport } = await import('../service.js')
    const today = new Date().toISOString().slice(0, 10)
    const rows = await purchasesReport(business.id, '2020-01-01', today, 'item')

    const rmRow = rows.find((r) => r.label === 'Raw Material')
    const pkgRow = rows.find((r) => r.label === 'Packaging')
    expect(rmRow).toBeDefined()
    expect(pkgRow).toBeDefined()
    // Raw Material: 20×10=200 taxable, gst=16
    expect(rmRow!.subtotal).toBe('200.00')
    expect(rmRow!.gstAmount).toBe('16.00')
    // Packaging: 100×1=100 taxable, exempt gst=0
    expect(pkgRow!.subtotal).toBe('100.00')
    expect(pkgRow!.gstAmount).toBe('0.00')
  })
})

// ─── Stock valuation ──────────────────────────────────────────────────────────

// Helper: create a PO → GRN chain and insert a grn_line + stock_movement.
async function seedGrnMovement(
  businessId: string,
  supplierId: string,
  userId: string,
  itemId: string,
  qty: string,
  unitCost: string,
  movedAt: Date,
): Promise<void> {
  const { db: appDb } = await import('../../../db/client.js')
  const schema = await import('../../../db/schema/index.js')
  const [po] = await appDb
    .insert(schema.purchaseOrders)
    .values({
      businessId,
      supplierId,
      poNumber: `PO-${Date.now()}-${Math.random()}`,
      status: 'approved',
      orderDate: '2026-01-01',
      subtotal: '0.00',
      total: '0.00',
      createdBy: userId,
      updatedBy: userId,
    })
    .returning()
  if (!po) throw new Error('seed: no po')

  const [poLine] = await appDb
    .insert(schema.poLines)
    .values({
      businessId,
      poId: po.id,
      itemId,
      description: 'Test item',
      qtyOrdered: '1000.0000',
      qtyReceived: qty,
      unitCost,
      lineTotal: '0.00',
      createdBy: userId,
      updatedBy: userId,
    })
    .returning()
  if (!poLine) throw new Error('seed: no poLine')

  const [grn] = await appDb
    .insert(schema.grns)
    .values({
      businessId,
      poId: po.id,
      supplierId,
      receivedAt: '2026-01-01',
      createdBy: userId,
      updatedBy: userId,
    })
    .returning()
  if (!grn) throw new Error('seed: no grn')

  const [grnLine] = await appDb
    .insert(schema.grnLines)
    .values({
      businessId,
      grnId: grn.id,
      poLineId: poLine.id,
      itemId,
      qtyReceived: qty,
      unitCost,
      createdBy: userId,
      updatedBy: userId,
    })
    .returning()
  if (!grnLine) throw new Error('seed: no grnLine')

  await appDb.insert(schema.stockMovements).values({
    businessId,
    itemId,
    qty,
    source: 'grn',
    sourceId: grnLine.id,
    movedAt,
    createdBy: userId,
  })
}

describe('reports: stock valuation', () => {
  it('avg method — computes weighted average cost × qty', async () => {
    const { business, user, appDb, schema } = await seedBusiness()
    const supplier = await seedSupplier(business.id, user.id)
    const item = await seedItem(business.id, user.id, 'STOCK-VAL-A', '0.00')

    // Lot 1: qty=10, unitCost=50.00 → cost basis 500
    // Lot 2: qty=10, unitCost=70.00 → cost basis 700
    // Total inQty=20, totalCost=1200, avgCost=60.00
    // One outflow: qty=-5 (invoice)
    // Net stock = 15, value = 15 × 60 = 900
    await seedGrnMovement(
      business.id,
      supplier.id,
      user.id,
      item.id,
      '10.0000',
      '50.00',
      new Date('2026-01-01T00:00:00Z'),
    )
    await seedGrnMovement(
      business.id,
      supplier.id,
      user.id,
      item.id,
      '10.0000',
      '70.00',
      new Date('2026-01-02T00:00:00Z'),
    )

    await appDb.insert(schema.stockMovements).values({
      businessId: business.id,
      itemId: item.id,
      qty: '-5.0000',
      source: 'invoice',
      sourceId: null,
      movedAt: new Date('2026-01-03T00:00:00Z'),
      createdBy: user.id,
    })

    const { stockValuationReport } = await import('../service.js')
    const rows = await stockValuationReport(business.id, '2026-12-31', 'avg')

    const row = rows.find((r) => r.itemId === item.id)
    expect(row).toBeDefined()
    expect(row!.qty).toBe('15.0000')
    expect(row!.avgCost).toBe('60.00')
    expect(row!.value).toBe('900.00')
  })

  it('fifo method — consumes oldest lots first', async () => {
    const { business, user, appDb, schema } = await seedBusiness()
    const supplier = await seedSupplier(business.id, user.id)
    const item = await seedItem(business.id, user.id, 'STOCK-FIFO-B', '0.00')

    // Lot 1: qty=5 @ 40.00 (older)
    // Lot 2: qty=10 @ 80.00 (newer)
    // Outflow: -7 units → consumes all of lot1 (5) + 2 from lot2
    // Remaining: 8 units from lot2 @ 80.00 → value = 640
    await seedGrnMovement(
      business.id,
      supplier.id,
      user.id,
      item.id,
      '5.0000',
      '40.00',
      new Date('2026-02-01T00:00:00Z'),
    )
    await seedGrnMovement(
      business.id,
      supplier.id,
      user.id,
      item.id,
      '10.0000',
      '80.00',
      new Date('2026-02-02T00:00:00Z'),
    )

    await appDb.insert(schema.stockMovements).values({
      businessId: business.id,
      itemId: item.id,
      qty: '-7.0000',
      source: 'invoice',
      sourceId: null,
      movedAt: new Date('2026-02-03T00:00:00Z'),
      createdBy: user.id,
    })

    const { stockValuationReport } = await import('../service.js')
    const rows = await stockValuationReport(business.id, '2026-12-31', 'fifo')

    const row = rows.find((r) => r.itemId === item.id)
    expect(row).toBeDefined()
    expect(row!.qty).toBe('8.0000')
    expect(row!.value).toBe('640.00')
  })

  it('asOf filter excludes future movements', async () => {
    const { business, user, appDb, schema } = await seedBusiness()
    const supplier = await seedSupplier(business.id, user.id)
    const item = await seedItem(business.id, user.id, 'STOCK-ASOF-C', '0.00')

    // Movement within asOf range (2025-06-01 ≤ 2025-12-31)
    await seedGrnMovement(
      business.id,
      supplier.id,
      user.id,
      item.id,
      '100.0000',
      '10.00',
      new Date('2025-06-01T00:00:00Z'),
    )

    // Future movement (2027-01-01 > 2025-12-31) — must be excluded
    await appDb.insert(schema.stockMovements).values({
      businessId: business.id,
      itemId: item.id,
      qty: '500.0000',
      source: 'adjustment',
      sourceId: null,
      movedAt: new Date('2027-01-01T00:00:00Z'),
      createdBy: user.id,
    })

    const { stockValuationReport } = await import('../service.js')
    const rows = await stockValuationReport(business.id, '2025-12-31', 'avg')
    const row = rows.find((r) => r.itemId === item.id)
    expect(row).toBeDefined()
    expect(row!.qty).toBe('100.0000')
  })

  it('stockValuationCsv — correct headers', async () => {
    const { stockValuationCsv } = await import('../service.js')
    const csv = stockValuationCsv(
      [
        {
          itemId: 'x',
          itemName: 'Widget',
          sku: 'W1',
          qty: '10.0000',
          avgCost: '25.00',
          value: '250.00',
        },
      ],
      'avg',
    )
    expect(csv).toContain('SKU,Item,Qty on Hand,Avg Cost (MVR),Value (MVR)')
    expect(csv).toContain('W1,Widget,10.0000,25.00,250.00')
  })
})

// ─── Aged receivables ─────────────────────────────────────────────────────────

describe('reports: aged receivables', () => {
  it('buckets outstanding invoices by days overdue (asOf=2026-05-16)', async () => {
    const { business, user, appDb, schema } = await seedBusiness()
    const customer = await seedCustomer(business.id, user.id)
    const asOf = '2026-05-16'

    // Insert issued invoices directly so we can control dueDate precisely.
    // outstanding = total − paid_amount; we leave paid_amount = 0.
    await appDb.insert(schema.invoices).values([
      // Not yet due → current bucket
      {
        businessId: business.id,
        customerId: customer.id,
        invoiceNumber: 'INV-AGE-001',
        status: 'issued' as const,
        issueDate: '2026-05-01',
        dueDate: '2026-05-20', // future → 0 days overdue → current
        subtotal: '100.00',
        gstAmount: '8.00',
        total: '108.00',
        paidAmount: '0.00',
        // MVR-denominated (exchangeRate 1) — totalMvr/paidAmountMvr mirror
        // total/paidAmount exactly, same as a real issue()/addPayment() would
        // produce (Phase 30, UPGRADE.md G-10). Aged receivables reads these
        // MVR columns, not the document-currency ones.
        totalMvr: '108.00',
        paidAmountMvr: '0.00',
        createdBy: user.id,
        updatedBy: user.id,
      },
      // 15 days overdue → 1-30 bucket
      {
        businessId: business.id,
        customerId: customer.id,
        invoiceNumber: 'INV-AGE-002',
        status: 'issued' as const,
        issueDate: '2026-04-01',
        dueDate: '2026-05-01', // 15 days before asOf
        subtotal: '200.00',
        gstAmount: '16.00',
        total: '216.00',
        paidAmount: '0.00',
        totalMvr: '216.00',
        paidAmountMvr: '0.00',
        createdBy: user.id,
        updatedBy: user.id,
      },
      // 45 days overdue → 31-60 bucket
      {
        businessId: business.id,
        customerId: customer.id,
        invoiceNumber: 'INV-AGE-003',
        status: 'issued' as const,
        issueDate: '2026-03-01',
        dueDate: '2026-04-01', // 45 days before asOf
        subtotal: '300.00',
        gstAmount: '24.00',
        total: '324.00',
        paidAmount: '0.00',
        totalMvr: '324.00',
        paidAmountMvr: '0.00',
        createdBy: user.id,
        updatedBy: user.id,
      },
      // 100 days overdue → 91+ bucket
      {
        businessId: business.id,
        customerId: customer.id,
        invoiceNumber: 'INV-AGE-004',
        status: 'partially_paid' as const,
        issueDate: '2026-01-01',
        dueDate: '2026-02-05', // ~100 days before asOf
        subtotal: '500.00',
        gstAmount: '40.00',
        total: '540.00',
        paidAmount: '100.00', // partial payment → outstanding 440
        totalMvr: '540.00',
        paidAmountMvr: '100.00',
        createdBy: user.id,
        updatedBy: user.id,
      },
    ])

    const { agedReceivablesReport } = await import('../service.js')
    const rows = await agedReceivablesReport(business.id, asOf)

    expect(rows).toHaveLength(1)
    const row = rows[0]!
    expect(row.entityId).toBe(customer.id)

    // current: INV-AGE-001 = 108.00
    expect(row.current).toBe('108.00')
    // 1-30: INV-AGE-002 = 216.00
    expect(row.days1_30).toBe('216.00')
    // 31-60: INV-AGE-003 = 324.00
    expect(row.days31_60).toBe('324.00')
    // 91+: INV-AGE-004 outstanding = 540 - 100 = 440
    expect(row.days91Plus).toBe('440.00')
    // total = 108 + 216 + 324 + 440 = 1088
    expect(row.total).toBe('1088.00')
  })

  it('excludes fully-paid invoices', async () => {
    const { business, user, appDb, schema } = await seedBusiness()
    const customer = await seedCustomer(business.id, user.id)

    await appDb.insert(schema.invoices).values([
      {
        businessId: business.id,
        customerId: customer.id,
        invoiceNumber: 'INV-PAID',
        status: 'paid' as const,
        issueDate: '2026-01-01',
        dueDate: '2026-02-01',
        subtotal: '500.00',
        gstAmount: '40.00',
        total: '540.00',
        paidAmount: '540.00', // fully paid
        totalMvr: '540.00',
        paidAmountMvr: '540.00',
        createdBy: user.id,
        updatedBy: user.id,
      },
    ])

    const { agedReceivablesReport } = await import('../service.js')
    const rows = await agedReceivablesReport(business.id, '2026-12-31')
    // paid invoices have status=paid which is not in ('issued', 'partially_paid')
    const row = rows.find((r) => r.entityId === customer.id)
    expect(row).toBeUndefined()
  })

  it('agedCsv — correct headers for receivables', async () => {
    const { agedCsv } = await import('../service.js')
    const csv = agedCsv(
      [
        {
          entityId: 'id1',
          entityName: 'Cust A',
          current: '100.00',
          days1_30: '0.00',
          days31_60: '0.00',
          days61_90: '0.00',
          days91Plus: '50.00',
          total: '150.00',
        },
      ],
      'Customer',
    )
    expect(csv).toContain('Customer,Current,1-30 Days,31-60 Days,61-90 Days,91+ Days,Total (MVR)')
    expect(csv).toContain('Cust A,100.00,0.00,0.00,0.00,50.00,150.00')
  })
})

// ─── Aged payables ────────────────────────────────────────────────────────────

describe('reports: aged payables', () => {
  it('buckets outstanding bills by days overdue', async () => {
    const { business, user, appDb, schema } = await seedBusiness()
    const supplier = await seedSupplier(business.id, user.id)
    const asOf = '2026-05-16'

    await appDb.insert(schema.bills).values([
      // Not yet due → current
      {
        businessId: business.id,
        supplierId: supplier.id,
        billNumber: 'BILL-P-001',
        status: 'confirmed' as const,
        billDate: '2026-05-01',
        dueDate: '2026-06-01',
        subtotal: '200.00',
        inputGstAmount: '16.00',
        total: '216.00',
        paidAmount: '0.00',
        createdBy: user.id,
        updatedBy: user.id,
      },
      // 35 days overdue → 31-60
      {
        businessId: business.id,
        supplierId: supplier.id,
        billNumber: 'BILL-P-002',
        status: 'partially_paid' as const,
        billDate: '2026-03-01',
        dueDate: '2026-04-11', // 35 days before asOf
        subtotal: '500.00',
        inputGstAmount: '40.00',
        total: '540.00',
        paidAmount: '100.00',
        createdBy: user.id,
        updatedBy: user.id,
      },
    ])

    const { agedPayablesReport } = await import('../service.js')
    const rows = await agedPayablesReport(business.id, asOf)

    const row = rows.find((r) => r.entityId === supplier.id)
    expect(row).toBeDefined()
    // current: BILL-P-001 = 216.00
    expect(row!.current).toBe('216.00')
    // 31-60: BILL-P-002 outstanding = 540 - 100 = 440
    expect(row!.days31_60).toBe('440.00')
    expect(row!.total).toBe('656.00')
  })
})

// ─── GST summary ─────────────────────────────────────────────────────────────

describe('reports: gst-summary', () => {
  it('computes output vs input tax for a date range', async () => {
    const { business, user } = await seedBusiness()
    await seedRates(business.id, user.id)
    const customer = await seedCustomer(business.id, user.id)
    const supplier = await seedSupplier(business.id, user.id)

    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: 'test' }
    const { createDraft: invDraft, issue } = await import('../../invoicing/service.js')
    const { createDraft: billDraft, confirmBill } = await import('../../purchases/service.js')

    // Issue invoice: qty=10, unitPrice=100, general_8 → taxable=1000, gst=80
    const inv = await invDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [
          { description: 'Sale', qty: '10.0000', unitPrice: '100.00', gstCategory: 'general_8' },
        ],
      },
      ctx,
    )
    await issue(business.id, inv.id, ctx)

    // Confirm bill: qty=5, unitCost=100, general_8 → taxable=500, gst=40
    const bill = await billDraft(
      business.id,
      {
        supplierId: supplier.id,
        lines: [
          { description: 'Purchase', qty: '5.0000', unitCost: '100.00', gstCategory: 'general_8' },
        ],
      },
      ctx,
    )
    await confirmBill(business.id, bill.id, ctx)

    const { gstSummaryReport } = await import('../service.js')
    const today = new Date().toISOString().slice(0, 10)
    const result = await gstSummaryReport(business.id, '2020-01-01', today)

    expect(result.outputTaxByCategory['general_8']).toBeDefined()
    expect(result.inputTaxByCategory['general_8']).toBeDefined()

    // Output tax from invoices ≥ 80 (may include other tests' invoices for this business)
    const outGst = parseFloat(result.totalOutputTax)
    const inGst = parseFloat(result.totalInputTax)
    expect(outGst).toBeGreaterThanOrEqual(80)
    expect(inGst).toBeGreaterThanOrEqual(40)
    // Net payable = output - input
    expect(parseFloat(result.netPayable)).toBeCloseTo(outGst - inGst, 2)
  })

  it('gstSummaryCsv — includes output, input and totals rows', async () => {
    const { gstSummaryCsv } = await import('../service.js')
    const csv = gstSummaryCsv({
      from: '2026-01-01',
      to: '2026-01-31',
      outputTaxByCategory: { general_8: { net: '1000.00', gst: '80.00' } },
      inputTaxByCategory: { general_8: { net: '500.00', gst: '40.00' } },
      totalOutputTax: '80.00',
      totalInputTax: '40.00',
      netPayable: '40.00',
    })
    expect(csv).toContain('Type,Category,Taxable Amount (MVR),GST (MVR)')
    expect(csv).toContain('Output,general_8')
    expect(csv).toContain('Input,general_8')
    expect(csv).toContain('Net Payable')
    expect(csv).toContain('40.00')
  })
})

// ─── Route-level: auth + CSV format ──────────────────────────────────────────

describe('reports: HTTP routes', () => {
  it('GET /reports/sales returns 401 without auth', async () => {
    const { app } = await import('../../../server.js')
    const res = await app.request('/reports/sales?from=2026-01-01&to=2026-12-31')
    expect(res.status).toBe(401)
  })

  it('GET /reports/sales?format=csv returns text/csv with auth', async () => {
    const { business, user, token } = await seedBusiness()
    await seedRates(business.id, user.id)
    const { app } = await import('../../../server.js')
    const res = await app.request('/reports/sales?from=2026-01-01&to=2026-12-31&format=csv', {
      headers: { Cookie: `session=${token}` },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/csv/)
    const body = await res.text()
    expect(body).toContain('Customer,Invoices,Subtotal (MVR)')
  })

  it('GET /reports/aged-receivables?format=csv returns CSV', async () => {
    const { token } = await seedBusiness()
    const { app } = await import('../../../server.js')
    const res = await app.request('/reports/aged-receivables?asOf=2026-05-16&format=csv', {
      headers: { Cookie: `session=${token}` },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch(/text\/csv/)
  })

  it('GET /reports/stock-valuation?format=json returns JSON', async () => {
    const { token } = await seedBusiness()
    const { app } = await import('../../../server.js')
    const res = await app.request('/reports/stock-valuation?asOf=2026-05-16', {
      headers: { Cookie: `session=${token}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as Record<string, unknown>
    expect(body).toHaveProperty('asOf')
    expect(body).toHaveProperty('method', 'avg')
    expect(Array.isArray(body['rows'])).toBe(true)
  })
})
