// Real-game captures of the WarpGrid integration (patched game copy in ../game, built to ../game-dist).
// Run: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/game.mjs [--nobuild] [--only=a,b] [--perf]
import { chromium } from '/home/user/addictive-game/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const only = args.find((a) => a.startsWith('--only='))?.split('=')[1]?.split(',');
const perf = args.includes('--perf');
const dist = join(root, 'game-dist');
const out = join(root, 'shots/game');
mkdirSync(out, { recursive: true });

if (!args.includes('--nobuild')) {
  copyFileSync(join(root, 'grid.ts'), join(root, 'game/src/render/warpgrid.ts'));
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

async function open(warp, { fake = true, w = 1920, h = 1080 } = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  // Fake clock: frames advance only when we say so, so sequences are spaced in game time.
  if (fake) await page.clock.install({ time: 1e6 });
  await page.goto(`http://localhost:${port}/?autoplay&warp=${warp}`);
  if (fake) {
    const now = await page.evaluate(() => Date.now());
    await page.clock.pauseAt(now + 100);
    await page.clock.runFor(200);
  }
  await page.locator('#screen-title [data-act="play"]').click();
  for (let i = 0; i < 600; i++) {
    if (fake) await page.clock.runFor(50);
    else await page.waitForTimeout(50);
    const ok = await page.evaluate(() => window.shardstorm?.state === 'playing' && window.shardstorm.world?.time > 0);
    if (ok) break;
  }
  // Let the camera settle.
  await adv(page, fake ? 600 : 0);
  if (!fake) await page.waitForTimeout(400);
  return page;
}

/** Advance the fake clock (rAF fires every 16 ms of fake time). */
async function adv(page, ms) {
  if (ms > 0) await page.clock.runFor(Math.round(ms));
}

const info = (page) => page.evaluate(() => {
  const a = window.shardstorm;
  const w = a.world;
  return { t: +w.time.toFixed(2), enemies: w.enemies.length, boss: w.boss?.kind ?? null, gridMs: +a.renderer.gridMs.toFixed(3), heat: +a.renderer.grid.maxHeat.toFixed(2) };
});

async function seq(page, name, times, before) {
  const log = [];
  let now = 0;
  if (before) await page.evaluate(before);
  for (let i = 0; i < times.length; i++) {
    await adv(page, (times[i] - now) * 1000);
    now = times[i];
    await page.screenshot({ path: join(out, `${name}-${String(i).padStart(2, '0')}.png`) });
    log.push({ dt: times[i], ...(await info(page)) });
  }
  console.log(name, JSON.stringify(log));
  return log;
}

const report = {};
const want = (n) => !only || only.includes(n);

if (want('fight')) {
  // Mid-run brawl (~200 s): kill ripples, nova rings, bot dashes.
  const page = await open(105);
  report.fight = await seq(page, 'fight', [0, 0.25, 0.5, 0.75, 1.0, 1.25]);
  await page.close();
}

if (want('dash')) {
  const page = await open(75);
  // Force a dash now (the sim consumes dashBuffer on the next step).
  report.dash = await seq(page, 'dash', [0.05, 0.12, 0.2, 0.3, 0.45, 0.7], () => { window.shardstorm.world.player.dashBuffer = 0.2; });
  await page.close();
}

if (want('singularity')) {
  const page = await open(150);
  // Drop an evolved Singularity mine (pull) next to the player: real sim pulls enemies, then detonates.
  report.singularity = await seq(page, 'singularity', [0.1, 0.35, 0.6, 0.85, 0.95, 1.1, 1.5], () => {
    const w = window.shardstorm.world;
    const p = w.player;
    w.mines.push({ x: p.x + 170, y: p.y - 40, armT: 0, life: 0, radius: 120, damage: 80, pull: true, pullT: 0.9, triggered: true, dead: false });
  });
  await page.close();
}

if (want('bossdead')) {
  const page = await open(190);
  // Warden is on the field around 180-190 s; trigger its death visuals where it stands
  // (renderer-side only: the same events the sim emits on a boss kill).
  report.bossdead = await seq(page, 'bossdead', [0.03, 0.12, 0.25, 0.45, 0.7, 1.0, 1.6], () => {
    const a = window.shardstorm;
    const w = a.world;
    const p = w.player;
    const onScreen = (e) => Math.abs(e.x - p.x) < 600 && Math.abs(e.y - p.y) < 330;
    const b = w.enemies.find((e) => e.boss && onScreen(e)) ?? { x: p.x + 280, y: p.y - 60 };
    a.renderer.consume([
      { t: 'kill', x: b.x, y: b.y, color: '#ff2d55', r: 52, elite: false, boss: true, score: 5000, dash: false },
      { t: 'bossdead', x: b.x, y: b.y, name: 'The Warden' },
    ], w);
  });
  await page.close();
}

if (want('voidheart')) {
  const page = await open(120);
  // The bot rarely survives to 540 s: spawn the hive mothership (real AI) near the player.
  await page.evaluate(() => {
    const w = window.shardstorm.world;
    const e = w.spawnEnemy('voidheart', w.player.x + 330, w.player.y - 40);
    if (e) { e.spawnT = 0; w.boss = e; }
  });
  await adv(page, 1500);
  report.voidheart = await seq(page, 'voidheart', [0, 1, 2]);
  await page.close();
}

if (perf) {
  // In-game cost at 1080p in a heavy late fight: grid JS ms (Renderer.gridMs) and rAF frame
  // time with the grid on vs. stubbed out (SwiftShader: frame times are pessimistic).
  const page = await open(300, { fake: false });
  const sample = () => page.evaluate(() => new Promise((resolve) => {
    const a = window.shardstorm;
    const g = [];
    const f = [];
    let last = performance.now();
    let n = 0;
    const tick = () => {
      const now = performance.now();
      f.push(now - last);
      last = now;
      g.push(a.renderer.gridMs);
      if (++n < 150) requestAnimationFrame(tick);
      else {
        const m = (x) => x.reduce((s, v) => s + v, 0) / x.length;
        const p95 = (x) => [...x].sort((u, v) => u - v)[Math.floor(x.length * 0.95)];
        resolve({ enemies: a.world.enemies.length, gridMsMean: +m(g).toFixed(3), gridMsP95: +p95(g).toFixed(3), frameMsMean: +m(f).toFixed(2), frameMsP95: +p95(f).toFixed(2) });
      }
    };
    requestAnimationFrame(tick);
  }));
  report.perfGrid = await sample();
  await page.evaluate(() => {
    const G = window.shardstorm.renderer.grid;
    G.draw = () => {};
  });
  report.perfNoGridDraw = await sample();
  console.log('perf', JSON.stringify({ grid: report.perfGrid, noGridDraw: report.perfNoGridDraw }));
  await page.close();
}

writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
await browser.close();
server.close();
