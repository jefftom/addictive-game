// Same-load comparison: draw cost of the v1 prototype (v1/) at 1080p.
import { chromium } from '/home/user/addictive-game/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = join(dirname(fileURLToPath(import.meta.url)), '../v1');
execFileSync('/home/user/addictive-game/node_modules/.bin/rolldown', [join(root, 'harness.ts'), '--file', join(root, 'dist/harness.js'), '--format', 'iife', '--platform', 'browser'], { stdio: 'ignore' });
const browser = await chromium.launch({ args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist'] });
const [w, h] = (process.argv[2] ?? '1920x1080').split('x').map(Number);
const page = await browser.newPage({ viewport: { width: w, height: h } });
await page.goto('file://' + join(root, 'harness.html'));
await page.waitForFunction(() => window.ready === true);
await page.evaluate(([w, h]) => window.api.setup(w, h), [w, h]);
const out = {};
for (let i = 0; i < 4; i++) out['gen' + (i + 1)] = +(await page.evaluate((i) => window.api.prepare(i), i)).toFixed(0);
for (let i = 0; i < 4; i++) out['sector' + (i + 1)] = +(await page.evaluate((i) => window.api.bench(i, 120, 'galaxy'), i)).toFixed(2);
out.warp = +(await page.evaluate(() => window.api.bench(0, 120, 'warp'))).toFixed(2);
console.log(JSON.stringify(out));
await browser.close();
