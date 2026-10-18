import { expect, test } from '@playwright/test';
import type { World } from '../src/game/world';
import type { SaveData } from '../src/meta/save';
import type { UI } from '../src/ui/ui';
import { skipIntro } from './helpers';

type Probe = Window & { shardstorm: { world: World; ui: UI; save: SaveData; state: string; dailyRun: boolean; startRun(daily: boolean, roster?: { ship: 'spark'; device: 'kbA' | 'kbB' }[]): void; endRun(): void } };

test('results show the final build and goal, settle once, and consume one deliberate retry', async ({ page }) => {
  await skipIntro(page); await page.goto('/?seed=77');
  await page.locator('#screen-title [data-act="play"]').click();
  const settled = await page.evaluate(() => {
    const a = (window as unknown as Probe).shardstorm;
    a.world.players[0]!.build.weapons[0]!.level = 3; a.ui.runGoal = 'pulse';
    a.endRun();
    const snapshot = JSON.stringify(a.save); a.endRun();
    (document.querySelector('#screen-results [data-act="again"]') as HTMLElement).click();
    return { once: snapshot === JSON.stringify(a.save), state: a.state, runs: a.save.stats.runs, cores: a.save.cores };
  });
  expect(settled.once).toBe(true); expect(settled.state).toBe('results');
  const screen = page.locator('#screen-results');
  await expect(screen.locator('.res-review')).toContainText('Pulse Blaster · Lv 3');
  await expect(screen.locator('.res-goal')).toContainText('Next run: Photon Storm');
  await expect(screen.locator('.res-cause')).toHaveCount(0);
  await page.keyboard.down('Space'); await page.waitForTimeout(1000); await page.keyboard.press('Space'); await page.keyboard.up('Space');
  await expect(screen).toBeVisible();
  const retry = await page.evaluate(() => {
    const a = (window as unknown as Probe).shardstorm, b = document.querySelector('#screen-results [data-act="again"]') as HTMLElement;
    b.click(); const first = a.world; b.click();
    return { once: first === a.world, state: a.state, runs: a.save.stats.runs, cores: a.save.cores, goal: a.ui.runGoal };
  });
  expect(retry).toEqual({ once: true, state: 'playing', runs: settled.runs, cores: settled.cores, goal: null });
  await page.reload();
  expect(await page.evaluate(() => (window as unknown as Probe).shardstorm.save.stats.runs)).toBe(settled.runs);
});

test('Daily retry stays Daily and Change Ship explicitly launches a normal solo run', async ({ page }) => {
  await skipIntro(page); await page.goto('/?seed=77');
  await page.evaluate(() => { const a = (window as unknown as Probe).shardstorm; a.startRun(true); a.endRun(); });
  await expect(page.locator('#screen-results [data-act="again"]')).toContainText('Daily Run');
  await page.waitForTimeout(1000); await page.locator('#screen-results [data-act="again"]').click();
  expect(await page.evaluate(() => (window as unknown as Probe).shardstorm.dailyRun)).toBe(true);
  await page.evaluate(() => { const a = (window as unknown as Probe).shardstorm; a.endRun(); a.save.achievements.survive3 = 1; });
  await page.waitForTimeout(1000); await page.locator('[data-act="change-ship"]').click();
  await page.locator('[data-select="vanguard"]').click();
  await page.locator('[data-act="launch"]').click();
  expect(await page.evaluate(() => { const a = (window as unknown as Probe).shardstorm; return [a.dailyRun, a.world.players[0]!.ship, a.world.players.length]; })).toEqual([false, 'vanguard', 1]);
});

test('lethal projectile is explained and results actions fit small portrait and landscape', async ({ page }) => {
  await skipIntro(page); await page.goto('/?seed=77');
  await page.evaluate(() => {
    const a = (window as unknown as Probe).shardstorm; a.startRun(false);
    const p = a.world.players[0]!; p.invuln = 0; p.hp = 1;
    a.world.fireBullet(p.x, p.y, 0, 0, 100);
    a.world.update(1 / 60, { mx: 0, my: 0, dash: false }); a.endRun();
  });
  const screen = page.locator('#screen-results');
  await expect(screen.locator('.res-cause')).toHaveText('Lethal hit: a hostile projectile.');
  for (const viewport of [{ width: 320, height: 568 }, { width: 393, height: 851 }, { width: 851, height: 393 }]) {
    await page.setViewportSize(viewport);
    expect(await screen.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    for (const button of await screen.locator('.result-actions button').all()) {
      await button.scrollIntoViewIfNeeded(); const b = await button.boundingBox();
      expect(b!.x).toBeGreaterThanOrEqual(0); expect(b!.x + b!.width).toBeLessThanOrEqual(viewport.width);
      expect(b!.height).toBeGreaterThanOrEqual(44);
    }
  }
});

test('repeated co-op confirmation keeps one new run and the same roster', async ({ page }) => {
  await skipIntro(page); await page.goto('/?seed=77');
  await page.evaluate(() => { const a = (window as unknown as Probe).shardstorm; a.startRun(false, [{ ship: 'spark', device: 'kbA' }, { ship: 'spark', device: 'kbB' }]); a.endRun(); });
  await expect(page.locator('[data-act="change-ship"]')).toHaveCount(0);
  await page.waitForTimeout(1000);
  expect(await page.evaluate(() => {
    const a = (window as unknown as Probe).shardstorm, b = document.querySelector('#screen-results [data-act="again"]') as HTMLElement;
    b.click(); const w = a.world; b.click();
    return [w === a.world, a.world.players.length, a.world.coop, a.save.stats.runs];
  })).toEqual([true, 2, true, 1]);
});
