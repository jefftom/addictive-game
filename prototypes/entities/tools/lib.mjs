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

export async function startRun(page) {
  await page.locator('#screen-title [data-act="play"]').click();
  await page.waitForFunction(() => ['playing','levelup'].includes(window.shardstorm.state), null, { timeout: 90000 }).catch(async (e) => { console.log('state', await page.evaluate(() => window.shardstorm.state)); throw e; });
}

/** Redraws the current (frozen) frame in the given mode without advancing anything. */
export async function redraw(page, mode) {
  return page.evaluate((mode) => {
    const app = window.shardstorm;
    const r = app.renderer;
    if (mode.fx !== undefined) r.setPostFx(mode.fx);
    if (mode.glow !== undefined) r.sprites.setGlowScale(mode.glow);
    if (r.postfx && mode.crt !== undefined) r.postfx.settings.crt = mode.crt;
    if (r.postfx) r.postfx.settings.quality = mode.quality ?? 3;
    if (r.postfx && mode.bloom !== undefined) r.postfx.settings.bloom = mode.bloom;
    if (r.postfx && mode.threshold !== undefined) r.postfx.settings.threshold = mode.threshold;
    if (r.postfx && mode.streaks !== undefined) r.postfx.settings.streaks = mode.streaks;
    for (const key of ['grain', 'vignette']) if (r.postfx && mode[key] !== undefined) r.postfx.settings[key] = mode[key];
    if (mode.flashes !== undefined) r.settings.flashes = mode.flashes;
    const attract = app.state === 'title' || app.state === 'results';
    const w = attract ? app.attract : app.world;
    r.draw(w, 0, { attract, realDt: 0 });
    return { fx: r.postFxActive, stats: r.postfx?.stats() ?? null };
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
