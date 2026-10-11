// Shared helpers: static server for the built game, rAF freeze control, frame redraw.
import { chromium } from '/home/user/addictive-game/node_modules/playwright/index.mjs';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };

export async function serve(dir) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let p = decodeURIComponent(url.pathname);
    if (p.endsWith('/')) p += 'index.html';
    try {
      const body = await readFile(join(dir, p));
      res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

// Injected before page scripts: lets us freeze the game loop and keeps an event log.
const INIT = () => {
  const raf = window.requestAnimationFrame.bind(window);
  const queued = [];
  window.__freeze = false;
  window.__freezeIf = null;
  window.requestAnimationFrame = (cb) =>
    raf((t) => {
      if (!window.__freeze && window.__freezeIf) {
        try {
          if (window.__freezeIf()) {
            window.__freeze = true;
            window.__freezeIf = null;
          }
        } catch {}
      }
      return window.__freeze ? queued.push(cb) : cb(t);
    });
  window.__thaw = () => {
    window.__freeze = false;
    const q = queued.splice(0);
    for (const cb of q) raf(cb);
  };
  // Advance exactly n frames then freeze again.
  window.__step = (n) =>
    new Promise((resolve) => {
      let left = n;
      const tick = () => {
        if (--left <= 0) {
          window.__freeze = true;
          resolve();
        } else raf(tick);
      };
      window.__thaw();
      raf(tick);
    });
  window.__events = [];
  const hook = () => {
    const app = window.shardstorm;
    if (!app) return setTimeout(hook, 50);
    const r = app.renderer;
    const consume = r.consume.bind(r);
    r.consume = (evs, w) => {
      for (const e of evs) if (e.t !== 'hit' && e.t !== 'shoot' && e.t !== 'pickup') window.__events.push({ t: e.t, at: performance.now() });
      if (window.__events.length > 500) window.__events.splice(0, 250);
      return consume(evs, w);
    };
  };
  hook();
};

export async function launch() {
  return chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-unsafe-swiftshader'] });
}

export async function openGame(browser, base, query = '', vp = { width: 1280, height: 720 }) {
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.text());
  });
  await page.addInitScript(INIT);
  await page.goto(`${base}/${query}`);
  // Hide DOM toasts/tutorial so before/after frames differ only by rendering.
  await page.addStyleTag({ content: '#toasts,#tutorial{display:none!important}' });
  await page.waitForFunction(() => !!window.shardstorm);
  return page;
}

export async function waitGalaxy(page) {
  await page.waitForFunction(() => { const g = window.shardstorm.renderer.bg.galaxy; return g.sector >= 0 && g.isReady(g.sector); }, null, { timeout: 90000 }).catch(() => console.log('galaxy not ready'));
}

export async function startRun(page) {
  await waitGalaxy(page);
  await page.locator('#screen-title [data-act="play"]').click();
  await page.waitForFunction(() => window.shardstorm.state === 'playing', null, { timeout: 180000 });
  await waitGalaxy(page);
}

/** Redraws the current (frozen) frame in the given mode without advancing anything. */
export async function redraw(page, mode) {
  return page.evaluate((mode) => {
    const app = window.shardstorm;
    const r = app.renderer;
    if (mode.flashes !== undefined) r.settings.flashes = mode.flashes;
    if (mode.shake !== undefined) r.settings.shake = mode.shake;
    if (mode.fx !== undefined) r.setPostFx(mode.fx);
    if (mode.glow !== undefined) { r.sprites.setGlowScale(mode.glow); r.fx.art.setGlowScale(mode.glow); }
    const S = r.postfx?.settings;
    if (S) {
      S.quality = mode.quality ?? 3;
      for (const key of ['bloom', 'threshold', 'knee', 'streaks', 'grain', 'vignette', 'renderScale']) if (mode[key] !== undefined) S[key] = mode[key];
    }
    // Re-run the quality hook so world scale follows renderScale.
    if (r.postfx) r.postfx.onQualityChange?.(r.postfx.quality, r.postfx.renderScale);
    const attract = app.state === 'title' || app.state === 'results';
    const w = attract ? app.attract : app.world;
    r.draw(w, 0, { attract, realDt: 0 });
    return { fx: r.postFxActive, stats: r.postfx?.stats() ?? null, world: [r.worldCanvas.width, r.worldCanvas.height] };
  }, mode);
}

/** Lets the game run until `pred` (a function source string, evaluated in page) is true, then freezes. */
export async function freezeWhen(page, pred, timeout = 60000) {
  await page.evaluate((src) => {
    window.__freezeIf = new Function('return (' + src + ')()');
    window.__thaw();
  }, pred);
  await page.waitForFunction(() => window.__freeze === true, null, { timeout, polling: 50 });
  await page.waitForTimeout(80);
}

/** Kill storm: keeps 400 live aliens near the pilot and kills 60 per sim-second via world.killEnemy (real kill events). */
export async function installStorm(page, alive = 400, perSec = 60) {
  await page.evaluate(([ALIVE, RATE]) => {
    const app = window.shardstorm, r = app.renderer;
    const kinds = ['drifter', 'drifter', 'swarmling', 'swarmling', 'dasher', 'splitter', 'shooter', 'brute'];
    const orig = r.draw.bind(r);
    let acc = 0;
    window.__stormFrames = 0;
    window.__stormDraw = [];
    r.draw = (world, dt, opts) => {
      let cons = 0;
      if (!opts.attract && dt > 0) {
        const p = world.players[0];
        p.invuln = 5; p.hp = Math.max(p.hp, 50);
        let n = 0;
        for (const e of world.enemies) if (!e.dead) { n++; if (!e.boss) e.hp = e.maxHp = 1e9; }
        let guard = 0;
        while (n < ALIVE && guard++ < 500) {
          const a = Math.random() * 6.283, d = 110 + Math.random() * 480;
          const ne = world.spawnEnemy(kinds[(Math.random() * kinds.length) | 0], p.x + Math.cos(a) * d, p.y + Math.sin(a) * d * 0.62, Math.random() < 0.02);
          if (ne) { ne.hp = ne.maxHp = 1e9; ne.spawnT = 0; n++; } else break;
        }
        acc = Math.min(acc + dt * RATE, 30);
        const before = world.events.length;
        while (acc >= 1) {
          acc -= 1;
          for (let tries = 0; tries < 20; tries++) {
            const e = world.enemies[(Math.random() * world.enemies.length) | 0];
            if (e && !e.dead && !e.boss && Math.hypot(e.x - p.x, e.y - p.y) < 600) { e.kx = (e.x - p.x) * 0.8; e.ky = (e.y - p.y) * 0.8; e.hp = 0; world.killEnemy(e, false, 0); break; }
          }
        }
        const t0 = performance.now();
        r.consume(world.events.splice(before), world);
        cons = performance.now() - t0;
        window.__stormFrames++;
      }
      const t1 = performance.now();
      const v = orig(world, dt, opts);
      if (!opts.attract && dt > 0) window.__stormDraw.push({ draw: performance.now() - t1, cons, fx: r.postfx ? r.postfx.stats().cpuMs : 0, up: r.postfx ? r.postfx.stats().uploadMs : 0, on: r.postFxActive });
      return v;
    };
  }, [alive, perSec]);
}
