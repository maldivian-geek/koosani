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

async function seedBusiness(allowBackorders = false) {
  const { db: appDb } = await import('../../../db/client.js')
  const schema = await import('../../../db/schema/index.js')

  const [business] = await appDb
    .insert(schema.businesses)
    .values({
      name: `PO Test Biz ${Date.now()}`,
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
      email: `po+${Date.now()}+${Math.random()}@example.com`,
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

  return { business, user, token }
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
  ])
}

async function seedSupplier(businessId: string, userId: string) {
  const { db: appDb } = await import('../../../db/client.js')
  const schema = await import('../../../db/schema/index.js')
  const [supplier] = await appDb
    .insert(schema.suppliers)
    .values({
      businessId,
      name: 'Test Supplier',
      tin: null,
      email: null,
      phone: null,
      address: null,
      notes: null,
      createdBy: userId,
      updatedBy: userId,
    })
    .returning()
  if (!supplier) throw new Error('seed: no supplier')
  return supplier
}

async function seedItem(
  businessId: string,
  userId: string,
  gstCategory: 'general_8' | 'zero' = 'general_8',
) {
  const { db: appDb } = await import('../../../db/client.js')
  const schema = await import('../../../db/schema/index.js')
  const [item] = await appDb
    .insert(schema.items)
    .values({
      businessId,
      sku: `SKU-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: 'Test Item',
      unit: 'pcs',
      gstCategory,
      createdBy: userId,
      updatedBy: userId,
    })
    .returning()
  if (!item) throw new Error('seed: no item')
  return item
}

// ─── GRN math tests ───────────────────────────────────────────────────────────

describe('po: GRN math and stock commitment', () => {
  it('creates PO, approves it, creates GRN, commits stock correctly', async () => {
    const { business, user } = await seedBusiness()
    await seedRates(business.id, user.id)
    const supplier = await seedSupplier(business.id, user.id)
    const item = await seedItem(business.id, user.id)
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: 'test' }

    const { createDraft, approvePo, createGrn } = await import('../service.js')

    const po = await createDraft(
      business.id,
      {
        supplierId: supplier.id,
        lines: [
          { itemId: item.id, description: 'Goods', qtyOrdered: '10.0000', unitCost: '25.00' },
        ],
      },
      ctx,
    )

    expect(po.status).toBe('draft')
    expect(po.lines[0]!.lineTotal).toBe('250.00')
    expect(po.subtotal).toBe('250.00')

    const approved = await approvePo(business.id, po.id, ctx)
    expect(approved.status).toBe('approved')
    expect(approved.poNumber).toBe('PO-000001')

    // Create GRN for 7 of the 10 ordered
    const grn = await createGrn(
      business.id,
      po.id,
      {
        receivedAt: '2025-05-20',
        lines: [{ poLineId: po.lines[0]!.id, qtyReceived: '7.0000', unitCost: '25.00' }],
      },
      ctx,
    )

    expect(grn.lines).toHaveLength(1)
    expect(grn.lines[0]!.qtyReceived).toBe('7.0000')

    // PO status should be partially_received (7 of 10)
    const { getPo } = await import('../service.js')
    const updatedPo = await getPo(business.id, po.id)
    expect(updatedPo.status).toBe('partially_received')
    expect(updatedPo.lines[0]!.qtyReceived).toBe('7.0000')

    // Stock on hand should be 7
    const [stockRow] = await client`SELECT stock_on_hand FROM items WHERE id = ${item.id}`
    expect(stockRow?.stock_on_hand).toBe('7.0000')
  })

  it('marks PO as received when all lines fully received', async () => {
    const { business, user } = await seedBusiness()
    await seedRates(business.id, user.id)
    const supplier = await seedSupplier(business.id, user.id)
    const item = await seedItem(business.id, user.id)
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: 'test' }

    const { createDraft, approvePo, createGrn, getPo } = await import('../service.js')

    const po = await createDraft(
      business.id,
      {
        supplierId: supplier.id,
        lines: [{ itemId: item.id, description: 'Goods', qtyOrdered: '5.0000', unitCost: '10.00' }],
      },
      ctx,
    )
    await approvePo(business.id, po.id, ctx)

    await createGrn(
      business.id,
      po.id,
      {
        receivedAt: '2025-05-21',
        lines: [{ poLineId: po.lines[0]!.id, qtyReceived: '5.0000', unitCost: '10.00' }],
      },
      ctx,
    )

    const final = await getPo(business.id, po.id)
    expect(final.status).toBe('received')
  })

  it('sequential POs get sequential numbers', async () => {
    const { business, user } = await seedBusiness()
    await seedRates(business.id, user.id)
    const supplier = await seedSupplier(business.id, user.id)
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: 'test' }

    const { createDraft, approvePo } = await import('../service.js')
    const line = { description: 'Item', qtyOrdered: '1.0000', unitCost: '10.00' }

    const d1 = await createDraft(business.id, { supplierId: supplier.id, lines: [line] }, ctx)
    const d2 = await createDraft(business.id, { supplierId: supplier.id, lines: [line] }, ctx)

    const a1 = await approvePo(business.id, d1.id, ctx)
    const a2 = await approvePo(business.id, d2.id, ctx)

    expect(a1.poNumber).toBe('PO-000001')
    expect(a2.poNumber).toBe('PO-000002')
  })
})

// ─── Over-receipt tests ───────────────────────────────────────────────────────

describe('po: over-receipt rejection', () => {
  it('rejects GRN qty that exceeds qty ordered when allowBackorders = false', async () => {
    const { business, user } = await seedBusiness(false)
    await seedRates(business.id, user.id)
    const supplier = await seedSupplier(business.id, user.id)
    const item = await seedItem(business.id, user.id)
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: 'test' }

    const { createDraft, approvePo, createGrn, ValidationError } = await import('../service.js')

    const po = await createDraft(
      business.id,
      {
        supplierId: supplier.id,
        lines: [{ itemId: item.id, description: 'Goods', qtyOrdered: '5.0000', unitCost: '10.00' }],
      },
      ctx,
    )
    await approvePo(business.id, po.id, ctx)

    await expect(
      createGrn(
        business.id,
        po.id,
        {
          receivedAt: '2025-05-22',
          lines: [{ poLineId: po.lines[0]!.id, qtyReceived: '6.0000', unitCost: '10.00' }],
        },
        ctx,
      ),
    ).rejects.toThrow(ValidationError)
  })

  it('allows over-receipt when allowBackorders = true', async () => {
    const { business, user } = await seedBusiness(true)
    await seedRates(business.id, user.id)
    const supplier = await seedSupplier(business.id, user.id)
    const item = await seedItem(business.id, user.id)
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: 'test' }

    const { createDraft, approvePo, createGrn } = await import('../service.js')

    const po = await createDraft(
      business.id,
      {
        supplierId: supplier.id,
        lines: [{ itemId: item.id, description: 'Goods', qtyOrdered: '5.0000', unitCost: '10.00' }],
      },
      ctx,
    )
    await approvePo(business.id, po.id, ctx)

    // 6 > 5 ordered — allowed because allowBackorders = true
    const grn = await createGrn(
      business.id,
      po.id,
      {
        receivedAt: '2025-05-22',
        lines: [{ poLineId: po.lines[0]!.id, qtyReceived: '6.0000', unitCost: '10.00' }],
      },
      ctx,
    )

    expect(grn.lines[0]!.qtyReceived).toBe('6.0000')
  })

  it('rejects GRN against a draft PO', async () => {
    const { business, user } = await seedBusiness()
    await seedRates(business.id, user.id)
    const supplier = await seedSupplier(business.id, user.id)
    const item = await seedItem(business.id, user.id)
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: 'test' }

    const { createDraft, createGrn, ValidationError } = await import('../service.js')

    const po = await createDraft(
      business.id,
      {
        supplierId: supplier.id,
        lines: [{ itemId: item.id, description: 'G', qtyOrdered: '1.0000', unitCost: '1.00' }],
      },
      ctx,
    )

    await expect(
      createGrn(
        business.id,
        po.id,
        {
          receivedAt: '2025-05-22',
          lines: [{ poLineId: po.lines[0]!.id, qtyReceived: '1.0000', unitCost: '1.00' }],
        },
        ctx,
      ),
    ).rejects.toThrow(ValidationError)
  })
})

// ─── PO → Bill prefill tests ──────────────────────────────────────────────────

describe('po: createBillFromPo prefill', () => {
  it('creates a draft bill pre-filled with GRN received quantities', async () => {
    const { business, user } = await seedBusiness()
    await seedRates(business.id, user.id)
    const supplier = await seedSupplier(business.id, user.id)
    const item = await seedItem(business.id, user.id)
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: 'test' }

    const { createDraft, approvePo, createGrn, createBillFromPo } = await import('../service.js')

    const po = await createDraft(
      business.id,
      {
        supplierId: supplier.id,
        lines: [
          { itemId: item.id, description: 'Widget', qtyOrdered: '10.0000', unitCost: '50.00' },
        ],
      },
      ctx,
    )
    await approvePo(business.id, po.id, ctx)

    // Receive 8 of 10
    await createGrn(
      business.id,
      po.id,
      {
        receivedAt: '2025-05-25',
        lines: [{ poLineId: po.lines[0]!.id, qtyReceived: '8.0000', unitCost: '50.00' }],
      },
      ctx,
    )

    const bill = await createBillFromPo(business.id, po.id, ctx)

    expect(bill.supplierId).toBe(supplier.id)
    expect(bill.status).toBe('draft')
    expect(bill.poId).toBe(po.id)
    expect(bill.lines).toHaveLength(1)

    const line = bill.lines[0]!
    // Bill line qty = qty received from GRN (8), not qty ordered (10)
    expect(line.qty).toBe('8.0000')
    expect(line.unitCost).toBe('50.00')
    expect(line.description).toBe('Widget')

    // GST should be applied: 8 * 50 = 400 subtotal, 8% = 32 gst, 432 total
    expect(bill.subtotal).toBe('400.00')
    expect(bill.inputGstAmount).toBe('32.00')
    expect(bill.total).toBe('432.00')
  })

  it('rejects bill creation if no GRN lines exist', async () => {
    const { business, user } = await seedBusiness()
    await seedRates(business.id, user.id)
    const supplier = await seedSupplier(business.id, user.id)
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: 'test' }

    const { createDraft, approvePo, createBillFromPo, ValidationError } =
      await import('../service.js')

    const po = await createDraft(
      business.id,
      {
        supplierId: supplier.id,
        lines: [{ description: 'Service', qtyOrdered: '1.0000', unitCost: '100.00' }],
      },
      ctx,
    )
    await approvePo(business.id, po.id, ctx)

    await expect(createBillFromPo(business.id, po.id, ctx)).rejects.toThrow(ValidationError)
  })

  it('rejects bill creation from draft PO', async () => {
    const { business, user } = await seedBusiness()
    await seedRates(business.id, user.id)
    const supplier = await seedSupplier(business.id, user.id)
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: 'test' }

    const { createDraft, createBillFromPo, ValidationError } = await import('../service.js')

    const po = await createDraft(
      business.id,
      {
        supplierId: supplier.id,
        lines: [{ description: 'Item', qtyOrdered: '1.0000', unitCost: '50.00' }],
      },
      ctx,
    )

    await expect(createBillFromPo(business.id, po.id, ctx)).rejects.toThrow(ValidationError)
  })
})

// ─── Cancel tests ─────────────────────────────────────────────────────────────

describe('po: cancel', () => {
  it('cancels a draft PO', async () => {
    const { business, user } = await seedBusiness()
    await seedRates(business.id, user.id)
    const supplier = await seedSupplier(business.id, user.id)
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: 'test' }

    const { createDraft, cancelPo } = await import('../service.js')

    const po = await createDraft(
      business.id,
      {
        supplierId: supplier.id,
        lines: [{ description: 'Item', qtyOrdered: '1.0000', unitCost: '5.00' }],
      },
      ctx,
    )

    const cancelled = await cancelPo(business.id, po.id, 'Test reason', ctx)
    expect(cancelled.status).toBe('cancelled')
    expect(cancelled.cancelReason).toBe('Test reason')
  })

  it('rejects cancel after GRN created', async () => {
    const { business, user } = await seedBusiness()
    await seedRates(business.id, user.id)
    const supplier = await seedSupplier(business.id, user.id)
    const item = await seedItem(business.id, user.id)
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: 'test' }

    const { createDraft, approvePo, createGrn, cancelPo, ValidationError } =
      await import('../service.js')

    const po = await createDraft(
      business.id,
      {
        supplierId: supplier.id,
        lines: [{ itemId: item.id, description: 'G', qtyOrdered: '1.0000', unitCost: '1.00' }],
      },
      ctx,
    )
    await approvePo(business.id, po.id, ctx)
    await createGrn(
      business.id,
      po.id,
      {
        receivedAt: '2025-05-22',
        lines: [{ poLineId: po.lines[0]!.id, qtyReceived: '1.0000', unitCost: '1.00' }],
      },
      ctx,
    )

    await expect(cancelPo(business.id, po.id, 'reason', ctx)).rejects.toThrow(ValidationError)
  })
})
