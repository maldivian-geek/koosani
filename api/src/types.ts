import type { JwtPayload } from './modules/auth/service.js'

// Shared Hono environment type — used in server.ts and all route files
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
