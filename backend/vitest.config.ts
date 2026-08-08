import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/**/*.live.test.ts'],
    coverage: { reporter: ['text', 'lcov'], include: ['src/**'] },
  },
});
