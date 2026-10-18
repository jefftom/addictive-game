import { expect, test } from '@playwright/test';
import type { World } from '../src/game/world';
import type { Renderer } from '../src/render/renderer';
import { skipIntro } from './helpers';

type AppWindow = Window & { shardstorm: { renderer: Renderer; world: World } };
test.beforeEach(async ({ page }) => { await skipIntro(page); });

test('vessel API preserves drawing state and ghosts contain only a hull', async ({ page }) => {
  await page.goto('/?coop=2&autoplay');
  await page.waitForFunction(() => !!(window as unknown as AppWindow).shardstorm?.world);
  const result = await page.evaluate(() => {
    const r = (window as unknown as AppWindow).shardstorm.renderer;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    r.fx.begin({ k: 1, ox: 128, oy: 128, minX: -128, minY: -128, maxX: 128, maxY: 128 }, 0, 0);
    ctx.setTransform(2, 0, 0, 3, 10, 20); ctx.globalAlpha = 0.7; ctx.globalCompositeOperation = 'screen';
    const original = ctx.drawImage.bind(ctx); let draws = 0;
    ctx.drawImage = ((...args: Parameters<typeof ctx.drawImage>) => { draws++; original(...args); }) as typeof ctx.drawImage;
    r.fx.drawVessel(ctx, 'bastion', 0, 0, 0, { ghost: true });
    const ghostDraws = draws;
    const pixels = ctx.getImageData(0, 0, 256, 256).data;
    let maxAlpha = 0;
    for (let i = 3; i < pixels.length; i += 4) maxAlpha = Math.max(maxAlpha, pixels[i]!);
    const beforeNormal = draws;
    r.fx.drawVessel(ctx, 'bastion', 0, 0, 0, { accent: '#ffcc66' });
    return { ghostDraws, maxAlpha, normalDraws: draws - beforeNormal,
      alpha: ctx.globalAlpha, op: ctx.globalCompositeOperation, transform: [...ctx.getTransform().toFloat64Array()] };
  });
  expect(result.ghostDraws).toBe(1);
  expect(result.maxAlpha).toBeGreaterThan(0);
  expect(result.maxAlpha).toBeLessThanOrEqual(90);
  expect(result.normalDraws).toBeGreaterThan(3);
  expect(result.alpha).toBeCloseTo(0.7);
  expect(result.op).toBe('screen');
  expect(result.transform).toEqual([2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 1, 0, 10, 20, 0, 1]);
});

test('capital ship motion follows simulation time and freezes at zero dt', async ({ page }) => {
  await page.goto('/?coop=2&autoplay');
  await page.waitForFunction(() => !!(window as unknown as AppWindow).shardstorm?.world);
  const result = await page.evaluate(() => {
    const { renderer: r, world } = (window as unknown as AppWindow).shardstorm;
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    world.enemies.length = 0;
    const warden = world.spawnEnemy('warden', 0, 0)!, hydra = world.spawnEnemy('hydra', 80, 0)!;
    warden.spawnT = hydra.spawnT = 0; warden.fireT = 0.3;
    const fx = r.fx;
    fx.flashes = false;
    type Boss = { spin: number; spin2: number; heading: number; necks: Float32Array };
    const states = () => (fx as unknown as { bosses: Map<number, Boss> }).bosses;
    const view = { k: 1, ox: 128, oy: 128, minX: -500, minY: -500, maxX: 500, maxY: 500 };
    const run = (hz: number) => {
      fx.reset();
      for (let i = 0; i < hz; i++) { fx.begin(view, 1 / hz, 1 / hz); fx.drawEnemies(ctx, world); }
      const b = states().get(warden.id)!;
      return [b.spin, b.spin2];
    };
    const sixty = run(60), oneTwenty = run(120);
    const snapshot = () => [...states()].map(([id, b]) => [id, b.spin, b.spin2, b.heading, [...b.necks]]);
    const before = snapshot();
    for (let i = 0; i < 30; i++) { fx.begin(view, 0, 1 / 60); fx.drawEnemies(ctx, world); }
    return { sixty, oneTwenty, before, after: snapshot() };
  });
  expect(result.sixty[0]).toBeCloseTo(result.oneTwenty[0]!, 8);
  expect(result.sixty[1]).toBeCloseTo(result.oneTwenty[1]!, 8);
  expect(result.after).toEqual(result.before);
});
