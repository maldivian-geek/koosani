import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import postgres from 'postgres'
import * as argon2 from 'argon2'
import jwt from 'jsonwebtoken'
import { runMigrations } from '../../../db/test-helpers.js'

// Phase 33c, UPGRADE.md G-13/F-24 — see ARCHITECTURE.md §4.15.

let container: StartedPostgreSqlContainer
let client: ReturnType<typeof postgres>

const JWT_SECRET = 'test-secret-at-least-32-chars-long-xx'

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  const url = container.getConnectionUri()
  process.env['DATABASE_URL'] = url
  process.env['REDIS_URL'] = process.env['REDIS_URL'] ?? 'redis://localhost:6379'
  process.env['JWT_SECRET'] = JWT_SECRET
  process.env['FRONTEND_URL'] = 'http://localhost:5173'
  process.env['NODE_ENV'] = 'test'
  await runMigrations(url)
  client = postgres(url, { max: 1 })
}, 60_000)

afterAll(async () => {
  await client?.end()
  await container?.stop()
})

async function seedBusiness(role: 'admin' | 'manager' | 'staff' = 'admin') {
  const { db: appDb } = await import('../../../db/client.js')
  const schema = await import('../../../db/schema/index.js')

  const [business] = await appDb
    .insert(schema.businesses)
    .values({
      name: `CF Test Biz ${Date.now()}-${Math.random()}`,
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
      email: `cf+${Date.now()}+${Math.random()}@example.com`,
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

describe('customFields — definitions', () => {
  it('creates a definition and lists it for its doc type', async () => {
    const { business, user } = await seedBusiness()
    const svc = await import('../service.js')
    const def = await svc.createDefinition(
      business.id,
      {
        docType: 'invoice',
        fieldName: 'po_reference',
        fieldLabel: 'PO Reference',
        fieldType: 'text',
      },
      ctxFor(user.id, business.id),
    )
    expect(def.fieldName).toBe('po_reference')

    const list = await svc.listDefinitions(business.id, 'invoice')
    expect(list).toHaveLength(1)
    expect(list[0]?.fieldLabel).toBe('PO Reference')

    const otherDocType = await svc.listDefinitions(business.id, 'estimate')
    expect(otherDocType).toHaveLength(0)
  })

  it('rejects a duplicate field name for the same doc type', async () => {
    const { business, user } = await seedBusiness()
    const svc = await import('../service.js')
    await svc.createDefinition(
      business.id,
      { docType: 'invoice', fieldName: 'dup', fieldLabel: 'Dup', fieldType: 'text' },
      ctxFor(user.id, business.id),
    )
    await expect(
      svc.createDefinition(
        business.id,
        { docType: 'invoice', fieldName: 'dup', fieldLabel: 'Dup Again', fieldType: 'text' },
        ctxFor(user.id, business.id),
      ),
    ).rejects.toThrow(svc.ValidationError)
  })

  it('deleting a definition also removes its values', async () => {
    const { business, user } = await seedBusiness()
    const svc = await import('../service.js')
    const def = await svc.createDefinition(
      business.id,
      { docType: 'invoice', fieldName: 'ref', fieldLabel: 'Ref', fieldType: 'text' },
      ctxFor(user.id, business.id),
    )
    const docId = crypto.randomUUID()
    await svc.upsertValues(
      business.id,
      { docType: 'invoice', docId, values: [{ fieldDefinitionId: def.id, value: 'ABC-1' }] },
      ctxFor(user.id, business.id),
    )

    await svc.deleteDefinition(business.id, def.id, ctxFor(user.id, business.id))

    const values = await svc.listValuesForDoc(business.id, 'invoice', docId)
    expect(values).toHaveLength(0)
  })

  it('rejects non-admin creating a definition via the route', async () => {
    const { token } = await seedBusiness('staff')
    const { app } = await import('../../../server.js')
    const res = await app.request('/custom-fields/definitions', {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify({
        docType: 'invoice',
        fieldName: 'x',
        fieldLabel: 'X',
        fieldType: 'text',
      }),
    })
    expect(res.status).toBe(403)
  })
})

describe('customFields — values', () => {
  it('validates values against the field type', async () => {
    const { business, user } = await seedBusiness()
    const svc = await import('../service.js')
    const numberDef = await svc.createDefinition(
      business.id,
      {
        docType: 'invoice',
        fieldName: 'warranty_months',
        fieldLabel: 'Warranty (months)',
        fieldType: 'number',
      },
      ctxFor(user.id, business.id),
    )
    const boolDef = await svc.createDefinition(
      business.id,
      {
        docType: 'invoice',
        fieldName: 'gift_wrapped',
        fieldLabel: 'Gift Wrapped',
        fieldType: 'boolean',
      },
      ctxFor(user.id, business.id),
    )
    const dateDef = await svc.createDefinition(
      business.id,
      {
        docType: 'invoice',
        fieldName: 'delivery_date',
        fieldLabel: 'Delivery Date',
        fieldType: 'date',
      },
      ctxFor(user.id, business.id),
    )
    const docId = crypto.randomUUID()

    await expect(
      svc.upsertValues(
        business.id,
        {
          docType: 'invoice',
          docId,
          values: [{ fieldDefinitionId: numberDef.id, value: 'not-a-number' }],
        },
        ctxFor(user.id, business.id),
      ),
    ).rejects.toThrow(svc.ValidationError)

    await expect(
      svc.upsertValues(
        business.id,
        { docType: 'invoice', docId, values: [{ fieldDefinitionId: boolDef.id, value: 'maybe' }] },
        ctxFor(user.id, business.id),
      ),
    ).rejects.toThrow(svc.ValidationError)

    const result = await svc.upsertValues(
      business.id,
      {
        docType: 'invoice',
        docId,
        values: [
          { fieldDefinitionId: numberDef.id, value: '12' },
          { fieldDefinitionId: boolDef.id, value: 'true' },
          { fieldDefinitionId: dateDef.id, value: '2026-08-01' },
        ],
      },
      ctxFor(user.id, business.id),
    )
    expect(result.find((f) => f.fieldName === 'warranty_months')?.value).toBe('12')
    expect(result.find((f) => f.fieldName === 'gift_wrapped')?.value).toBe('true')
  })

  it('re-upserting a value updates it rather than duplicating', async () => {
    const { business, user } = await seedBusiness()
    const svc = await import('../service.js')
    const def = await svc.createDefinition(
      business.id,
      {
        docType: 'estimate',
        fieldName: 'project_code',
        fieldLabel: 'Project Code',
        fieldType: 'text',
      },
      ctxFor(user.id, business.id),
    )
    const docId = crypto.randomUUID()
    await svc.upsertValues(
      business.id,
      { docType: 'estimate', docId, values: [{ fieldDefinitionId: def.id, value: 'PC-1' }] },
      ctxFor(user.id, business.id),
    )
    await svc.upsertValues(
      business.id,
      { docType: 'estimate', docId, values: [{ fieldDefinitionId: def.id, value: 'PC-2' }] },
      ctxFor(user.id, business.id),
    )
    const values = await svc.listValuesForDoc(business.id, 'estimate', docId)
    expect(values).toHaveLength(1)
    expect(values[0]?.value).toBe('PC-2')
  })

  it('rejects upserting a value against a permission-gated doc type without the right role', async () => {
    const { business, user } = await seedBusiness('admin')
    const svc = await import('../service.js')
    const def = await svc.createDefinition(
      business.id,
      { docType: 'po', fieldName: 'cost_center', fieldLabel: 'Cost Center', fieldType: 'text' },
      ctxFor(user.id, business.id),
    )

    // A staff user with no explicit 'po' grant should be forbidden
    const { token: staffToken } = await seedBusiness('staff')
    const { app } = await import('../../../server.js')
    const res = await app.request('/custom-fields/values', {
      method: 'PUT',
      headers: authHeaders(staffToken),
      body: JSON.stringify({
        docType: 'po',
        docId: crypto.randomUUID(),
        values: [{ fieldDefinitionId: def.id, value: 'CC-1' }],
      }),
    })
    expect(res.status).toBe(403)
  })
})
