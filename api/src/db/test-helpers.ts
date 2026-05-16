// Migration helper for tests — Drizzle imports are allowed in db/ files (ARCHITECTURE.md §2)
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const MIGRATIONS_DIR = path.resolve(__dirname, 'migrations')

export async function runMigrations(url: string): Promise<void> {
  const client = postgres(url, { max: 1 })
  const db = drizzle(client)
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR })
  await client.end()
}
