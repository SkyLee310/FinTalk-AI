// Loads .env into process.env for the integration tests, which need
// DATABASE_URL. A no-op in CI, where the variable is already exported and no
// .env file exists.
import 'dotenv/config';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/**/*.live.test.ts'],
    // The integration suites share one database and each resets it in
    // beforeEach, so test files must run one at a time. In parallel, one
    // file's TRUNCATE deletes rows another file is still inserting against,
    // surfacing as foreign-key violations rather than as the race it is.
    fileParallelism: false,
    coverage: { reporter: ['text', 'lcov'], include: ['src/**'] },
  },
});
