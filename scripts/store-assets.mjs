// Own procedural art and bundled fonts only. Uploading to Steam is an owner step.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT, serve, launch, openGame, startRun, freeze, bossPose, redraw, installStorm, spreadPilots, capture, contactSheet } from './capture-lib.mjs';

const OUT = resolve(ROOT, 'store-assets');
await mkdir(OUT, { recursive: true });
const server = await serve(), browser = await launch(), records = [];
const only = process.env.STORE_ONLY ? new RegExp(process.env.STORE_ONLY) : null;
if (only) { try { records.push(...JSON.parse(await readFile(resolve(OUT, 'captures.json'), 'utf8'))); } catch {} }

// PNG IHDR and JPEG SOF checks use the saved bytes, not the requested viewport.
function dimensions(bytes) {
  if (bytes.subarray(1, 4).toString() === 'PNG') return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  for (let i = 2; i < bytes.length - 8;) {
    if (bytes[i++] !== 255) continue;
    const marker = bytes[i++], length = bytes.readUInt16BE(i);
    if ([0xc0, 0xc1, 0xc2].includes(marker)) return [bytes.readUInt16BE(i + 5), bytes.readUInt16BE(i + 3)];
    i += length;
  }
  throw new Error('No PNG IHDR or JPEG SOF');
}

async function save(page, name, width, height, caption, screenshot = {}) {
  const file = resolve(OUT, name);
  const record = await capture(page, file, caption, screenshot);
  const actual = dimensions(await readFile(file));
  if (actual[0] !== width || actual[1] !== height) throw new Error(`${name}: expected ${width}x${height}, got ${actual}`);
  record.width = width; record.height = height; record.file = name;
  const old = records.findIndex(r => r.file === name);
  if (old >= 0) records.splice(old, 1);
  records.push(record);
  await contactSheet(OUT, records);
  console.log(name, `${width}x${height}`, caption, `sector=${record.sector} enemies=${record.enemies} time=${record.time.toFixed(1)}`);
}

async function scene(width, height, warp = 185, coop = 0) {
  const page = await openGame(browser, server.base, `?autoplay&warp=${warp}&fxq=3&seed=1000${coop ? `&coop=${coop}` : ''}`, { viewport: { width, height }, deviceScaleFactor: 1 });
  await startRun(page); await freeze(page);
  return page;
}

async function keyArt(page, portrait = false, hero = false) {
  await page.addStyleTag({ content: '#ui,#toasts,#tutorial,#comms,.comms,#pause-btn{display:none!important}' });
  await page.evaluate(({ portrait, hero }) => {
    const a = window.shardstorm, r = a.renderer, draw = r.draw.bind(r), w = a.world;
    r.draw = (world, dt, opts) => draw(world, dt, { ...opts, attract: true });
    r.texts.items.length = 0;
    const p = w.players[0]; p.dashT = .12; p.dashDirX = 1; p.dashDirY = 0;
    if (w.boss) [w.boss.x, w.boss.y] = r.screenToWorld(innerWidth * .68, innerHeight * .42);
    r.consume([{ t: 'dash', x: p.x, y: p.y, dx: 1, dy: 0, pid: 0 }], w);
    r.draw(w, 0, { attract: true, realDt: 0 });
    // A scaled illustration of the same vessel anchors the capsule composition.
    // Screenshots below remain uncomposited gameplay with its real HUD.
    const c = document.createElement('canvas'); c.id = 'store-art'; c.width = innerWidth; c.height = innerHeight;
    Object.assign(c.style, { position: 'fixed', inset: '0', zIndex: '10', pointerEvents: 'none' }); document.body.append(c);
    const ctx = c.getContext('2d'), x = innerWidth * (hero ? .5 : portrait ? .57 : .76), y = innerHeight * (portrait ? .65 : .52);
    const shade = ctx.createLinearGradient(0, 0, portrait ? 0 : innerWidth, portrait ? innerHeight : 0);
    shade.addColorStop(0, 'rgba(3,7,18,.88)'); shade.addColorStop(.55, 'rgba(3,7,18,.2)'); shade.addColorStop(1, 'rgba(3,7,18,.05)');
    ctx.fillStyle = shade; ctx.fillRect(0, 0, c.width, c.height);
    const size = hero ? 230 : Math.min(innerWidth * .34, innerHeight * .42);
    r.fx.begin({ k: 1, ox: 0, oy: 0, minX: 0, minY: 0, maxX: c.width, maxY: c.height }, 0, 0);
    // Capture-only cache: bake the original procedural hull at its output scale.
    // The gameplay cache intentionally caps resolution at 4 px/world unit.
    r.fx.art.clear(); r.fx.art.res = Math.max(4, size / 45 * 2);
    r.fx.drawVessel(ctx, 'spark', x, y, -.6, { scale: size / 45, thrust: 1.5 });
  }, { portrait, hero });
}

async function logo(page, placement, width, height) {
  await page.evaluate(async ({ placement, width, height }) => {
    await document.fonts.load('900 100px Tektur');
    const h = document.createElement('h1'); h.className = 'logo'; h.id = 'store-logo';
    // Steam library logos permit the game name/logomark only; use that everywhere.
    h.innerHTML = 'SHARD<br>STORM';
    const size = placement === 'small' ? height * .39 : placement === 'portrait' ? width * .17 : height * .23;
    Object.assign(h.style, { position: 'fixed', zIndex: '20', margin: '0', fontSize: `${size}px`, lineHeight: '.86', overflowWrap: 'normal', whiteSpace: 'nowrap', left: `${width * .055}px`, top: placement === 'bottom' ? 'auto' : `${height * (placement === 'portrait' ? .08 : placement === 'small' ? .11 : .18)}px`, bottom: placement === 'bottom' ? `${height * .08}px` : 'auto' });
    document.body.append(h);
    const r = h.getBoundingClientRect();
    if (r.right > width - 6 || r.bottom > height - 6 || r.top < 0) throw new Error('Capsule logo clipped');
  }, { placement, width, height });
}

const capsules = [
  ['header_capsule.png', 920, 430, 'left', 120], ['library_header.png', 920, 430, 'left', 120],
  ['small_capsule.png', 462, 174, 'small', 120], ['main_capsule.png', 1232, 706, 'bottom', 185],
  ['vertical_capsule.png', 748, 896, 'portrait', 120], ['library_capsule.png', 600, 900, 'portrait', 120],
  ['library_hero.png', 3840, 1240, 'hero', 185],
  ['event_cover.png', 800, 450, 'left', 185], ['event_header.png', 1920, 622, 'left', 185],
];
try {
  for (const [name, width, height, placement, warp] of capsules) {
    if (only && !only.test(name)) continue;
    const page = await scene(width, height, warp);
    try {
      await installStorm(page, 180, 20, true);
      await page.evaluate(() => window.__step(20));
      await keyArt(page, placement === 'portrait', placement === 'hero');
      if (placement !== 'hero') await logo(page, placement, width, height);
      await save(page, name, width, height, 'Procedural gameplay key art with scaled Spark vessel; title only; hero has no text');
    } finally { await page.close(); }
  }
  if (!only || only.test('library_logo.png')) {
    const page = await openGame(browser, server.base, '?fxq=3', { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
    try {
      await freeze(page);
      await page.addStyleTag({ content: 'html,body{background:transparent!important}body>*{display:none!important}' });
      await page.evaluate(async () => {
        await document.fonts.load('900 100px Tektur');
        const h = document.createElement('h1'); h.className = 'logo'; h.id = 'store-logo'; h.textContent = 'SHARDSTORM';
        Object.assign(h.style, { display: 'block', position: 'fixed', margin: '0', top: '24px', left: '16px', fontSize: '180px', lineHeight: '1', whiteSpace: 'nowrap', overflowWrap: 'normal', width: 'max-content', textShadow: '0 0 9px #37899b' });
        document.body.append(h); h.style.setProperty('display', 'block', 'important');
        h.style.fontSize = `${180 * 1248 / h.getBoundingClientRect().width}px`;
      });
      const height = await page.locator('#store-logo').evaluate(el => Math.ceil(el.getBoundingClientRect().bottom + 24));
      await save(page, 'library_logo.png', 1280, height, 'Transparent title logo, cropped to a 1280 px wide strip', { omitBackground: true, clip: { x: 0, y: 0, width: 1280, height } });
    } finally { await page.close(); }
  }
  if (!only || only.test('page_background.png')) {
    const page = await scene(1438, 810, 40);
    try {
      await page.evaluate(() => {
        const r = window.shardstorm.renderer;
        document.querySelectorAll('body>*').forEach(el => el.style.display = 'none');
        const c = document.createElement('canvas'); c.width = 1438; c.height = 810; document.body.append(c);
        const ctx = c.getContext('2d'); r.bg.galaxy.setSector(3, { sync: true });
        r.bg.draw(ctx, 0, 0, 1, c.width, c.height, 20, 0, 1);
        ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(0, 0, c.width, c.height);
      });
      await save(page, 'page_background.png', 1438, 810, 'Gilded Throne galaxy only, darkened 50%');
    } finally { await page.close(); }
  }
  const shots = [
    { time: 40, sector: 0, label: 'Turquoise Whorl' }, { time: 185, boss: 'warden', label: 'Warden volley' },
    { time: 250, sector: 1, label: 'Garnet Nebula' }, { time: 365, boss: 'hydra', label: 'Hydra charge lane' },
    { time: 430, sector: 2, label: 'Amethyst Abyss' }, { time: 545, boss: 'voidheart', label: 'Void Heart' },
    { time: 610, sector: 3, label: 'Gilded Throne / Overtime' }, { time: 120, coop: 4, label: 'Four captains at maximum zoom' },
    { time: 200, storm: true, label: '400-alien / 60-kills-per-second capture fixture' },
  ];
  for (const [i, shot] of shots.entries()) {
    const name = `screenshot_${String(i + 1).padStart(2, '0')}.png`;
    if (only && !only.test(name)) continue;
    const page = await scene(1920, 1080, shot.time, shot.coop);
    try {
      if (i > 1) await page.addStyleTag({ content: '#comms{display:none!important}' });
      if (shot.sector !== undefined) await page.evaluate(i => { const g = window.shardstorm.renderer.bg.galaxy; g.setSector(i, { sync: true }); g.setSector = () => {}; }, shot.sector);
      if (shot.boss) {
        await bossPose(page, shot.boss);
      }
      if (shot.coop) {
        await spreadPilots(page);
        // Keep maximum zoom, but compose the captains inside the HUD bands.
        // The QA matrix separately captures the actual maximum-leash edges.
        await page.evaluate(() => {
          const w = window.shardstorm.world, c = w.teamCenter();
          for (const p of w.players) { p.x = c.x + (p.x - c.x) * .7; p.y = c.y + (p.y - c.y) * .7; }
        });
      }
      if (shot.storm) { await installStorm(page, 400, 60, true); await page.evaluate(() => window.__step(60)); }
      await redraw(page);
      await save(page, name, 1920, 1080, `${shot.label}; gameplay HUD; capture fixtures recorded in script`);
    } finally { await page.close(); }
  }
  for (const [name, size] of [['community_icon.jpg', 184], ['app_icon_1024.png', 1024]]) {
    if (only && !only.test(name)) continue;
    const page = await openGame(browser, server.base, '?fx=0', { viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    try {
      await freeze(page);
      await page.evaluate(size => {
        const fx = window.shardstorm.renderer.fx;
        document.querySelectorAll('body>*').forEach(el => el.style.display = 'none');
        const c = document.createElement('canvas'); c.width = c.height = size; document.body.append(c);
        const ctx = c.getContext('2d'), g = ctx.createRadialGradient(size * .5, size * .45, 0, size / 2, size / 2, size * .7);
        g.addColorStop(0, '#152944'); g.addColorStop(1, '#040714'); ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
        fx.begin({ k: 1, ox: 0, oy: 0, minX: 0, minY: 0, maxX: size, maxY: size }, 0, 0);
        fx.art.clear(); fx.art.res = Math.max(4, size / 64 * 2);
        fx.drawVessel(ctx, 'spark', size * .5, size * .49, -Math.PI / 2, { scale: size / 64, thrust: .8 });
      }, size);
      await save(page, name, size, size, 'Original Spark vessel on fleet background; no text', name.endsWith('.jpg') ? { type: 'jpeg', quality: 92 } : {});
    } finally { await page.close(); }
  }
  await writeFile(resolve(OUT, 'README.txt'), `SHARDSTORM store artwork. Generated by npm run store:assets.\nCaptions and native pixel dimensions: captures.json / index.html.\nCapsules are compositions of the game's procedural art; gameplay screenshots retain the HUD.\nNo remote images or fonts. No uploads performed. Review all files in Steam's upload UI before publishing.\nValve rules checked 2026-10-11:\nhttps://partner.steamgames.com/doc/store/assets/standard\nhttps://partner.steamgames.com/doc/store/assets/rules\nhttps://partner.steamgames.com/doc/store/assets/libraryassets\nThe app icon may be copied to build/icon.png by the owner; packaging currently retains its existing icon configuration.\nOptional achievement icons are not generated. The 23 achievements require 46 separate unlocked/locked icons.\n`);
} finally { await browser.close(); await server.close(); }
console.log(`Saved ${records.length} assets to ${OUT}`);
