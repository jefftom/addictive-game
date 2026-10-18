// Generates steam/achievements.json from src/meta/achievements.ts (via src/platform/achievements.ts).
// Usage: npm run steam:achievements        (writes the file)
//        npm run steam:achievements -- --check   (exits 1 if the file is stale)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runnerImport } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = fileURLToPath(new URL('../steam/achievements.json', import.meta.url));
const { module } = await runnerImport(fileURLToPath(new URL('../src/platform/achievements.ts', import.meta.url)), { root, configFile: false });
const text = `${JSON.stringify(module.steamAchievementsFile(), null, 2)}\n`;

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(out, 'utf8');
  } catch {
    /* missing */
  }
  // Windows checkouts (core.autocrlf) turn LF into CRLF: compare the content, not the line endings.
  if (current.replace(/\r\n/g, '\n') !== text) {
    console.error('steam/achievements.json is stale: run "npm run steam:achievements"');
    process.exit(1);
  }
  console.log('steam/achievements.json is up to date');
} else {
  writeFileSync(out, text);
  console.log(`wrote ${module.STEAM_ACHIEVEMENTS.length} achievements to steam/achievements.json`);
}
