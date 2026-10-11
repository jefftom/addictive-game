import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build works on GitHub Pages sub-paths and as a single file.
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsInlineLimit: 100_000,
    cssCodeSplit: false,
    sourcemap: false,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Several tests run minutes of simulated play (golden master, bot runs): ~2-3 s each on a
    // fast machine, and shared CI runners can be 2-3x slower than that.
    testTimeout: 30_000,
  },
});
