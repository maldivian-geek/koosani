import { drizzle } from 'drizzle-orm/postgres-js'
import { eq } from 'drizzle-orm'
import postgres from 'postgres'
import * as argon2 from 'argon2'
import * as schema from './schema/index'

const url = process.env.DATABASE_URL ?? 'postgresql://koosani:koosani@localhost:5432/koosani_dev'
const client = postgres(url, { max: 1 })
const db = drizzle(client, { schema })

async function seed() {
  console.log('Seeding...')

  const [business] = await db
    .insert(schema.businesses)
    .values({
      name: 'Demo Business Pvt Ltd',
      tin: 'MVR123456789',
      address: "Male', Maldives",
      phone: '+960 300 0000',
      email: 'admin@demo.mv',
      gstPeriodType: 'monthly',
      allowBackorders: false,
      createdBy: null as unknown as string,
      updatedBy: null as unknown as string,
    })
    .returning()

  if (!business) throw new Error('Failed to insert business')

  const passwordHash = await argon2.hash('Admin1234!', { type: argon2.argon2id })

  const [user] = await db
    .insert(schema.users)
    .values({
      businessId: business.id,
      email: 'admin@demo.mv',
      name: 'Demo Admin',
      role: 'admin',
      passwordHash,
      emailVerified: true,
      tokenVersion: 0,
      createdBy: business.id,
      updatedBy: business.id,
    })
    .returning()

  if (!user) throw new Error('Failed to insert user')

  // Back-fill created_by/updated_by on the business row now that a user exists
  await db
    .update(schema.businesses)
    .set({ createdBy: user.id, updatedBy: user.id })
    .where(eq(schema.businesses.id, business.id))

  console.log('Seed complete.')
  console.log(`  Business: ${business.id} — ${business.name}`)
  console.log(`  Admin:    ${user.id} — ${user.email}  (password: Admin1234!)`)
}

seed()
  .catch((err) => {
    console.error('Seed failed:', err)
    process.exit(1)
  })
  .finally(() => client.end())
