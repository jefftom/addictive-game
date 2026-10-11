import { expect, test } from '@playwright/test';
import type { Renderer } from '../src/render/renderer';
import type { World } from '../src/game/world';
import { skipIntro } from './helpers';

type Probe = Window & { shardstorm: { renderer: Renderer; world: World; state: string; endRun(): void } };
test.beforeEach(async ({ page }) => { await skipIntro(page); });

test('grid draws a bounded mesh and responds to capital-ship death', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?autoplay&fxq=0');
  await page.locator('#screen-title [data-act="play"]').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Probe).shardstorm.renderer.grid.pointCount)).toBeGreaterThan(800);
  const stats = await page.evaluate(() => {
    const {renderer:r,world:w} = (window as unknown as Probe).shardstorm;
    r.consume([{t:'bossdead',x:w.players[0]!.x,y:w.players[0]!.y,name:'Warden'}],w);
    return {n:r.grid.pointCount, spacing:r.grid.spacing, ms:r.gridMs};
  });
  expect(stats.n).toBeLessThanOrEqual(1800); expect(stats.spacing).toBe(32); expect(Number.isFinite(stats.ms)).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as unknown as Probe).shardstorm.renderer.grid.flare)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('grid motion persists and applies independently of screen shake', async ({ page }) => {
  await page.goto('/?fxq=0');
  await page.locator('#screen-title [data-act="settings"]').click();
  const slider = page.locator('#set-gridMotion'); await expect(slider).toHaveValue('100');
  await slider.fill('0');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('shardstorm.save')!).settings.gridMotion)).toBe(0);
  expect(await page.evaluate(() => (window as unknown as Probe).shardstorm.renderer.settings.gridMotion)).toBe(0);
  await expect(page.locator('#set-shake')).toHaveValue('100');
  await page.reload(); await page.locator('#screen-title [data-act="settings"]').click();
  await expect(page.locator('#set-gridMotion')).toHaveValue('0');
  await page.locator('#screen-settings [data-act="back"]').click();
  await page.locator('#screen-title [data-act="play"]').click();
  await expect.poll(() => page.evaluate(() => (window as unknown as Probe).shardstorm.renderer.grid.motion)).toBe(0);
});

test('old saves inherit their screen shake value', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('shardstorm.save', JSON.stringify({story:{introSeen:true},settings:{shake:0.3}})));
  await page.goto('/?fxq=0'); await page.locator('#screen-title [data-act="settings"]').click();
  await expect(page.locator('#set-gridMotion')).toHaveValue('30');
});

test('grid quality follows active FX and a deliberate 2D choice', async ({ page }) => {
  await page.goto('/?fxq=0');
  const tiers = await page.evaluate(() => {
    const r = (window as unknown as Probe).shardstorm.renderer, g = r.grid, fx = r.postfx!;
    const probe = () => {
      g.reset(); g.update(1 / 60, 0, 0);
      return { quality: g.quality, steps: g.stepsLast, cost: r.costTier };
    };
    const q0 = probe();
    fx.settings.quality = 3; fx.onQualityChange?.(3, 1); const q3 = probe();
    fx.settings.quality = 'auto';
    for (let i = 0; i < 2500; i++) fx.reportFrameTime(40);
    const automatic = probe();
    r.setPostFx(false); const chosen = probe();
    return { q0, q3, automatic, chosen };
  });
  expect(tiers).toEqual({q0:{quality:0,steps:0,cost:1},q3:{quality:0,steps:1,cost:4},
    automatic:{quality:0,steps:0,cost:0},chosen:{quality:1,steps:1,cost:4}});
});

test('co-op mesh reserves zoom coverage and restores solo spacing at results', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'Co-op requires keyboard or gamepad pilots');
  await page.setViewportSize({width:1280,height:720}); await page.goto('/?coop=4&autoplay&fxq=0');
  await expect.poll(() => page.evaluate(() => (window as unknown as Probe).shardstorm?.world?.players.length)).toBe(4);
  expect(await page.evaluate(() => (window as unknown as Probe).shardstorm.renderer.grid.spacing)).toBe(40);
  expect(await page.evaluate(() => (window as unknown as Probe).shardstorm.renderer.grid.pointCount)).toBeLessThanOrEqual(1800);
  await page.evaluate(() => (window as unknown as Probe).shardstorm.endRun());
  await expect(page.locator('#screen-results')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as unknown as Probe).shardstorm.renderer.grid.spacing)).toBe(32);
});
