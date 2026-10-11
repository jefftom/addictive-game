import { launch, serve } from './lib.mjs';
import { join } from 'node:path';
const E = new URL('..', import.meta.url).pathname;
const sheets = (process.argv[2] ?? 'ships,aliens,bosses,fx').split(',');
const tag = process.argv[3] ?? 'g';
const { server, base } = await serve(join(E, 'harness-dist'));
const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1500, height: 1500 }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console]', m.text()); });
await page.goto(base + '/index.html');
await page.waitForFunction(() => window.ready);
for (const s of sheets) {
  const t0 = Date.now();
  await page.evaluate((s) => window.gallery(s), s);
  await page.locator('#c').screenshot({ path: join(E, 'shots', `${tag}-${s}.png`) });
  console.log(s, Date.now() - t0, 'ms');
}
await browser.close(); server.close();
