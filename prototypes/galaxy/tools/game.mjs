// Readability in motion (art review item 12): the real game (patched copy in ../game,
// built to ../game-dist) played by the bot through each sector, captured once per
// game-second through boss fights, surges and warps, at 720p / 1080p / 1280x800 / 1440p.
// Every capture is rendered 4x from the same frame state: galaxy full / galaxy backdrop-only /
// legacy full / legacy backdrop-only, and sprite-vs-local-backdrop contrast (OKLab dE) is compared.
// Run: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/game.mjs [--nobuild] [--sizes=1920x1080,...] [--every=1]
import { chromium } from '/home/user/addictive-game/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const dist = join(root, 'game-dist');
const out = join(root, 'shots/game');
mkdirSync(out, { recursive: true });
const sizes = (args.find((a) => a.startsWith('--sizes='))?.split('=')[1] ?? '1280x720,1920x1080,1280x800,2560x1440').split(',').map((s) => s.split('x').map(Number));
const every = Number(args.find((a) => a.startsWith('--every='))?.split('=')[1] ?? 2);

if (!args.includes('--nobuild')) {
  copyFileSync(join(root, 'galaxy.ts'), join(root, 'game/src/render/galaxy.ts'));
  execFileSync('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir', '--logLevel', 'warn'], { cwd: join(root, 'game'), stdio: 'inherit' });
}

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = join(dist, p);
  if (!f.startsWith(dist) || !existsSync(f)) {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(200, { 'content-type': MIME[extname(f)] ?? 'application/octet-stream' });
  res.end(readFileSync(f));
}).listen(0);
const port = server.address().port;
const browser = await chromium.launch({ args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist'] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Windows: [fast-forward to, capture from, capture to] in run seconds.
const WINDOWS = [
  { name: 's1-surge-warden', warp: 170, from: 172, to: 214 },
  { name: 's2-hydra', warp: 352, from: 353, to: 391 },
  { name: 's3-voidheart', warp: 533, from: 534, to: 572 },
  { name: 's4-overtime', warp: 596, from: 597, to: 623 },
];

/** In-page: render the current frame 4 ways and measure sprite contrast against the local backdrop. */
const measure = () => {
  const app = window.shardstorm;
  const r = app.renderer;
  const w = app.world;
  const cv = r.canvas;
  const g = cv.getContext('2d');
  const grab = () => g.getImageData(0, 0, cv.width, cv.height).data;
  const frame = (legacy, bgOnly) => {
    r.bg.legacy = legacy;
    r.debugBgOnly = bgOnly;
    r.draw(w, 0, { attract: false, realDt: 0 });
    r.debugBgOnly = false;
    return grab();
  };
  const toLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const lab = (R, G, B) => {
    const rr = toLin(R / 255), gg = toLin(G / 255), bb = toLin(B / 255);
    const l = Math.cbrt(0.4122214708 * rr + 0.5363325363 * gg + 0.0514459929 * bb);
    const m = Math.cbrt(0.2119034982 * rr + 0.6806995451 * gg + 0.1073969566 * bb);
    const s = Math.cbrt(0.0883024619 * rr + 0.2817188376 * gg + 0.6299787081 * bb);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  };
  const stats = (A, B) => {
    const des = [];
    const cores = [];
    let n = 0;
    for (let i = 0; i < A.length; i += 12) {
      if (A[i] === B[i] && A[i + 1] === B[i + 1] && A[i + 2] === B[i + 2]) continue;
      const a = lab(A[i], A[i + 1], A[i + 2]);
      const b = lab(B[i], B[i + 1], B[i + 2]);
      const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      if (d < 0.03) continue;
      n++;
      des.push(d);
      if (a[0] > 0.7) cores.push(d);
    }
    des.sort((x, y) => x - y);
    cores.sort((x, y) => x - y);
    const q = (arr, p) => (arr.length ? +arr[Math.floor(p * (arr.length - 1))].toFixed(3) : null);
    return { spritePx: n, weak: +(des.filter((d) => d < 0.08).length / Math.max(1, n)).toFixed(3), p10: q(des, 0.1), median: q(des, 0.5), coreP10: q(cores, 0.1) };
  };
  const GF = frame(false, false);
  const GB = frame(false, true);
  const LF = frame(true, false);
  const LB = frame(true, true);
  frame(false, false); // leave the galaxy frame on screen for the screenshot
  // Backdrop luminance near the player (central 40%), p99 (the renderer's own star dots excluded by the percentile).
  const Ls = [];
  const W = cv.width, H = cv.height;
  for (let y = Math.floor(H * 0.3); y < H * 0.7; y += 3) for (let x = Math.floor(W * 0.3); x < W * 0.7; x += 3) {
    const i = (y * W + x) * 4;
    Ls.push((0.2126 * GB[i] + 0.7152 * GB[i + 1] + 0.0722 * GB[i + 2]) / 255);
  }
  Ls.sort((a, b) => a - b);
  const maxL = Ls[Math.floor(Ls.length * 0.99)];
  const fx = r.bg.galaxy.warpFx;
  return {
    t: +w.time.toFixed(1), enemies: w.enemies.length, boss: w.boss?.kind ?? null, sector: r.bg.galaxy.sector, warp: fx.phase,
    galaxy: stats(GF, GB), legacy: stats(LF, LB), bgP99Centre: +maxL.toFixed(3),
  };
};

const report = {};
for (const [W, H] of sizes) {
  const key = `${W}x${H}`;
  report[key] = {};
  for (const win of WINDOWS) {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    await page.clock.install({ time: 1e6 });
    await page.goto(`http://localhost:${port}/?autoplay&god&seed=777&warp=${win.warp}`);
    await page.clock.runFor(200);
    // Let the worker build sector 0 (real time) before starting.
    for (let i = 0; i < 100; i++) {
      await sleep(100);
      await page.clock.runFor(17);
      if (await page.evaluate(() => window.shardstorm?.renderer.bg.galaxy.isReady(0))) break;
    }
    await page.locator('#screen-title [data-act="play"]').click();
    for (let i = 0; i < 600; i++) {
      await page.clock.runFor(50);
      if (await page.evaluate(() => window.shardstorm?.state === 'playing' && window.shardstorm.world?.time > 0)) break;
    }
    // Wait (real time) until the run's starting sector is generated and shown.
    for (let i = 0; i < 100; i++) {
      await sleep(100);
      await page.clock.runFor(17);
      if (await page.evaluate(() => { const gx = window.shardstorm.renderer.bg.galaxy; return gx.isReady(gx.sector) && gx.sector >= 0; })) break;
    }
    const rows = [];
    let t = await page.evaluate(() => window.shardstorm.world.time);
    let shot = 0;
    for (let target = win.from; target <= win.to; target += every) {
      while (t < target) {
        await page.clock.runFor(1000 / 60);
        t = await page.evaluate(() => window.shardstorm.world?.time ?? 0);
        // Give the worker real time while a warp tunnel waits for generation.
        if (await page.evaluate(() => window.shardstorm.renderer.bg.galaxy.warpFx.phase === 'tunnel')) await sleep(30);
        if (await page.evaluate(() => window.shardstorm.state !== 'playing' && window.shardstorm.state !== 'levelup')) break;
      }
      if (await page.evaluate(() => !window.shardstorm.world)) break;
      const m = await page.evaluate(measure);
      rows.push(m);
      if (shot++ % 3 === 0 || m.warp) await page.screenshot({ path: join(out, `${key}-${win.name}-t${Math.round(m.t)}.png`) });
    }
    report[key][win.name] = rows;
    const ev = await page.evaluate(() => window.__galaxyEvents ?? []);
    report[key][win.name + ':events'] = ev;
    console.log(key, win.name, rows.length, 'frames', JSON.stringify(ev.map((e) => `${e.t}${e.to !== undefined ? '>' + e.to : ''}@${e.time.toFixed(1)}`)));
    await page.close();
  }
}

// Summary: per size, galaxy vs legacy medians of the per-frame stats.
const med = (a) => { const s = a.filter((x) => x !== null).sort((x, y) => x - y); return s.length ? +s[Math.floor(s.length / 2)].toFixed(3) : null; };
const summary = {};
for (const [k, wins] of Object.entries(report)) {
  const rows = Object.entries(wins).filter(([n]) => !n.includes(':')).flatMap(([, r]) => r);
  summary[k] = {
    frames: rows.length,
    galaxy: { weak: med(rows.map((r) => r.galaxy.weak)), median: med(rows.map((r) => r.galaxy.median)), p10: med(rows.map((r) => r.galaxy.p10)), coreP10: med(rows.map((r) => r.galaxy.coreP10)) },
    legacy: { weak: med(rows.map((r) => r.legacy.weak)), median: med(rows.map((r) => r.legacy.median)), p10: med(rows.map((r) => r.legacy.p10)), coreP10: med(rows.map((r) => r.legacy.coreP10)) },
    worstFrameWeak: rows.reduce((m, r) => (r.galaxy.weak > m.v ? { v: r.galaxy.weak, t: r.t, legacy: r.legacy.weak } : m), { v: 0 }),
    bgP99Centre: Math.max(...rows.map((r) => r.bgP99Centre)),
  };
}
report.summary = summary;
writeFileSync(join(out, 'readability.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify(summary, null, 1));
await browser.close();
server.close();
