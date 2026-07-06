import type { JwtPayload } from './modules/auth/service.js'

// Shared Hono environment type — used in server.ts and all staff route files
export type AppEnv = {
  Variables: {
    userId: string
    businessId: string
    role: 'admin' | 'manager' | 'staff'
    name: string
    email: string
    sid: string
    ip: string
    reqId: string
    jwtPayload: JwtPayload
  }
}

// Separate Hono environment for the customer portal (Phase 28, UPGRADE.md
// G-8) — deliberately has no overlap with AppEnv's staff variables
// (SECURITY.md §13.14). Set by requirePortalAuth, never by requireAuth.
export type PortalEnv = {
  Variables: {
    portalBusinessId: string
    portalCustomerId: string
    portalSid: string
  }
}
