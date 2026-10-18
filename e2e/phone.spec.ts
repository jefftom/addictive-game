import { expect, test } from '@playwright/test';
import type { Input } from '../src/core/input';
import type { Renderer } from '../src/render/renderer';
import { skipIntro } from './helpers';

type Probe = Window & { stopFrames: boolean; shardstorm: { input: Input; renderer: Renderer; state: string } };
test.use({ hasTouch: true });

test.beforeEach(async ({ page }) => {
  await skipIntro(page);
  await page.addInitScript(() => {
    localStorage.setItem('shardstorm.save', JSON.stringify({ story: { introSeen: true }, tutorialDone: true }));
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = cb => raf(t => { if (!(window as unknown as Probe).stopFrames) cb(t); });
  });
  await page.setViewportSize({ width: 393, height: 851 });
  await page.goto('/?fxq=3&seed=77');
  await page.locator('#screen-title [data-act="play"]').click();
  await page.waitForFunction(() => (window as unknown as Probe).shardstorm.state === 'playing');
  await page.evaluate(() => { (window as unknown as Probe).stopFrames = true; });
});

test('a real two-finger gesture steers and dashes independently, then cancels cleanly', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  const read = () => page.evaluate(() => (window as unknown as Probe).shardstorm.input.read(0, 0));
  const dash = await page.evaluate(() => {
    const r = (window as unknown as Probe).shardstorm.renderer;
    return { x: r.hud.dashButton.x / r.dpr, y: r.hud.dashButton.y / r.dpr };
  });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 90, y: 670, id: 1 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 94, y: 670, id: 1 }] });
  expect(await read()).toEqual({ mx: 0, my: 0, dash: false });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 116, y: 670, id: 1 }] });
  const move = await read();
  expect(move.mx).toBeCloseTo((0.5 - 0.18) / 0.82, 2);
  expect(move.my).toBeCloseTo(0);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 116, y: 670, id: 1 }, { ...dash, id: 2 }] });
  expect(await read()).toMatchObject({ mx: move.mx, dash: true });
  expect((await read()).dash).toBe(false);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  expect(await read()).toEqual({ mx: 0, my: 0, dash: false });
  await page.touchscreen.tap(dash.x, dash.y);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  expect(await read()).toEqual({ mx: 0, my: 0, dash: false });
});

test('phone world resolution and controls survive rotation and the 2D fallback', async ({ page }) => {
  for (const viewport of [{ width: 393, height: 851 }, { width: 851, height: 393 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(() => page.evaluate(() => (window as unknown as Probe).shardstorm.renderer.cssW)).toBe(viewport.width);
    const result = await page.evaluate(() => {
      const r = (window as unknown as Probe).shardstorm.renderer;
      return { phone: r.phone, dpr: r.dpr, cssW: r.cssW, cssH: r.cssH, hudW: r.canvas.width,
        worldW: r.worldCanvas.width, scale: r.postfx!.renderScale, quality: r.postfx!.quality,
        dash: r.hud.dashButton, stick: r.hud.stickRadius, particles: r.particles.density };
    });
    expect(result.phone).toBe(true);
    expect(result.hudW).toBe(Math.round(result.cssW * result.dpr));
    expect(result.worldW).toBe(Math.round(result.hudW * Math.min(1, 1.25 / result.dpr)));
    expect(result.quality).toBe(3);
    expect(result.stick! / result.dpr).toBe(52);
    expect(result.dash.r * 2 / result.dpr).toBe(76);
    expect(result.dash.y + result.dash.r).toBeLessThan(result.cssH * result.dpr);
    expect(result.particles).toBe(0.45);
  }
  expect(await page.evaluate(() => {
    const r = (window as unknown as Probe).shardstorm.renderer;
    r.setPostFx(false);
    return { active: r.postFxActive, particles: r.particles.density, shards: r.fx.shards.quality };
  })).toEqual({ active: false, particles: 0.45, shards: 0.5 });
});
