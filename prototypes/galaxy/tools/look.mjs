// Quick look: render views and save (optionally clipped) screenshots.
// node tools/look.mjs [--nobuild] WxH spec... ; spec = name:sector:mode[:x,y,w,h]
//   mode: plain | overlay | bare (backdrop only) | moved | warp<p> (e.g. warp0.42, from sector-1 -> sector)
import { chromium } from '/home/user/addictive-game/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let args = process.argv.slice(2);
if (!args.includes('--nobuild')) {
  const rd = '/home/user/addictive-game/node_modules/.bin/rolldown';
  execFileSync(rd, [join(root, 'harness.ts'), '--file', join(root, 'dist/harness.js'), '--format', 'iife', '--platform', 'browser'], { stdio: 'inherit' });
  execFileSync(rd, [join(root, 'worker.ts'), '--file', join(root, 'dist/worker.js'), '--format', 'esm', '--platform', 'browser'], { stdio: 'inherit' });
}
args = args.filter((a) => a !== '--nobuild');
const [w, h] = args.shift().split('x').map(Number);
const out = join(root, '../look');
mkdirSync(out, { recursive: true });
const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const f = join(root, p);
  if (!existsSync(f)) return res.writeHead(404), res.end();
  res.writeHead(200, { 'content-type': extname(f) === '.html' ? 'text/html' : 'text/javascript' });
  res.end(readFileSync(f));
}).listen(0);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(`http://localhost:${server.address().port}/harness.html`);
await page.waitForFunction(() => window.ready === true);
await page.evaluate(([w, h]) => window.api.setup(w, h), [w, h]);
for (const spec of args) {
  const [name, sec, mode, clip] = spec.split(':');
  const i = Number(sec);
  await page.evaluate(([i, mode]) => {
    if (mode.startsWith('warp')) window.api.renderWarp(Math.max(0, i - 1), i, Number(mode.slice(4)));
    else if (mode === 'moved') window.api.render(i, { camX: 5200, camY: -3100, time: 30 });
    else if (mode.startsWith('time')) window.api.render(i, { time: Number(mode.slice(4)), beat: 0.6 });
    else if (mode.startsWith('camo')) {
      window.api.render(i, { top: false });
      window.api.camoMap('#' + mode.slice(4));
    } else window.api.render(i, { overlay: mode === 'overlay', top: mode !== 'bare', legacy: mode === 'legacy' });
  }, [i, mode]);
  const o = { path: join(out, name + '.png') };
  if (clip) {
    const [x, y, cw, ch] = clip.split(',').map(Number);
    o.clip = { x, y, width: cw, height: ch };
  }
  await page.screenshot(o);
  console.log('saved', o.path);
}
await browser.close();
server.close();
