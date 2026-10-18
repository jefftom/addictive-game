import { expect, test, type Page } from '@playwright/test';
import type { World } from '../src/game/world';
import type { SaveData } from '../src/meta/save';
import type { UI } from '../src/ui/ui';
import { skipIntro } from './helpers';

type Probe = Window & { shardstorm: { world: World; ui: UI; save: SaveData; state: string; startRun(daily: boolean, roster?: { ship: 'spark'; device: 'kbA' | 'kbB' }[]): void; endRun(): void } };
async function earn(page: Page) {
  await page.evaluate(() => {
    const a = (window as unknown as Probe).shardstorm; a.startRun(false);
    const p = a.world.players[0]!; p.invuln = 0; a.world.hurtPlayer(1e6, p.x, p.y);
    a.endRun();
  });
  await page.waitForTimeout(1000);
  await page.locator('#screen-results [data-act="transmission"]').click();
}
async function resources(page: Page) {
  return page.evaluate(() => { const { transmission, ...rest } = (window as unknown as Probe).shardstorm.save; return JSON.stringify(rest); });
}

test('optional signal preserves edits on return/reload and keyboard solving never changes rewards', async ({ page }) => {
  await skipIntro(page); await page.goto('/?seed=77'); await earn(page);
  const before = await resources(page), signal = page.locator('#screen-transmission');
  expect(await page.evaluate(() => {
    const shortcut = new KeyboardEvent('keydown', { code: 'KeyR', key: 'r', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(shortcut); return shortcut.defaultPrevented;
  })).toBe(false);
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyQ', key: 'a', bubbles: true, cancelable: true })));
  await expect(signal.locator('.signal-answer')).toHaveAttribute('aria-label', 'Your answer: A, 1 of 6 letters');
  await page.keyboard.press('Backspace');
  for (const letter of 'OCA') await signal.locator(`[data-letter="${letter}"]`).click();
  await signal.locator('[data-signal="hint"]').click();
  await signal.locator('[data-signal="back"]').click();
  await expect(page.locator('#screen-results')).toBeVisible();
  await page.waitForTimeout(1000); await page.locator('#screen-results [data-act="transmission"]').click();
  await expect(signal.locator('.signal-answer')).toHaveAttribute('aria-label', 'Your answer: O C A, 3 of 6 letters');
  await page.reload();
  await page.locator('#screen-title [data-act="transmission"]').click();
  await expect(signal.locator('.signal-hint')).toBeVisible();
  for (const letter of 'BEN') await signal.locator(`[data-letter="${letter}"]`).click();
  await signal.locator('[data-signal="decode"]').click();
  await expect(signal.locator('.signal-feedback')).toContainText('does not match');
  await signal.locator('[data-signal="decode"]').click();
  expect(await resources(page)).toBe(before);
  await signal.locator('[data-signal="clear"]').click();
  for (const letter of 'BEACON') await page.keyboard.press(`Key${letter}`);
  await page.keyboard.press('Enter');
  await expect(signal.locator('.signal-message')).toBeVisible();
  await expect(signal.locator('.signal-feedback')).toContainText('Decoded: BEACON');
  expect(await resources(page)).toBe(before);
  await page.reload(); await page.locator('#screen-title [data-act="transmission"]').click();
  await expect(signal.locator('.signal-message')).toBeVisible();
  await expect(signal.locator('[data-signal="decode"]')).toBeDisabled();
  expect(await resources(page)).toBe(before);
});

test('touch reveal and gamepad back work without overflow or forced decoding', async ({ page }) => {
  await skipIntro(page); await page.goto('/?seed=77'); await earn(page);
  const signal = page.locator('#screen-transmission'), before = await resources(page);
  for (const viewport of [{ width: 320, height: 568 }, { width: 393, height: 851 }, { width: 851, height: 393 }]) {
    await page.setViewportSize(viewport);
    expect(await signal.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
    for (const b of await signal.locator('button').all()) {
      await b.scrollIntoViewIfNeeded(); const box = await b.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44); expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width);
    }
  }
  await signal.locator('[data-signal="reveal"]').click();
  await expect(signal.locator('.signal-feedback')).toContainText('Answer revealed');
  expect(await resources(page)).toBe(before);
  await page.evaluate(() => (window as unknown as Probe).shardstorm.ui.padNav({ up:false,down:false,left:false,right:false,confirm:false,back:true,alt:false }));
  await expect(page.locator('#screen-results')).toBeVisible();
  await page.waitForTimeout(1000); await page.locator('#screen-results [data-act="again"]').click();
  await expect(page.locator('#screen-transmission')).toBeHidden();
  expect(await page.evaluate(() => (window as unknown as Probe).shardstorm.state)).toBe('playing');
});

test('retreat, Daily and co-op cannot earn a fragment, and combat never opens its screen', async ({ page }) => {
  await skipIntro(page); await page.goto('/?seed=77');
  await expect(page.locator('#screen-title [data-act="transmission"]')).toHaveCount(0);
  const state = await page.evaluate(() => {
    const a = (window as unknown as Probe).shardstorm;
    a.startRun(false); a.endRun();
    a.startRun(true); a.world.gameOver = true; a.endRun();
    a.startRun(false, [{ ship:'spark',device:'kbA' },{ship:'spark',device:'kbB'}]); a.world.gameOver = true; a.endRun();
    return a.save.transmission?.unlocked;
  });
  expect(state).toBe(false);
  await earn(page); await page.locator('[data-signal="play"]').click();
  expect(await page.evaluate(() => {
    const a = (window as unknown as Probe).shardstorm; a.ui.showTransmission(a.save); return [a.state, a.ui.current];
  })).toEqual(['playing', 'hud']);
});
