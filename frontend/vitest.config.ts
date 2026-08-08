import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    // Mirrors the "@/*" path alias in tsconfig.json so tests can import
    // application modules the same way the app does.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
});
