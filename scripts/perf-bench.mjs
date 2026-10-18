import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cpus, totalmem, freemem, platform, arch } from 'node:os';
import { gzipSync } from 'node:zlib';
import { ROOT, VIEWS, serve, launch, openGame, startRun, freeze, installStorm, spreadPilots, stats } from './capture-lib.mjs';

const OUT = resolve(ROOT, 'qa-shots');
const OUT_FILE = resolve(OUT, process.env.PERF_FILE ?? 'perf.json');
const only = process.env.PERF_ONLY ? new RegExp(process.env.PERF_ONLY) : null;
await mkdir(OUT, { recursive: true });
const server = await serve(), browser = await launch();
const cpuBefore = cpus();
await new Promise(r => setTimeout(r, 1000));
const cpuAfter = cpus();
let idle = 0, total = 0;
cpuAfter.forEach((c, i) => { for (const key in c.times) { const dt = c.times[key] - cpuBefore[i].times[key]; total += dt; if (key === 'idle') idle += dt; } });
const report = { machine: { os: `${platform()} ${arch()}`, cpu: cpus()[0].model, cores: cpus().length, cpuBusyPercent: 100 * (1 - idle / total), freeMB: freemem() / 1048576, totalMB: totalmem() / 1048576, raster: 'Headless Chromium with SwiftShader; JS submission timings, not GPU FPS' }, simulationStepSeconds: 1 / 60, runs: [], heap: [], medians: {} };
const scenarios = [
  { id: 'storm1080fx', query: '?autoplay&warp=200&fxq=3&seed=1000', view: VIEWS.D, storm: true },
  { id: 'storm1080_2d', query: '?autoplay&warp=200&fx=0&seed=1000', view: VIEWS.D, storm: true },
  { id: 'storm720fx', query: '?autoplay&warp=200&fxq=3&seed=1000', view: VIEWS.H, storm: true },
  { id: 'coop4max', query: '?coop=4&autoplay&warp=120&fxq=3&seed=1000', view: VIEWS.D, coop: true },
].filter(scene => !only || only.test(scene.id));
try {
  if (!scenarios.length) throw new Error('PERF_ONLY matched no scenario');
  // Alternate scenarios each round so thermal/load drift cannot favour one path.
  for (let round = 0; round < 3; round++) for (const scene of scenarios) {
    const page = await openGame(browser, server.base, scene.query, scene.view, { chatter: 'off' });
    try {
      await startRun(page); await freeze(page);
      if (scene.storm) await installStorm(page);
      if (scene.coop) await spreadPilots(page);
      const result = await page.evaluate(async coop => {
        const a = window.shardstorm, r = a.renderer, draw = r.draw.bind(r), consume = r.consume.bind(r), bg = r.bg.draw.bind(r.bg);
        const samples = []; let consumed = 0, background = 0, last = performance.now();
        // Equal simulation advancement per sampled frame: software raster stalls
        // must not compare different amounts of combat on the FX and 2D paths.
        // No health, invulnerability or damage rules are changed.
        const step = a.stepGame.bind(a), points = a.world.players.map(p => [p.x, p.y]);
        a.stepGame = () => {
          if (coop) a.world.players.forEach((p, i) => { [p.x, p.y] = points[i]; });
          step(1 / 60);
          if (coop) a.world.zoom = 1.45;
        };
        r.consume = (...args) => { const t = performance.now(); const value = consume(...args); consumed += performance.now() - t; return value; };
        r.bg.draw = (...args) => { const t = performance.now(); const value = bg(...args); background += performance.now() - t; return value; };
        await new Promise((done, reject) => {
          const timeout = setTimeout(() => reject(new Error('360-frame benchmark timed out')), 180000);
          r.draw = (world, dt, opts) => {
            if (world.gameOver) { clearTimeout(timeout); reject(new Error('Benchmark pilot died; no HP protection permitted')); }
            const t = performance.now(); draw(world, dt, opts); const end = performance.now(), fx = r.postfx?.stats();
            if (!opts.attract) {
              samples.push({ combined: end - t + consumed, draw: end - t, consume: consumed, background, grid: r.gridMs, postfx: r.postFxActive ? fx?.cpuMs ?? 0 : 0, upload: r.postFxActive ? fx?.uploadMs ?? 0 : 0, frame: t - last, enemies: world.enemies.filter(e => !e.dead).length, zoom: world.zoom, tier: r.costTier, shards: r.fx.shards.count, playing: a.state === 'playing' ? 1 : 0 });
              consumed = 0; background = 0; last = t;
              if (samples.length >= 360) { clearTimeout(timeout); window.__freeze = true; done(); }
            }
          };
          window.__thaw();
        });
        const gl = r.postfx?.gl, info = gl?.getExtension('WEBGL_debug_renderer_info');
        return { samples: samples.slice(30), heapMB: performance.memory?.usedJSHeapSize / 1048576, time: a.world.time, storm: window.__storm ?? null, postFxActive: r.postFxActive,
          gpu: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unavailable' };
      }, !!scene.coop);
      const summary = Object.fromEntries(Object.keys(result.samples[0]).map(key => [key, stats(result.samples.map(s => s[key]))]));
      report.runs.push({ scenario: scene.id, round, ...result, summary });
      await writeFile(OUT_FILE, JSON.stringify(report, null, 2));
      console.log(scene.id, round + 1, 'consume+draw', summary.combined);
    } finally { await page.close(); }
  }
  for (const scene of scenarios) {
    const runs = report.runs.filter(r => r.scenario === scene.id);
    report.medians[scene.id] = Object.fromEntries(Object.keys(runs[0].summary).map(metric => [metric, Object.fromEntries(['mean', 'p50', 'p95'].map(key => [key, stats(runs.map(r => r.summary[metric][key])).p50]))]));
  }
  // Same app/page retains the renderer and its caches across all three checkpoints.
  if (!only) {
    const page = await openGame(browser, server.base, '?autoplay&fxq=3&seed=1000', VIEWS.D, { chatter: 'off' });
    try {
      await freeze(page);
      report.heap.push(await page.evaluate(() => ({ at: 'title', usedMB: performance.memory?.usedJSHeapSize / 1048576, readyMs: performance.now() })));
      await page.evaluate(() => { const a = window.shardstorm; a.debug.warp = 120; a.startRun(false); });
      await page.evaluate(() => window.__step(30));
      report.heap.push(await page.evaluate(() => ({ at: '120', time: window.shardstorm.world.time, usedMB: performance.memory?.usedJSHeapSize / 1048576 })));
      // Fast-forward on this world with the regular app loop, including all render layers.
      // Yield each batch so browser GC and worker messages can run; no forced collection.
      await page.evaluate(async () => {
        const a = window.shardstorm;
        while (a.world.time < 600 && !a.world.gameOver) {
          for (let i = 0; i < 60 && a.world.time < 600 && !a.world.gameOver; i++) a.stepGame(.05);
          await new Promise(r => setTimeout(r, 0));
        }
      });
      report.heap.push(await page.evaluate(() => ({ at: '600', time: window.shardstorm.world.time, survived: !window.shardstorm.world.gameOver, usedMB: performance.memory?.usedJSHeapSize / 1048576 })));
      report.heapGrowthMB = report.heap[2].usedMB - report.heap[1].usedMB;
    } finally { await page.close(); }
  }
  try { const single = await readFile(resolve(ROOT, 'dist-single/shardstorm.html')); report.single = { bytes: single.length, gzipBytes: gzipSync(single).length }; } catch { report.single = 'Run npm run build:single first'; }
  await writeFile(OUT_FILE, JSON.stringify(report, null, 2));
  console.table(Object.fromEntries(Object.entries(report.medians).map(([id, s]) => [id, { mean: s.combined.mean, p50: s.combined.p50, p95: s.combined.p95, background: s.background.mean, grid: s.grid.mean, postP50: s.postfx.p50, consume: s.consume.mean }])));
} catch (error) {
  report.failure = String(error);
  throw error;
} finally {
  await writeFile(OUT_FILE, JSON.stringify(report, null, 2));
  await browser.close(); await server.close();
}
