import { expect, test } from '@playwright/test';
import { PLAYER_COLORS, ZOOM_MAX } from '../src/game/content/coop';
import { ENEMIES } from '../src/game/content/enemies';
import { WEAPONS } from '../src/game/content/weapons';
import { GEM_TIERS, PAL } from '../src/render/palette';
import type { World } from '../src/game/world';
import type { Renderer } from '../src/render/renderer';
import { skipIntro } from './helpers';

type ProbeWindow = Window & { shardstorm: { renderer: Renderer; world: World; state: string };
  galaxyEvents?: string[]; cardSeen?: boolean };

test.beforeEach(async ({ page }) => { await skipIntro(page); });

test('title galaxy generates off-thread without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => {
    const g = (window as unknown as ProbeWindow).shardstorm?.renderer.bg.galaxy;
    return g?.isReady(0) && g.sector === 0 && g.usesWorker && g.genStats.get(0)?.worker;
  }), { timeout: 10000 }).toBe(true);
  expect(errors).toEqual([]);
});

test('every sector and warp phase covers solo and zoomed co-op views', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as ProbeWindow).shardstorm);
  const uncovered = await page.evaluate(zoom => {
    const r = (window as unknown as ProbeWindow).shardstorm.renderer, g = r.bg.galaxy;
    const failures: string[] = [];
    const check = (label: string) => {
      for (const k of [r.scale * r.dpr, r.scale * r.dpr / zoom]) {
        for (const [x, y] of [[0, 0], [800, -500], [-2100, 1700]]) {
          r.ctx.setTransform(1, 0, 0, 1, 0, 0);
          r.ctx.globalAlpha = 1; r.ctx.globalCompositeOperation = 'source-over';
          r.ctx.fillStyle = '#ff00ff'; r.ctx.fillRect(0, 0, r.w, r.h);
          g.draw(r.ctx, x, y, k, r.w, r.h, 0);
          const d = r.ctx.getImageData(0, 0, r.w, r.h).data;
          let holes = 0;
          for (let i = 0; i < d.length; i += 4) if (d[i] === 255 && d[i + 1] === 0 && d[i + 2] === 255) holes++;
          if (holes) failures.push(`${label}, k=${k}, camera=${x}/${y}: ${holes}`);
        }
      }
    };
    for (let i = 0; i < 4; i++) {
      g.clearWarp(); g.prepare(i); g.setSector(i, { sync: true }); g.update(1); check(`sector ${i}`);
      for (const p of [0.15, 0.42, 0.56, 0.8]) { g.setWarpPreview(i, (i + 1) % 4, p); check(`warp ${i} at ${p}`); }
    }
    g.clearWarp();
    return failures;
  }, ZOOM_MAX);
  expect(uncovered).toEqual([]);
});

test('full background pixels stay distinct from gameplay glows', async ({ page }) => {
  const colors = [...new Set([
    ...Object.entries(PAL).filter(([key]) => key !== 'void' && key !== 'voidHi').flatMap(([, value]) => value),
    ...GEM_TIERS.map(x => x.color), ...Object.values(ENEMIES).map(x => x.color),
    ...Object.values(WEAPONS).map(x => x.color), ...PLAYER_COLORS,
  ].filter(c => /^#[\da-f]{6}$/i.test(c)))];
  await page.goto('/');
  await page.waitForFunction(() => !!(window as unknown as ProbeWindow).shardstorm);
  const failures = await page.evaluate(colors => {
    const r = (window as unknown as ProbeWindow).shardstorm.renderer, g = r.bg.galaxy;
    const linear = (c: number) => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    const lab = (red: number, green: number, blue: number) => {
      const R = linear(red / 255), G = linear(green / 255), B = linear(blue / 255);
      const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
      const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
      const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
      return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
        1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
        0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
    };
    const glows = colors.map(hex => {
      const n = parseInt(hex.slice(1), 16);
      return lab(((n >> 16) & 255) * 0.3, ((n >> 8) & 255) * 0.3, (n & 255) * 0.3);
    });
    const failures: string[] = [];
    for (let sector = 0; sector < 4; sector++) {
      g.clearWarp(); g.prepare(sector); g.setSector(sector, { sync: true }); g.update(1);
      for (const [x, y] of [[0, 0], [800, -500], [-2100, 1700], [5300, -3700]]) {
        r.bg.draw(r.ctx, x, y, r.scale * r.dpr, r.w, r.h, 1, 0.5, 0);
        const width = Math.round(r.w * 0.4), height = Math.round(r.h * 0.4);
        const data = r.ctx.getImageData(Math.round((r.w - width) / 2), Math.round((r.h - height) / 2), width, height).data;
        const counts = glows.map(() => 0), light: number[] = [];
        // Every pixel: alternate-pixel sampling misses some one-pixel grid strokes.
        for (let p = 0; p < data.length; p += 4) {
          const v = lab(data[p]!, data[p + 1]!, data[p + 2]!); light.push(v[0]!);
          for (let c = 0; c < glows.length; c++) {
            const z = glows[c]!, dl = v[0]! - z[0]!, da = v[1]! - z[1]!, db = v[2]! - z[2]!;
            if (dl * dl + da * da + db * db < 0.0025) counts[c]!++;
          }
        }
        const share = Math.max(...counts) / light.length;
        light.sort((a, b) => a - b);
        const p99 = light[Math.floor(light.length * 0.99)]!;
        if (share >= 0.005 || p99 >= 0.27) failures.push(`sector ${sector}, ${x}/${y}: camouflage=${share}, L99=${p99}`);
      }
    }
    return failures;
  }, colors);
  expect(failures).toEqual([]);
});

test('warp phase order and card are presentation-only', async ({ page }) => {
  await page.goto('/?autoplay');
  await page.locator('#screen-title [data-act="play"]').click();
  await page.waitForFunction(() => (window as unknown as ProbeWindow).shardstorm.renderer.bg.galaxy.sector === 0);
  await page.evaluate(() => {
    const probe = window as unknown as ProbeWindow, app = probe.shardstorm, r = app.renderer;
    const original = r.onGalaxy;
    probe.galaxyEvents = [];
    r.onGalaxy = e => {
      original?.(e);
      if (e.t.startsWith('warp-')) probe.galaxyEvents!.push(e.t);
      if (e.t === 'warp-done') probe.cardSeen = !!(r.sectorCard as unknown as { card: unknown }).card;
    };
    r.consume([{ t: 'sector', index: 1 }], app.world);
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as ProbeWindow).galaxyEvents), { timeout: 10000 })
    .toEqual(['warp-spool', 'warp-tunnel', 'warp-punch', 'warp-done']);
  expect(await page.evaluate(() => ({ card: (window as unknown as ProbeWindow).cardSeen, sector: (window as unknown as ProbeWindow).shardstorm.world.sector })))
    .toEqual({ card: true, sector: 0 });
});

test('pause holds the warp and sector card until resume', async ({ page }) => {
  await page.goto('/?autoplay');
  await page.locator('#screen-title [data-act="play"]').click();
  await page.waitForFunction(() => (window as unknown as ProbeWindow).shardstorm.renderer.bg.galaxy.sector === 0);
  await page.locator('#pause-btn').click();
  await expect(page.locator('#screen-pause')).toBeVisible();
  await page.evaluate(() => {
    const r = (window as unknown as ProbeWindow).shardstorm.renderer;
    r.bg.galaxy.setWarpPreview(0, 1, 0.42);
    r.showSectorCard(1, 'The Garnet Nebula', 'Sector Two: past the First Gate');
  });
  const snapshot = () => page.evaluate(() => {
    const r = (window as unknown as ProbeWindow).shardstorm.renderer;
    return { progress: r.bg.galaxy.warpFx.progress, life: (r.sectorCard as unknown as { card: { life: number } }).card.life };
  });
  const before = await snapshot();
  await page.waitForTimeout(700);
  expect(await snapshot()).toEqual(before);
  await page.locator('#screen-pause [data-act="resume"]').click();
  await expect.poll(async () => (await snapshot()).progress).toBeGreaterThan(before.progress);
});

for (const failure of ['constructor', 'worker error'] as const) {
  test(`galaxy falls back to chunked generation after ${failure}`, async ({ page }) => {
    await page.addInitScript(mode => {
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(url: string | URL, options?: WorkerOptions) {
          if (mode === 'constructor') throw new Error('Worker unavailable in this test');
          super(url, options);
          setTimeout(() => this.onerror?.(new ErrorEvent('error')), 0);
        }
      };
    }, failure);
    await page.goto('/');
    await expect.poll(() => page.evaluate(() => {
      const g = (window as unknown as ProbeWindow).shardstorm?.renderer.bg.galaxy;
      return g?.isReady(0) && g.sector === 0 && !g.usesWorker && g.genStats.get(0)?.worker === false;
    }), { timeout: 15000 }).toBe(true);
  });
}
