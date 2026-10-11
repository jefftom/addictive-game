// Side-by-side crops: node cmp.mjs out.png x y w h scale "label=path" ...
import { launch } from './lib.mjs';
import { readFileSync } from 'node:fs';
const [out, x, y, w, h, sc, ...items] = process.argv.slice(2);
const its = items.map((a) => { const i = a.indexOf('='); return { label: a.slice(0, i), data: readFileSync(a.slice(i + 1)).toString('base64') }; });
const W = Math.round(+w * +sc), H = Math.round(+h * +sc);
const b = await launch();
const p = await b.newPage({ viewport: { width: (W + 6) * its.length + 6, height: H + 30 } });
await p.setContent(`<body style="margin:0;background:#111;display:flex;gap:6px;padding:6px;font:600 13px monospace;color:#eee">${its
  .map((it) => `<div><div>${it.label}</div><div style="width:${W}px;height:${H}px;overflow:hidden;position:relative"><img src="data:image/png;base64,${it.data}" style="position:absolute;left:${-x * sc}px;top:${-y * sc}px;transform-origin:0 0;transform:scale(${sc});image-rendering:pixelated"></div></div>`)
  .join('')}</body>`);
await p.waitForTimeout(150);
await p.screenshot({ path: out, fullPage: true });
await b.close();
