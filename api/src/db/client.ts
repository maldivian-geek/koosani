import { drizzle } from 'drizzle-orm/postgres-js'
import { sql, type ExtractTablesWithRelations } from 'drizzle-orm'
import type { PgTransaction } from 'drizzle-orm/pg-core'
import type { PostgresJsQueryResultHKT } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { config } from '../lib/config.js'
import * as schema from './schema/index'

const queryClient = postgres(config.DATABASE_URL)
export const db = drizzle(queryClient, { schema })
export type Db = typeof db
export type DbTx = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>

export async function ping(): Promise<void> {
  await db.execute(sql`SELECT 1`)
}
