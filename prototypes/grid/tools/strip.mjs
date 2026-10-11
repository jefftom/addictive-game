// Contact strip from PNG frames: node tools/strip.mjs out.png cols thumbW label1=file1 label2=file2 ...
import { chromium } from '/home/user/addictive-game/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
const [outFile, cols, thumbW, ...items] = process.argv.slice(2);
const frames = items.map((it) => {
  const i = it.indexOf('=');
  return { label: it.slice(0, i), url: 'data:image/png;base64,' + readFileSync(it.slice(i + 1)).toString('base64') };
});
const browser = await chromium.launch();
const page = await browser.newPage();
const data = await page.evaluate(async ([frames, cols, tw]) => {
  const imgs = await Promise.all(frames.map((f) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = f.url; })));
  const th = Math.round((tw * imgs[0].height) / imgs[0].width);
  const rows = Math.ceil(imgs.length / cols);
  const c = document.createElement('canvas');
  c.width = cols * tw + (cols - 1) * 4;
  c.height = rows * th + (rows - 1) * 4;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  imgs.forEach((im, i) => {
    const x = (i % cols) * (tw + 4);
    const y = Math.floor(i / cols) * (th + 4);
    g.drawImage(im, x, y, tw, th);
    g.font = '14px monospace';
    const w = g.measureText(frames[i].label).width + 12;
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(x, y, w, 22);
    g.fillStyle = '#fff';
    g.fillText(frames[i].label, x + 6, y + 16);
  });
  return c.toDataURL('image/png');
}, [frames, Number(cols), Number(thumbW)]);
writeFileSync(outFile, Buffer.from(data.split(',')[1], 'base64'));
await browser.close();
