import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import postgres from 'postgres'
import * as argon2 from 'argon2'
import jwt from 'jsonwebtoken'
import { runMigrations } from '../../../db/test-helpers.js'

// Full round-trip: magic-link request -> DB token -> verify -> portal session
// cookie -> scoped access to the customer's own data only (Phase 28,
// UPGRADE.md G-8; SECURITY.md §13.14).

let container: StartedPostgreSqlContainer
let client: ReturnType<typeof postgres>

const JWT_SECRET = 'test-secret-at-least-32-chars-long-xx'
const PORTAL_JWT_SECRET = 'test-portal-secret-at-least-32-chars-xx'

// The verify/magic-link endpoints are IP rate-limited (SECURITY.md §13.14);
// Hono's app.request() test harness has no real client IP, so every call
// would otherwise share one Redis bucket and trip the limiter after 5 calls
// across the whole file. Each test gets its own fake-but-valid X-Real-IP.
let ipCounter = 0
function nextTestIp(): string {
  ipCounter += 1
  return `10.${(ipCounter >> 16) & 0xff}.${(ipCounter >> 8) & 0xff}.${ipCounter & 0xff}`
}

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  const url = container.getConnectionUri()
  process.env['DATABASE_URL'] = url
  process.env['REDIS_URL'] = process.env['REDIS_URL'] ?? 'redis://localhost:6379'
  process.env['JWT_SECRET'] = JWT_SECRET
  process.env['PORTAL_JWT_SECRET'] = PORTAL_JWT_SECRET
  process.env['FRONTEND_URL'] = 'http://localhost:5173'
  process.env['PORTAL_FRONTEND_URL'] = 'http://localhost:5174'
  process.env['NODE_ENV'] = 'test'
  await runMigrations(url)
  client = postgres(url, { max: 1 })
}, 60_000)

afterAll(async () => {
  await client?.end()
  await container?.stop()
})

async function seedBusinessWithCustomer(email: string) {
  const { db: appDb } = await import('../../../db/client.js')
  const schema = await import('../../../db/schema/index.js')

  const [business] = await appDb
    .insert(schema.businesses)
    .values({
      name: `Portal Test Biz ${Date.now()}-${Math.random()}`,
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
      email: `staff+${Date.now()}+${Math.random()}@example.com`,
      name: 'Staff Member',
      role: 'admin',
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

  const [customer] = await appDb
    .insert(schema.customers)
    .values({
      businessId: business.id,
      name: 'Portal Test Customer',
      tin: null,
      email,
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

  return { business, user, customer }
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

async function seedSentEstimate(businessId: string, customerId: string, userId: string) {
  const estimatesSvc = await import('../../estimates/service.js')
  const ctx = { userId, businessId, ip: '127.0.0.1', ua: undefined }
  const draft = await estimatesSvc.createDraft(
    businessId,
    {
      customerId,
      lines: [
        { description: 'Quote item', qty: '1.0000', unitPrice: '50.00', gstCategory: 'general_8' },
      ],
    },
    ctx,
  )
  return estimatesSvc.send(businessId, draft.id, ctx)
}

function authCookie(name: string, token: string) {
  return { Cookie: `${name}=${token}` }
}

describe('portal auth — magic link', () => {
  it('requesting a magic link always returns 204 regardless of match (no enumeration)', async () => {
    const { app } = await import('../../../server.js')
    const res = await app.request('/portal/auth/magic-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'nobody-matches-anything@example.com' }),
    })
    expect(res.status).toBe(204)
  })

  it('creates one portal_auth_tokens row per matching (business, customer) pair', async () => {
    // Calls the service directly (awaited) rather than through the route:
    // the route fires requestMagicLink() detached from the response (same
    // fire-and-forget pattern as staff auth, so the 204 isn't held up by
    // email latency), so asserting on its DB side effect needs the awaited
    // call, not the HTTP round trip.
    const email = `multi+${Date.now()}@example.com`
    const { business: b1, customer: c1 } = await seedBusinessWithCustomer(email)
    const { business: b2, customer: c2 } = await seedBusinessWithCustomer(email)

    const portalAuthSvc = await import('../../portalAuth/service.js')
    await portalAuthSvc.requestMagicLink(email)

    const { db: appDb } = await import('../../../db/client.js')
    const schema = await import('../../../db/schema/index.js')
    const { eq, or } = await import('drizzle-orm')
    const tokens = await appDb
      .select()
      .from(schema.portalAuthTokens)
      .where(
        or(
          eq(schema.portalAuthTokens.customerId, c1.id),
          eq(schema.portalAuthTokens.customerId, c2.id),
        ),
      )
    expect(tokens).toHaveLength(2)
    expect(new Set(tokens.map((t) => t.businessId))).toEqual(new Set([b1.id, b2.id]))
  })

  it('verify with an invalid token is rejected', async () => {
    const { app } = await import('../../../server.js')
    const res = await app.request('/portal/auth/magic-link/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Real-IP': nextTestIp() },
      body: JSON.stringify({ token: 'not-a-real-token' }),
    })
    expect(res.status).toBe(401)
  })

  it('verify with a real token issues a session and is single-use', async () => {
    const email = `verify+${Date.now()}@example.com`
    const { customer } = await seedBusinessWithCustomer(email)

    // Mint a token the same way the service does, so we have the plaintext
    // to submit (mirrors what the emailed link would contain).
    const crypto = await import('node:crypto')
    const token = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    const portalAuthRepo = await import('../../portalAuth/repository.js')
    await portalAuthRepo.createToken({
      businessId: customer.businessId,
      customerId: customer.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    })

    const { app } = await import('../../../server.js')
    const ip = nextTestIp()
    const res = await app.request('/portal/auth/magic-link/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Real-IP': ip },
      body: JSON.stringify({ token }),
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toContain('portal_session=')

    const second = await app.request('/portal/auth/magic-link/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Real-IP': ip },
      body: JSON.stringify({ token }),
    })
    expect(second.status).toBe(401) // already consumed
  })
})

async function loginToPortal(businessId: string, customerId: string) {
  const crypto = await import('node:crypto')
  const token = crypto.randomBytes(32).toString('hex')
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  const portalAuthRepo = await import('../../portalAuth/repository.js')
  await portalAuthRepo.createToken({
    businessId,
    customerId,
    tokenHash,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
  })

  const { app } = await import('../../../server.js')
  const res = await app.request('/portal/auth/magic-link/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Real-IP': nextTestIp() },
    body: JSON.stringify({ token }),
  })
  const setCookie = res.headers.get('set-cookie') ?? ''
  const match = /portal_session=([^;]+)/.exec(setCookie)
  const sessionToken = match?.[1]
  if (!sessionToken) throw new Error('no portal_session cookie in response')
  return sessionToken
}

describe('portal — scoped access to own data only', () => {
  it("can view its own invoice but not another customer's invoice (404, not 403)", async () => {
    const email = `scope+${Date.now()}@example.com`
    const { business, user, customer } = await seedBusinessWithCustomer(email)
    const otherCustomerEmail = `other+${Date.now()}@example.com`
    const { customer: otherCustomer } = await (async () => {
      // second customer within the SAME business
      const { db: appDb } = await import('../../../db/client.js')
      const schema = await import('../../../db/schema/index.js')
      const [otherCustomer] = await appDb
        .insert(schema.customers)
        .values({
          businessId: business.id,
          name: 'Other Customer',
          tin: null,
          email: otherCustomerEmail,
          phone: null,
          address: null,
          creditTermsDays: '30',
          creditLimit: null,
          notes: null,
          createdBy: user.id,
          updatedBy: user.id,
        })
        .returning()
      return { customer: otherCustomer! }
    })()

    const myInvoice = await seedIssuedInvoice(business.id, customer.id, user.id)
    const otherInvoice = await seedIssuedInvoice(business.id, otherCustomer.id, user.id)

    const sessionToken = await loginToPortal(business.id, customer.id)
    const { app } = await import('../../../server.js')

    const ownRes = await app.request(`/portal/invoices/${myInvoice.id}`, {
      headers: authCookie('portal_session', sessionToken),
    })
    expect(ownRes.status).toBe(200)

    const otherRes = await app.request(`/portal/invoices/${otherInvoice.id}`, {
      headers: authCookie('portal_session', sessionToken),
    })
    expect(otherRes.status).toBe(404)
  })

  it("list endpoints only return the authenticated customer's own rows", async () => {
    const email = `list+${Date.now()}@example.com`
    const { business, user, customer } = await seedBusinessWithCustomer(email)
    await seedIssuedInvoice(business.id, customer.id, user.id)
    await seedIssuedInvoice(business.id, customer.id, user.id)

    const sessionToken = await loginToPortal(business.id, customer.id)
    const { app } = await import('../../../server.js')
    const res = await app.request('/portal/invoices', {
      headers: authCookie('portal_session', sessionToken),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { items: unknown[]; total: number }
    expect(body.total).toBe(2)
  })

  it('rejects requests with no session cookie', async () => {
    const { app } = await import('../../../server.js')
    const res = await app.request('/portal/invoices')
    expect(res.status).toBe(401)
  })

  it('rejects a staff JWT presented as a portal session (different secret/shape)', async () => {
    const email = `staffleak+${Date.now()}@example.com`
    const { business, customer } = await seedBusinessWithCustomer(email)
    // A JWT signed with the STAFF secret, shaped like a staff payload —
    // must never be accepted as a portal session even if somehow presented
    // under the portal_session cookie name.
    const fakeStaffToken = jwt.sign(
      {
        id: 'x',
        email: 'x',
        role: 'admin',
        name: 'x',
        businessId: business.id,
        tokenVersion: 0,
        sid: 'x',
      },
      JWT_SECRET,
      { algorithm: 'HS256' },
    )
    const { app } = await import('../../../server.js')
    const res = await app.request('/portal/invoices', {
      headers: authCookie('portal_session', fakeStaffToken),
    })
    expect(res.status).toBe(401)
    void customer
  })
})

describe('portal — estimate accept/decline', () => {
  it('accepts a sent estimate belonging to the authenticated customer', async () => {
    const email = `accept+${Date.now()}@example.com`
    const { business, user, customer } = await seedBusinessWithCustomer(email)
    const estimate = await seedSentEstimate(business.id, customer.id, user.id)

    const sessionToken = await loginToPortal(business.id, customer.id)
    const { app } = await import('../../../server.js')
    const res = await app.request(`/portal/estimates/${estimate.id}/accept`, {
      method: 'POST',
      headers: authCookie('portal_session', sessionToken),
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { status: string }
    expect(body.status).toBe('accepted')

    // Audited with no staff actor
    const { db: appDb } = await import('../../../db/client.js')
    const schema = await import('../../../db/schema/index.js')
    const { eq, and } = await import('drizzle-orm')
    const [logRow] = await appDb
      .select()
      .from(schema.auditLogs)
      .where(
        and(
          eq(schema.auditLogs.entityId, estimate.id),
          eq(schema.auditLogs.action, 'estimate.accepted'),
        ),
      )
    expect(logRow?.userId).toBeNull()
  })

  it("cannot accept another customer's estimate", async () => {
    const email = `declineother+${Date.now()}@example.com`
    const { business, user, customer } = await seedBusinessWithCustomer(email)
    const otherEmail = `declineother2+${Date.now()}@example.com`
    const { db: appDb } = await import('../../../db/client.js')
    const schema = await import('../../../db/schema/index.js')
    const [otherCustomer] = await appDb
      .insert(schema.customers)
      .values({
        businessId: business.id,
        name: 'Other',
        tin: null,
        email: otherEmail,
        phone: null,
        address: null,
        creditTermsDays: '30',
        creditLimit: null,
        notes: null,
        createdBy: user.id,
        updatedBy: user.id,
      })
      .returning()

    const estimate = await seedSentEstimate(business.id, otherCustomer!.id, user.id)
    const sessionToken = await loginToPortal(business.id, customer.id)
    const { app } = await import('../../../server.js')
    const res = await app.request(`/portal/estimates/${estimate.id}/accept`, {
      method: 'POST',
      headers: authCookie('portal_session', sessionToken),
    })
    expect(res.status).toBe(404)
  })
})

describe('portal — draft documents are never exposed', () => {
  it('excludes a draft invoice from the list and 404s its detail route', async () => {
    const email = `draftinv+${Date.now()}@example.com`
    const { business, user, customer } = await seedBusinessWithCustomer(email)
    const issued = await seedIssuedInvoice(business.id, customer.id, user.id)

    const invoicingSvc = await import('../../invoicing/service.js')
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }
    const draft = await invoicingSvc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [
          {
            description: 'Draft item',
            qty: '1.0000',
            unitPrice: '10.00',
            gstCategory: 'general_8',
          },
        ],
      },
      ctx,
    )

    const sessionToken = await loginToPortal(business.id, customer.id)
    const { app } = await import('../../../server.js')

    const listRes = await app.request('/portal/invoices', {
      headers: authCookie('portal_session', sessionToken),
    })
    const listBody = (await listRes.json()) as { items: { id: string }[]; total: number }
    expect(listBody.total).toBe(1)
    expect(listBody.items.map((i) => i.id)).toEqual([issued.id])
    expect(listBody.items.map((i) => i.id)).not.toContain(draft.id)

    const detailRes = await app.request(`/portal/invoices/${draft.id}`, {
      headers: authCookie('portal_session', sessionToken),
    })
    expect(detailRes.status).toBe(404)
  })

  it('excludes a draft estimate from the list and 404s its detail route', async () => {
    const email = `draftest+${Date.now()}@example.com`
    const { business, user, customer } = await seedBusinessWithCustomer(email)
    const sent = await seedSentEstimate(business.id, customer.id, user.id)

    const estimatesSvc = await import('../../estimates/service.js')
    const ctx = { userId: user.id, businessId: business.id, ip: '127.0.0.1', ua: undefined }
    const draft = await estimatesSvc.createDraft(
      business.id,
      {
        customerId: customer.id,
        lines: [
          {
            description: 'Draft quote',
            qty: '1.0000',
            unitPrice: '10.00',
            gstCategory: 'general_8',
          },
        ],
      },
      ctx,
    )

    const sessionToken = await loginToPortal(business.id, customer.id)
    const { app } = await import('../../../server.js')

    const listRes = await app.request('/portal/estimates', {
      headers: authCookie('portal_session', sessionToken),
    })
    const listBody = (await listRes.json()) as { items: { id: string }[]; total: number }
    expect(listBody.total).toBe(1)
    expect(listBody.items.map((i) => i.id)).toEqual([sent.id])
    expect(listBody.items.map((i) => i.id)).not.toContain(draft.id)

    const detailRes = await app.request(`/portal/estimates/${draft.id}`, {
      headers: authCookie('portal_session', sessionToken),
    })
    expect(detailRes.status).toBe(404)

    const acceptRes = await app.request(`/portal/estimates/${draft.id}/accept`, {
      method: 'POST',
      headers: authCookie('portal_session', sessionToken),
    })
    expect(acceptRes.status).toBe(404)
  })
})

describe('portal auth — session cap', () => {
  it('caps active portal sessions at 10, evicting the oldest', async () => {
    const email = `sessioncap+${Date.now()}@example.com`
    const { business, customer } = await seedBusinessWithCustomer(email)

    const tokens: string[] = []
    for (let i = 0; i < 11; i++) {
      tokens.push(await loginToPortal(business.id, customer.id))
    }

    const { db: appDb } = await import('../../../db/client.js')
    const schema = await import('../../../db/schema/index.js')
    const { eq, and } = await import('drizzle-orm')
    const activeSessions = await appDb
      .select()
      .from(schema.portalSessions)
      .where(
        and(
          eq(schema.portalSessions.customerId, customer.id),
          eq(schema.portalSessions.isActive, true),
        ),
      )
    expect(activeSessions).toHaveLength(10)

    // The very first session (oldest) must have been evicted; the most
    // recent one is still usable.
    const { app } = await import('../../../server.js')
    const firstRes = await app.request('/portal/me', {
      headers: authCookie('portal_session', tokens[0]!),
    })
    expect(firstRes.status).toBe(401)

    const lastRes = await app.request('/portal/me', {
      headers: authCookie('portal_session', tokens[10]!),
    })
    expect(lastRes.status).toBe(200)
  })
})

describe('portal auth — verify checks the customer still exists first', () => {
  it('rejects verify for a customer soft-deleted between token issue and verify, with no orphaned session', async () => {
    const email = `softdel+${Date.now()}@example.com`
    const { business, customer } = await seedBusinessWithCustomer(email)

    const crypto = await import('node:crypto')
    const token = crypto.randomBytes(32).toString('hex')
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
    const portalAuthRepo = await import('../../portalAuth/repository.js')
    await portalAuthRepo.createToken({
      businessId: business.id,
      customerId: customer.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    })

    // Soft-delete the customer after the token was issued but before it's verified.
    const { db: appDb } = await import('../../../db/client.js')
    const schema = await import('../../../db/schema/index.js')
    const { eq } = await import('drizzle-orm')
    await appDb
      .update(schema.customers)
      .set({ deletedAt: new Date() })
      .where(eq(schema.customers.id, customer.id))

    const { app } = await import('../../../server.js')
    const res = await app.request('/portal/auth/magic-link/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Real-IP': nextTestIp() },
      body: JSON.stringify({ token }),
    })
    expect(res.status).toBe(401)
    // No cookie should have been set for a session that was never created.
    expect(res.headers.get('set-cookie')).toBeNull()

    const sessions = await appDb
      .select()
      .from(schema.portalSessions)
      .where(eq(schema.portalSessions.customerId, customer.id))
    expect(sessions).toHaveLength(0)
  })
})

describe('portal auth — logout', () => {
  it('deactivates the session so the cookie no longer works', async () => {
    const email = `logout+${Date.now()}@example.com`
    const { business, customer } = await seedBusinessWithCustomer(email)
    const sessionToken = await loginToPortal(business.id, customer.id)
    const { app } = await import('../../../server.js')

    const logoutRes = await app.request('/portal/auth/logout', {
      method: 'POST',
      headers: authCookie('portal_session', sessionToken),
    })
    expect(logoutRes.status).toBe(204)

    const afterRes = await app.request('/portal/invoices', {
      headers: authCookie('portal_session', sessionToken),
    })
    expect(afterRes.status).toBe(401)
  })
})
