// Standalone harness screenshots + bench.
// Run: PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tools/shoot.mjs [--only=kill,boss] [--perf] [--nogalaxy]
import { chromium } from '/home/user/addictive-game/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const perf = args.includes('--perf');
const only = args.find((a) => a.startsWith('--only='))?.split('=')[1]?.split(',');
const galaxy = !args.includes('--nogalaxy');
const W = Number(args.find((a) => a.startsWith('--w='))?.split('=')[1] ?? 1920);
const H = Number(args.find((a) => a.startsWith('--h='))?.split('=')[1] ?? 1080);

execFileSync(join(root, 'tools/build.sh'), { stdio: 'inherit' });
mkdirSync(join(root, 'shots/seq'), { recursive: true });

const browser = await chromium.launch({ args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('file://' + join(root, 'harness.html'));
await page.waitForFunction(() => window.ready === true);
await page.evaluate(([w, h, g]) => window.api.setup(w, h, { galaxy: g }), [W, H, galaxy]);

const save = (file, dataUrl) => writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));

const SEQS = {
  kill: { sector: 0, times: [0.08, 0.14, 0.22, 0.32, 0.45, 0.56, 0.7, 1.0] },
  boss: { sector: 1, times: [0.75, 0.83, 0.95, 1.1, 1.3, 1.55, 1.9, 2.5] },
  blackhole: { sector: 2, times: [0.15, 0.35, 0.6, 0.85, 0.97, 1.05, 1.25, 1.7] },
  voidheart: { sector: 2, times: [0.5, 1.0, 2.0, 3.0] },
  dash: { sector: 0, times: [0.17, 0.22, 0.28, 0.36, 0.5, 0.8, 0.95, 1.2] },
  nova: { sector: 1, times: [0.15, 0.25, 0.4, 0.6, 0.7, 0.9, 1.2, 1.6] },
  chaos: { sector: 1, times: [1.0, 2.0, 3.0, 4.0] },
  'boss-reduced': { scenario: 'boss', sector: 1, reduced: true, times: [0.75, 0.83, 0.95, 1.1, 1.3, 1.55, 1.9, 2.5] },
};

for (const [name, s] of Object.entries(SEQS)) {
  if (only && !only.includes(name)) continue;
  await page.evaluate((r) => window.api.set({ flashes: !r }), !!s.reduced);
  await page.evaluate(([n, sec]) => window.api.scenario(n, sec), [s.scenario ?? name, s.sector]);
  const out = await page.evaluate(([t]) => window.api.sequence(t, 4, 480), [s.times]);
  save(join(root, `shots/${name}-strip.png`), out.strip);
  out.frames.forEach((f, i) => save(join(root, `shots/seq/${name}-${String(i).padStart(2, '0')}.png`), f));
  console.log('shot', name, 'maxHeat', out.heat.join(' '));
}

if (args.includes('--measure')) {
  // Brightness budget: grid alone over black, max channel per moment.
  const M = {
    rest: { scenario: 'kill', sector: 0, times: [0.02, 0.05] },
    kill: { scenario: 'kill', sector: 0, times: [0.14, 0.22, 0.32, 0.56, 0.62, 0.7] },
    boss: { scenario: 'boss', sector: 1, times: [0.83, 0.95, 1.1, 1.3, 1.55, 1.9] },
    blackhole: { scenario: 'blackhole', sector: 2, times: [0.35, 0.6, 0.85, 0.97, 1.05] },
    voidheart: { scenario: 'voidheart', sector: 2, times: [1.0, 2.0, 3.0] },
    dash: { scenario: 'dash', sector: 0, times: [0.22, 0.28, 0.36] },
    nova: { scenario: 'nova', sector: 1, times: [0.25, 0.4, 0.7] },
    chaos: { scenario: 'chaos', sector: 1, times: [1.0, 2.0, 3.0, 4.0] },
  };
  const rep = {};
  await page.evaluate(([w, h]) => window.api.setup(w, h, { galaxy: false }), [W, H]);
  for (const reduced of [false, true]) {
    await page.evaluate((r) => window.api.set({ flashes: !r }), reduced);
    for (const [name, s] of Object.entries(M)) {
      await page.evaluate(([n, sec]) => window.api.scenario(n, sec), [s.scenario, s.sector]);
      const r = await page.evaluate((t) => window.api.measure(t), s.times);
      rep[(reduced ? 'reduced-' : '') + name] = r;
      console.log((reduced ? 'reduced-' : '') + name, JSON.stringify(r.map((x) => [x.t, x.max, x.p999, x.over045, x.flare])));
    }
  }
  await page.evaluate(() => window.api.set({ flashes: true }));
  writeFileSync(join(root, 'shots/brightness.json'), JSON.stringify(rep, null, 2));
}

if (perf) {
  const report = {};
  for (const [w, h, label] of [[1920, 1080, '1080p'], [2560, 1440, '1440p'], [1280, 720, '720p']]) {
    await page.evaluate(([w, h]) => window.api.setup(w, h, { galaxy: false }), [w, h]);
    for (const mode of ['none', 'legacy', 'grid-q0', 'grid-q1']) {
      await page.evaluate((m) => window.api.tune({ quality: m === 'grid-q0' ? 0 : 1 }), mode);
      report[label + '-' + mode] = await page.evaluate((m) => window.api.bench(200, m), mode);
      console.log(label, mode, JSON.stringify(report[label + '-' + mode]));
    }
    await page.evaluate(() => window.api.tune({ quality: 1 }));
  }
  writeFileSync(join(root, 'shots/perf.json'), JSON.stringify(report, null, 2));
}
await browser.close();
