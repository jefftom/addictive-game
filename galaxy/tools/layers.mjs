import { chromium } from '/home/user/addictive-game/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
const root = '/tmp/claude-0/-home-user-addictive-game/1abae5b2-c201-57a9-8979-0317e8f22528/scratchpad/plan/galaxy';
execFileSync('/home/user/addictive-game/node_modules/.bin/rolldown', [root + '/harness.ts', '--file', root + '/dist/harness.js', '--format', 'iife', '--platform', 'browser'], { stdio: 'ignore' });
const extra = process.argv.slice(2);
const browser = await chromium.launch({ args: extra });
for (const [w, h] of [[1280, 720], [1920, 1080]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto('file://' + root + '/harness.html');
  await page.waitForFunction(() => window.ready === true);
  await page.evaluate(([w, h]) => window.api.setup(w, h), [w, h]);
  const out = {};
  out.blank = await page.evaluate(() => window.api.bench(0, 120, 'blank'));
  out.legacy = await page.evaluate(() => window.api.bench(0, 120, 'legacy'));
  for (const [name, m] of [['base', 1], ['dust', 2], ['center', 4], ['planets', 8], ['all', 15]]) out[name] = await page.evaluate(([m]) => window.api.bench(0, 120, 'galaxy', m), [m]);
  console.log(w + 'x' + h, JSON.stringify(Object.fromEntries(Object.entries(out).map(([a, b]) => [a, +b.toFixed(2)]))));
  if (w === 1280) console.log(await page.evaluate(() => { const c = document.createElement('canvas').getContext('webgl'); if (!c) return 'no webgl'; const d = c.getExtension('WEBGL_debug_renderer_info'); return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'webgl'; }));
  await page.close();
}
await browser.close();
