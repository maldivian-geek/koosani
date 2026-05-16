import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { serve } from '@hono/node-server'
import type { Context, Next } from 'hono'
import { config } from './lib/config.js'
import { logger } from './lib/logger.js'
import { ping } from './db/client.js'
import { authRoutes } from './modules/auth/routes.js'
import { customerRoutes } from './modules/customers/routes.js'
import { supplierRoutes } from './modules/suppliers/routes.js'
import { itemRoutes, categoryRoutes } from './modules/items/routes.js'
import { inventoryRoutes } from './modules/inventory/routes.js'
import { gstRoutes } from './modules/gst/routes.js'
import { invoiceRoutes, creditNoteRoutes } from './modules/invoicing/routes.js'
import { billRoutes } from './modules/purchases/routes.js'
import { fileRoutes } from './modules/files/routes.js'
import type { AppEnv } from './types.js'

// ─── App ──────────────────────────────────────────────────────────────────────

const app = new Hono<AppEnv>()

// Security headers (per SECURITY.md §13.8 CSP pinned in Phase 18 hardening)
app.use('*', secureHeaders())

// CORS — credentials required for httpOnly cookie transport
app.use(
  '*',
  cors({
    origin: config.FRONTEND_URL,
    credentials: true,
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Accept'],
  }),
)

// Request logging
app.use('*', async (c: Context, next: Next) => {
  const reqId = crypto.randomUUID()
  c.set('reqId', reqId)
  const start = Date.now()
  await next()
  logger.info({
    reqId,
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    ms: Date.now() - start,
  })
})

// ─── Health checks ────────────────────────────────────────────────────────────

app.get('/healthz', (c) => c.json({ status: 'ok' }))

app.get('/readyz', async (c) => {
  try {
    await ping()
    return c.json({ status: 'ok' })
  } catch (err) {
    logger.error({ err }, 'readyz DB ping failed')
    return c.json({ status: 'error' }, 503)
  }
})

// ─── Routes ───────────────────────────────────────────────────────────────────

app.route('/auth', authRoutes)

// /me lives at root, handled inside authRoutes as GET /me
// Re-route: authRoutes registers GET /me; mount auth at root for /me
app.route('/', authRoutes)

app.route('/customers', customerRoutes)
app.route('/suppliers', supplierRoutes)
app.route('/items', itemRoutes)
app.route('/item-categories', categoryRoutes)
app.route('/inventory', inventoryRoutes)
app.route('/gst', gstRoutes)
app.route('/invoices', invoiceRoutes)
app.route('/credit-notes', creditNoteRoutes)
app.route('/bills', billRoutes)
app.route('/files', fileRoutes)

// ─── Error handler ────────────────────────────────────────────────────────────

app.onError((err, c) => {
  logger.error({ err, reqId: c.get('reqId') }, 'Unhandled error')
  return c.json({ error: 'internal' }, 500)
})

app.notFound((c) => c.json({ error: 'not_found' }, 404))

// ─── Start (only when run directly, not imported in tests) ───────────────────

if (process.env.NODE_ENV !== 'test') {
  const port = Number(process.env.PORT ?? 3000)
  serve({ fetch: app.fetch, port }, () => {
    logger.info({ port }, 'API server started')
  })
}

export { app }
