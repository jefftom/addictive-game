import { expect, test, type Page } from '@playwright/test';
import { skipIntro } from './helpers';

// These tests cover the game loop and menus; the first-launch story crawl has its own spec (story.spec.ts).
test.beforeEach(async ({ page }) => {
  await skipIntro(page);
});

/** Errors other than unreachable web fonts fail the test. */
function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

type Snapshot = { state: string; time: number; level: number; enemies: number; pending: number };

async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    // `shardstorm` is a debug handle exposed by main.ts; private fields are readable at runtime.
    const app = (window as unknown as { shardstorm: Record<string, unknown> }).shardstorm;
    const w = app.world as { time: number; level: number; enemies: unknown[]; pendingLevelUps: number } | null;
    return {
      state: app.state as string,
      time: w?.time ?? 0,
      level: w?.level ?? 0,
      enemies: w?.enemies.length ?? 0,
      pending: w?.pendingLevelUps ?? 0,
    };
  });
}

async function startRun(page: Page): Promise<void> {
  await page.locator('#screen-title [data-act="play"]').click();
  await expect.poll(async () => (await snapshot(page)).state).toBe('playing');
}

test('title screen loads without errors and fits the viewport', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.locator('#screen-title')).toBeVisible();
  await expect(page.locator('.logo')).toContainText('SHARD');
  await expect(page.locator('#screen-title .mission')).toHaveCount(3);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});

test('a run starts, the world simulates and the canvas draws', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await startRun(page);
  await page.waitForTimeout(2500);
  const s = await snapshot(page);
  expect(s.time).toBeGreaterThan(1);
  expect(s.enemies).toBeGreaterThan(0);
  // The canvas should have drawn a non-uniform image.
  const distinct = await page.evaluate(() => {
    const c = document.getElementById('game') as HTMLCanvasElement;
    const probe = document.createElement('canvas');
    probe.width = 64;
    probe.height = 36;
    const ctx = probe.getContext('2d')!;
    ctx.drawImage(c, 0, 0, 64, 36);
    const d = ctx.getImageData(0, 0, 64, 36).data;
    const set = new Set<number>();
    for (let i = 0; i < d.length; i += 4) set.add((d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]!);
    return set.size;
  });
  expect(distinct).toBeGreaterThan(20);
  expect(errors).toEqual([]);
});

test('level-up offers can be picked with the keyboard', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'keyboard flow is desktop-only');
  const errors = trackErrors(page);
  await page.goto('/');
  await startRun(page);
  await page.evaluate(() => {
    const w = (window as unknown as { shardstorm: { world: { addXp(n: number): void; xpNext: number } } }).shardstorm.world;
    w.addXp(w.xpNext);
  });
  await expect(page.locator('#screen-levelup')).toBeVisible();
  await expect(page.locator('#screen-levelup .offer')).toHaveCount(3);
  await page.waitForTimeout(400);
  await page.keyboard.press('Digit1');
  await expect.poll(async () => (await snapshot(page)).state).toBe('playing');
  await expect(page.locator('#screen-levelup')).toBeHidden();
  expect(errors).toEqual([]);
});

test('pause, resume and ending a run show the results screen', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await startRun(page);
  await page.waitForTimeout(800);
  await page.locator('#pause-btn').click();
  await expect(page.locator('#screen-pause')).toBeVisible();
  await page.locator('#screen-pause [data-act="resume"]').click();
  await expect.poll(async () => (await snapshot(page)).state).toBe('playing');
  await page.locator('#pause-btn').click();
  await page.locator('#screen-pause [data-act="quit"]').click();
  await expect(page.locator('#screen-results')).toBeVisible();
  await expect(page.locator('#screen-results .reward-line').first()).toBeVisible();
  // Progress is saved.
  const runs = await page.evaluate(() => JSON.parse(localStorage.getItem('shardstorm.save') ?? '{}').stats?.runs);
  expect(runs).toBe(1);
  // Restart (after the short grace period that stops mashed keys from skipping results).
  await page.waitForTimeout(1000);
  await page.locator('#screen-results [data-act="again"]').click();
  await expect.poll(async () => (await snapshot(page)).state).toBe('playing');
  expect(errors).toEqual([]);
});

test('menus open and close', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  for (const screen of ['hangar', 'workshop', 'records', 'settings']) {
    await page.locator(`#screen-title [data-act="${screen}"]`).click();
    await expect(page.locator(`#screen-${screen}`)).toBeVisible();
    await page.locator(`#screen-${screen} [data-act="back"]`).click();
    await expect(page.locator('#screen-title')).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('mashing the dash key never picks a level-up card, and held keys keep working', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'keyboard flow is desktop-only');
  const errors = trackErrors(page);
  await page.goto('/');
  await startRun(page);
  await page.keyboard.down('KeyD');
  await page.evaluate(() => {
    const w = (window as unknown as { shardstorm: { world: { addXp(n: number): void; xpNext: number } } }).shardstorm.world;
    w.addXp(w.xpNext);
  });
  await expect(page.locator('#screen-levelup')).toBeVisible();
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Space');
    await page.waitForTimeout(80);
  }
  await expect(page.locator('#screen-levelup')).toBeVisible();
  await page.keyboard.press('Digit2');
  await expect.poll(async () => (await snapshot(page)).state).toBe('playing');
  // KeyD is still held: the ship should keep moving right.
  const x0 = await page.evaluate(() => (window as unknown as { shardstorm: { world: { player: { x: number } } } }).shardstorm.world.player.x);
  await page.waitForTimeout(600);
  const x1 = await page.evaluate(() => (window as unknown as { shardstorm: { world: { player: { x: number } } } }).shardstorm.world.player.x);
  await page.keyboard.up('KeyD');
  expect(x1 - x0).toBeGreaterThan(40);
  expect(errors).toEqual([]);
});
