import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDatabase } from '../../db/test-db.js'
import postgres from 'postgres'
import * as argon2 from 'argon2'
import jwt from 'jsonwebtoken'

// Full round-trip: HTTP route enqueues → the pdf worker (registered here, in
// this same process) picks the job up → renders → uploads via files → the
// route's job.waitUntilFinished resolves → a real signed URL comes back.
// This is the one test in the suite that exercises the actual BullMQ queue
// rather than calling a service function directly (UPGRADE.md Phase 23).

let client: ReturnType<typeof postgres>
let stopWorker: (() => Promise<void>) | undefined

const JWT_SECRET = 'test-secret-at-least-32-chars-long-xx'

beforeAll(async () => {
  const url = await createTestDatabase()
  process.env['DATABASE_URL'] = url
  process.env['REDIS_URL'] = process.env['REDIS_URL'] ?? 'redis://localhost:6380'
  process.env['JWT_SECRET'] = JWT_SECRET
  process.env['FRONTEND_URL'] = 'http://localhost:5173'
  process.env['NODE_ENV'] = 'test'
  client = postgres(url, { max: 1 })

  const { registerPdfWorker } = await import('../pdf.js')
  const worker = registerPdfWorker()
  stopWorker = () => worker.close()
}, 60_000)

afterAll(async () => {
  await stopWorker?.()
  await client?.end()
})

async function seedBusinessWithInvoice() {
  const { db: appDb } = await import('../../db/client.js')
  const schema = await import('../../db/schema/index.js')

  const [business] = await appDb
    .insert(schema.businesses)
    .values({
      name: 'PDF Test Biz',
      tin: 'MVR555',
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
      email: `pdftest+${Date.now()}@example.com`,
      name: 'PDF Tester',
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
      name: 'PDF Test Customer',
      tin: null,
      email: null,
      phone: null,
      address: 'Male, Maldives',
      creditTermsDays: '30',
      creditLimit: null,
      notes: null,
      createdBy: user.id,
      updatedBy: user.id,
    })
    .returning()
  if (!customer) throw new Error('seed: no customer')

  const invoicingSvc = await import('../../modules/invoicing/service.js')
  const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }
  const draft = await invoicingSvc.createDraft(
    business.id,
    {
      customerId: customer.id,
      lines: [
        { description: 'Widget', qty: '2.0000', unitPrice: '100.00', gstCategory: 'general_8' },
      ],
    },
    ctx,
  )
  const issued = await invoicingSvc.issue(business.id, draft.id, ctx)

  return { business, user, token, invoiceId: issued.id }
}

function authHeaders(token: string) {
  return { 'Content-Type': 'application/json', Cookie: `session=${token}` }
}

describe('pdf worker — invoice PDF end-to-end', () => {
  it('renders a real PDF via the queue and returns a working signed URL', async () => {
    const { app } = await import('../../server.js')
    const { token, invoiceId, business } = await seedBusinessWithInvoice()

    const res = await app.request(`/invoices/${invoiceId}/pdf`, { headers: authHeaders(token) })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { url: string }
    expect(body.url).toBeTruthy()

    // The file row was created and attached to the invoice entity
    const { db: appDb } = await import('../../db/client.js')
    const schema = await import('../../db/schema/index.js')
    const { and, eq } = await import('drizzle-orm')
    const rows = await appDb
      .select()
      .from(schema.files)
      .where(
        and(
          eq(schema.files.businessId, business.id),
          eq(schema.files.entityType, 'invoice'),
          eq(schema.files.entityId, invoiceId),
        ),
      )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.mimeType).toBe('application/pdf')
    expect(rows[0]?.scanResult).toBe('clean')
  }, 30_000)
})

describe('pdf worker — estimate PDF end-to-end', () => {
  it('renders a real estimate PDF via the queue and returns a working signed URL', async () => {
    const { app } = await import('../../server.js')
    const { business, user, token, customer } = await (async () => {
      const seeded = await seedBusinessWithInvoice()
      const { db: appDb } = await import('../../db/client.js')
      const schema = await import('../../db/schema/index.js')
      const { eq } = await import('drizzle-orm')
      const [customerRow] = await appDb
        .select()
        .from(schema.customers)
        .where(eq(schema.customers.businessId, seeded.business.id))
      return { ...seeded, customer: customerRow! }
    })()

    const estimatesSvc = await import('../../modules/estimates/service.js')
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }
    const draft = await estimatesSvc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [
          {
            description: 'Quoted widget',
            qty: '1.0000',
            unitPrice: '50.00',
            gstCategory: 'general_8',
          },
        ],
      },
      ctx,
    )
    await estimatesSvc.send(business.id, draft.id, ctx)

    const res = await app.request(`/estimates/${draft.id}/pdf`, { headers: authHeaders(token) })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { url: string }
    expect(body.url).toBeTruthy()

    const { db: appDb } = await import('../../db/client.js')
    const schema = await import('../../db/schema/index.js')
    const { and, eq } = await import('drizzle-orm')
    const rows = await appDb
      .select()
      .from(schema.files)
      .where(
        and(
          eq(schema.files.businessId, business.id),
          eq(schema.files.entityType, 'estimate'),
          eq(schema.files.entityId, draft.id),
        ),
      )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.mimeType).toBe('application/pdf')
  }, 30_000)
})
