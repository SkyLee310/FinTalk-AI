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
    coverage: { reporter: ['text', 'lcov'], include: ['src/**'] },
  },
});
