// node montage.mjs out.png cols scale file1 file2 ...  (nearest-neighbour upscale; labels = file names)
import { launch } from './lib.mjs';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
const [out, cols, scale, ...files] = process.argv.slice(2);
const imgs = files.map((f) => ({ name: basename(f, '.png'), src: 'data:image/png;base64,' + readFileSync(f).toString('base64') }));
const browser = await launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });
const size = await page.evaluate(async ({ imgs, cols, scale }) => {
  const els = await Promise.all(imgs.map((d) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = d.src; })));
  const cw = Math.max(...els.map((i) => i.width)) * scale, ch = Math.max(...els.map((i) => i.height)) * scale + 16;
  const rows = Math.ceil(els.length / cols);
  const c = document.createElement('canvas'); c.width = cw * cols; c.height = ch * rows; c.id = 'm';
  document.body.style.margin = '0'; document.body.appendChild(c);
  const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height); g.imageSmoothingEnabled = false;
  els.forEach((im, k) => { const x = (k % cols) * cw, y = Math.floor(k / cols) * ch; g.drawImage(im, x, y + 16, im.width * scale, im.height * scale); g.fillStyle = '#9fe'; g.font = '12px monospace'; g.fillText(imgs[k].name, x + 4, y + 12); });
  return { w: c.width, h: c.height };
}, { imgs, cols: +cols, scale: +scale });
await page.setViewportSize({ width: size.w, height: size.h });
await page.locator('#m').screenshot({ path: out });
await browser.close();
console.log(out, size);
