import { expect, test } from '@playwright/test';
import type { World } from '../src/game/world';
import type { UI } from '../src/ui/ui';
import type { Offer } from '../src/game/upgrades';
import { skipIntro } from './helpers';

type Probe = Window & { shardstorm: { world: World; ui: UI; state: string; offers: Offer[]; openLevelUp(): void; pause(): void; endRun(): void; startRun(daily: boolean, roster?: { ship: 'spark' | 'tempest'; device: 'kbA' | 'kbB' }[]): void } };

test('evolution goals explain the build without consuming picks or simulation state', async ({ page }) => {
  await skipIntro(page);
  await page.goto('/?seed=77');
  await page.locator('#screen-title [data-act="play"]').click();
  await page.evaluate(() => {
    const a = (window as unknown as Probe).shardstorm;
    a.world.players[0]!.build.weapons[0]!.level = 3;
    a.world.pendingLevelUps = 1; a.openLevelUp();
  });
  const snap = () => page.evaluate(() => {
    const a = (window as unknown as Probe).shardstorm, w = a.world;
    return JSON.stringify([a.state, w.time, w.players[0]!.build, w.spawnRng, w.lootRng, w.rng, w.posRng, a.offers, w.players[0]!.rerolls]);
  });
  const before = await snap(), screen = page.locator('#screen-levelup');
  await screen.locator('[data-evolution-toggle]').click();
  await expect(screen.locator('[data-evolution="pulse"]')).toContainText('Weapon 3/5');
  await expect(screen.locator('[data-evolution="pulse"]')).toContainText('missing');
  await page.waitForTimeout(400);
  await screen.locator('[data-pin="pulse"]').click();
  await expect(screen.locator('[data-pin="pulse"]')).toHaveAttribute('aria-pressed', 'true');
  await screen.locator('[data-evolution-toggle]').click();
  expect(await snap()).toBe(before);
  await page.evaluate(() => { const a = (window as unknown as Probe).shardstorm; a.state = 'playing'; a.pause(); });
  const pause = page.locator('#screen-pause');
  await expect(pause.locator('[data-evolution-toggle]')).toContainText('Goal: Photon Storm');
  await pause.locator('[data-evolution-toggle]').focus();
  await page.keyboard.press('Enter');
  await expect(pause.locator('.evolution-body')).toBeVisible();
  await page.evaluate(() => { const a = (window as unknown as Probe).shardstorm; a.endRun(); a.startRun(false); });
  expect(await page.evaluate(() => (window as unknown as Probe).shardstorm.ui.runGoal)).toBeNull();
});

test('phone evolution guide stays bounded and explains full passive slots', async ({ page }) => {
  await skipIntro(page); await page.goto('/?seed=77');
  await page.locator('#screen-title [data-act="play"]').click();
  await page.evaluate(() => {
    const a = (window as unknown as Probe).shardstorm;
    a.world.players[0]!.build.passives = { power: 1, magnet: 1, plating: 1, fortune: 1 };
    a.pause();
  });
  const screen = page.locator('#screen-pause');
  await screen.locator('[data-evolution-toggle]').click();
  await expect(screen.locator('[data-state="blocked"]')).toContainText('Passive slots full');
  await expect(screen.locator('[data-pin]')).toHaveCount(0);
  for (const viewport of [{ width: 320, height: 568 }, { width: 393, height: 851 }, { width: 851, height: 393 }]) {
    await page.setViewportSize(viewport);
    await screen.locator('[data-evolution-toggle]').scrollIntoViewIfNeeded();
    const bounds = await screen.locator('[data-evolution-toggle]').boundingBox();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(await screen.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
});

test('co-op guide follows the picking pilot and accepts only their controller', async ({ page }) => {
  await skipIntro(page); await page.goto('/?seed=77');
  await page.evaluate(() => {
    const a = (window as unknown as Probe).shardstorm;
    a.startRun(false, [{ ship: 'spark', device: 'kbA' }, { ship: 'tempest', device: 'kbB' }]);
    a.world.levelRound = [1]; a.openLevelUp();
  });
  const screen = page.locator('#screen-levelup');
  await expect(screen.locator('[data-evolution="arc"]')).toHaveCount(1);
  await expect(screen.locator('[data-evolution="pulse"]')).toHaveCount(0);
  await expect(screen.locator('[data-pin]')).toHaveCount(0);
  await page.waitForTimeout(400);
  await screen.locator('[data-evolution-toggle]').focus();
  await page.evaluate(() => (window as unknown as Probe).shardstorm.ui.menuAction('kbA', 'confirm'));
  await expect(screen.locator('.evolution-body')).toBeHidden();
  await page.evaluate(() => (window as unknown as Probe).shardstorm.ui.menuAction('kbB', 'confirm'));
  await expect(screen.locator('.evolution-body')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as Probe).shardstorm.state)).toBe('levelup');
});
