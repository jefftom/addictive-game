// Side-by-side montage of PNGs with labels: node montage.mjs out.png "label=path" ... [--cols=N] [--scale=S]
import { chromium } from '/home/user/addictive-game/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';
const args = process.argv.slice(2);
const outPath = args.shift();
const cols = Number(args.find((a) => a.startsWith('--cols='))?.split('=')[1] ?? 0);
const scale = Number(args.find((a) => a.startsWith('--scale='))?.split('=')[1] ?? 1);
const items = args.filter((a) => !a.startsWith('--')).map((a) => { const i = a.indexOf('='); return { label: a.slice(0, i), data: readFileSync(a.slice(i + 1)).toString('base64') }; });
const browser = await chromium.launch();
const page = await browser.newPage();
const html = `<body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(${cols || items.length},auto);gap:6px;padding:6px;width:max-content;font:600 14px monospace;color:#eee">${items
  .map((it) => `<div><div style="padding:2px 4px">${it.label}</div><img style="display:block;image-rendering:pixelated;zoom:${scale}" src="data:image/png;base64,${it.data}"></div>`)
  .join('')}</body>`;
await page.setContent(html);
await page.waitForTimeout(200);
const el = await page.$('body');
await el.screenshot({ path: outPath });
await browser.close();
