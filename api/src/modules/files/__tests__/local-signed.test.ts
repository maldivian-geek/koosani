import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDatabase } from '../../../db/test-db.js'
import postgres from 'postgres'

// The local storage backend's signed-download URLs (SECURITY.md §13.5 rule 5
// semantics — HMAC signature + expiry IS the authorization; forced download).

let client: ReturnType<typeof postgres>

beforeAll(async () => {
  const url = await createTestDatabase()
  process.env['DATABASE_URL'] = url
  process.env['REDIS_URL'] = process.env['REDIS_URL'] ?? 'redis://localhost:6380/1'
  process.env['JWT_SECRET'] = 'test-secret-at-least-32-chars-long-xx'
  process.env['FRONTEND_URL'] = 'http://localhost:5173'
  process.env['NODE_ENV'] = 'test'
  client = postgres(url, { max: 1 })
}, 60_000)

afterAll(async () => {
  await client?.end()
})

const PDF_BYTES = Buffer.from('%PDF-1.4\n%%EOF\n')

describe('local storage signed downloads', () => {
  it('serves a stored file through its signed URL with forced-download headers', async () => {
    const { storage } = await import('../../../lib/storage.js')
    const { app } = await import('../../../server.js')

    const key = `test-biz/uploads/${Date.now()}-signed.pdf`
    await storage.put(key, PDF_BYTES, 'application/pdf')
    const signedUrl = await storage.getSignedUrl(key, 300)

    const u = new URL(signedUrl)
    expect(u.pathname).toBe('/files/local')

    const res = await app.request(u.pathname + u.search)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-disposition')).toContain('attachment')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    const body = Buffer.from(await res.arrayBuffer())
    expect(body.equals(PDF_BYTES)).toBe(true)
  })

  it('rejects a tampered signature and an expired link', async () => {
    const { storage, signLocalKey } = await import('../../../lib/storage.js')
    const { app } = await import('../../../server.js')

    const key = `test-biz/uploads/${Date.now()}-tamper.pdf`
    await storage.put(key, PDF_BYTES, 'application/pdf')
    const signedUrl = await storage.getSignedUrl(key, 300)
    const u = new URL(signedUrl)

    // Tampered signature
    u.searchParams.set('sig', 'f'.repeat(64))
    expect((await app.request(u.pathname + '?' + u.searchParams.toString())).status).toBe(403)

    // Expired (correctly signed for a past exp)
    const pastExp = Math.floor(Date.now() / 1000) - 60
    const expired = new URLSearchParams({
      key,
      exp: String(pastExp),
      sig: signLocalKey(key, pastExp),
    })
    expect((await app.request('/files/local?' + expired.toString())).status).toBe(403)
  })

  it('rejects path traversal even with a matching signature shape', async () => {
    const { signLocalKey } = await import('../../../lib/storage.js')
    const { app } = await import('../../../server.js')

    const evil = '../../../etc/passwd'
    const exp = Math.floor(Date.now() / 1000) + 300
    const qs = new URLSearchParams({ key: evil, exp: String(exp), sig: signLocalKey(evil, exp) })
    expect((await app.request('/files/local?' + qs.toString())).status).toBe(403)
  })

  it('does not require a session cookie (signature is the authorization)', async () => {
    const { storage } = await import('../../../lib/storage.js')
    const { app } = await import('../../../server.js')

    const key = `test-biz/uploads/${Date.now()}-noauth.pdf`
    await storage.put(key, PDF_BYTES, 'application/pdf')
    const u = new URL(await storage.getSignedUrl(key, 300))
    // Explicitly no Cookie header
    const res = await app.request(u.pathname + u.search, { headers: {} })
    expect(res.status).toBe(200)
  })
})
