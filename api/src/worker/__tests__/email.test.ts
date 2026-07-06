import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import postgres from 'postgres'
import * as argon2 from 'argon2'
import jwt from 'jsonwebtoken'
import { runMigrations } from '../../db/test-helpers.js'

// Full round-trip through the email/reminders queues (Phase 24, UPGRADE.md
// G-3/G-4) — both workers run in this process so jobs actually get consumed
// (mirrors worker/__tests__/pdf.test.ts's approach for the pdf queue).

let container: StartedPostgreSqlContainer
let client: ReturnType<typeof postgres>
let stopEmailWorker: (() => Promise<void>) | undefined
let stopRemindersWorker: (() => Promise<void>) | undefined

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

  const { registerEmailWorker } = await import('../email.js')
  const emailWorker = registerEmailWorker()
  stopEmailWorker = () => emailWorker.close()

  const { registerRemindersWorker } = await import('../reminders.js')
  const remindersWorker = registerRemindersWorker()
  stopRemindersWorker = () => remindersWorker.close()
}, 60_000)

afterAll(async () => {
  await stopEmailWorker?.()
  await stopRemindersWorker?.()
  await client?.end()
  await container?.stop()
})

async function pollUntil<T>(
  fn: () => Promise<T[]>,
  predicate: (rows: T[]) => boolean,
  timeoutMs = 10_000,
) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const rows = await fn()
    if (predicate(rows)) return rows
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('pollUntil: timed out waiting for condition')
}

async function seedBusinessWithInvoice(dueDate: string) {
  const { db: appDb } = await import('../../db/client.js')
  const schema = await import('../../db/schema/index.js')

  const [business] = await appDb
    .insert(schema.businesses)
    .values({
      name: 'Email Test Biz',
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
      email: `emailtest+${Date.now()}@example.com`,
      name: 'Email Tester',
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
      name: 'Email Test Customer',
      tin: null,
      email: 'customer@example.com',
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
      dueDate,
      lines: [
        { description: 'Widget', qty: '1.0000', unitPrice: '100.00', gstCategory: 'general_8' },
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

describe('email — invoice send', () => {
  it('POST /invoices/:id/send enqueues and the worker logs a sent email', async () => {
    const { app } = await import('../../server.js')
    const { token, invoiceId, business } = await seedBusinessWithInvoice('2026-08-01')

    const res = await app.request(`/invoices/${invoiceId}/send`, {
      method: 'POST',
      headers: authHeaders(token),
    })
    expect(res.status).toBe(202)

    const { db: appDb } = await import('../../db/client.js')
    const schema = await import('../../db/schema/index.js')
    const { and, eq } = await import('drizzle-orm')

    const rows = await pollUntil(
      () =>
        appDb
          .select()
          .from(schema.emailLogs)
          .where(
            and(
              eq(schema.emailLogs.businessId, business.id),
              eq(schema.emailLogs.entityId, invoiceId),
              eq(schema.emailLogs.kind, 'invoice'),
            ),
          ),
      (r) => r.length > 0,
    )
    expect(rows[0]?.status).toBe('sent')
    expect(rows[0]?.toEmail).toBe('customer@example.com')
  }, 20_000)
})

describe('email — payment receipt', () => {
  it('adding a payment automatically enqueues a receipt email', async () => {
    const { app } = await import('../../server.js')
    const { token, invoiceId, business } = await seedBusinessWithInvoice('2026-08-01')

    const res = await app.request(`/invoices/${invoiceId}/payments`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ amount: '108.00', method: 'bank_transfer', paidAt: '2026-07-01' }),
    })
    expect(res.status).toBe(201)

    const { db: appDb } = await import('../../db/client.js')
    const schema = await import('../../db/schema/index.js')
    const { and, eq } = await import('drizzle-orm')

    const rows = await pollUntil(
      () =>
        appDb
          .select()
          .from(schema.emailLogs)
          .where(
            and(
              eq(schema.emailLogs.businessId, business.id),
              eq(schema.emailLogs.entityId, invoiceId),
              eq(schema.emailLogs.kind, 'receipt'),
            ),
          ),
      (r) => r.length > 0,
    )
    expect(rows[0]?.status).toBe('sent')
  }, 20_000)
})

describe('reminders — opt-out and scan idempotency', () => {
  it('PATCH /invoices/:id/reminders disables reminders for that invoice', async () => {
    const { app } = await import('../../server.js')
    const { token, invoiceId } = await seedBusinessWithInvoice('2026-08-01')

    const res = await app.request(`/invoices/${invoiceId}/reminders`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ enabled: false }),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { remindersEnabled: boolean }
    expect(body.remindersEnabled).toBe(false)
  })

  it('the reminders scan fires exactly once per (invoice, offset), even run twice', async () => {
    const { todayMv } = await import('@koosani/shared')
    // dueDate = today, offset 0 is in the default schedule [-3, 0, 7, 14]
    const { business, invoiceId } = await seedBusinessWithInvoice(todayMv())

    const { remindersQueue } = await import('../../lib/queues.js')

    const runOnce = async () => {
      const job = await remindersQueue.add('reminders', { businessId: business.id })
      // Poll job state instead of QueueEvents (not wired for this queue)
      const start = Date.now()
      while (Date.now() - start < 10_000) {
        const state = await job.getState()
        if (state === 'completed' || state === 'failed') return
        await new Promise((r) => setTimeout(r, 100))
      }
      throw new Error('reminders job did not complete in time')
    }

    await runOnce()
    await runOnce()

    const { db: appDb } = await import('../../db/client.js')
    const schema = await import('../../db/schema/index.js')
    const { and, eq } = await import('drizzle-orm')

    const rows = await pollUntil(
      () =>
        appDb
          .select()
          .from(schema.emailLogs)
          .where(
            and(
              eq(schema.emailLogs.businessId, business.id),
              eq(schema.emailLogs.entityId, invoiceId),
              eq(schema.emailLogs.kind, 'reminder'),
            ),
          ),
      (r) => r.length > 0,
    )
    expect(rows).toHaveLength(1)
  }, 30_000)
})

describe('reminders — estimate expiry sweep', () => {
  it('expires a sent estimate whose expiryDate has passed', async () => {
    const { business, user } = await seedBusinessWithInvoice('2026-08-01')

    const { db: appDb } = await import('../../db/client.js')
    const schema = await import('../../db/schema/index.js')
    const { eq } = await import('drizzle-orm')
    const [customer] = await appDb
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.businessId, business.id))

    const estimatesSvc = await import('../../modules/estimates/service.js')
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }
    const draft = await estimatesSvc.createDraft(
      business.id,
      {
        customerId: customer!.id,
        expiryDate: '2020-01-01', // long past
        lines: [
          { description: 'Old quote', qty: '1.0000', unitPrice: '10.00', gstCategory: 'general_8' },
        ],
      },
      ctx,
    )
    await estimatesSvc.send(business.id, draft.id, ctx)

    const { remindersQueue } = await import('../../lib/queues.js')
    const job = await remindersQueue.add('reminders', { businessId: business.id })
    const start = Date.now()
    while (Date.now() - start < 10_000) {
      const state = await job.getState()
      if (state === 'completed' || state === 'failed') break
      await new Promise((r) => setTimeout(r, 100))
    }

    const updated = await estimatesSvc.getEstimate(business.id, draft.id)
    expect(updated.status).toBe('expired')
  }, 20_000)
})

describe('email — estimate send', () => {
  it('POST /estimates/:id/send enqueues and the worker logs a sent email', async () => {
    const { app } = await import('../../server.js')
    const { business, token } = await seedBusinessWithInvoice('2026-08-01')

    const { db: appDb } = await import('../../db/client.js')
    const schema = await import('../../db/schema/index.js')
    const { eq, and } = await import('drizzle-orm')
    const [customer] = await appDb
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.businessId, business.id))

    const draftRes = await app.request('/estimates', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        customerId: customer!.id,
        lines: [
          {
            description: 'Quoted widget',
            qty: '1.0000',
            unitPrice: '50.00',
            gstCategory: 'general_8',
          },
        ],
      }),
    })
    expect(draftRes.status).toBe(201)
    const draft = (await draftRes.json()) as { id: string }

    const sendRes = await app.request(`/estimates/${draft.id}/send`, {
      method: 'POST',
      headers: authHeaders(token),
    })
    expect(sendRes.status).toBe(200)

    const rows = await pollUntil(
      () =>
        appDb
          .select()
          .from(schema.emailLogs)
          .where(
            and(
              eq(schema.emailLogs.businessId, business.id),
              eq(schema.emailLogs.entityId, draft.id),
              eq(schema.emailLogs.kind, 'estimate'),
            ),
          ),
      (r) => r.length > 0,
    )
    expect(rows[0]?.status).toBe('sent')
    expect(rows[0]?.toEmail).toBe('customer@example.com')
  }, 20_000)
})
