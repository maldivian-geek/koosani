// Per-test-file isolated database inside the suite's single shared Postgres
// testcontainer (vitest.global-setup.ts). Cloning the already-migrated
// template with CREATE DATABASE ... TEMPLATE is near-instant, so files get
// the same pristine-schema guarantee the old one-container-per-file setup
// gave, without booting a container or re-running migrations per file.
// Databases are not dropped afterwards — the container is destroyed at the
// end of the run. Drizzle imports are allowed in db/ files (ARCHITECTURE.md §2).
import postgres from 'postgres'

const TEMPLATE_DB = 'test'
let counter = 0

export async function createTestDatabase(): Promise<string> {
  const templateUrl = process.env['TEST_PG_TEMPLATE_URL']
  if (!templateUrl) {
    throw new Error('TEST_PG_TEMPLATE_URL not set — vitest.global-setup.ts did not run')
  }

  // Connect to the maintenance database, never the template itself —
  // CREATE DATABASE ... TEMPLATE fails while any session is connected to
  // the template.
  const adminUrl = new URL(templateUrl)
  adminUrl.pathname = '/postgres'
  const dbName = `t_${process.pid}_${++counter}`

  const admin = postgres(adminUrl.toString(), { max: 1 })
  try {
    // Concurrent clones from parallel workers can transiently collide on the
    // template lock — retry briefly instead of failing the whole file.
    let lastErr: unknown
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await admin.unsafe(`CREATE DATABASE ${dbName} TEMPLATE ${TEMPLATE_DB}`)
        lastErr = undefined
        break
      } catch (err) {
        lastErr = err
        await new Promise((r) => setTimeout(r, 250 * (attempt + 1)))
      }
    }
    if (lastErr) throw lastErr
  } finally {
    await admin.end()
  }

  const dbUrl = new URL(templateUrl)
  dbUrl.pathname = `/${dbName}`
  return dbUrl.toString()
}
