// node crop.mjs in.png out.png x y w h [scale]
import { launch } from './lib.mjs';
import { readFileSync } from 'node:fs';
const [inp, out, x, y, w, h, sc = '1'] = process.argv.slice(2);
const b = await launch();
const p = await b.newPage({ viewport: { width: Math.round(+w * +sc), height: Math.round(+h * +sc) } });
await p.setContent(`<body style="margin:0;background:#000"><div style="width:${w * sc}px;height:${h * sc}px;overflow:hidden;position:relative"><img src="data:image/png;base64,${readFileSync(inp).toString('base64')}" style="position:absolute;left:${-x * sc}px;top:${-y * sc}px;transform-origin:0 0;transform:scale(${sc});image-rendering:pixelated"></div></body>`);
await p.screenshot({ path: out });
await b.close();
