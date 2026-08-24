import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    // Each test file starts its own Postgres testcontainer in beforeAll.
    // Run files strictly one at a time so only a single container is ever
    // alive — parallel container startups exhaust Docker on dev machines and
    // time out the hooks. hookTimeout covers image pull + boot + migrations.
    fileParallelism: false,
    hookTimeout: 120_000,
  },
})
