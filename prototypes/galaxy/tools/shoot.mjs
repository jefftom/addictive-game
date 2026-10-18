// Renders every sector (plain, readability overlay, moved camera), the warp
// phases, runs the colour-distance check and measures generation + draw cost
// in headless Chromium (SwiftShader). Served over http so the module worker works.
// Run: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/shoot.mjs [--perf] [--only=N] [--nobuild] [--out=dir]
import { chromium } from '/home/user/addictive-game/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const perf = args.includes('--perf');
const only = args.find((a) => a.startsWith('--only='))?.split('=')[1];
const outDir = join(root, args.find((a) => a.startsWith('--out='))?.split('=')[1] ?? 'shots');
mkdirSync(outDir, { recursive: true });

if (!args.includes('--nobuild')) {
  const rd = '/home/user/addictive-game/node_modules/.bin/rolldown';
  execFileSync(rd, [join(root, 'harness.ts'), '--file', join(root, 'dist/harness.js'), '--format', 'iife', '--platform', 'browser'], { stdio: 'inherit' });
  execFileSync(rd, [join(root, 'worker.ts'), '--file', join(root, 'dist/worker.js'), '--format', 'esm', '--platform', 'browser'], { stdio: 'inherit' });
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript' };
const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const f = join(root, p);
  if (!f.startsWith(root) || !existsSync(f)) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' });
  res.end(readFileSync(f));
}).listen(0);
const base = `http://localhost:${server.address().port}`;

const browser = await chromium.launch({ args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist'] });
const report = { sizes: {} };

async function open(w, h, worker = false) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on('console', (m) => console.log('[page]', m.text()));
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.goto(base + '/harness.html');
  await page.waitForFunction(() => window.ready === true);
  await page.evaluate(([w, h, wk]) => window.api.setup(w, h, wk), [w, h, worker]);
  return page;
}
const shot = (page, name) => page.screenshot({ path: join(outDir, name) });

const sectors = only !== undefined ? [Number(only)] : [0, 1, 2, 3];

{
  const page = await open(1280, 720);
  const gen = {};
  for (const i of sectors) gen[i] = +(await page.evaluate((i) => window.api.prepare(i), i)).toFixed(1);
  report.genSyncMs720 = gen;
  report.genStats720 = await page.evaluate(() => window.api.genStats());
  report.pieces = await page.evaluate(() => window.api.pieces());
  for (const i of sectors) {
    const n = i + 1;
    await page.evaluate((i) => window.api.render(i, { top: false }), i);
    report[`luma-backdrop-${n}`] = await page.evaluate(() => window.api.luma());
    report[`luma-centre40-${n}`] = await page.evaluate(() => window.api.luma(0.4));
    report[`colour-${n}`] = await page.evaluate(() => window.api.colourCheck());
    await page.evaluate((i) => window.api.render(i, { camX: 0, camY: 0, time: 0 }), i);
    await shot(page, `sector-${n}.png`);
    await page.evaluate((i) => window.api.render(i, { camX: 0, camY: 0, time: 0, overlay: true }), i);
    await shot(page, `sector-${n}-overlay.png`);
    await page.evaluate((i) => window.api.render(i, { camX: 5200, camY: -3100, time: 30 }), i);
    await shot(page, `sector-${n}-moved.png`);
  }
  if (only === undefined) {
    report['colour-legacy'] = await page.evaluate(() => {
      window.api.render(0, { legacy: true, top: false });
      return window.api.colourCheck();
    });
    let n = 1;
    for (const p of [0.15, 0.28, 0.42, 0.56, 0.62, 0.75, 0.9]) {
      await page.evaluate((p) => window.api.renderWarp(0, 1, p), p);
      await shot(page, `warp-${n++}-p${Math.round(p * 100)}.png`);
    }
  }
  report.memBytes = await page.evaluate(() => window.api.mem());
  await page.close();
}

if (perf) {
  for (const [w, h] of [
    [1280, 720],
    [1280, 800],
    [1920, 1080],
    [2560, 1440],
  ]) {
    const page = await open(w, h);
    const r = { gen: {}, draw: {} };
    for (let i = 0; i < 4; i++) r.gen[i] = +(await page.evaluate((i) => window.api.prepare(i), i)).toFixed(1);
    r.genStats = await page.evaluate(() => window.api.genStats());
    r.draw.blank = +(await page.evaluate(() => window.api.bench(0, 120, 'blank'))).toFixed(2);
    r.draw.legacyNebula = +(await page.evaluate(() => window.api.bench(0, 120, 'legacy'))).toFixed(2);
    for (let i = 0; i < 4; i++) {
      const e = {};
      for (const [name, m] of [['tile', 1], ['center', 4], ['planets', 8], ['glow', 16], ['all', 31]]) e[name] = +(await page.evaluate(([i, m]) => window.api.bench(i, 120, 'galaxy', m), [i, m])).toFixed(2);
      r.draw[`sector${i + 1}`] = e;
    }
    r.draw.warp = await page.evaluate(() => window.api.benchWarp(0, 1));
    r.draw.warp34 = await page.evaluate(() => window.api.benchWarp(2, 3));
    r.draw.fullWithStarsGrid = +(await page.evaluate(() => window.api.bench(1, 120, 'full'))).toFixed(2);
    await page.close();
    if (w === 1920 || w === 1280) {
      // Background generation in fresh pages: worker vs chunked main thread, with frame gaps measured.
      const p2 = await open(w, h, true);
      r.worker = {};
      for (let i = 0; i < 4; i++) r.worker[i] = await p2.evaluate((i) => window.api.genBackground(i, true), i);
      r.liveWarpWorker = await p2.evaluate(() => window.api.liveWarp(0, 1, true));
      if (w === 1280) r.resizeWorker = await p2.evaluate(() => window.api.resizeTest(true));
      await p2.close();
      const p3 = await open(w, h, false);
      r.chunked = {};
      for (let i = 0; i < 4; i++) r.chunked[i] = await p3.evaluate((i) => window.api.genBackground(i, false), i);
      r.liveWarpChunked = await p3.evaluate(() => window.api.liveWarp(0, 1, false));
      if (w === 1280) r.resizeChunked = await p3.evaluate(() => window.api.resizeTest(false));
      await p3.close();
    }
    report.sizes[`${w}x${h}`] = r;
  }
}

writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
await browser.close();
server.close();
