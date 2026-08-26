import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createTestDatabase } from '../../../db/test-db.js'
import postgres from 'postgres'
import * as argon2 from 'argon2'
import jwt from 'jsonwebtoken'

// Phase 32, UPGRADE.md G-12 — see ARCHITECTURE.md §4.12.

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
      name: `Project Test Biz ${Date.now()}-${Math.random()}`,
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
      email: `proj+${Date.now()}+${Math.random()}@example.com`,
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

async function seedCustomer(businessId: string, userId: string) {
  const { db: appDb } = await import('../../../db/client.js')
  const schema = await import('../../../db/schema/index.js')
  const [customer] = await appDb
    .insert(schema.customers)
    .values({
      businessId,
      name: 'Project Test Customer',
      tin: null,
      email: null,
      phone: null,
      address: null,
      creditTermsDays: '30',
      creditLimit: null,
      notes: null,
      createdBy: userId,
      updatedBy: userId,
    })
    .returning()
  if (!customer) throw new Error('seed: no customer')
  return customer
}

function ctxFor(userId: string, businessId: string) {
  return { userId, businessId, ip: '127.0.0.1', ua: undefined }
}

function authHeaders(token: string) {
  return { 'Content-Type': 'application/json', Cookie: `session=${token}` }
}

describe('projects — createProject / createTask / createTimeEntry', () => {
  it('creates a project with a default billable rate and GST category', async () => {
    const { business, user } = await seedBusiness()
    const customer = await seedCustomer(business.id, user.id)
    const svc = await import('../service.js')
    const project = await svc.createProject(
      business.id,
      { customerId: customer.id, name: 'Website Redesign', defaultBillableRate: '50.00' },
      ctxFor(user.id, business.id),
    )
    expect(project.customerId).toBe(customer.id)
    expect(project.defaultBillableRate).toBe('50.00')
    expect(project.defaultGstCategory).toBe('general_8')
  })

  it('creates a task under a project, overriding the billable rate', async () => {
    const { business, user } = await seedBusiness()
    const svc = await import('../service.js')
    const project = await svc.createProject(
      business.id,
      { name: 'Internal Tooling' },
      ctxFor(user.id, business.id),
    )
    const task = await svc.createTask(
      business.id,
      project.id,
      { name: 'Design mockups', billableRate: '75.00' },
      ctxFor(user.id, business.id),
    )
    expect(task.projectId).toBe(project.id)
    expect(task.billableRate).toBe('75.00')
  })

  it('time entry snapshots the task rate, falling back to the project default', async () => {
    const { business, user } = await seedBusiness()
    const svc = await import('../service.js')
    const project = await svc.createProject(
      business.id,
      { name: 'Consulting', defaultBillableRate: '40.00' },
      ctxFor(user.id, business.id),
    )
    const task = await svc.createTask(
      business.id,
      project.id,
      { name: 'Strategy session', billableRate: '60.00' },
      ctxFor(user.id, business.id),
    )

    const entryWithTask = await svc.createTimeEntry(
      business.id,
      project.id,
      { taskId: task.id, entryDate: '2026-01-15', hours: '2.0000' },
      ctxFor(user.id, business.id),
    )
    expect(entryWithTask.billableRate).toBe('60.00') // from task, not project

    const entryNoTask = await svc.createTimeEntry(
      business.id,
      project.id,
      { entryDate: '2026-01-16', hours: '1.5000' },
      ctxFor(user.id, business.id),
    )
    expect(entryNoTask.billableRate).toBe('40.00') // falls back to project default
  })

  it('rejects a billable time entry with no rate available anywhere', async () => {
    const { business, user } = await seedBusiness()
    const svc = await import('../service.js')
    const project = await svc.createProject(
      business.id,
      { name: 'No Rate Project' },
      ctxFor(user.id, business.id),
    )
    await expect(
      svc.createTimeEntry(
        business.id,
        project.id,
        { entryDate: '2026-01-15', hours: '1.0000' },
        ctxFor(user.id, business.id),
      ),
    ).rejects.toThrow(svc.ValidationError)
  })

  it('a non-billable time entry does not require a rate', async () => {
    const { business, user } = await seedBusiness()
    const svc = await import('../service.js')
    const project = await svc.createProject(
      business.id,
      { name: 'No Rate Project' },
      ctxFor(user.id, business.id),
    )
    const entry = await svc.createTimeEntry(
      business.id,
      project.id,
      { entryDate: '2026-01-15', hours: '1.0000', billable: false },
      ctxFor(user.id, business.id),
    )
    expect(entry.billable).toBe(false)
    expect(entry.billableRate).toBeNull()
  })
})

describe('projects — time entry update/delete guarded once invoiced', () => {
  it('rejects editing or deleting a time entry once invoiced', async () => {
    const { business, user } = await seedBusiness()
    const customer = await seedCustomer(business.id, user.id)
    const svc = await import('../service.js')
    const project = await svc.createProject(
      business.id,
      { customerId: customer.id, name: 'Billable Project', defaultBillableRate: '50.00' },
      ctxFor(user.id, business.id),
    )
    const entry = await svc.createTimeEntry(
      business.id,
      project.id,
      { entryDate: '2026-01-15', hours: '3.0000' },
      ctxFor(user.id, business.id),
    )

    await svc.markInvoiced(
      business.id,
      [entry.id],
      crypto.randomUUID(),
      ctxFor(user.id, business.id),
    )

    await expect(
      svc.updateTimeEntry(business.id, entry.id, { hours: '5.0000' }, ctxFor(user.id, business.id)),
    ).rejects.toThrow(svc.ValidationError)
    await expect(
      svc.deleteTimeEntry(business.id, entry.id, ctxFor(user.id, business.id)),
    ).rejects.toThrow(svc.ValidationError)
  })
})

describe('projects — billable → invoice line flow', () => {
  it('lists uninvoiced billable time entries for a customer and excludes them once invoiced', async () => {
    const { business, user } = await seedBusiness()
    const customer = await seedCustomer(business.id, user.id)
    const svc = await import('../service.js')
    const project = await svc.createProject(
      business.id,
      { customerId: customer.id, name: 'Billable Project', defaultBillableRate: '50.00' },
      ctxFor(user.id, business.id),
    )
    const entry = await svc.createTimeEntry(
      business.id,
      project.id,
      { entryDate: '2026-01-10', hours: '2.0000' },
      ctxFor(user.id, business.id),
    )

    // A non-billable entry on the same project shouldn't appear
    await svc.createTimeEntry(
      business.id,
      project.id,
      { entryDate: '2026-01-11', hours: '1.0000', billable: false },
      ctxFor(user.id, business.id),
    )

    let billable = await svc.listUninvoicedBillable(business.id, customer.id)
    expect(billable).toHaveLength(1)
    expect(billable[0]?.id).toBe(entry.id)

    await svc.markInvoiced(
      business.id,
      [entry.id],
      crypto.randomUUID(),
      ctxFor(user.id, business.id),
    )

    billable = await svc.listUninvoicedBillable(business.id, customer.id)
    expect(billable).toHaveLength(0)
  })

  it('rejects double-invoicing the same time entry', async () => {
    const { business, user } = await seedBusiness()
    const customer = await seedCustomer(business.id, user.id)
    const svc = await import('../service.js')
    const project = await svc.createProject(
      business.id,
      { customerId: customer.id, name: 'Billable Project', defaultBillableRate: '50.00' },
      ctxFor(user.id, business.id),
    )
    const entry = await svc.createTimeEntry(
      business.id,
      project.id,
      { entryDate: '2026-01-10', hours: '2.0000' },
      ctxFor(user.id, business.id),
    )
    await svc.markInvoiced(
      business.id,
      [entry.id],
      crypto.randomUUID(),
      ctxFor(user.id, business.id),
    )
    await expect(
      svc.markInvoiced(business.id, [entry.id], crypto.randomUUID(), ctxFor(user.id, business.id)),
    ).rejects.toThrow(svc.ValidationError)
  })
})

describe('projects — routes', () => {
  it('rejects creating a project without the projects:add permission', async () => {
    const { token } = await seedBusiness('staff')
    const { app } = await import('../../../server.js')
    const res = await app.request('/projects', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'Unauthorized Project' }),
    })
    expect(res.status).toBe(403)
  })

  it('admin can create a project, add a task, and fetch the project with its tasks', async () => {
    const { token } = await seedBusiness('admin')
    const { app } = await import('../../../server.js')

    const createRes = await app.request('/projects', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'HTTP Test Project' }),
    })
    expect(createRes.status).toBe(201)
    const project = (await createRes.json()) as { id: string }

    const taskRes = await app.request(`/projects/${project.id}/tasks`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({ name: 'A task' }),
    })
    expect(taskRes.status).toBe(201)

    const getRes = await app.request(`/projects/${project.id}`, { headers: authHeaders(token) })
    expect(getRes.status).toBe(200)
    const body = (await getRes.json()) as { tasks: unknown[] }
    expect(body.tasks).toHaveLength(1)
  })
})
