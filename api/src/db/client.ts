import { drizzle } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import postgres from 'postgres'
import * as schema from './schema/index'

const url = process.env.DATABASE_URL
if (!url) throw new Error('DATABASE_URL is required')

const queryClient = postgres(url)
export const db = drizzle(queryClient, { schema })
export type Db = typeof db

export async function ping(): Promise<void> {
  await db.execute(sql`SELECT 1`)
}
