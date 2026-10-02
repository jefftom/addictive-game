import { defineConfig } from 'vitest/config';

// Long-running balance simulation; run with `npm run sim`.
export default defineConfig({
  test: {
    include: ['tests/**/*.sim.ts'],
    environment: 'node',
    testTimeout: 600_000,
  },
});
