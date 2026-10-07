import { expect, test, type Page } from '@playwright/test';

/**
 * Local co-op flow with two keyboard pilots (kbA = WASD + Space, kbB = arrows +
 * Enter/RightShift). Desktop project only: co-op needs keyboards or gamepads.
 */

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

/** Vanguard and Tempest unlocked; the tutorial already seen. */
const SEED_SAVE = {
  version: 1,
  ship: 'spark',
  achievements: { survive3: 1, combo150: 1 },
  stats: { runs: 4, bestScore: 4321, bestTime: 200, bestCombo: 160 },
  tutorialDone: true,
};

type Pilot = { x: number; y: number; ship: string; downed: boolean; dashId: number; build: number };
type Snap = { state: string; n: number; pilots: Pilot[]; zoom: number; time: number };

async function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const app = (window as unknown as { shardstorm: Record<string, unknown> }).shardstorm;
    type W = {
      time: number;
      zoom: number;
      players: {
        x: number;
        y: number;
        ship: string;
        downed: boolean;
        dashId: number;
        build: { weapons: { level: number }[]; passives: Record<string, number>; relics: string[] };
      }[];
    };
    const w = app.world as W | null;
    const pilots = (w?.players ?? []).map((p) => ({
      x: p.x,
      y: p.y,
      ship: p.ship,
      downed: p.downed,
      dashId: p.dashId,
      // Sum of weapon levels + passive levels + relics: +1 for every non-filler pick.
      build: p.build.weapons.reduce((a, b) => a + b.level, 0) + Object.values(p.build.passives).reduce((a, b) => a + b, 0) + p.build.relics.length,
    }));
    return { state: app.state as string, n: pilots.length, pilots, zoom: w?.zoom ?? 1, time: w?.time ?? 0 };
  });
}

/** Debug helpers run against the live world (the e2e harness handle from main.ts). */
async function onWorld(page: Page, fn: string, arg?: unknown): Promise<void> {
  await page.evaluate(
    ([body, a]) => {
      const w = (window as unknown as { shardstorm: { world: unknown } }).shardstorm.world;
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      new Function('w', 'a', body as string)(w, a);
    },
    [fn, arg] as const,
  );
}

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'co-op needs keyboards or gamepads');
  await page.addInitScript((save) => {
    if (!localStorage.getItem('shardstorm.save')) localStorage.setItem('shardstorm.save', JSON.stringify(save));
  }, SEED_SAVE);
});

async function joinTwoAndLaunch(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('#screen-title [data-act="coop"]').click();
  await expect(page.locator('#screen-lobby')).toBeVisible();
  await page.keyboard.press('Space'); // kbA joins as P1
  await page.keyboard.press('Enter'); // kbB joins as P2
  const joined = page.locator('#screen-lobby .slot-card:not(.empty)');
  await expect(joined).toHaveCount(2);
  await expect(joined.nth(0)).toContainText('Keyboard · WASD');
  await expect(joined.nth(1)).toContainText('Keyboard · Arrows');
  await expect(joined.nth(0).locator('h3')).toHaveText('Spark');
  await expect(joined.nth(1).locator('h3')).toHaveText('Vanguard');
  await page.keyboard.press('ArrowRight'); // P2 cycles ship; P1 is untouched
  await expect(joined.nth(1).locator('h3')).toHaveText('Tempest');
  await expect(joined.nth(0).locator('h3')).toHaveText('Spark');
  await page.keyboard.press('Space'); // P1 ready
  await expect(page.locator('#screen-lobby .lobby-status')).toContainText('P2');
  await page.keyboard.press('Enter'); // P2 ready
  await expect(page.locator('#screen-lobby .lobby-status.go')).toBeVisible();
  await expect.poll(async () => (await snap(page)).state, { timeout: 6000 }).toBe('playing');
  // Keep both pilots alive and in place for the checks below.
  await onWorld(page, 'for (const p of w.players) p.invuln = 1e9;');
}

test('two keyboard pilots join, fly independently, pick in turn, pause and finish', async ({ page }) => {
  const errors = trackErrors(page);
  await joinTwoAndLaunch(page);
  let s = await snap(page);
  expect(s.n).toBe(2);
  expect(s.pilots.map((p) => p.ship)).toEqual(['spark', 'tempest']);

  // Independent movement: WASD moves only P1, arrows only P2.
  let a = await snap(page);
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(600);
  await page.keyboard.up('KeyD');
  let b = await snap(page);
  expect(b.pilots[0]!.x - a.pilots[0]!.x).toBeGreaterThan(40);
  expect(Math.abs(b.pilots[1]!.x - a.pilots[1]!.x)).toBeLessThan(5);
  await page.waitForTimeout(400); // let P1 coast to a stop
  a = await snap(page);
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(600);
  await page.keyboard.up('ArrowLeft');
  b = await snap(page);
  expect(a.pilots[1]!.x - b.pilots[1]!.x).toBeGreaterThan(40);
  expect(Math.abs(b.pilots[0]!.x - a.pilots[0]!.x)).toBeLessThan(5);

  // Dash keys belong to one pilot each.
  a = await snap(page);
  await page.keyboard.press('ShiftRight');
  await expect.poll(async () => (await snap(page)).pilots[1]!.dashId).toBeGreaterThan(a.pilots[1]!.dashId);
  expect((await snap(page)).pilots[0]!.dashId).toBe(a.pilots[0]!.dashId);

  // A forced level-up opens a round: P1 picks, then P2. Other devices cannot pick for them.
  const before = await snap(page);
  await onWorld(page, 'w.addXp(w.xpNext, 0);');
  await expect(page.locator('#screen-levelup .lu-who')).toContainText('P1');
  await page.waitForTimeout(400);
  await page.keyboard.press('Enter'); // kbB: not P2's turn
  await page.keyboard.press('Numpad1');
  await page.keyboard.press('Space'); // a dash key never picks
  await page.waitForTimeout(150);
  await expect(page.locator('#screen-levelup .lu-who')).toContainText('P1');
  await page.keyboard.press('Digit1'); // P1 takes card 1
  await expect(page.locator('#screen-levelup .lu-who')).toContainText('P2');
  await expect(page.locator('#screen-levelup .lu-chip.done')).toHaveCount(1);
  await page.waitForTimeout(400);
  await page.keyboard.press('KeyE'); // kbA: not P1's turn any more
  await page.keyboard.press('Digit2');
  await page.waitForTimeout(150);
  await expect(page.locator('#screen-levelup .lu-who')).toContainText('P2');
  await page.keyboard.press('Enter'); // P2 takes the focused card
  await expect.poll(async () => (await snap(page)).state).toBe('playing');
  const after = await snap(page);
  expect(after.pilots[0]!.build).toBe(before.pilots[0]!.build + 1);
  expect(after.pilots[1]!.build).toBe(before.pilots[1]!.build + 1);

  // Pause shows both builds; resume.
  await page.keyboard.press('Escape');
  await expect(page.locator('#screen-pause')).toBeVisible();
  await expect(page.locator('#screen-pause .pilot-build')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await snap(page)).state).toBe('playing');

  // Downed and revived: P2 goes down, P1 flies over and revives them.
  await onWorld(page, 'const p = w.players[1]; p.invuln = 0; p.dashT = 0; p.shieldReady = false; p.revivesUsed = 99; w.hurtPlayer(1e9, p.x, p.y, 1);');
  await expect.poll(async () => (await snap(page)).pilots[1]!.downed).toBe(true);
  expect((await snap(page)).state).toBe('playing');
  await expect(page.locator('#toasts')).toContainText('P2 is down');
  await onWorld(page, 'const [p1, p2] = w.players; p1.x = p2.x + 10; p1.y = p2.y;');
  await expect.poll(async () => (await snap(page)).pilots[1]!.downed, { timeout: 8000 }).toBe(false);
  await expect(page.locator('#toasts')).toContainText('back in the fight');

  // End the run: co-op results, and the squad record is saved apart from solo.
  await onWorld(page, 'w.score = 2468;');
  await page.locator('#pause-btn').click();
  await page.locator('#screen-pause [data-act="quit"]').click();
  await expect(page.locator('#screen-results')).toBeVisible();
  await expect(page.locator('#screen-results .coop-table tbody tr')).toHaveCount(2);
  await expect(page.locator('#screen-results')).toContainText('Co-op · 2 captains');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('shardstorm.save') ?? '{}'));
  expect(saved.version).toBe(2);
  expect(saved.coop.runs).toBe(1);
  expect(saved.coop.best['2']).toBeGreaterThanOrEqual(2468); // the clock keeps scoring until the pause
  expect(saved.coop.revives).toBe(1);
  expect(saved.coop.lastRoster).toEqual([
    { device: 'kbA', ship: 'spark' },
    { device: 'kbB', ship: 'tempest' },
  ]);
  expect(saved.stats.bestScore).toBe(4321);
  expect(saved.stats.runs).toBe(5);

  // Play again keeps the squad.
  await page.waitForTimeout(1000);
  await page.locator('#screen-results [data-act="again"]').click();
  await expect.poll(async () => (await snap(page)).state).toBe('playing');
  s = await snap(page);
  expect(s.pilots.map((p) => p.ship)).toEqual(['spark', 'tempest']);
  expect(errors).toEqual([]);
});

test('the lobby: leave, mouse controls and back to title', async ({ page }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  await page.locator('#screen-title [data-act="coop"]').click();
  await page.keyboard.press('Enter'); // kbB joins first: P1
  await page.keyboard.press('Space'); // kbA: P2
  const joined = page.locator('#screen-lobby .slot-card:not(.empty)');
  await expect(joined).toHaveCount(2);
  await expect(joined.nth(0)).toContainText('Keyboard · Arrows');
  await page.keyboard.press('Backspace'); // kbB leaves; kbA moves up to P1
  await expect(joined).toHaveCount(1);
  await expect(joined.nth(0)).toContainText('Keyboard · WASD');
  await expect(joined.nth(0).locator('.slot-id')).toContainText('P1');
  // Mouse controls act for a slot too.
  await expect(joined.nth(0).locator('h3')).toHaveText('Vanguard'); // keeps the ship it joined with
  await joined.nth(0).locator('[data-lobby="right"]').click();
  await expect(joined.nth(0).locator('h3')).toHaveText('Tempest');
  await joined.nth(0).locator('[data-lobby="leave"]').click();
  await expect(joined).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#screen-title')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { shardstorm: { state: string } }).shardstorm.state)).toBe('title');
  expect(errors).toEqual([]);
});
