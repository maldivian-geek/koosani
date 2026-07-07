import { randomBytes } from 'node:crypto'
import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import postgres from 'postgres'
import * as argon2 from 'argon2'
import * as schema from './schema/index.js'

// Production-safe first-run seed: bootstraps one business + one admin user
// from env vars, not hardcoded demo data (see seed.ts for the dev/demo
// equivalent — same GST rates, but a fixed "Demo Business"/known password,
// never meant to run against a real database).
//
// Idempotent by design (checks for any existing business row first) so it's
// safe to invoke on every container start, not just the first one.
//
// Required: ADMIN_BUSINESS_NAME, ADMIN_EMAIL, ADMIN_NAME.
// Optional: ADMIN_PASSWORD (a secure random one is generated and printed to
// stdout — once — if not set), ADMIN_TIN, ADMIN_ADDRESS, ADMIN_PHONE.

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required')

const client = postgres(url, { max: 1 })
const db = drizzle(client, { schema })

function generatePassword(): string {
  // 24 random bytes, base64url-encoded — well above any reasonable entropy
  // floor, and safe to paste/type without escaping issues.
  return randomBytes(24).toString('base64url')
}

async function seedProd() {
  const [existing] = await db.select({ id: schema.businesses.id }).from(schema.businesses).limit(1)
  if (existing) {
    console.log('seedProd: a business already exists, skipping (idempotent no-op).')
    return
  }

  const businessName = process.env.ADMIN_BUSINESS_NAME
  const adminEmail = process.env.ADMIN_EMAIL
  const adminName = process.env.ADMIN_NAME
  if (!businessName || !adminEmail || !adminName) {
    throw new Error(
      'seedProd: ADMIN_BUSINESS_NAME, ADMIN_EMAIL, and ADMIN_NAME are all required for the first-run seed.',
    )
  }

  const generatedPassword = process.env.ADMIN_PASSWORD ? null : generatePassword()
  const password = generatedPassword ?? process.env.ADMIN_PASSWORD!

  console.log('seedProd: no business found yet, seeding first admin...')

  const [business] = await db
    .insert(schema.businesses)
    .values({
      name: businessName,
      tin: process.env.ADMIN_TIN ?? null,
      address: process.env.ADMIN_ADDRESS ?? null,
      phone: process.env.ADMIN_PHONE ?? null,
      email: adminEmail,
      gstPeriodType: 'monthly',
      allowBackorders: false,
      createdBy: null as unknown as string,
      updatedBy: null as unknown as string,
    })
    .returning()

  if (!business) throw new Error('seedProd: failed to insert business')

  const passwordHash = await argon2.hash(password, { type: argon2.argon2id })

  const [user] = await db
    .insert(schema.users)
    .values({
      businessId: business.id,
      email: adminEmail,
      name: adminName,
      role: 'admin',
      passwordHash,
      emailVerified: true,
      tokenVersion: 0,
      createdBy: business.id,
      updatedBy: business.id,
    })
    .returning()

  if (!user) throw new Error('seedProd: failed to insert user')

  await db
    .update(schema.businesses)
    .set({ createdBy: user.id, updatedBy: user.id })
    .where(eq(schema.businesses.id, business.id))

  // Same MIRA GST rates as seed.ts (FUNCTIONS.md §gst, ARCHITECTURE.md §4.4) —
  // these are fixed by law, not demo data, so every business starts with them.
  await db.insert(schema.gstRates).values([
    {
      businessId: business.id,
      category: 'general_8',
      rate: '0.0800',
      validFrom: '2023-01-01',
      validTo: null,
      createdBy: user.id,
      updatedBy: user.id,
    },
    {
      businessId: business.id,
      category: 'tourism_16',
      rate: '0.1600',
      validFrom: '2023-01-01',
      validTo: '2025-06-30',
      createdBy: user.id,
      updatedBy: user.id,
    },
    {
      businessId: business.id,
      category: 'tourism_17',
      rate: '0.1700',
      validFrom: '2025-07-01',
      validTo: null,
      createdBy: user.id,
      updatedBy: user.id,
    },
    {
      businessId: business.id,
      category: 'zero',
      rate: '0.0000',
      validFrom: '2023-01-01',
      validTo: null,
      createdBy: user.id,
      updatedBy: user.id,
    },
    {
      businessId: business.id,
      category: 'exempt',
      rate: '0.0000',
      validFrom: '2023-01-01',
      validTo: null,
      createdBy: user.id,
      updatedBy: user.id,
    },
  ])

  console.log('seedProd: seed complete.')
  console.log(`  Business: ${business.id} — ${business.name}`)
  console.log(`  Admin:    ${user.id} — ${user.email}`)
  if (generatedPassword) {
    console.log(
      `  Generated password (shown once, not stored anywhere — save it now): ${generatedPassword}`,
    )
  }
}

seedProd()
  .catch((err) => {
    console.error('seedProd failed:', err)
    process.exit(1)
  })
  .finally(() => client.end())
