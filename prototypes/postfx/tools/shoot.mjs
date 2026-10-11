// Real-game before/after captures on the COMBINED four-layer build (galaxy + grid + entities + post-FX).
// "before" = the same build's 2D fallback (?fx off, full sprite glow); "after" = post-FX (glow 0.15).
// Run: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/shoot.mjs [scene,scene]
import { join } from 'node:path';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { ROOT, serve, launch, openGame, startRun, redraw, freezeWhen, waitGalaxy, installStorm } from './lib.mjs';

const only = (process.argv[2] ?? 'all').split(',');
const want = (n) => only.includes('all') || only.includes(n);
const { server, base } = await serve(join(ROOT, 'combined-dist'));
const browser = await launch();
const out = (n) => join(ROOT, 'shots', n);
const reportPath = out('report.json');
const report = existsSync(reportPath) ? JSON.parse(readFileSync(reportPath, 'utf8')) : {};

async function pair(page, name, extra = {}, clip) {
  const c = clip ? { clip } : {};
  await redraw(page, { fx: false, ...extra });
  await page.screenshot({ path: out(`${name}-before.png`), ...c });
  const r = await redraw(page, { fx: true, ...extra });
  await page.screenshot({ path: out(`${name}-after.png`), ...c });
  report[name] = r;
  return r;
}

const playing = `() => window.shardstorm.state === 'playing' && window.shardstorm.world.pendingLevelUps === 0`;
const onScreen = (b) => `(Math.abs(${b}.x - window.shardstorm.renderer.camX) < 400 && Math.abs(${b}.y - window.shardstorm.renderer.camY) < 210)`;

async function bossScene(page, kind, ship = 'spark') {
  await page.evaluate((ship) => (window.shardstorm.save.ship = ship), ship);
  await startRun(page);
  await page.evaluate((kind) => {
    const app = window.shardstorm, w = app.world, p = w.players[0];
    w.spawnEnemy(kind, p.x + 260, p.y - 60);
  }, kind);
}

if (want('title')) {
  const page = await openGame(browser, base, '');
  await waitGalaxy(page);
  await page.waitForTimeout(4000);
  await freezeWhen(page, `() => window.shardstorm.attract.enemies.length > 25`);
  await pair(page, 'title');
  await page.close();
}

if (want('early')) {
  const page = await openGame(browser, base, '?autoplay&god&warp=50');
  await startRun(page);
  await page.waitForTimeout(2500);
  await freezeWhen(page, playing);
  await pair(page, 'early');
  await page.close();
}

if (want('warden')) {
  // Warden (gate fortress) charging a volley, explosions around, then a real boss kill mid-ripple.
  const page = await openGame(browser, base, '?autoplay&god&warp=120');
  await bossScene(page, 'warden', 'phantom');
  await freezeWhen(page, `() => { const b = window.shardstorm.world.boss; return !!b && ${onScreen('b')} && b.spawnT <= 0 && b.fireT < 0.45 && window.shardstorm.world.pendingLevelUps === 0; }`, 60000).catch(() => console.log('warden timeout'));
  await pair(page, 'warden');

  // Real kill path, boss moved on-screen; capture the shockwave 0.33 s later.
  await page.evaluate(() => {
    const w = window.shardstorm.world, b = w.boss, p = w.players[0];
    window.__events.length = 0;
    b.x = p.x + 170; b.y = p.y + 80;
    window.__killBoss = () => { if (w.boss) w.damageEnemy(w.boss, w.boss.hp + 1, false, 0, 0, 0); };
    // No level-up screen in the middle of the capture.
    w.xpNext = 1e12;
  });
  await page.evaluate(() => window.__step(2));
  await page.evaluate(() => window.__killBoss());
  await freezeWhen(page, `() => window.__events.some((e) => e.t === 'bossdead')`);
  const t0 = await page.evaluate(() => window.__events.find((e) => e.t === 'bossdead').at);
  await freezeWhen(page, `() => performance.now() - ${t0} > 330`);
  report.bossdeadLive = await page.evaluate(() => window.shardstorm.renderer.postfx.stats());
  await page.screenshot({ path: out('bossdeath-live.png') });
  await pair(page, 'bossdeath');
  await redraw(page, { fx: true, flashes: false });
  await page.screenshot({ path: out('bossdeath-after-reduced-flashes.png') });
  await redraw(page, { fx: false, flashes: false });
  await page.screenshot({ path: out('bossdeath-before-reduced-flashes.png') });
  await redraw(page, { fx: true, flashes: true, shake: 0 });
  await page.screenshot({ path: out('bossdeath-after-shake0.png') });
  await redraw(page, { fx: true, flashes: true, shake: 1 });
  // A few frames later: the wave front has travelled.
  await page.evaluate(() => window.__step(14));
  await page.screenshot({ path: out('bossdeath-live-2.png') });

  // Context loss -> 2D fallback -> restore.
  const lost = await page.evaluate(async () => {
    const r = window.shardstorm.renderer;
    const ext = r.postfx.canvas.getContext('webgl2').getExtension('WEBGL_lose_context');
    ext.loseContext();
    await new Promise((res) => setTimeout(res, 100));
    window.__ext = ext;
    return { afterLoss: r.postFxActive, bodyClass: document.body.className, glow: r.fx.art.glowScale };
  });
  await redraw(page, {});
  await page.screenshot({ path: out('context-lost-fallback.png') });
  const restored = await page.evaluate(async () => {
    window.__ext.restoreContext();
    await new Promise((res) => setTimeout(res, 300));
    const r = window.shardstorm.renderer;
    return { active: r.postFxActive, bodyClass: document.body.className, glow: r.fx.art.glowScale };
  });
  await redraw(page, {});
  await page.screenshot({ path: out('context-restored.png') });
  report.contextLoss = { lost, restored };
  await page.close();
}

if (want('voidheart')) {
  const page = await openGame(browser, base, '?autoplay&god&warp=140');
  await bossScene(page, 'voidheart', 'tempest');
  await freezeWhen(page, `() => { const b = window.shardstorm.world.boss; return !!b && ${onScreen('b')} && b.spawnT <= 0 && window.shardstorm.world.bullets.length > 25 && window.shardstorm.world.pendingLevelUps === 0; }`, 60000).catch(() => console.log('voidheart timeout'));
  await pair(page, 'voidheart');
  await page.close();
}

if (want('hydra')) {
  const page = await openGame(browser, base, '?autoplay&god&warp=45');
  await bossScene(page, 'hydra', 'vanguard');
  await freezeWhen(page, `() => { const b = window.shardstorm.world.boss; return !!b && ${onScreen('b')} && b.state === 1 && b.stateT < 0.3; }`, 60000).catch(() => console.log('hydra timeout'));
  await pair(page, 'hydra');
  await page.close();
}

if (want('nova')) {
  const page = await openGame(browser, base, '?autoplay&god&warp=130');
  await page.evaluate(() => (window.shardstorm.save.ship = 'bastion'));
  await startRun(page);
  await page.waitForTimeout(1500);
  await freezeWhen(
    page,
    `() => { const a = window.shardstorm; if (a.state !== 'playing') return false;
       const now = performance.now(); return window.__events.some((e) => e.t === 'ring' && now - e.at > 150 && now - e.at < 260); }`,
  );
  await pair(page, 'nova');
  await page.close();
}

if (want('lowhp')) {
  // Low HP + a fresh hit: red edge pressure, small aberration tick, no refraction around the ship.
  const page = await openGame(browser, base, '?autoplay&warp=90');
  await startRun(page);
  await page.waitForTimeout(1500);
  await freezeWhen(page, playing);
  await page.evaluate(() => {
    const w = window.shardstorm.world, p = w.players[0];
    p.hp = w.stats.maxHp * 0.08;
    window.__events.length = 0;
  });
  await page.evaluate(() => window.__step(3));
  await page.evaluate(() => { const w = window.shardstorm.world, p = w.players[0]; p.invuln = 0; w.hurtPlayer(1, p.x + 20, p.y, 0); });
  await page.evaluate(() => window.__step(4));
  await pair(page, 'lowhp');
  await page.close();
}

if (want('storm')) {
  // Kill storm, 1920x1080: 400 live aliens around the pilot, 60 scripted kills per sim-second (real kill events).
  const page = await openGame(browser, base, '?autoplay&warp=200', { width: 1920, height: 1080 });
  await startRun(page);
  await page.waitForTimeout(1000);
  await installStorm(page);
  await freezeWhen(page, `() => window.__stormFrames > 150`, 180000);
  report.stormInfo = await page.evaluate(() => ({ enemies: window.shardstorm.world.enemies.length, shards: window.shardstorm.renderer.fx.shards.count }));
  await pair(page, 'storm');
  // Crop: centre 900x560 (where the pilot is) at 1:1 for detail.
  await pair(page, 'storm-crop', {}, { x: 510, y: 260, width: 900, height: 560 });
  await redraw(page, { fx: true, renderScale: 0.75, quality: 0 });
  await page.screenshot({ path: out('storm-after-lowest-rung.png') });
  report.lowestRung = await page.evaluate(() => ({ world: [window.shardstorm.renderer.worldCanvas.width, window.shardstorm.renderer.worldCanvas.height], stats: window.shardstorm.renderer.postfx.stats() }));
  await redraw(page, { fx: true, renderScale: 1, quality: 3 });

  // Glow comparison crop around the densest enemy cluster.
  const bc = await page.evaluate(() => {
    const r = window.shardstorm.renderer, w = window.shardstorm.world;
    const k = r.scale * r.dpr;
    const pts = w.enemies.map((e) => ({ x: (e.x - r.camX) * k + r.w / 2, y: (e.y - r.camY) * k + r.h / 2 })).filter((p) => p.x > 250 && p.x < r.w - 250 && p.y > 200 && p.y < r.h - 200);
    let best = { x: r.w / 2, y: r.h / 2 }, bs = -1;
    for (const p of pts) { let s = 0; for (const q of pts) if (Math.hypot(p.x - q.x, p.y - q.y) < 160) s++; if (s > bs) { bs = s; best = p; } }
    return best;
  });
  const clip = { x: Math.max(0, Math.min(1920 - 480, bc.x - 240)), y: Math.max(0, Math.min(1080 - 340, bc.y - 170)), width: 480, height: 340 };
  await redraw(page, { fx: false });
  await page.screenshot({ path: out('glow-a-2d-fallback.png'), clip });
  await redraw(page, { fx: true, glow: 1 });
  await page.screenshot({ path: out('glow-b-fx-fullglow.png'), clip });
  report.spritePx = { full: await page.evaluate(() => window.shardstorm.renderer.sprites.pixelCount()) };
  await redraw(page, { fx: true, glow: 0.15 });
  await page.screenshot({ path: out('glow-c-fx-0.15.png'), clip });
  report.spritePx.tight = await page.evaluate(() => window.shardstorm.renderer.sprites.pixelCount());
  await redraw(page, { fx: true, glow: 0 });
  await page.screenshot({ path: out('glow-d-fx-noglow.png'), clip });
  await redraw(page, { fx: true, glow: 0.15 });
  await page.close();
}

writeFileSync(reportPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1).slice(0, 3000));
await browser.close();
server.close();
