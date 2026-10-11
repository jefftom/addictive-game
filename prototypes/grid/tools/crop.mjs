// Crop/scale PNGs: node tools/crop.mjs out.png scale cols file:x,y,w,h [file:x,y,w,h ...] (tiles side by side)
import { chromium } from '/home/user/addictive-game/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const [outFile, scale, cols, ...items] = process.argv.slice(2);
const tiles = items.map((it) => { const [f, r] = it.split(':'); const [x, y, w, h] = r.split(',').map(Number); return { url: 'data:image/png;base64,' + readFileSync(f).toString('base64'), x, y, w, h, label: f.split('/').pop() }; });
const browser = await chromium.launch();
const page = await browser.newPage();
const data = await page.evaluate(async ([tiles, s, cols]) => {
  const imgs = await Promise.all(tiles.map((t) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = t.url; })));
  const tw = tiles[0].w * s, th = tiles[0].h * s;
  const rows = Math.ceil(tiles.length / cols);
  const c = document.createElement('canvas');
  c.width = cols * tw + (cols - 1) * 4; c.height = rows * th + (rows - 1) * 4;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  tiles.forEach((t, i) => {
    const x = (i % cols) * (tw + 4), y = Math.floor(i / cols) * (th + 4);
    g.drawImage(imgs[i], t.x, t.y, t.w, t.h, x, y, tw, th);
    g.font = '13px monospace'; g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(x, y, g.measureText(t.label).width + 10, 18); g.fillStyle = '#fff'; g.fillText(t.label, x + 5, y + 13);
  });
  return c.toDataURL('image/png');
}, [tiles, Number(scale), Number(cols)]);
writeFileSync(outFile, Buffer.from(data.split(',')[1], 'base64'));
await browser.close();
