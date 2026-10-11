// Real-game captures of the ALL-LAYERS build (galaxy v2 + warp grid v2 + entities + post-FX),
// built from ../combo into ../game-dist. Fake clock: frames are spaced in game time.
// Run: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/combo.mjs [--build] [--only=a,b] [--perf]
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
const out = join(root, 'shots/combo');
mkdirSync(out, { recursive: true });

if (args.includes('--build')) {
  copyFileSync(join(root, 'grid.ts'), join(root, 'combo/src/render/warpgrid.ts'));
  copyFileSync(join(root, 'gridfx.ts'), join(root, 'combo/src/render/gridfx.ts'));
  execFileSync('npx', ['tsc', '--noEmit', '-p', '.'], { cwd: join(root, 'combo'), stdio: 'inherit' });
  execFileSync('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir', '--logLevel', 'warn'], { cwd: join(root, 'combo'), stdio: 'inherit' });
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

const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-unsafe-swiftshader'] });

async function open(warp, { w = 1920, h = 1080, sector = 0, fx = true, flashes = true, motion = 1, seed = 777 } = {}) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.clock.install({ time: 1e6 });
  await page.goto(`http://localhost:${port}/?autoplay&god&seed=${seed}&warp=${warp}${fx ? '' : '&fx=0'}`);
  await page.addStyleTag({ content: '#toasts,#tutorial{display:none!important}' });
  for (let tries = 0; tries < 5; tries++) {
    try {
      const now = await page.evaluate(() => Date.now());
      await page.clock.pauseAt(now + 1500);
      break;
    } catch (e) {
      console.log('[retry pauseAt]', e.message);
    }
  }
  await page.clock.runFor(200);
  // Galaxy sector 0 generates in a worker (real time).
  for (let i = 0; i < 400; i++) {
    await page.clock.runFor(50);
    const ok = await page.evaluate(() => { const g = window.shardstorm?.renderer.bg.galaxy; return !!g && g.sector >= 0 && g.isReady(g.sector); });
    if (ok) break;
    await page.waitForTimeout(50);
  }
  await page.locator('#screen-title [data-act="play"]').click();
  for (let i = 0; i < 600; i++) {
    await page.clock.runFor(50);
    const ok = await page.evaluate(() => window.shardstorm?.state === 'playing' && window.shardstorm.world?.time > 0);
    if (ok) break;
  }
  await page.evaluate(({ sector, flashes, motion }) => {
    const r = window.shardstorm.renderer;
    if (r.bg.galaxy.sector !== sector) r.bg.galaxy.setSector(sector, { sync: true });
    r.settings.flashes = flashes;
    r.settings.gridMotion = motion;
    window.__gms = [];
    const d = r.draw.bind(r);
    r.draw = (wd, dt, o) => { d(wd, dt, o); window.__gms.push(r.gridMs); };
  }, { sector, flashes, motion });
  await adv(page, 700);
  return page;
}

async function adv(page, ms) {
  if (ms > 0) await page.clock.runFor(Math.round(ms));
}

const info = (page) => page.evaluate(() => {
  const a = window.shardstorm;
  const w = a.world;
  const G = a.renderer.grid;
  const ms = window.__gms.splice(0);
  return { t: +w.time.toFixed(2), enemies: w.enemies.length, fx: a.renderer.postFxActive, q: G.quality, heat: +G.maxHeat.toFixed(2), hot: +G.hotFrac.toFixed(3), expo: +G.exposure.toFixed(2), flare: +G.flare.toFixed(2), gridMs: ms.length ? +(ms.reduce((s, v) => s + v, 0) / ms.length).toFixed(3) : null };
});

async function seq(page, name, times, before) {
  const log = [];
  let now = 0;
  if (before) await page.evaluate(before);
  for (let i = 0; i < times.length; i++) {
    await adv(page, (times[i] - now) * 1000);
    now = times[i];
    await page.screenshot({ path: join(out, `${name}-${String(i).padStart(2, '0')}.png`) });
    log.push({ at: times[i], ...(await info(page)) });
  }
  console.log(name, JSON.stringify(log));
  return log;
}

/** Heavy storm: hold 400 enemies around the pilot, kill 60 per sim-second (real kill events). */
const STORM = () => {
  const app = window.shardstorm;
  const r = app.renderer;
  const kinds = ['drifter', 'drifter', 'swarmling', 'swarmling', 'dasher', 'splitter', 'shooter', 'brute'];
  let acc = 0;
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const d = r.draw.bind(r);
  r.draw = (world, dt, opts) => {
    if (!opts.attract) {
      const p = world.players[0];
      p.invuln = 5;
      p.hp = Math.max(p.hp, 50);
      let alive = 0;
      for (const e of world.enemies) if (!e.dead) { alive++; if (!e.boss) e.hp = 1e9; }
      let guard = 0;
      while (alive < 400 && guard++ < 500) {
        const a = rnd() * 6.283;
        const dd = 110 + rnd() * 480;
        const ne = world.spawnEnemy(kinds[(rnd() * kinds.length) | 0], p.x + Math.cos(a) * dd, p.y + Math.sin(a) * dd * 0.62, rnd() < 0.02);
        if (ne) { ne.hp = ne.maxHp = 1e9; ne.spawnT = 0; alive++; } else break;
      }
      acc = Math.min(acc + dt * 60, 30);
      const before = world.events.length;
      while (acc >= 1) {
        acc -= 1;
        for (let tries = 0; tries < 20; tries++) {
          const e = world.enemies[(rnd() * world.enemies.length) | 0];
          if (e && !e.dead && !e.boss && Math.hypot(e.x - p.x, e.y - p.y) < 600) { e.kx = (e.x - p.x) * 0.8; e.ky = (e.y - p.y) * 0.8; e.hp = 0; world.killEnemy(e, false, 0); break; }
        }
      }
      const evs = world.events.splice(before);
      r.consume(evs, world);
    }
    d(world, dt, opts);
  };
};

const report = {};
const want = (n) => !only || only.includes(n);

if (want('fight')) {
  const page = await open(105);
  report.fight = await seq(page, 'fight', [0, 0.25, 0.5, 0.75, 1.0, 1.25]);
  await page.close();
}

for (const [tag, o] of [['storm', {}], ['storm-s1', { sector: 1 }], ['storm-s3', { sector: 3 }], ['storm-reduced', { flashes: false }], ['storm-2d', { fx: false }]]) {
  if (!want(tag)) continue;
  const page = await open(150, o);
  await page.evaluate(STORM);
  await adv(page, 1500);
  report[tag] = await seq(page, tag, [0, 0.5, 1.0]);
  await page.close();
}

const BOSS_DEATH = () => {
  const w = window.shardstorm.world;
  const p = w.players[0];
  let b = w.enemies.find((e) => e.boss && !e.dead);
  if (!b) {
    b = w.spawnEnemy('warden', p.x + 300, p.y - 60);
    b.spawnT = 0;
    w.boss = b;
  }
  window.__boss = b;
};
for (const [tag, o] of [['bossdead', {}], ['bossdead-reduced', { flashes: false }], ['bossdead-2d', { fx: false }], ['bossdead-still', { motion: 0 }]]) {
  if (!want(tag)) continue;
  const page = await open(150, o);
  await page.evaluate(BOSS_DEATH);
  await adv(page, 900);
  report[tag] = await seq(page, tag, [0.03, 0.15, 0.3, 0.5, 0.8, 1.2, 1.8], () => {
    const w = window.shardstorm.world;
    const b = window.__boss;
    b.hp = 0;
    w.killEnemy(b, false, 0);
  });
  await page.close();
}

for (const [tag, o] of [['bomb', {}], ['bomb-reduced', { flashes: false }]]) {
  if (!want(tag)) continue;
  const page = await open(150, o);
  report[tag] = await seq(page, tag, [0.03, 0.15, 0.3, 0.5, 0.8, 1.2], () => { window.shardstorm.world.bomb(0); });
  await page.close();
}

if (want('voidheart')) {
  const page = await open(150, { sector: 2 });
  await page.evaluate(() => {
    const w = window.shardstorm.world;
    const p = w.players[0];
    const e = w.spawnEnemy('voidheart', p.x + 330, p.y - 40);
    if (e) { e.spawnT = 0; w.boss = e; }
  });
  await adv(page, 1500);
  report.voidheart = await seq(page, 'voidheart', [0, 1, 2]);
  await page.close();
}

if (want('singularity')) {
  const page = await open(150);
  report.singularity = await seq(page, 'singularity', [0.1, 0.35, 0.6, 0.85, 0.95, 1.1, 1.5], () => {
    const w = window.shardstorm.world;
    const p = w.players[0];
    w.mines.push({ x: p.x + 170, y: p.y - 40, armT: 0, life: 0, radius: 120, damage: 80, pull: true, pullT: 0.9, triggered: true, dead: false, pid: 0 });
  });
  await page.close();
}

if (want('dash')) {
  const page = await open(75);
  report.dash = await seq(page, 'dash', [0.05, 0.12, 0.2, 0.3, 0.45, 0.7], () => { window.shardstorm.world.players[0].dashBuffer = 0.2; });
  await page.close();
}

if (want('death')) {
  const page = await open(105);
  report.death = await seq(page, 'death', [0.05, 0.2, 0.45, 0.8], () => {
    const w = window.shardstorm.world;
    window.__captureGod = false;
    globalThis.__captureGod = false;
    const p = w.players[0];
    p.invuln = 0;
    p.shieldReady = false;
    p.hp = 1;
    w.hurtPlayer(999, p.x + 10, p.y, 0);
  });
  await page.close();
}

if (perf) {
  // JS-side grid cost (forces + update + draw) per frame in the heavy storm, real clock.
  for (const [tag, o] of [['perf-fx', { pin: true }], ['perf-2d', { fx: false }], ['perf-fx-1440', { pin: true, w: 2560, h: 1440 }], ['perf-fx-720', { pin: true, w: 1280, h: 720 }]]) {
    if (!want(tag) && only && !only.includes('perf')) continue;
    const page = await browser.newPage({ viewport: { width: o.w ?? 1920, height: o.h ?? 1080 }, deviceScaleFactor: 1 });
    page.on('pageerror', (e) => console.log('[pageerror]', e.message));
    await page.goto(`http://localhost:${port}/?autoplay&god&seed=777&warp=150${o.fx === false ? '&fx=0' : ''}`);
    await page.waitForFunction(() => { const g = window.shardstorm?.renderer.bg.galaxy; return !!g && g.isReady(0); }, null, { timeout: 90000 });
    await page.locator('#screen-title [data-act="play"]').click();
    await page.waitForFunction(() => window.shardstorm.state === 'playing', null, { timeout: 180000 });
    if (o.pin) await page.evaluate(() => { const r = window.shardstorm.renderer; r.postfx.settings.quality = 0; r.postfx.reenable(0); });
    await page.evaluate(STORM);
    await page.waitForTimeout(3000);
    report[tag] = await page.evaluate(() => new Promise((resolve) => {
      const a = window.shardstorm;
      const r = a.renderer;
      const G = r.grid;
      const g = [];
      const f = [];
      const parts = { upd: [], draw: [] };
      const up = G.update.bind(G);
      const dr = G.draw.bind(G);
      G.update = (...x) => { const t = performance.now(); up(...x); parts.upd.push(performance.now() - t); };
      G.draw = (...x) => { const t = performance.now(); dr(...x); parts.draw.push(performance.now() - t); };
      let last = performance.now();
      let n = 0;
      const tick = () => {
        const now = performance.now();
        f.push(now - last);
        last = now;
        g.push(r.gridMs);
        if (++n < 240) requestAnimationFrame(tick);
        else {
          const st = (x) => { const s = [...x].sort((u, v) => u - v); return { mean: +(x.reduce((q, v) => q + v, 0) / x.length).toFixed(3), p50: +s[Math.floor(s.length * 0.5)].toFixed(3), p95: +s[Math.floor(s.length * 0.95)].toFixed(3) }; };
          resolve({ enemies: a.world.enemies.length, points: G.pointCount, quality: G.quality, fx: r.postFxActive, gridMs: st(g.slice(20)), update: st(parts.upd.slice(20)), draw: st(parts.draw.slice(20)), frameMs: st(f.slice(20)) });
        }
      };
      requestAnimationFrame(tick);
    }));
    console.log(tag, JSON.stringify(report[tag]));
    await page.close();
  }
}

writeFileSync(join(out, `report${only ? '-' + only.join('_') : ''}.json`), JSON.stringify(report, null, 2));
await browser.close();
server.close();
