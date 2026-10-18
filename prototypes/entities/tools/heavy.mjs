// Heavy-combat benchmark on REAL game builds: keeps 400 enemies alive around the
// pilot and kills 60/s (through world.killEnemy, so real kill events), timing the
// renderer's JS cost (consume + draw) per frame. Usage: node heavy.mjs <dist> <tag> [w h] [frames] [warp]
import { launch, serve, openGame, startRun } from './lib.mjs';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
const E = new URL('..', import.meta.url).pathname;
const [dist, tag, W = '1920', H = '1080', FR = '360', WARP = '200'] = process.argv.slice(2);
const { server, base } = await serve(dist);
const browser = await launch();
const page = await openGame(browser, base, `?autoplay&warp=${WARP}`, { width: +W, height: +H });
await startRun(page);
await page.waitForTimeout(1500);
const res = await page.evaluate(async (FR) => {
  const app = window.shardstorm;
  const r = app.renderer;
  const kinds = ['drifter', 'drifter', 'swarmling', 'swarmling', 'dasher', 'splitter', 'shooter', 'brute'];
  const origDraw = r.draw.bind(r);
  const origConsume = r.consume.bind(r);
  const draw = [], cons = [], frame = [];
  let kills = 0, acc = 0, last = performance.now(), consMs = 0, simT = 0;
  r.consume = (evs, w) => { countKills(evs); const t0 = performance.now(); origConsume(evs, w); consMs += performance.now() - t0; };
  // Per-method EntityFx timings + kill-event count.
  const parts = {};
  const partsArr = {};
  let killEvents = 0;
  if (r.fx) {
    for (const m of ['drawTelegraphs', 'drawEnemies', 'drawProjectiles', 'drawBullets', 'drawDebris', 'drawShards', 'drawLightning', 'drawPlayers', 'onEvent', 'begin']) {
      const f = r.fx[m].bind(r.fx);
      parts[m] = 0;
      partsArr[m] = [];
      r.fx[m] = (...a) => { const t0 = performance.now(); const v = f(...a); parts[m] += performance.now() - t0; return v; };
    }
  }
    const countKills = (evs) => { for (const e of evs) if (e.t === 'kill') killEvents++; };
  let done;
  const finished = new Promise((res) => (done = res));
  r.draw = (world, dt, opts) => {
    const now = performance.now();
    const rdt = (now - last) / 1000;
    last = now;
    if (!opts.attract && world.players) {
      const p = world.players[0];
      // No invulnerability blink (it halves the hull alpha in screenshots); top HP up instead.
      p.invuln = 0;
      p.hp = Math.max(p.hp, 80);
      // Only scripted kills: weapons still hit (flashes, knockback) but cannot kill.
      let alive = 0;
      for (const e of world.enemies) if (!e.dead) { alive++; if (!e.boss) e.hp = 1e9; }
      let guard = 0;
      while (alive < 400 && guard++ < 500) {
        const a = Math.random() * 6.283;
        const d = 110 + Math.random() * 480;
        const ne = world.spawnEnemy(kinds[(Math.random() * kinds.length) | 0], p.x + Math.cos(a) * d, p.y + Math.sin(a) * d * 0.62, Math.random() < 0.02); if (ne) { ne.hp = ne.maxHp = 1e9; ne.spawnT = 0; alive++; }
        else break;
      }
      acc = Math.min(acc + dt * 60, 30); simT += dt;
      const before = world.events.length;
      while (acc >= 1) {
        acc -= 1;
        // A random live, non-boss enemy near the pilot.
        for (let tries = 0; tries < 20; tries++) {
          const e = world.enemies[(Math.random() * world.enemies.length) | 0];
          if (e && !e.dead && !e.boss && Math.hypot(e.x - p.x, e.y - p.y) < 600) { e.kx = (e.x - p.x) * 0.8; e.ky = (e.y - p.y) * 0.8; e.hp = 0; world.killEnemy(e, false, 0); kills++; break; }
        }
      }
      const evs = world.events.splice(before);
      const t0 = performance.now();
      countKills(evs);
      origConsume(evs, world);
      consMs += performance.now() - t0;
    }
    const t0 = performance.now();
    origDraw(world, dt, opts);
    const d = performance.now() - t0;
    if (!opts.attract) {
      draw.push(d); cons.push(consMs); frame.push(rdt * 1000);
      for (const m in parts) { partsArr[m].push(parts[m]); parts[m] = 0; }
      consMs = 0;
      if (draw.length >= FR) done();
    }
  };
  await finished;
  r.draw = origDraw;
  const st = (a) => { const s = [...a].sort((x, y) => x - y); const m = a.reduce((x, y) => x + y, 0) / a.length; return { mean: +m.toFixed(3), p50: +s[Math.floor(s.length * 0.5)].toFixed(3), p95: +s[Math.floor(s.length * 0.95)].toFixed(3), max: +s[s.length - 1].toFixed(3) }; };
  const w = app.world;
  const fx = r.fx;
  return { frames: draw.length, kills, killsPerSimSec: +(kills / simT).toFixed(1), simSec: +simT.toFixed(2), enemies: w.enemies.length, draw: st(draw.slice(30)), consume: st(cons.slice(30)), frameInterval: st(frame.slice(30)), shards: fx ? fx.shards.count : null, killEventsPerSimSec: +(killEvents / simT).toFixed(1), fxParts: Object.fromEntries(Object.entries(partsArr).map(([k, v]) => [k, st(v.slice(30))])), sprites: fx ? fx.art.size : null };
}, +FR);
console.log(JSON.stringify(res));
await page.evaluate(() => { window.__freeze = true; });
await page.screenshot({ path: join(E, 'shots', `heavy-${tag}.png`) });
writeFileSync(join(E, 'shots', `heavy-${tag}.json`), JSON.stringify(res, null, 2));
await browser.close(); server.close();
