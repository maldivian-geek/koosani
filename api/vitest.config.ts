import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    // One Postgres testcontainer for the whole suite (vitest.global-setup.ts);
    // each file clones the migrated template database via createTestDatabase()
    // (src/db/test-db.ts). Parallel files are safe again — they share the one
    // container but never a database. maxWorkers stays bounded for CPU sanity.
    globalSetup: ['./vitest.global-setup.ts'],
    maxWorkers: 4,
    hookTimeout: 60_000,
  },
})
