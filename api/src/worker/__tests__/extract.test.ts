import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { createTestDatabase } from '../../db/test-db.js'
import postgres from 'postgres'
import * as argon2 from 'argon2'
import jwt from 'jsonwebtoken'
import type { OcrWord } from '../../lib/ocr-engine.js'

// Order-list "import from image" — OCR (Phase 36, ARCHITECTURE.md §4.16).
// Full round-trip like worker/__tests__/pdf.test.ts: HTTP route enqueues →
// the extract worker (registered here, in this same process) picks the job
// up → mocked OCR → real clustering (order-list-ocr.ts) → real parse
// (order-list-import.ts) → the route's job.waitUntilFinished resolves.
// `lib/ocr-engine.ts` is mocked so no real OCR/network runs in CI — nothing
// downstream of the OcrWord[] contract needs to know the difference.

vi.mock('../../lib/ocr-engine.js', () => ({
  ocrImage: vi.fn(async (): Promise<OcrWord[]> => MOCK_WORDS),
}))

// A single clean row — "RICE 25 KG" | "10" — built with the same hand-picked
// gap ratios verified in lib/__tests__/order-list-ocr.test.ts (more small
// intra-word gaps than large inter-cell gaps, so the median-based clustering
// threshold lands cleanly).
const MOCK_WORDS: OcrWord[] = [
  { text: 'RICE', x0: 0, y0: 0, x1: 30, y1: 20 },
  { text: '25', x0: 34, y0: 0, x1: 50, y1: 20 },
  { text: 'KG', x0: 54, y0: 0, x1: 80, y1: 20 },
  { text: '10', x0: 300, y0: 0, x1: 320, y1: 20 },
]

// Minimal valid 1x1 PNG (verified against the installed `file-type` package
// — detects as image/png by magic bytes, not by extension/declared type).
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

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

  const { registerExtractWorker } = await import('../extract.js')
  const worker = registerExtractWorker()
  stopWorker = () => worker.close()
}, 60_000)

afterAll(async () => {
  await stopWorker?.()
  await client?.end()
})

async function seedBusiness(role: 'admin' | 'manager' | 'staff' = 'admin') {
  const { db: appDb } = await import('../../db/client.js')
  const schema = await import('../../db/schema/index.js')

  const [business] = await appDb
    .insert(schema.businesses)
    .values({
      name: `Extract Test Biz ${Date.now()}-${Math.random()}`,
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
      email: `extract+${Date.now()}+${Math.random()}@example.com`,
      name: 'Extract Tester',
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

function jsonHeaders(token: string) {
  return { 'Content-Type': 'application/json', Cookie: `session=${token}` }
}

// No Content-Type here — fetch/undici sets `multipart/form-data;
// boundary=...` automatically from the FormData body, matching how a real
// browser upload behaves (and how web/src/lib/apiFetch.ts skips the header
// for FormData bodies).
function multipartHeaders(token: string) {
  return { Cookie: `session=${token}` }
}

async function createOrderList(token: string, title: string) {
  const { app } = await import('../../server.js')
  const res = await app.request('/order-lists', {
    method: 'POST',
    headers: jsonHeaders(token),
    body: JSON.stringify({ title }),
  })
  return (await res.json()) as { id: string }
}

function pngFormData(filename = 'order.png', mime = 'image/png'): FormData {
  const buffer = Buffer.from(PNG_BASE64, 'base64')
  const formData = new FormData()
  formData.append('file', new Blob([buffer], { type: mime }), filename)
  return formData
}

describe('extract worker — order list image import end-to-end', () => {
  it('OCRs an image via the queue and returns parsed draft lines', async () => {
    const { app } = await import('../../server.js')
    const { token } = await seedBusiness('admin')
    const list = await createOrderList(token, 'Image import test')

    const res = await app.request(`/order-lists/${list.id}/lines/extract-image`, {
      method: 'POST',
      headers: multipartHeaders(token),
      body: pngFormData(),
    })

    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      lines: Array<{ itemName: string; qty: string }>
      skipped: number
    }
    expect(body.lines).toHaveLength(1)
    expect(body.lines[0]).toMatchObject({ itemName: 'RICE 25 KG', qty: '10', uom: 'Each' })
    expect(body.skipped).toBe(0)

    // Nothing persisted — same review-and-confirm contract as /lines/parse.
    const detail = await app.request(`/order-lists/${list.id}`, { headers: jsonHeaders(token) })
    expect(((await detail.json()) as { lines: unknown[] }).lines).toHaveLength(0)
  }, 30_000)

  it('rejects a text file disguised as a PNG with 415 (magic-byte sniff)', async () => {
    const { app } = await import('../../server.js')
    const { token } = await seedBusiness('admin')
    const list = await createOrderList(token, 'Bad upload test')

    const formData = new FormData()
    formData.append(
      'file',
      new Blob([Buffer.from('not actually a png, just text')], { type: 'image/png' }),
      'fake.png',
    )

    const res = await app.request(`/order-lists/${list.id}/lines/extract-image`, {
      method: 'POST',
      headers: multipartHeaders(token),
      body: formData,
    })
    expect(res.status).toBe(415)
  })

  it('404s for a cross-business order list id', async () => {
    const { app } = await import('../../server.js')
    const { token: ownerToken } = await seedBusiness('admin')
    const { token: otherToken } = await seedBusiness('admin')
    const list = await createOrderList(ownerToken, 'Owner-only list')

    const res = await app.request(`/order-lists/${list.id}/lines/extract-image`, {
      method: 'POST',
      headers: multipartHeaders(otherToken),
      body: pngFormData(),
    })
    expect(res.status).toBe(404)
  })

  it('returns 403 for staff without an explicit orders:add grant', async () => {
    const { app } = await import('../../server.js')
    const { token } = await seedBusiness('staff')

    const res = await app.request(
      `/order-lists/00000000-0000-0000-0000-000000000000/lines/extract-image`,
      {
        method: 'POST',
        headers: multipartHeaders(token),
        body: pngFormData(),
      },
    )
    expect(res.status).toBe(403)
  })
})
