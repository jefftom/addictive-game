// Brightness budget audit on the world canvas (pre-post-FX, glow 0.15): per element class, the
// distribution of max(r,g,b) inside each entity's disc. node tools/budget.mjs [scene]
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { ROOT, serve, launch, openGame, startRun, redraw, freezeWhen } from './lib.mjs';
const scene = process.argv[2] ?? 'mid';
const Q = { early: ['?autoplay&god&warp=50', 15], mid: ['?autoplay&god&warp=150', 80], late: ['?autoplay&god&warp=400', 120] }[scene];
const { server, base } = await serve(join(ROOT, 'combined-dist'));
const browser = await launch();
const page = await openGame(browser, base, Q[0]);
await startRun(page);
await page.waitForTimeout(2000);
await freezeWhen(page, `() => window.shardstorm.state === 'playing' && window.shardstorm.world.pendingLevelUps === 0 && window.shardstorm.world.enemies.length > ${Q[1]}`, 120000).catch(() => console.log('timeout'));
await redraw(page, { fx: true });
const res = await page.evaluate(() => {
  const app = window.shardstorm, r = app.renderer, w = app.world;
  const c = r.worldCanvas, ctx = c.getContext('2d');
  const img = ctx.getImageData(0, 0, c.width, c.height).data;
  const k = r.scale * r.dpr, W = c.width, H = c.height;
  const toS = (x, y) => [(x - r.camX) * k + W / 2, (y - r.camY) * k + H / 2];
  const stats = {};
  const add = (cls, x, y, rad) => {
    const [sx, sy] = toS(x, y); const R = rad * k;
    if (sx < R || sy < R || sx > W - R || sy > H - R) return;
    const s = (stats[cls] ??= { n: 0, px: 0, over45: 0, over60: 0, over90: 0, max: 0, sum: 0 });
    s.n++;
    for (let yy = Math.floor(sy - R); yy <= sy + R; yy++) for (let xx = Math.floor(sx - R); xx <= sx + R; xx++) {
      if ((xx - sx) ** 2 + (yy - sy) ** 2 > R * R) continue;
      const i = (yy * W + xx) * 4; const m = Math.max(img[i], img[i + 1], img[i + 2]) / 255;
      s.px++; s.sum += m; if (m > 0.45) s.over45++; if (m > 0.6) s.over60++; if (m > 0.9) s.over90++; if (m > s.max) s.max = m;
    }
  };
  for (const e of w.enemies) if (!e.dead && e.spawnT <= 0) add(e.boss ? 'boss:' + e.kind : e.kind, e.x, e.y, e.r * 0.9);
  for (const b of w.bullets) add('enemyBullet', b.x, b.y, 5);
  const p = w.players[0]; add('player', p.x, p.y, 14);
  // Backdrop: whole frame + central 60%: sample a grid, excluding entity discs is skipped (statistical).
  let bgMax = 0, bgCentre = [], bgAll = [];
  for (let y = 0; y < H; y += 7) for (let x = 0; x < W; x += 7) {
    const i = (y * W + x) * 4; const m = Math.max(img[i], img[i + 1], img[i + 2]) / 255;
    bgAll.push(m); if (Math.abs(x - W / 2) < W * 0.3 && Math.abs(y - H / 2) < H * 0.3) bgCentre.push(m);
  }
  const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return +s[Math.floor(s.length * q)].toFixed(3); };
  const out = {};
  for (const [kk, s] of Object.entries(stats)) out[kk] = { n: s.n, mean: +(s.sum / s.px).toFixed(3), over45: +(s.over45 / s.px).toFixed(3), over60: +(s.over60 / s.px).toFixed(3), over90: +(s.over90 / s.px).toFixed(3), max: +s.max.toFixed(3) };
  out.frame = { p50: pct(bgAll, 0.5), p90: pct(bgAll, 0.9), p99: pct(bgAll, 0.99) };
  out.centre60 = { p50: pct(bgCentre, 0.5), p90: pct(bgCentre, 0.9), p99: pct(bgCentre, 0.99) };
  out.sector = r.bg.galaxy.sector;
  return out;
});
console.log(JSON.stringify(res, null, 1));
writeFileSync(join(ROOT, 'shots', `budget-${scene}.json`), JSON.stringify(res, null, 2));
await browser.close(); server.close();
