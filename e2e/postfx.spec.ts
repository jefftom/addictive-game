import { expect, test, type Page } from '@playwright/test';
import type { Renderer } from '../src/render/renderer';
import type { World } from '../src/game/world';
import { skipIntro } from './helpers';

type Probe = Window & { shardstorm: { renderer: Renderer; world: World; attract: World }; loss?: WEBGL_lose_context };
test.beforeEach(async ({ page }) => { await skipIntro(page); });
function errorsOn(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return errors;
}
const active = (page: Page) => page.evaluate(() => (window as unknown as Probe).shardstorm.renderer.postFxActive);
async function variety(page: Page): Promise<number> {
  return page.evaluate(() => {
    const r = (window as unknown as Probe).shardstorm.renderer;
    const source = r.postFxActive ? r.worldCanvas : r.canvas;
    const probe = document.createElement('canvas'); probe.width = 64; probe.height = 36;
    const ctx = probe.getContext('2d')!; ctx.drawImage(source, 0, 0, 64, 36);
    const data = ctx.getImageData(0, 0, 64, 36).data, colors = new Set<number>();
    for (let i = 0; i < data.length; i += 4) colors.add((data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!);
    return colors.size;
  });
}
async function start(page: Page, query = '?fxq=0') {
  await page.goto('/' + query);
  await page.locator('#screen-title [data-act="play"]').click();
  await expect.poll(() => variety(page)).toBeGreaterThan(20);
}

test('enhanced graphics presents the world below a crisp input/HUD canvas', async ({ page }) => {
  const errors = errorsOn(page);
  await start(page);
  expect(await active(page)).toBe(true);
  await expect(page.locator('body')).toHaveClass(/fx-on/);
  await expect(page.locator('#fx')).toBeVisible();
  const shot = (await page.screenshot()).toString('base64');
  const colors = await page.evaluate(async data => {
    const img = new Image(); img.src = 'data:image/png;base64,' + data; await img.decode();
    const probe = document.createElement('canvas'); probe.width = 64; probe.height = 36;
    const ctx = probe.getContext('2d')!; ctx.drawImage(img, 0, 0, 64, 36);
    const d = ctx.getImageData(0, 0, 64, 36).data, colors = new Set<number>();
    for (let i = 0; i < d.length; i += 4) colors.add((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!);
    return colors.size;
  }, shot);
  expect(colors).toBeGreaterThan(20);
  expect(await page.locator('#fx').evaluate(el => getComputedStyle(el).pointerEvents)).toBe('none');
  expect(errors).toEqual([]);
});

test('context loss falls back to 2D and restoration resumes enhanced graphics', async ({ page }) => {
  const errors = errorsOn(page);
  await start(page);
  await page.evaluate(() => {
    const w = window as unknown as Probe;
    w.loss = (document.getElementById('fx') as HTMLCanvasElement).getContext('webgl2')!.getExtension('WEBGL_lose_context')!;
    w.loss.loseContext();
  });
  await expect.poll(() => active(page)).toBe(false);
  await expect(page.locator('body')).not.toHaveClass(/fx-on/);
  await expect.poll(() => variety(page)).toBeGreaterThan(20);
  expect(await page.evaluate(() => (window as unknown as Probe).shardstorm.renderer.worldCanvas.width)).toBe(1);
  await page.evaluate(() => (window as unknown as Probe).loss!.restoreContext());
  await expect.poll(() => active(page)).toBe(true);
  await expect.poll(() => variety(page)).toBeGreaterThan(20);
  expect(errors).toEqual([]);
});

test('enhanced graphics setting persists and can be re-enabled', async ({ page }) => {
  const errors = errorsOn(page);
  await page.goto('/?fxq=0');
  await page.locator('#screen-title [data-act="settings"]').click();
  await page.locator('#set-postfx').uncheck();
  await expect(page.locator('body')).not.toHaveClass(/fx-on/);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('shardstorm.save')!).settings.postfx)).toBe(false);
  await page.reload();
  await expect(page.locator('#screen-title')).toBeVisible();
  expect(await active(page)).toBe(false);
  await page.locator('#screen-title [data-act="settings"]').click();
  await expect(page.locator('#set-postfx')).not.toBeChecked();
  await page.locator('#set-postfx').check();
  await expect.poll(() => active(page)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  expect(errors).toEqual([]);
});

test('fx=0 forces a complete 2D frame', async ({ page }) => {
  const errors = errorsOn(page);
  await start(page, '?fx=0');
  expect(await active(page)).toBe(false);
  await expect(page.locator('#fx')).toBeHidden();
  expect(await variety(page)).toBeGreaterThan(20);
  expect(errors).toEqual([]);
});

test('auto-off survives ordinary input and only an off/on setting retries it', async ({ page }) => {
  const errors = errorsOn(page);
  await start(page, '');
  await page.evaluate(() => {
    const fx = (window as unknown as Probe).shardstorm.renderer.postfx!;
    for (let i = 0; i < 400; i++) fx.reportFrameTime(30);
  });
  await expect.poll(() => active(page)).toBe(false);
  await page.mouse.click(200, 300);
  expect(await active(page)).toBe(false);
  await page.evaluate(() => {
    const r = (window as unknown as Probe).shardstorm.renderer;
    r.setPostFx(false); r.setPostFx(true);
  });
  expect(await active(page)).toBe(true);
  expect(await page.evaluate(() => (window as unknown as Probe).shardstorm.renderer.postfx!.quality)).toBe(1);
  expect(errors).toEqual([]);
});

test('unavailable WebGL2 keeps an opaque, complete Canvas 2D world', async ({ page }) => {
  const errors = errorsOn(page);
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...args: Parameters<typeof original>) {
      if (args[0] === 'webgl2') return null;
      return original.apply(this, args);
    } as typeof original;
  });
  await start(page);
  expect(await active(page)).toBe(false);
  expect(await page.evaluate(() => {
    const r = (window as unknown as Probe).shardstorm.renderer;
    return { unavailable: r.postfx === null, alpha: r.hudCtx.getContextAttributes().alpha };
  })).toEqual({ unavailable: true, alpha: false });
  expect(errors).toEqual([]);
});

test('resolution changes preserve simulation extents and the native overlay clears in attract mode', async ({ page }) => {
  const errors = errorsOn(page);
  await start(page);
  const result = await page.evaluate(() => {
    const { renderer: r, world: w, attract } = (window as unknown as Probe).shardstorm;
    const before = [w.viewHalfW, w.viewHalfH];
    r.postfx!.settings.renderScale = 0.75;
    r.postfx!.onQualityChange!(0, r.postfx!.renderScale);
    r.draw(w, 0, { attract: false, realDt: 0, modal: true });
    const worldSize = [r.worldCanvas.width, r.worldCanvas.height];
    r.texts.clear();
    r.draw(attract, 0, { attract: true, realDt: 0 });
    const probe = document.createElement('canvas'); probe.width = 64; probe.height = 36;
    const ctx = probe.getContext('2d')!; ctx.drawImage(r.canvas, 0, 0, 64, 36);
    const data = ctx.getImageData(0, 0, 64, 36).data;
    return { before, after: [w.viewHalfW, w.viewHalfH], worldSize,
      expected: [Math.round(r.w * (r.phone ? 0.625 : 0.75)), Math.round(r.h * (r.phone ? 0.625 : 0.75))],
      alpha: data.filter((_, i) => i % 4 === 3).some(x => x > 0) };
  });
  expect(result.after).toEqual(result.before);
  expect(result.worldSize).toEqual(result.expected);
  expect(result.alpha).toBe(false);
  expect(errors).toEqual([]);
});

test('a mid-frame render failure preserves the current world before freeing its canvas', async ({ page }) => {
  const errors = errorsOn(page);
  await start(page);
  const colors = await page.evaluate(() => {
    const { renderer: r, world: w } = (window as unknown as Probe).shardstorm;
    const fx = r.postfx!, render = fx.render;
    // Simulate failure at the render boundary, before the asynchronous context-loss event.
    fx.render = () => { Object.defineProperty(fx, 'active', { value: false, configurable: true }); return false; };
    r.draw(w, 0, { attract: false, realDt: 0, modal: true });
    fx.render = render;
    const probe = document.createElement('canvas'); probe.width = 64; probe.height = 36;
    const ctx = probe.getContext('2d')!; ctx.drawImage(r.canvas, 0, 0, 64, 36);
    const d = ctx.getImageData(0, 0, 64, 36).data, colors = new Set<number>();
    for (let i = 0; i < d.length; i += 4) colors.add((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!);
    return { count: colors.size, freed: r.worldCanvas.width === 1, active: r.postFxActive };
  });
  expect(colors.count).toBeGreaterThan(20);
  expect(colors.freed).toBe(true);
  expect(colors.active).toBe(false);
  expect(errors).toEqual([]);
});
