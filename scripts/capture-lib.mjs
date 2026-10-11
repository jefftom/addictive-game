// Shared, local-only capture harness. Scene fixtures never ship in the game bundle.
import { chromium, devices } from '@playwright/test';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, resolve, relative, sep, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const VIEWS = { D: { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 }, H: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 }, M: devices['Pixel 7'], Dk: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 } };
export const VARIANTS = { default: {}, '2d': { postfx: false }, reduced: { flashes: false }, 'shake0': { shake: 0 }, 'grid0': { gridMotion: 0 } };
export const VETERAN = { rank: 8, tutorialDone: true, story: { introSeen: true }, achievements: { survive3: 1, combo150: 1, warden: 1, perfect10: 1 }, workshop: { hull: 3, might: 3, reach: 3, haste: 2, growth: 3, greed: 2, reflex: 2, recovery: 1, armor: 1, reroll: 1 } };
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };

export async function serve(dir = resolve(ROOT, 'dist')) {
  const root = resolve(dir);
  const server = createServer(async (req, res) => {
    try {
      let path = decodeURIComponent(new URL(req.url, 'http://local').pathname);
      if (path.endsWith('/')) path += 'index.html';
      const file = resolve(root, `.${path}`), rel = relative(root, file);
      if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) { res.writeHead(403); res.end(); return; }
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }); res.end(body);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  return { server, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(r => server.close(r)) };
}

export async function launch() {
  return chromium.launch({ args: ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--enable-precise-memory-info'] });
}

const INIT = () => {
  const raf = window.requestAnimationFrame.bind(window), queued = [];
  window.__freeze = false; window.__freezeIf = null; window.__events = [];
  window.requestAnimationFrame = cb => raf(t => {
    if (!window.__freeze && window.__freezeIf?.()) { window.__freeze = true; window.__freezeIf = null; }
    return window.__freeze ? queued.push(cb) : cb(t);
  });
  window.__thaw = () => { window.__freeze = false; for (const cb of queued.splice(0)) raf(cb); };
  window.__step = n => new Promise(resolve => {
    let left = n;
    const tick = () => { if (--left <= 0) { window.__freeze = true; resolve(); } else raf(tick); };
    window.__thaw(); raf(tick);
  });
};

export async function openGame(browser, base, query = '', view = VIEWS.H, settings = {}, save = {}) {
  const page = await browser.newPage(view);
  const errors = [], requests = [];
  page.captureErrors = errors; page.externalRequests = requests;
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => {
    const url = route.request().url();
    const allowed = base.startsWith('file:') ? /^(file:|data:|blob:)/.test(url) : new URL(url).origin === new URL(base).origin || /^(data:|blob:)/.test(url);
    if (!allowed) { requests.push(url); return route.abort(); }
    return route.continue();
  });
  await page.addInitScript(INIT);
  await page.addInitScript(data => localStorage.setItem('shardstorm.save', JSON.stringify(data)), { ...VETERAN, ...save, settings: { master: 0, ...settings } });
  await page.goto(`${base}${base.startsWith('file:') ? '' : '/'}${query}`);
  await page.waitForFunction(() => !!window.shardstorm, null, { timeout: 180000 });
  await page.addStyleTag({ content: '#toasts,#tutorial{display:none!important}' });
  await page.evaluate(() => {
    const r = window.shardstorm.renderer, consume = r.consume.bind(r);
    r.consume = (events, w) => {
      for (const e of events) if (!['hit', 'shoot', 'pickup'].includes(e.t)) window.__events.push({ ...e, at: performance.now() });
      if (window.__events.length > 500) window.__events.splice(0, 250);
      return consume(events, w);
    };
  });
  await waitGalaxy(page);
  return page;
}

export async function waitGalaxy(page) {
  // Generation readiness precedes the initial 0.6-second visual fade. A frozen
  // screenshot must wait for both, including the much faster plain-2D path.
  await page.waitForFunction(() => { const g = window.shardstorm.renderer.bg.galaxy; return g.sector >= 0 && g.isReady(g.sector) && g.fadeIn >= 1; }, null, { timeout: 90000 });
}
export async function startRun(page) {
  if (await page.evaluate(() => window.shardstorm.state === 'title')) await page.locator('#screen-title [data-act="play"]').click();
  await page.waitForFunction(() => window.shardstorm.state === 'playing', null, { timeout: 180000 });
  await waitGalaxy(page);
  await page.waitForFunction(() => {
    if (window.shardstorm.state !== 'playing') return false;
    window.__freeze = true;
    return true;
  }, null, { timeout: 60000 });
  if (await page.evaluate(() => window.shardstorm.world.gameOver)) throw new Error('Capture seed died during warp; choose another seed');
}
export async function freeze(page) { await page.evaluate(() => { window.__freeze = true; }); }
export async function redraw(page, mode = {}) {
  return page.evaluate(mode => {
    const a = window.shardstorm, r = a.renderer;
    // A bounded capture batch can end during the bot's 0.6-second card pause.
    // Finish its normal first-card choice; intentional menu captures disable autoplay.
    for (let i = 0; a.debug.autoplay && a.state === 'levelup' && i < 100; i++) a.pick(0);
    Object.assign(r.settings, mode);
    if (mode.postfx !== undefined) r.setPostFx(mode.postfx);
    const attract = !a.world || a.state === 'title' || a.state === 'results' || a.state === 'lobby';
    r.draw(attract ? a.attract : a.world, 0, { attract, realDt: 0 });
    return { postFxActive: r.postFxActive, costTier: r.costTier, stats: r.postfx?.stats() };
  }, mode);
}
export async function freezeWhen(page, predicate, timeout = 60000) {
  await page.evaluate(source => { window.__freezeIf = new Function(`return (${source})()`); window.__thaw(); }, String(predicate));
  await page.waitForFunction(() => window.__freeze, null, { timeout, polling: 50 });
}

export async function bossPose(page, kind) {
  await page.evaluate(kind => {
    const w = window.shardstorm.world;
    if (w.boss?.kind !== kind) throw new Error(`Expected live ${kind}, got ${w.boss?.kind}`);
    w.players[0].invuln = 100; // Visual captures only; perf never calls this helper.
  }, kind);
  await freezeWhen(page, () => {
    const a = window.shardstorm, w = a.world, b = w.boss;
    if (!b) return false;
    const [x, y] = a.renderer.worldToScreen(b.x, b.y);
    return a.state === 'playing' && x > 110 && x < innerWidth - 110 && y > 150 && y < innerHeight - 150 &&
      (b.kind === 'hydra' ? b.state === 1 : w.bullets.length >= 10);
  }, 60000);
}

// This deliberately synthetic workload uses real spawn/kill/event paths. Setup is
// outside renderer timing; protection is only available for visual captures.
export async function installStorm(page, alive = 400, perSec = 60, protect = false) {
  await page.evaluate(({ alive, perSec, protect }) => {
    const a = window.shardstorm, r = a.renderer, step = a.stepGame.bind(a);
    const kinds = ['drifter', 'swarmling', 'dasher', 'splitter', 'shooter', 'brute'];
    let acc = 0, seed = 19;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    window.__storm = { kills: 0, seconds: 0, live: 0 };
    a.stepGame = dt => {
      const previousTime = a.world?.time ?? 0;
      step(dt);
      const w = a.world;
      if (!w || a.state !== 'playing') return;
      const p = w.players[0];
      if (protect) { p.hp = p.stats.maxHp; p.invuln = 1; }
      const simDt = w.time - previousTime;
      window.__storm.seconds += simDt;
      for (const e of w.enemies) if (!e.dead && !e.boss) e.hp = e.maxHp = 1e9;
      const before = w.events.length;
      acc += simDt * perSec;
      while (acc >= 1) {
        acc--;
        const candidates = w.enemies.filter(e => !e.dead && !e.boss && Math.hypot(e.x - p.x, e.y - p.y) < 600);
        const e = candidates[Math.floor(random() * candidates.length)];
        if (e) { e.kx = (e.x - p.x) * .8; e.ky = (e.y - p.y) * .8; w.killEnemy(e, false, 0); window.__storm.kills++; }
      }
      let n = w.enemies.filter(e => !e.dead).length;
      for (let guard = 0; n < alive && guard < 500; guard++) {
        const angle = random() * Math.PI * 2, distance = 110 + random() * 480;
        const e = w.spawnEnemy(kinds[Math.floor(random() * kinds.length)], p.x + Math.cos(angle) * distance, p.y + Math.sin(angle) * distance * .62, random() < .02);
        if (!e) break;
        e.hp = e.maxHp = 1e9; e.spawnT = 0; n++;
      }
      window.__storm.live = n;
      r.consume(w.events.splice(before), w);
    };
  }, { alive, perSec, protect });
}

export async function spreadPilots(page) {
  await page.evaluate(() => {
    const a = window.shardstorm, w = a.world, c = { ...w.teamCenter() }, span = w.maxSpan();
    w.zoom = 1.45;
    w.players.forEach((p, i) => { p.x = c.x + (i % 2 - .5) * span.x; p.y = c.y + (Math.floor(i / 2) - .5) * span.y; p.vx = p.vy = 0; });
    a.renderer.reset(w);
  });
}

export async function capture(page, path, caption = '', screenshot = {}) {
  await page.evaluate(async () => { await document.fonts.load('900 100px Tektur'); if (!document.fonts.check('900 100px Tektur')) throw new Error('Bundled logo font not loaded'); });
  if (page.captureErrors.length || page.externalRequests.length) throw new Error(JSON.stringify({ errors: page.captureErrors, external: page.externalRequests }));
  await page.screenshot({ path, animations: 'disabled', ...screenshot });
  const metadata = await page.evaluate(() => {
    const a = window.shardstorm, w = a.world ?? a.attract, r = a.renderer;
    return { state: a.state, sector: w.sector, enemies: w.enemies.filter(e => !e.dead).length, time: w.time, zoom: w.zoom,
      fx: r.postFxActive, costTier: r.costTier, gridMotion: r.settings.gridMotion, flashes: r.settings.flashes, shake: r.settings.shake,
      boss: w.boss ? { kind: w.boss.kind, screen: r.worldToScreen(w.boss.x, w.boss.y) } : null,
      comms: { visible: !a.comms.root.hidden, faded: a.comms.root.classList.contains('under'), opacity: getComputedStyle(a.comms.root).opacity },
      worker: r.bg.galaxy.usesWorker, postfx: r.postfx?.stats() ?? null };
  });
  return { file: path.split(/[\\/]/).pop(), caption, ...metadata };
}
export async function contactSheet(dir, items) {
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, 'captures.json'), JSON.stringify(items, null, 2));
  const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  await writeFile(resolve(dir, 'index.html'), `<!doctype html><meta charset="utf-8"><title>SHARDSTORM captures</title><style>body{background:#090d18;color:#eef;font:14px system-ui;margin:24px}main{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}figure{margin:0}img{width:100%;max-height:420px;object-fit:contain;background:#000}figcaption{padding:8px}</style><h1>SHARDSTORM captures</h1><main>${items.map(i => `<figure><a href="${escape(i.file)}"><img loading="lazy" src="${escape(i.file)}"></a><figcaption>${escape(i.file)}<br>${escape(i.caption)}<br>sector ${i.sector}, ${i.enemies} enemies, ${i.time?.toFixed(1)}s</figcaption></figure>`).join('')}</main>`);
}

export const stats = xs => {
  const s = [...xs].sort((a, b) => a - b);
  return { mean: xs.reduce((a, b) => a + b, 0) / xs.length, p50: s[Math.floor(s.length * .5)], p95: s[Math.floor(s.length * .95)] };
};
