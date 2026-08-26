import { Hono } from 'hono'
import { fileTypeFromBuffer } from 'file-type'
import { requireAuth } from '../../middleware/requireAuth.js'
import { getRealIp } from '../../lib/ip.js'
import { storage, verifyLocalKey } from '../../lib/storage.js'
import { config } from '../../lib/config.js'
import * as svc from './service.js'
import type { AppEnv } from '../../types.js'

// Public (signature-authenticated) download route backing the LOCAL storage
// backend's signed URLs — mounted at /files/local BEFORE the cookie-auth'd
// /files router (server.ts). The HMAC signature + expiry IS the
// authorization, exactly like an S3 signed URL; forced download + nosniff
// per SECURITY.md §13.5 rule 5. 404s outright when the s3 backend is active.
export const localFileRoutes = new Hono<AppEnv>()
localFileRoutes.get('/', async (c) => {
  if (config.FILES_STORAGE !== 'local') return c.json({ error: 'not_found' }, 404)

  const key = c.req.query('key') ?? ''
  const exp = Number(c.req.query('exp') ?? '')
  const sig = c.req.query('sig') ?? ''
  // Signature already binds the exact server-minted key, but reject path
  // traversal outright as defense-in-depth (keys are server-generated and
  // never contain '..').
  if (!key || key.includes('..') || !sig || !verifyLocalKey(key, exp, sig)) {
    return c.json({ error: 'forbidden' }, 403)
  }

  let data: Buffer
  try {
    data = await storage.get(key)
  } catch {
    return c.json({ error: 'not_found' }, 404)
  }

  const detected = await fileTypeFromBuffer(data)
  const filename = key.split('/').pop() ?? 'download'
  c.header('Content-Type', detected?.mime ?? 'application/octet-stream')
  c.header('Content-Disposition', `attachment; filename="${filename}"`)
  c.header('X-Content-Type-Options', 'nosniff')
  return c.body(new Uint8Array(data))
})

export const fileRoutes = new Hono<AppEnv>()
fileRoutes.use('*', requireAuth)

// POST /files — multipart upload; returns { id, url }
fileRoutes.post('/', async (c) => {
  const formData = await c.req.formData()
  const entry = formData.get('file')
  if (!entry || !(entry instanceof File)) return c.json({ error: 'file field required' }, 400)

  const buffer = Buffer.from(await entry.arrayBuffer())
  const ctx = {
    userId: c.get('userId'),
    businessId: c.get('businessId'),
    ip: getRealIp(c),
    ua: c.req.header('user-agent'),
  }

  try {
    const record = await svc.uploadFile(c.get('businessId'), buffer, entry.name, entry.type, ctx)
    const url = await svc.getSignedUrl(c.get('businessId'), record.id)
    return c.json({ id: record.id, url }, 201)
  } catch (err) {
    if (err instanceof svc.ValidationError) return c.json({ error: err.message }, 422)
    throw err
  }
})

// GET /files/:id/url — returns { url }
fileRoutes.get('/:id/url', async (c) => {
  try {
    const url = await svc.getSignedUrl(c.get('businessId'), c.req.param('id'))
    return c.json({ url })
  } catch (err) {
    if (err instanceof svc.NotFoundError) return c.json({ error: 'not_found' }, 404)
    throw err
  }
})
