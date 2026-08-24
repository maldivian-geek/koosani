// Boots ONE Postgres testcontainer for the entire suite and migrates its
// default database ('test') once. Test files never start containers of their
// own — each gets an isolated database cloned from the migrated template via
// createTestDatabase() (src/db/test-db.ts). Env vars set here are inherited
// by vitest's worker processes, which spawn after setup() completes.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { runMigrations } from './src/db/test-helpers.js'

let container: StartedPostgreSqlContainer

export async function setup(): Promise<void> {
  container = await new PostgreSqlContainer('postgres:16-alpine').start()
  const templateUrl = container.getConnectionUri()
  await runMigrations(templateUrl)
  process.env['TEST_PG_TEMPLATE_URL'] = templateUrl
}

export async function teardown(): Promise<void> {
  await container?.stop()
}
