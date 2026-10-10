// Tuning sweeps on one frozen real frame: node tools/tune.mjs <scene> '<json array of variants>' [clip x,y,w,h]
// variant: { name, fx, glow, threshold, knee, bloom, l0Keep, gain, grain, flashes }
import { join } from 'node:path';
import { ROOT, serve, launch, openGame, startRun, redraw, freezeWhen } from './lib.mjs';
const [scene, json, clipS] = process.argv.slice(2);
const variants = JSON.parse(json);
const clip = clipS ? (([x, y, width, height]) => ({ x, y, width, height }))(clipS.split(',').map(Number)) : undefined;
const { server, base } = await serve(join(ROOT, 'combined-dist'));
const browser = await launch();
const scenes = {
  early: { q: '?autoplay&god&warp=50', vp: { width: 1280, height: 720 }, pred: `() => window.shardstorm.state === 'playing' && window.shardstorm.world.pendingLevelUps === 0 && window.shardstorm.world.enemies.length > 15` },
  mid: { q: '?autoplay&god&warp=150', vp: { width: 1280, height: 720 }, pred: `() => window.shardstorm.state === 'playing' && window.shardstorm.world.pendingLevelUps === 0 && window.shardstorm.world.enemies.length > 80` },
  warden: { q: '?autoplay&god&warp=120', vp: { width: 1280, height: 720 }, spawn: 'warden', pred: `() => { const b = window.shardstorm.world.boss; return !!b && Math.abs(b.x - window.shardstorm.renderer.camX) < 300 && Math.abs(b.y - window.shardstorm.renderer.camY) < 160 && b.spawnT <= 0 && window.shardstorm.world.pendingLevelUps === 0; }` },
  late: { q: '?autoplay&god&warp=400', vp: { width: 1280, height: 720 }, pred: `() => window.shardstorm.state === 'playing' && window.shardstorm.world.pendingLevelUps === 0 && window.shardstorm.world.enemies.length > 120` },
};
const S = scenes[scene];
const page = await openGame(browser, base, S.q, S.vp);
await startRun(page);
if (S.spawn) await page.evaluate((k) => { const w = window.shardstorm.world, p = w.players[0]; w.spawnEnemy(k, p.x + 200, p.y - 40); }, S.spawn);
await page.waitForTimeout(2000);
await freezeWhen(page, S.pred, 120000).catch(() => console.log('pred timeout'));
for (const v of variants) {
  await page.evaluate((v) => {
    const fx = window.shardstorm.renderer.postfx;
    for (const k of ['l0Keep', 'gain', 'grain', 'white']) if (v[k] !== undefined) fx.tune[k] = v[k];
  }, v);
  await redraw(page, { fx: v.fx ?? true, ...v });
  await page.screenshot({ path: join(ROOT, 'tune', `${scene}-${v.name}.png`), ...(clip ? { clip } : {}) });
  console.log('shot', v.name);
}
await browser.close();
server.close();
