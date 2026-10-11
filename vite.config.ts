import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the build works on GitHub Pages sub-paths and as a single file.
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    // Fonts stay separate, cacheable files (they would bloat the render-blocking CSS);
    // scripts/build-single.mjs inlines them for the single-file build.
    assetsInlineLimit: (file, content) => !file.endsWith('.woff2') && content.length < 100_000,
    cssCodeSplit: false,
    sourcemap: false,
  },
  plugins: [
    {
      // The bundled fonts' SIL OFL licence ships with every build (web and desktop).
      name: 'shardstorm-font-licence',
      apply: 'build',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'licenses/fonts-OFL.txt',
          source: readFileSync(new URL('./src/assets/fonts/OFL.txt', import.meta.url), 'utf8'),
        });
      },
    },
  ],
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Several tests run minutes of simulated play (golden master, bot runs): ~2-3 s each on a
    // fast machine, and shared CI runners can be 2-3x slower than that.
    testTimeout: 30_000,
  },
});
