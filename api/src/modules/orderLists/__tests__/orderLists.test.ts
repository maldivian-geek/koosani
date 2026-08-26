import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDatabase } from '../../../db/test-db.js'
import postgres from 'postgres'
import * as argon2 from 'argon2'
import jwt from 'jsonwebtoken'
import type { PermissionResource, PermissionAction } from '@koosani/shared'

// Phase 34 — see ARCHITECTURE.md §4.16. Order lists are a lightweight,
// non-financial checklist: no GST, no numbering, no stock movement.

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
      name: `OrderList Test Biz ${Date.now()}-${Math.random()}`,
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
      email: `ol+${Date.now()}+${Math.random()}@example.com`,
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

function ctxFor(userId: string, businessId: string) {
  return { userId, businessId, ip: '127.0.0.1', ua: undefined }
}

function authHeaders(token: string) {
  return { 'Content-Type': 'application/json', Cookie: `session=${token}` }
}

async function auditRowsFor(businessId: string, action: string) {
  const { db: appDb } = await import('../../../db/client.js')
  const schema = await import('../../../db/schema/index.js')
  const { and, eq } = await import('drizzle-orm')
  return appDb
    .select()
    .from(schema.auditLogs)
    .where(and(eq(schema.auditLogs.businessId, businessId), eq(schema.auditLogs.action, action)))
}

describe('orderLists — service happy paths', () => {
  it('creates a list, adds lines, patches line status, and reads it back with lines', async () => {
    const { business, user } = await seedBusiness()
    const svc = await import('../service.js')

    const list = await svc.createOrderList(
      business.id,
      { title: 'Weekly stock order', notes: 'from the paper list' },
      ctxFor(user.id, business.id),
    )
    expect(list.title).toBe('Weekly stock order')
    expect(list.lines).toHaveLength(0)

    const line1 = await svc.addLine(
      business.id,
      list.id,
      { itemName: 'Rice 25kg', qty: '2', uom: 'Bag' },
      ctxFor(user.id, business.id),
    )
    const line2 = await svc.addLine(
      business.id,
      list.id,
      { itemName: 'Cooking oil', qty: '10', uom: 'Each' },
      ctxFor(user.id, business.id),
    )
    expect(line1.position).toBe(0)
    expect(line2.position).toBe(1)
    expect(line1.paymentStatus).toBe('pending')
    expect(line1.stockStatus).toBe('unknown')

    const patched = await svc.patchLine(
      business.id,
      list.id,
      line1.id,
      { paymentStatus: 'paid', stockStatus: 'in_stock' },
      ctxFor(user.id, business.id),
    )
    expect(patched.paymentStatus).toBe('paid')
    expect(patched.stockStatus).toBe('in_stock')

    const full = await svc.getOrderList(business.id, list.id)
    expect(full.lines).toHaveLength(2)
    expect(full.lines[0]?.itemName).toBe('Rice 25kg')

    // Every mutation writes an audit row in the same transaction (CLAUDE.md §4).
    const createRows = await auditRowsFor(business.id, 'order_list.create')
    expect(createRows).toHaveLength(1)
    expect(createRows[0]?.entityId).toBe(list.id)

    const lineUpdateRows = await auditRowsFor(business.id, 'order_list.line_update')
    expect(lineUpdateRows).toHaveLength(1)
    expect(lineUpdateRows[0]?.entityId).toBe(list.id)
  })

  it('deletes a line and soft-deletes a list', async () => {
    const { business, user } = await seedBusiness()
    const svc = await import('../service.js')

    const list = await svc.createOrderList(
      business.id,
      { title: 'Delete-test list' },
      ctxFor(user.id, business.id),
    )
    const line = await svc.addLine(
      business.id,
      list.id,
      { itemName: 'Flour', qty: '5', uom: 'Bag' },
      ctxFor(user.id, business.id),
    )

    await svc.deleteLine(business.id, list.id, line.id, ctxFor(user.id, business.id))
    const afterLineDelete = await svc.getOrderList(business.id, list.id)
    expect(afterLineDelete.lines).toHaveLength(0)

    await svc.softDeleteOrderList(business.id, list.id, ctxFor(user.id, business.id))
    await expect(svc.getOrderList(business.id, list.id)).rejects.toThrow(svc.NotFoundError)

    const deleteRows = await auditRowsFor(business.id, 'order_list.delete')
    expect(deleteRows).toHaveLength(1)
  })

  it('lists order lists scoped to the calling business only', async () => {
    const { business: businessA, user: userA } = await seedBusiness()
    const { business: businessB, user: userB } = await seedBusiness()
    const svc = await import('../service.js')

    await svc.createOrderList(businessA.id, { title: 'A list' }, ctxFor(userA.id, businessA.id))
    await svc.createOrderList(businessB.id, { title: 'B list' }, ctxFor(userB.id, businessB.id))

    const resultA = await svc.listOrderLists(businessA.id, { q: undefined, page: 1, pageSize: 50 })
    expect(resultA.items).toHaveLength(1)
    expect(resultA.items[0]?.title).toBe('A list')
    expect(resultA.items[0]?.lineCount).toBe(0)
  })
})

describe('orderLists — error paths', () => {
  it('throws NotFoundError for cross-business access to a list', async () => {
    const { business: businessA, user: userA } = await seedBusiness()
    const { business: businessB } = await seedBusiness()
    const svc = await import('../service.js')

    const list = await svc.createOrderList(
      businessA.id,
      { title: 'Private list' },
      ctxFor(userA.id, businessA.id),
    )

    await expect(svc.getOrderList(businessB.id, list.id)).rejects.toThrow(svc.NotFoundError)
  })

  it('rejects an invalid create payload with 400 at the route boundary', async () => {
    const { token } = await seedBusiness('admin')
    const { app } = await import('../../../server.js')

    const res = await app.request('/order-lists', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ title: '' }),
    })
    expect(res.status).toBe(400)
  })

  it('returns 403 for staff without an explicit orders:add grant', async () => {
    const { token } = await seedBusiness('staff')
    const { app } = await import('../../../server.js')

    const res = await app.request('/order-lists', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ title: 'Staff attempt' }),
    })
    expect(res.status).toBe(403)
  })

  it('returns not_found via HTTP for a cross-business order list id', async () => {
    const { business: businessA, user: userA } = await seedBusiness()
    const { token: tokenB } = await seedBusiness('admin')
    const svc = await import('../service.js')
    const { app } = await import('../../../server.js')

    const list = await svc.createOrderList(
      businessA.id,
      { title: 'Only visible to A' },
      ctxFor(userA.id, businessA.id),
    )

    const res = await app.request(`/order-lists/${list.id}`, { headers: authHeaders(tokenB) })
    expect(res.status).toBe(404)
  })
})

describe('orderLists — routes', () => {
  it('admin can create a list, add a line, patch its status via HTTP, and list it', async () => {
    const { token } = await seedBusiness('admin')
    const { app } = await import('../../../server.js')

    const createRes = await app.request('/order-lists', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ title: 'HTTP order list' }),
    })
    expect(createRes.status).toBe(201)
    const list = (await createRes.json()) as { id: string }

    const lineRes = await app.request(`/order-lists/${list.id}/lines`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ itemName: 'Sugar 50kg', qty: '3', uom: 'Bag' }),
    })
    expect(lineRes.status).toBe(201)
    const line = (await lineRes.json()) as { id: string }

    const patchRes = await app.request(`/order-lists/${list.id}/lines/${line.id}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ paymentStatus: 'paid' }),
    })
    expect(patchRes.status).toBe(200)
    const patched = (await patchRes.json()) as { paymentStatus: string }
    expect(patched.paymentStatus).toBe('paid')

    const listRes = await app.request('/order-lists', { headers: authHeaders(token) })
    expect(listRes.status).toBe(200)
    const body = (await listRes.json()) as { items: unknown[]; total: number }
    expect(body.total).toBe(1)
  })
})

// ─── Phase 37 — staff view gating on GET /order-lists ────────────────────────

async function grantPermission(
  businessId: string,
  userId: string,
  resource: PermissionResource,
  action: PermissionAction,
) {
  const { db: appDb } = await import('../../../db/client.js')
  const schema = await import('../../../db/schema/index.js')
  await appDb.insert(schema.userPermissions).values({
    businessId,
    userId,
    resource,
    action,
    grantedBy: userId,
  })
}

describe('orderLists — Phase 37 staff view gating', () => {
  it('staff with no grants gets 403 on GET /order-lists', async () => {
    const { token } = await seedBusiness('staff')
    const { app } = await import('../../../server.js')

    const res = await app.request('/order-lists', { headers: authHeaders(token) })
    expect(res.status).toBe(403)
  })

  it('staff with only {orders,view} gets 200 on GET but 403 on POST', async () => {
    const { business, user, token } = await seedBusiness('staff')
    await grantPermission(business.id, user.id, 'orders', 'view')
    const { app } = await import('../../../server.js')

    const getRes = await app.request('/order-lists', { headers: authHeaders(token) })
    expect(getRes.status).toBe(200)

    const postRes = await app.request('/order-lists', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ title: 'Staff view-only attempt' }),
    })
    expect(postRes.status).toBe(403)
  })

  it('staff with {orders,add} gets 200 on GET (implied view)', async () => {
    const { business, user, token } = await seedBusiness('staff')
    await grantPermission(business.id, user.id, 'orders', 'add')
    const { app } = await import('../../../server.js')

    const getRes = await app.request('/order-lists', { headers: authHeaders(token) })
    expect(getRes.status).toBe(200)

    const postRes = await app.request('/order-lists', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ title: 'Staff with add grant' }),
    })
    expect(postRes.status).toBe(201)
  })
})

// ─── Paste/CSV import ────────────────────────────────────────────────────────

describe('order lists — paste/CSV import', () => {
  it('parseImportText maps positional columns, skips headers and junk, normalizes qty', async () => {
    const { parseImportText } = await import('../../../lib/order-list-import.js')

    const text = [
      'ITEM\tQTY\tUI\tNOTE\tAdditional Notes',
      'TS BISCOLATA MOOD 135 GM - TIN\t24\tEach',
      'TS CHICKEN 900G\t54\tEach\t\t20',
      'TS XL ENERGY DRINK REGULAR 250ML\t1,200.00\tEach',
      '\t\t',
      'TS DENIM AFTER SHAVE BLACK 100ML\tabc\tEach\tBLACK',
    ].join('\n')

    const { lines, skipped } = parseImportText(text)
    expect(lines).toHaveLength(4)
    expect(skipped).toBe(2) // header + empty row
    expect(lines[0]).toMatchObject({
      itemName: 'TS BISCOLATA MOOD 135 GM - TIN',
      qty: '24',
      uom: 'Each',
    })
    expect(lines[1]).toMatchObject({ qty: '54', additionalNote: '20' })
    expect(lines[2]?.qty).toBe('1200.00')
    expect(lines[3]).toMatchObject({ qty: '1', note: 'BLACK' }) // non-numeric qty defaults to 1
  })

  it('parses comma-delimited text when no tabs are present', async () => {
    const { parseImportText } = await import('../../../lib/order-list-import.js')
    const { lines } = parseImportText('PRINGLES,48,Each\n"TS SUPER RING 60GR",60,Each,CHEESE BALL')
    expect(lines).toHaveLength(2)
    expect(lines[1]).toMatchObject({ itemName: 'TS SUPER RING 60GR', note: 'CHEESE BALL' })
  })

  it('POST /:id/lines/parse returns drafts without persisting; /lines/bulk creates them with one audit row', async () => {
    const { app } = await import('../../../server.js')
    const { business, token } = await seedBusiness('admin')

    const createRes = await app.request('/order-lists', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ title: 'Import test' }),
    })
    expect(createRes.status).toBe(201)
    const list = (await createRes.json()) as { id: string }

    const parseRes = await app.request(`/order-lists/${list.id}/lines/parse`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ text: 'A\t2\tEach\nB\t3\tBox\tnote1' }),
    })
    expect(parseRes.status).toBe(200)
    const parsed = (await parseRes.json()) as { lines: unknown[]; skipped: number }
    expect(parsed.lines).toHaveLength(2)

    // Nothing persisted by parse
    const detailBefore = await app.request(`/order-lists/${list.id}`, {
      headers: authHeaders(token),
    })
    expect(((await detailBefore.json()) as { lines: unknown[] }).lines).toHaveLength(0)

    const bulkRes = await app.request(`/order-lists/${list.id}/lines/bulk`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ lines: parsed.lines }),
    })
    expect(bulkRes.status).toBe(201)
    const bulk = (await bulkRes.json()) as { lines: Array<{ position: number; itemName: string }> }
    expect(bulk.lines).toHaveLength(2)
    expect(bulk.lines.map((l) => l.position)).toEqual([0, 1])

    const auditRows = await auditRowsFor(business.id, 'order_list.import')
    expect(auditRows).toHaveLength(1)
    expect((auditRows[0]?.afterJson as { count: number }).count).toBe(2)
  })

  it('bulk import rejects more than 500 rows and 404s on another business list', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness('admin')
    const other = await seedBusiness('admin')

    const createRes = await app.request('/order-lists', {
      method: 'POST',
      headers: authHeaders(other.token),
      body: JSON.stringify({ title: 'Other biz list' }),
    })
    const otherList = (await createRes.json()) as { id: string }

    const tooMany = Array.from({ length: 501 }, (_, i) => ({
      itemName: `X${i}`,
      qty: '1',
      uom: 'Each',
    }))
    const ownListRes = await app.request('/order-lists', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ title: 'Own list' }),
    })
    const ownList = (await ownListRes.json()) as { id: string }

    const capRes = await app.request(`/order-lists/${ownList.id}/lines/bulk`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ lines: tooMany }),
    })
    expect(capRes.status).toBe(400)

    const crossRes = await app.request(`/order-lists/${otherList.id}/lines/bulk`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ lines: [{ itemName: 'A', qty: '1', uom: 'Each' }] }),
    })
    expect(crossRes.status).toBe(404)
  })
})

// ─── System item name resolution ─────────────────────────────────────────────

describe('order lists — system item name resolution', () => {
  it('resolves a line item name (customer wording) to the catalogue name, case-insensitively', async () => {
    const { app } = await import('../../../server.js')
    const { db: appDb } = await import('../../../db/client.js')
    const schema = await import('../../../db/schema/index.js')
    const { business, token } = await seedBusiness('admin')

    await appDb.insert(schema.items).values({
      businessId: business.id,
      sku: `SKU-${Date.now()}`,
      name: 'Chicken Whole 900g (Frozen)',
      customerItemName: 'TS CHICKEN 900G',
      unit: 'pcs',
      gstCategory: 'general_8',
      createdBy: business.id,
      updatedBy: business.id,
    })

    const createRes = await app.request('/order-lists', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ title: 'Resolution test' }),
    })
    const list = (await createRes.json()) as { id: string }

    // Line matching the customer item name in a different case
    const addRes = await app.request(`/order-lists/${list.id}/lines`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ itemName: 'ts chicken 900g', qty: '54', uom: 'Each' }),
    })
    expect(addRes.status).toBe(201)
    const added = (await addRes.json()) as { systemItemName: string | null }
    expect(added.systemItemName).toBe('Chicken Whole 900g (Frozen)')

    // Line with no catalogue match
    await app.request(`/order-lists/${list.id}/lines`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ itemName: 'UNMATCHED THING', qty: '1', uom: 'Each' }),
    })

    const detail = await app.request(`/order-lists/${list.id}`, { headers: authHeaders(token) })
    const body = (await detail.json()) as {
      lines: Array<{ itemName: string; systemItemName: string | null }>
    }
    expect(body.lines.find((l) => l.itemName === 'ts chicken 900g')?.systemItemName).toBe(
      'Chicken Whole 900g (Frozen)',
    )
    expect(body.lines.find((l) => l.itemName === 'UNMATCHED THING')?.systemItemName).toBeNull()

    // Renaming the line via PATCH re-resolves
    const lineId = (
      (await (
        await app.request(`/order-lists/${list.id}`, { headers: authHeaders(token) })
      ).json()) as { lines: Array<{ id: string; itemName: string }> }
    ).lines.find((l) => l.itemName === 'UNMATCHED THING')?.id
    const patchRes = await app.request(`/order-lists/${list.id}/lines/${lineId}`, {
      method: 'PATCH',
      headers: authHeaders(token),
      body: JSON.stringify({ itemName: 'TS CHICKEN 900G' }),
    })
    const patched = (await patchRes.json()) as { systemItemName: string | null }
    expect(patched.systemItemName).toBe('Chicken Whole 900g (Frozen)')
  })
})

// ─── Phase 38 — CSV export ────────────────────────────────────────────────────

describe('order lists — CSV export', () => {
  it('returns a 200 CSV with the header row and a correctly quoted seeded line', async () => {
    const { app } = await import('../../../server.js')
    const { token } = await seedBusiness('admin')

    const createRes = await app.request('/order-lists', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ title: 'CSV export test' }),
    })
    const list = (await createRes.json()) as { id: string }

    // A line whose fields need CSV quoting: a comma in the item name and a
    // quote in the note.
    await app.request(`/order-lists/${list.id}/lines`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        itemName: 'Rice, 25kg',
        qty: '2.5000',
        uom: 'Bag',
        note: 'Ask for "fresh" stock',
      }),
    })

    const csvRes = await app.request(`/order-lists/${list.id}/csv`, { headers: authHeaders(token) })
    expect(csvRes.status).toBe(200)
    expect(csvRes.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(csvRes.headers.get('content-disposition')).toContain(
      'attachment; filename="order-list-csv-export-test.csv"',
    )

    const body = await csvRes.text()
    const rows = body.split('\n')
    expect(rows[0]).toBe(
      '#,Item,System Item,Qty,UOM,Note,Additional Note,Payment Status,Stock Status',
    )
    // Comma in item name → quoted; embedded quote → doubled; qty trimmed to "2.5".
    expect(rows[1]).toBe('1,"Rice, 25kg",,2.5,Bag,"Ask for ""fresh"" stock",,Pending,Unknown')
  })

  it('returns 403 for staff without any orders grant', async () => {
    const { token } = await seedBusiness('admin')
    const { token: staffToken } = await seedBusiness('staff')

    const { app } = await import('../../../server.js')
    const createRes = await app.request('/order-lists', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ title: 'Staff-blocked list' }),
    })
    const list = (await createRes.json()) as { id: string }

    const csvRes = await app.request(`/order-lists/${list.id}/csv`, {
      headers: authHeaders(staffToken),
    })
    expect(csvRes.status).toBe(403)
  })

  it('returns 404 for a cross-business order list id', async () => {
    const { business: businessA, user: userA } = await seedBusiness()
    const { token: tokenB } = await seedBusiness('admin')
    const svc = await import('../service.js')
    const { app } = await import('../../../server.js')

    const list = await svc.createOrderList(
      businessA.id,
      { title: 'Only visible to A (csv)' },
      ctxFor(userA.id, businessA.id),
    )

    const res = await app.request(`/order-lists/${list.id}/csv`, { headers: authHeaders(tokenB) })
    expect(res.status).toBe(404)
  })
})
