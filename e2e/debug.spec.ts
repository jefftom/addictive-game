import { expect, test } from '@playwright/test';
import { skipIntro } from './helpers';

test('a debug seed repeats the warp and does not change ordinary or Daily seeds', async ({ page }) => {
  await skipIntro(page);
  const start = async (daily = false) => {
    await page.waitForFunction(() => !!(window as unknown as { shardstorm?: unknown }).shardstorm);
    return page.evaluate(daily => {
      const a = (window as unknown as { shardstorm: { startRun(daily: boolean): void; world: import('../src/game/world').World } }).shardstorm;
      const random = Math.random;
      Math.random = () => 0.25;
      try { a.startRun(daily); } finally { Math.random = random; }
      return { seed: a.world.cfg.seed, score: a.world.score, time: a.world.time, daily: a.world.cfg.daily };
    }, daily);
  };
  await page.goto('/?autoplay&warp=120&seed=77');
  const first = await start();
  await page.reload();
  expect(await start()).toEqual(first);
  expect(first.seed).toBe(77);
  await page.goto('/?seed=77');
  const dailySeed = (await start(true)).seed;
  await page.goto('/');
  expect((await start()).seed).toBe(0x40000000);
  const daily = await start(true);
  expect(daily.seed).toBe(dailySeed);
  expect(daily.daily).not.toBeNull();
});

test('keyboard focus reaches both new graphics settings and scrolls them into view', async ({ page }) => {
  await skipIntro(page);
  await page.goto('/');
  await page.locator('#screen-title [data-act="settings"]').click();
  const reached = new Set<string>();
  for (let i = 0; i < 24; i++) {
    await page.keyboard.press('Tab');
    const focus = await page.evaluate(() => {
      const el = document.activeElement!, rect = el.getBoundingClientRect();
      return { id: el.id, top: rect.top, bottom: rect.bottom };
    });
    if (focus.id === 'set-gridMotion' || focus.id === 'set-postfx') {
      reached.add(focus.id);
      expect(focus.top).toBeGreaterThanOrEqual(0);
      expect(focus.bottom).toBeLessThanOrEqual(page.viewportSize()!.height);
    }
    if (reached.size === 2) break;
  }
  expect([...reached].sort()).toEqual(['set-gridMotion', 'set-postfx']);
  await expect(page.locator('#set-fullscreen')).toHaveCount(0);
});

test('the title fits 720p and Deck-height windows without losing its logo or settings', async ({ page }) => {
  await skipIntro(page);
  for (const height of [720, 800]) {
    await page.setViewportSize({ width: 1280, height });
    await page.goto('/');
    const logo = page.locator('#screen-title .logo');
    await expect(logo).toBeVisible();
    const bounds = await logo.boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    const settings = await page.locator('#screen-title [data-act="settings"]').boundingBox();
    expect(settings!.y + settings!.height).toBeLessThanOrEqual(height);
  }
});
