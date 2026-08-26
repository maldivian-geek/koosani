import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDatabase } from '../../db/test-db.js'
import postgres from 'postgres'

// UPGRADE.md F-2, extended Phase 37 — verifies the role/permission default
// policy documented in SECURITY.md §Authorization Model: admin bypasses
// everything; manager gets view/add/edit/delete by default; staff needs an
// explicit or implied grant for view, and an explicit grant for anything
// else; 'export' requires an explicit grant regardless of role.

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

async function seedUser(role: 'admin' | 'manager' | 'staff') {
  const { db } = await import('../../db/client.js')
  const schema = await import('../../db/schema/index.js')

  const [business] = await db
    .insert(schema.businesses)
    .values({
      name: `Authz Test Biz ${Date.now()}`,
      tin: null,
      gstPeriodType: 'monthly',
      allowBackorders: false,
      createdBy: null as unknown as string,
      updatedBy: null as unknown as string,
    })
    .returning()
  if (!business) throw new Error('seed: no business')

  const [user] = await db
    .insert(schema.users)
    .values({
      businessId: business.id,
      email: `authz+${role}+${Date.now()}+${Math.random()}@example.com`,
      name: 'Test User',
      role,
      emailVerified: true,
      tokenVersion: 0,
      createdBy: business.id,
      updatedBy: business.id,
    })
    .returning()
  if (!user) throw new Error('seed: no user')

  return { business, user }
}

describe('authorize — hasPermission', () => {
  it('admin bypasses every check', async () => {
    const { hasPermission } = await import('../authorize.js')
    const { user } = await seedUser('admin')

    expect(await hasPermission('admin', user.id, 'invoices', 'delete')).toBe(true)
    expect(await hasPermission('admin', user.id, 'gst', 'edit')).toBe(true)
    expect(await hasPermission('admin', user.id, 'reports', 'export')).toBe(true)
  })

  it('manager gets view by default without an explicit grant', async () => {
    const { hasPermission } = await import('../authorize.js')
    const { user } = await seedUser('manager')

    expect(await hasPermission('manager', user.id, 'invoices', 'view')).toBe(true)
  })

  it('manager gets add/edit/delete by default without an explicit grant', async () => {
    const { hasPermission } = await import('../authorize.js')
    const { user } = await seedUser('manager')

    expect(await hasPermission('manager', user.id, 'invoices', 'add')).toBe(true)
    expect(await hasPermission('manager', user.id, 'po', 'edit')).toBe(true)
    expect(await hasPermission('manager', user.id, 'customers', 'delete')).toBe(true)
  })

  it('staff is denied view with no grants on the resource', async () => {
    const { hasPermission } = await import('../authorize.js')
    const { user } = await seedUser('staff')

    expect(await hasPermission('staff', user.id, 'invoices', 'view')).toBe(false)
  })

  it('staff is allowed view once an explicit view grant exists', async () => {
    const { hasPermission } = await import('../authorize.js')
    const { db } = await import('../../db/client.js')
    const schema = await import('../../db/schema/index.js')
    const { user } = await seedUser('staff')

    await db.insert(schema.userPermissions).values({
      businessId: user.businessId,
      userId: user.id,
      resource: 'invoices',
      action: 'view',
      grantedBy: user.id,
    })

    expect(await hasPermission('staff', user.id, 'invoices', 'view')).toBe(true)
    // Scoped to the resource, not other resources
    expect(await hasPermission('staff', user.id, 'bills', 'view')).toBe(false)
  })

  it('staff is allowed view via an edit grant (add/edit/delete imply view)', async () => {
    const { hasPermission } = await import('../authorize.js')
    const { db } = await import('../../db/client.js')
    const schema = await import('../../db/schema/index.js')
    const { user } = await seedUser('staff')

    await db.insert(schema.userPermissions).values({
      businessId: user.businessId,
      userId: user.id,
      resource: 'invoices',
      action: 'edit',
      grantedBy: user.id,
    })

    expect(await hasPermission('staff', user.id, 'invoices', 'view')).toBe(true)
  })

  it('manager still needs an explicit grant for reports.export', async () => {
    const { hasPermission } = await import('../authorize.js')
    const { user } = await seedUser('manager')

    expect(await hasPermission('manager', user.id, 'reports', 'export')).toBe(false)
  })

  it('staff is denied add/edit/delete without an explicit grant', async () => {
    const { hasPermission } = await import('../authorize.js')
    const { user } = await seedUser('staff')

    expect(await hasPermission('staff', user.id, 'invoices', 'add')).toBe(false)
    expect(await hasPermission('staff', user.id, 'invoices', 'edit')).toBe(false)
    expect(await hasPermission('staff', user.id, 'invoices', 'delete')).toBe(false)
  })

  it('staff is allowed once an explicit grant exists for that resource+action', async () => {
    const { hasPermission } = await import('../authorize.js')
    const { db } = await import('../../db/client.js')
    const schema = await import('../../db/schema/index.js')
    const { user } = await seedUser('staff')

    await db.insert(schema.userPermissions).values({
      businessId: user.businessId,
      userId: user.id,
      resource: 'invoices',
      action: 'add',
      grantedBy: user.id,
    })

    expect(await hasPermission('staff', user.id, 'invoices', 'add')).toBe(true)
    // The grant is scoped to exactly (resource, action) — it doesn't widen
    expect(await hasPermission('staff', user.id, 'invoices', 'delete')).toBe(false)
    expect(await hasPermission('staff', user.id, 'bills', 'add')).toBe(false)
  })
})
