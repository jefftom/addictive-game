// Timings on the COMBINED build in a kill storm (400 live aliens, 60 kills/s).
//  1. Live: N frames with post-FX on, then N with the 2D fallback: JS per frame (consume + draw incl. post submit).
//  2. Frozen frame: 2D fallback flushed vs post-FX submit at q3 / q0 / q0+renderScale 0.75; pure GL encoding; upload.
// Headless Chromium = SwiftShader: canvas raster and GL run on the CPU. JS-side numbers are the meaningful ones.
// Run: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/bench.mjs [width height]
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { ROOT, serve, launch, openGame, startRun, installStorm } from './lib.mjs';

const W = Number(process.argv[2] ?? 1920);
const H = Number(process.argv[3] ?? 1080);
const FR = Number(process.argv[4] ?? 240);
const { server, base } = await serve(join(ROOT, 'combined-dist'));
const browser = await launch();
const page = await openGame(browser, base, `?autoplay&warp=200`, { width: W, height: H });
await startRun(page);
await page.waitForTimeout(1000);
await installStorm(page);
const stat = (arr) => {
  const s = [...arr].sort((a, b) => a - b);
  const m = s.reduce((a, b) => a + b, 0) / s.length;
  return { mean: +m.toFixed(2), p50: +s[s.length >> 1].toFixed(2), p95: +s[Math.floor(s.length * 0.95)].toFixed(2) };
};
const out = { viewport: [W, H] };
for (const mode of ['fx', '2d', 'fx-q0-rs075']) {
  await page.evaluate((mode) => {
    const r = window.shardstorm.renderer;
    r.setPostFx(mode !== '2d');
    if (r.postfx) {
      r.postfx.settings.quality = mode === 'fx' ? 3 : 0;
      r.postfx.settings.renderScale = mode === 'fx-q0-rs075' ? 0.75 : 1;
      r.postfx.onQualityChange?.(r.postfx.quality, r.postfx.renderScale);
    }
    window.__stormDraw.length = 0;
  }, mode);
  await page.waitForFunction((n) => window.__stormDraw.length >= n, FR + 30, { timeout: 600000, polling: 500 });
  const rows = (await page.evaluate(() => window.__stormDraw.slice(30))).filter((x) => x.on === (mode !== '2d'));
  out[`live_${mode}`] = { frames: rows.length, consume: stat(rows.map((x) => x.cons)), draw_incl_post: stat(rows.map((x) => x.draw)), post_js_excl_upload: stat(rows.map((x) => x.fx - x.up)), upload_incl_2d_raster: stat(rows.map((x) => x.up)) };
  console.log(mode, JSON.stringify(out[`live_${mode}`]));
}
out.info = await page.evaluate(() => ({ enemies: window.shardstorm.world.enemies.length, shards: window.shardstorm.renderer.fx.shards.count, gpu: (() => { const gl = window.shardstorm.renderer.postfx.canvas.getContext('webgl2'); const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); })() }));

// Frozen frame.
await page.evaluate(() => (window.__freeze = true));
await page.waitForTimeout(200);
Object.assign(out, await page.evaluate(() => {
  const app = window.shardstorm, r = app.renderer, fx = r.postfx, w = app.world;
  const N = 25;
  const flush2d = (c) => c.getContext('2d').getImageData(0, 0, 1, 1);
  const stat = (arr) => { const s = [...arr].sort((a, b) => a - b); return { median: +s[s.length >> 1].toFixed(2), p90: +s[Math.floor(s.length * 0.9)].toFixed(2) }; };
  const run = (setup, body) => { setup(); for (let i = 0; i < 4; i++) body(); const t = []; for (let i = 0; i < N; i++) { const t0 = performance.now(); body(); t.push(performance.now() - t0); } return stat(t); };
  const draw = () => r.draw(w, 0, { attract: false, realDt: 0 });
  const o = {};
  const setQ = (q, rs) => { fx.settings.quality = q; fx.settings.renderScale = rs; fx.onQualityChange?.(fx.quality, fx.renderScale); };
  o.frozen_2d_fallback_flushed = run(() => r.setPostFx(false), () => { draw(); flush2d(r.canvas); });
  o.spritePx_glow1 = r.sprites.pixelCount();
  for (const [name, q, rs] of [['q3', 3, 1], ['q1', 1, 1], ['q0', 0, 1], ['q0_rs075', 0, 0.75]]) {
    const passes = [], ups = [];
    o[`frozen_fx_${name}_frame`] = run(() => { r.setPostFx(true); setQ(q, rs); }, () => { draw(); const s = fx.stats(); passes.push(s.cpuMs - s.uploadMs); ups.push(s.uploadMs); });
    o[`frozen_fx_${name}_post_js`] = stat(passes.slice(4));
    o[`frozen_fx_${name}_upload_incl_2d_raster`] = stat(ups.slice(4));
  }
  o.spritePx_glow015 = r.sprites.pixelCount();
  setQ('auto', 1);
  return o;
}));
console.log(JSON.stringify(out, null, 1));
writeFileSync(join(ROOT, `shots/bench-${W}x${H}.json`), JSON.stringify(out, null, 2));
await browser.close();
server.close();
