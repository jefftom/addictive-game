import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, VIEWS, VARIANTS, serve, launch, openGame, startRun, freeze, redraw, freezeWhen, bossPose, installStorm, spreadPilots, capture, contactSheet } from './capture-lib.mjs';

const OUT = resolve(ROOT, 'qa-shots');
await mkdir(OUT, { recursive: true });
const scenes = [];
const add = (id, warp, views, variants, extra = {}) => scenes.push({ id, warp, views, variants, ...extra });
add('title', null, ['D', 'H', 'M', 'Dk'], ['default', '2d']);
add('early-dash', 40, ['D', 'M'], ['default', '2d', 'reduced']);
add('warden-volley', 185, ['D'], ['default', '2d', 'reduced', 'shake0']);
for (const [i, warp] of [40, 250, 430, 610].entries()) add(`sector-${i}`, warp, ['D'], ['default'], { sector: i });
for (const progress of [.15, .42, .56, .8]) add(`warp-${progress}`, 40, ['D'], ['default', 'reduced'], { progress });
add('hydra-lane', 365, ['D'], ['default']);
add('void-spires', 545, ['D'], ['default', 'reduced']);
add('boss-death', 185, ['D'], ['default', '2d', 'reduced', 'shake0']);
add('storm', 200, ['D', 'H'], ['default', '2d', 'reduced', 'grid0']);
for (const id of ['bastion-nova', 'perfect-dash', 'bomb']) add(id, 120, ['D'], ['default', 'reduced'], { ship: 'bastion' });
add('low-hp', 40, ['D'], ['default', 'reduced']);
add('coop2', 90, ['D', 'H', 'M', 'Dk'], ['default', '2d'], { coop: 2 });
add('coop4', 120, ['D', 'H', 'M', 'Dk'], ['default', '2d', 'reduced'], { coop: 4 });
add('coop4-gray', 120, ['D', 'H', 'M'], ['default'], { coop: 4 });
for (const id of ['downed', 'revive', 'laststand', 'edge']) add(`coop-${id}`, 90, ['D'], ['default'], { coop: 4 });
add('comms-faded', 0, ['D', 'M'], ['default']);
for (const menu of ['hangar', 'settings', 'settings-bottom', 'lobby', 'lobby-filled', 'log', 'results', 'coop-results', 'levelup']) add(`menu-${menu}`, ['results', 'coop-results', 'levelup'].includes(menu) ? 40 : null, ['D', 'M'], ['default'], { menu, coop: menu === 'coop-results' ? 4 : 0 });
add('context-lost', 40, ['D'], ['default']);
add('context-restored', 40, ['D'], ['default']);
add('single-title', null, ['H'], ['default'], { single: true });
add('single-play', 40, ['H'], ['default'], { single: true });
const only = process.env.QA_ONLY ? new RegExp(process.env.QA_ONLY) : null;
let records = [];
if (only) { try { records = JSON.parse(await readFile(resolve(OUT, 'captures.json'), 'utf8')); } catch {} }
const server = await serve(), browser = await launch(), failures = [];
try {
  for (const scene of scenes) for (const view of scene.views) for (const variant of scene.variants) {
    const id = `${scene.id}__${variant}__${view}`;
    if (only && !only.test(id)) continue;
    let page;
    try {
      const q = new URLSearchParams({ fxq: '3', seed: '1000' });
      if (scene.warp !== null) { q.set('autoplay', ''); q.set('warp', String(scene.warp)); }
      if (scene.coop) q.set('coop', String(scene.coop));
      if (scene.menu?.startsWith('lobby')) q.set('bots', '');
      if (variant === '2d') q.set('fx', '0');
      const base = scene.single ? pathToFileURL(resolve(ROOT, 'dist-single/shardstorm.html')).href : server.base;
      page = await openGame(browser, base, `?${q}`, VIEWS[view], VARIANTS[variant], scene.ship ? { ship: scene.ship } : {});
      if (scene.warp !== null) await startRun(page);
      await freeze(page);
      let caption = `${scene.id}; ${variant}; ${view}`;
      if (scene.sector !== undefined) {
        const actual = await page.evaluate(i => {
          const a = window.shardstorm, actual = a.world.sector;
          a.renderer.bg.galaxy.setSector(i, { sync: true });
          // Keep the backdrop fixture after draw's normal sector selection.
          a.renderer.bg.galaxy.setSector = () => {};
          return actual;
        }, scene.sector);
        caption += `; render-side sector ${scene.sector} (simulation sector ${actual})`;
      }
      if (scene.progress !== undefined) {
        await page.evaluate(p => window.shardstorm.renderer.bg.galaxy.setWarpPreview(0, 1, p), scene.progress);
        caption += '; render-side transition preview';
      }
      if (scene.id === 'storm') {
        await installStorm(page, 400, 60, true);
        await page.evaluate(() => window.__step(60));
        caption += '; synthetic 400-live / 60-kills-per-sim-second fixture; capture HP protected';
      }
      if (scene.coop === 4 && !scene.menu) { await spreadPilots(page); caption += '; capture-only pilot spread to zoom 1.45'; }
      if (scene.id === 'early-dash') {
        await page.evaluate(() => {
          const a = window.shardstorm, p = a.world.players[0];
          p.dashT = .12; p.dashDirX = 1; p.dashDirY = 0;
          a.renderer.consume([{ t: 'dash', x: p.x, y: p.y, dx: 1, dy: 0, pid: 0 }], a.world);
        });
        caption += '; capture-only dash pose';
      }
      if (['warden-volley', 'hydra-lane', 'void-spires'].includes(scene.id)) {
        const kind = { 'warden-volley': 'warden', 'hydra-lane': 'hydra', 'void-spires': 'voidheart' }[scene.id];
        await bossPose(page, kind);
      }
      if (scene.id === 'boss-death') {
        await bossPose(page, 'warden');
        await page.evaluate(() => {
          const a = window.shardstorm;
          if (!a.world.boss) throw new Error('Expected live Warden');
          a.world.boss.hp = 1; a.world.players[0].invuln = 100;
        });
        await freezeWhen(page, () => window.__events.some(e => e.t === 'bossdead' && performance.now() - e.at >= 300), 45000);
        caption += '; real weapon kill after capture-only boss HP=1, 0.3s after event';
      }
      if (['bastion-nova', 'perfect-dash', 'bomb', 'low-hp'].includes(scene.id)) {
        await page.evaluate(id => {
          const a = window.shardstorm, w = a.world, p = w.players[0];
          if (id === 'bomb') w.bomb(0);
          if (id === 'perfect-dash') w.perfectDash(p);
          if (id === 'bastion-nova') w.rings.push({ id: -1, x: p.x, y: p.y, radius: 100, maxRadius: 160, t: .2, duration: .6, damage: 0, knock: 0, follow: true, owner: 0, color: '#ffc93c', hit: new Set(), hurtsPlayer: false });
          if (id === 'low-hp') { p.invuln = 0; p.dashT = 0; p.hp = p.stats.maxHp * .08 + 1; w.hurtPlayer(1, p.x, p.y, 0); }
          a.renderer.consume(w.events.splice(0), w);
          a.renderer.draw(w, .1, { attract: false, realDt: .1 });
        }, scene.id);
        caption += '; capture-only event/HP fixture';
      }
      if (/^coop-(downed|revive|laststand|edge)$/.test(scene.id)) {
        await page.evaluate(id => {
          const a = window.shardstorm, w = a.world;
          const down = pid => { const p = w.players[pid]; p.invuln = 0; p.dashT = 0; p.revivesUsed = 99; p.shieldReady = false; w.hurtPlayer(1e6, p.x, p.y, pid); };
          down(1);
          if (id === 'coop-revive') { const [p, q] = w.players; p.x = q.x + 20; p.y = q.y; q.reviveT = w.reviveNeed(q) * .6; }
          if (id === 'coop-laststand') { down(2); down(3); }
          if (id === 'coop-edge') w.players[3].x += 2000;
          a.renderer.consume(w.events.splice(0), w);
          // Let the event callout enter without advancing the captured simulation.
          a.renderer.draw(w, 0, { attract: false, realDt: .2 });
        }, scene.id);
        caption += '; capture-only down/revive/position fixture';
      }
      if (scene.id === 'comms-faded') {
        await page.evaluate(() => {
          const a = window.shardstorm;
          a.stepGame(.05);
          const r = a.comms.root.getBoundingClientRect(), [x, y] = a.renderer.screenToWorld(r.x + r.width / 2, r.y + r.height / 2);
          a.world.spawnEnemy('drifter', x, y).spawnT = 0;
          a.comms.updateFade(.125, rect => {
            const [minX, minY] = a.renderer.screenToWorld(rect.left, rect.top);
            const [maxX, maxY] = a.renderer.screenToWorld(rect.right, rect.bottom);
            return a.world.enemies.some(e => !e.dead && e.x >= minX && e.x <= maxX && e.y >= minY && e.y <= maxY);
          });
        });
        await page.waitForTimeout(250);
        caption += '; threat placed beneath live comms';
      }
      if (scene.menu) {
        if (scene.menu.startsWith('lobby')) {
          await page.evaluate(filled => {
            const a = window.shardstorm; a.openCoop();
            if (filled) { for (let i = 0; i < 4; i++) a.lobby.join('bot'); a.renderLobby(); }
          }, scene.menu === 'lobby-filled');
        }
        else if (scene.menu.includes('results')) {
          await page.evaluate(() => { window.shardstorm.endRun(); window.__resultAt = performance.now(); });
          await freezeWhen(page, () => performance.now() - window.__resultAt >= 1250);
        }
        else if (scene.menu === 'levelup') await page.evaluate(() => { const a = window.shardstorm; a.debug.autoplay = false; a.world.addXp(a.world.xpNext, 0); a.stepGame(.02); a.stepGame(0); });
        else await page.locator(`#screen-title [data-act="${scene.menu.replace('-bottom', '')}"]`).click();
        if (scene.menu === 'settings-bottom') await page.locator('#screen-settings [data-act="reset"]').scrollIntoViewIfNeeded();
      }
      if (scene.id.startsWith('context-')) {
        await page.evaluate(() => { window.__loss = window.shardstorm.renderer.postfx.gl.getExtension('WEBGL_lose_context'); window.__loss.loseContext(); });
        await page.waitForTimeout(250);
        if (scene.id === 'context-restored') { await page.evaluate(() => window.__loss.restoreContext()); await page.waitForTimeout(500); }
      }
      await redraw(page);
      if (scene.id === 'coop4-gray') await page.addStyleTag({ content: 'canvas{filter:grayscale(1)}' });
      const record = await capture(page, resolve(OUT, `${id}.png`), caption);
      records = records.filter(r => r.file !== record.file); records.push(record);
      await contactSheet(OUT, records);
      console.log('CAPTURE', id, record.state, record.enemies, record.time.toFixed(1));
      if (scene.progress !== undefined) await page.evaluate(() => window.shardstorm.renderer.bg.galaxy.clearWarp());
    } catch (error) { failures.push({ id, error: String(error) }); console.error('FAIL', id, String(error)); }
    finally { await page?.close(); }
  }
} finally { await browser.close(); await server.close(); }
if (failures.length) throw new Error(JSON.stringify(failures, null, 2));
console.log(`Saved ${records.length} captures to ${OUT}`);
