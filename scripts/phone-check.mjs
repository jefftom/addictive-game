// Repeatable phone-sized visual and submission-cost review; not physical phone FPS.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cpus, freemem } from 'node:os';
import { ROOT, VIEWS, serve, launch, openGame, startRun, installStorm, bossPose, redraw, capture, contactSheet, stats } from './capture-lib.mjs';

const out = resolve(process.env.PHONE_OUT ?? resolve(ROOT, 'output/playwright/phone'));
await mkdir(out, { recursive: true });
const servers = [{ label: 'after', ...await serve() }];
if (process.env.PHONE_BASELINE) servers.unshift({ label: 'before', ...await serve(resolve(process.env.PHONE_BASELINE)) });
const browser = await launch(), shots = [], runs = [];
const mode = process.env.PHONE_MODE ?? 'all';
const views = {
  portrait: VIEWS.M,
  landscape: { ...VIEWS.M, viewport: { width: 851, height: 393 } },
  small: { ...VIEWS.M, viewport: { width: 320, height: 568 } },
};
try {
  if (mode !== 'perf') for (const server of servers) {
    for (const scene of [
      { name: 'portrait', warp: 90 }, { name: 'storm', warp: 200, storm: true },
      { name: 'storm-2d', warp: 200, storm: true, plain: true },
      { name: 'storm-reduced', warp: 200, storm: true, reduced: true },
      { name: 'landscape', warp: 200, storm: true, view: 'landscape' },
      { name: 'small', warp: 200, storm: true, view: 'small' },
      { name: 'warden', warp: 185 },
    ]) {
      const page = await openGame(browser, server.base, `?autoplay&warp=${scene.warp}&seed=1000&${scene.plain ? 'fx=0' : 'fxq=3'}`,
        views[scene.view ?? 'portrait'], { flashes: !scene.reduced, shake: 0, chatter: 'off' });
      try {
        await startRun(page);
        // Recreate the seeded world after galaxy readiness, while rAF is frozen.
        // A faster renderer must not start the comparison further into combat.
        await page.evaluate(() => window.shardstorm.startRun(false));
        if (scene.name === 'warden') await bossPose(page, 'warden');
        if (scene.storm) {
          await installStorm(page, 400, 60, true); // Capture only: player protected for composition.
          await page.evaluate(async () => {
            const a = window.shardstorm;
            for (let i = 0; i < 90; i++) { a.stepGame(1 / 60); if (i % 15 === 0) await new Promise(r => setTimeout(r, 0)); }
          });
        }
        await page.evaluate(() => {
          const a = window.shardstorm, r = a.renderer, d = r.dpr;
          r.hud.touch = true;
          r.hud.stick = { active: true, ox: 72 * d, oy: r.h - 110 * d, x: 96 * d, y: r.h - 124 * d };
        });
        await redraw(page);
        shots.push(await capture(page, resolve(out, `${server.label}-${scene.name}.png`), `${server.label} ${scene.name}; ${scene.storm ? 'synthetic 400-enemy capture, protected pilot' : 'seeded gameplay'}`));
        console.log('capture', server.label, scene.name);
      } finally { await page.close(); }
    }
    await contactSheet(out, shots);
  }
  if (mode !== 'shots') for (let round = 0; round < 3; round++) for (const plain of [false, true]) {
    // Alternate baseline/current order to reduce warm-up and host-load bias.
    for (const server of round % 2 ? [...servers].reverse() : servers) {
      const page = await openGame(browser, server.base, `?autoplay&warp=200&seed=1000&${plain ? 'fx=0' : 'fxq=3'}`, VIEWS.M, { chatter: 'off' });
      try {
        await startRun(page);
        await page.evaluate(() => window.shardstorm.startRun(false));
        await installStorm(page, 400, 60, false);
        const result = await page.evaluate(async () => {
          const a = window.shardstorm, r = a.renderer, draw = r.draw.bind(r), consume = r.consume.bind(r), step = a.stepGame.bind(a);
          a.stepGame = () => step(1 / 60);
          const samples = []; let consumed = 0;
          r.consume = (...args) => { const t = performance.now(); const value = consume(...args); consumed += performance.now() - t; return value; };
          await new Promise((done, reject) => {
            const timeout = setTimeout(() => reject(Error('Phone benchmark timeout')), 120000);
            r.draw = (world, dt, opts) => {
              if (world.gameOver) { clearTimeout(timeout); reject(Error('Unprotected benchmark pilot died')); }
              const t = performance.now(); draw(world, dt, opts);
              if (!opts.attract) {
                samples.push({ ms: performance.now() - t + consumed, enemies: world.enemies.filter(e => !e.dead).length,
                  upload: r.postFxActive ? r.postfx.stats().uploadMs : 0, playing: a.state === 'playing' ? 1 : 0 });
                consumed = 0;
                if (samples.length >= 240) { clearTimeout(timeout); window.__freeze = true; done(); }
              }
            };
            window.__thaw();
          });
          const gl = r.postfx?.gl, info = gl?.getExtension('WEBGL_debug_renderer_info');
          return { samples: samples.slice(30), time: a.world.time, source: [r.worldCanvas.width, r.worldCanvas.height], hud: [r.w, r.h],
            gpu: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unavailable', errors: [] };
        });
        if (page.captureErrors.length || page.externalRequests.length) throw Error(JSON.stringify([page.captureErrors, page.externalRequests]));
        runs.push({ label: server.label, mode: plain ? '2d' : 'q3', round, ...result, timing: stats(result.samples.map(s => s.ms)) });
        console.log('perf', server.label, plain ? '2d' : 'q3', round, runs.at(-1).timing);
        await writeFile(resolve(out, 'perf.json'), JSON.stringify({ machine: { cpu: cpus()[0].model, freeMB: freemem() / 1048576 }, note: 'Software-rendered submission timing, not phone FPS. 240 frames, first 30 dropped; normal damage, fixed 1/60 simulation step.', runs }, null, 2));
      } finally { await page.close(); }
    }
  }
} finally { await browser.close(); for (const server of servers) await server.close(); }
