// Real-game frames: boss fights / telegraphs / player close-ups. Usage: node scenes.mjs <dist> <tag> [names]
import { launch, serve, openGame, startRun, freezeWhen } from './lib.mjs';
import { join } from 'node:path';
const E = new URL('..', import.meta.url).pathname;
const [dist, tag, only] = process.argv.slice(2);
const scenes = [
  { name: 'warden', boss: 'warden', pred: "() => { const b = window.shardstorm.world.boss; const c = window.shardstorm.renderer; const on = Math.abs(b.x - c.camX) < 420 && Math.abs(b.y - c.camY) < 230; return b && on && b.spawnT <= 0 && b.fireT < 0.45; }" },
  { name: 'hydra-tele', boss: 'hydra', pred: "() => { const b = window.shardstorm.world.boss; if (!b) return false; const c = window.shardstorm.renderer; const on = Math.abs(b.x - c.camX) < 420 && Math.abs(b.y - c.camY) < 230; return on && b.state === 1 && b.stateT < 0.3; }" },
  { name: 'hydra-volley', boss: 'hydra', pred: "() => { const b = window.shardstorm.world.boss; if (!b) return false; const c = window.shardstorm.renderer; const on = Math.abs(b.x - c.camX) < 420 && Math.abs(b.y - c.camY) < 230; return on && b.state === 3 && b.stateT < 1.1; }" },
  { name: 'voidheart', boss: 'voidheart', pred: "() => { const b = window.shardstorm.world.boss; if (!b) return false; const c = window.shardstorm.renderer; const on = Math.abs(b.x - c.camX) < 420 && Math.abs(b.y - c.camY) < 230; return on && b.spawnT <= 0 && window.shardstorm.world.bullets.length > 20; }" },
  { name: 'ship', boss: null, pred: "() => window.shardstorm.world.time > 125 && Math.hypot(window.shardstorm.world.players[0].vx, window.shardstorm.world.players[0].vy) > 150", clip: true },
  { name: 'kills', boss: null, pred: "() => window.shardstorm.world.time > 128 && window.shardstorm.renderer.fx.shards.count > 60" },
  { name: 'dash', boss: null, pred: "() => window.shardstorm.world.players[0].dashT > 0.05", clip: true },
].filter((s) => !only || only.split(',').includes(s.name));
const { server, base } = await serve(dist);
const browser = await launch();
for (const sc of scenes) {
  const ship = sc.ship ?? process.env.SHIP ?? 'spark';
  const page = await openGame(browser, base, `?autoplay&warp=120`, { width: 1280, height: 720 });
  await page.evaluate(([ship, fl]) => { window.__ship = ship; window.__flashes = fl; }, [ship, process.env.FLASHES !== '0']);
  await startRun(page);
  await page.evaluate((boss) => {
    const app = window.shardstorm;
    const r = app.renderer;
    const d = r.draw.bind(r);
    r.draw = (w, dt, o) => { if (!o.attract) { const p = w.players[0]; p.hp = Math.max(p.hp, 90); p.invuln = 0; } return d(w, dt, o); };
    if (window.__ship) app.world.players[0].ship = window.__ship;
    r.settings.flashes = window.__flashes;
    if (boss) { const w = app.world; const p = w.players[0]; w.spawnEnemy(boss, p.x + 260, p.y - 60); }
  }, sc.boss);
  try {
    await freezeWhen(page, sc.pred, 40000);
  } catch { console.log('timeout', sc.name); }
  const shotPath = join(E, 'shots', `${tag}-${sc.name}.png`);
  if (sc.clip) {
    const box = await page.evaluate(() => { const app = window.shardstorm; const r = app.renderer; const p = app.world.players[0]; const k = r.scale; return { x: r.cssW / 2 + (p.x - r.camX) * k, y: r.cssH / 2 + (p.y - r.camY) * k }; });
    await page.screenshot({ path: join(E, 'shots', `${tag}-${sc.name}-full.png`) });
    await page.screenshot({ path: shotPath, clip: { x: Math.max(0, box.x - 160), y: Math.max(0, box.y - 110), width: 320, height: 220 } });
  } else await page.screenshot({ path: shotPath });
  console.log('shot', sc.name);
  await page.close();
}
await browser.close(); server.close();
