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
import { poRoutes, grnRoutes } from './modules/po/routes.js'
import { reportRoutes } from './modules/reports/routes.js'
import { userRoutes } from './modules/users/routes.js'
import { auditRoutes } from './modules/audit/routes.js'
import { settingsRoutes } from './modules/settings/routes.js'
import { estimateRoutes } from './modules/estimates/routes.js'
import { recurrenceRoutes } from './modules/recurrence/routes.js'
import { customerCreditRoutes } from './modules/customerCredits/routes.js'
import { portalAuthRoutes } from './modules/portalAuth/routes.js'
import { portalRoutes } from './modules/portal/routes.js'
import { exchangeRateRoutes } from './modules/exchangeRates/routes.js'
import type { AppEnv } from './types.js'

// ─── App ──────────────────────────────────────────────────────────────────────

const app = new Hono<AppEnv>()

// Explicit CSP per SECURITY.md §13.8 — no unsafe-inline on scripts, no unsafe-eval.
// style-src keeps 'unsafe-inline' because PrimeVue injects inline styles for theming.
// STORAGE_HOSTNAME is the object-storage CDN host for signed download URLs.
const storageHosts = config.STORAGE_HOSTNAME ? [config.STORAGE_HOSTNAME] : []

app.use(
  '*',
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:', ...storageHosts],
      fontSrc: ["'self'", 'data:'],
      connectSrc: ["'self'", ...storageHosts],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
    xFrameOptions: 'DENY',
  }),
)

// CORS — credentials required for httpOnly cookie transport. Two explicit
// allowed origins (staff SPA + customer portal, SECURITY.md §13.14) — never a
// wildcard or regex.
const ALLOWED_ORIGINS = [config.FRONTEND_URL, config.PORTAL_FRONTEND_URL].filter(
  (o): o is string => !!o,
)
app.use(
  '*',
  cors({
    origin: (requestOrigin) =>
      ALLOWED_ORIGINS.includes(requestOrigin) ? requestOrigin : undefined,
    credentials: true,
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Accept'],
  }),
)

// CSRF mitigation #2 (SECURITY.md §CSRF): a cross-site HTML form's "simple
// request" can only carry Content-Type application/x-www-form-urlencoded,
// multipart/form-data, or text/plain — never application/json, and never a
// missing header (forms always set one of the three). So the only content
// types worth rejecting are exactly those three forgeable ones; a bodyless
// same-origin fetch/request that omits Content-Type entirely is not a CSRF
// vector and must not be blocked. sameSite=strict remains the primary
// defense for the multipart exemption (file/attachment uploads need it).
const FORGEABLE_CONTENT_TYPES = ['application/x-www-form-urlencoded', 'text/plain']
app.use('*', async (c: Context, next: Next) => {
  const method = c.req.method
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const contentType = c.req.header('content-type') ?? ''
    if (FORGEABLE_CONTENT_TYPES.some((t) => contentType.startsWith(t))) {
      return c.json({ error: 'unsupported_content_type' }, 415)
    }
  }
  await next()
})

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
app.route('/pos', poRoutes)
app.route('/grns', grnRoutes)
app.route('/reports', reportRoutes)
app.route('/users', userRoutes)
app.route('/audit', auditRoutes)
app.route('/settings', settingsRoutes)
app.route('/estimates', estimateRoutes)
app.route('/recurrence-profiles', recurrenceRoutes)
app.route('/customers', customerCreditRoutes)

// Customer portal (Phase 28, UPGRADE.md G-8) — separate auth, separate
// Variables type, mounted under its own prefix (SECURITY.md §13.14)
app.route('/portal/auth', portalAuthRoutes)
app.route('/portal', portalRoutes)

// Multi-currency (Phase 30, UPGRADE.md G-10)
app.route('/exchange-rates', exchangeRateRoutes)

// ─── Error handler ────────────────────────────────────────────────────────────

app.onError((err, c) => {
  logger.error({ err, reqId: c.get('reqId') }, 'Unhandled error')
  return c.json({ error: 'internal' }, 500)
})

app.notFound((c) => c.json({ error: 'not_found' }, 404))

// ─── Start (only when run directly, not imported in tests) ───────────────────

if (config.NODE_ENV !== 'test') {
  serve({ fetch: app.fetch, port: config.PORT }, () => {
    logger.info({ port: config.PORT }, 'API server started')
  })
}

export { app }
