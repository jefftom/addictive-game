import { expect, test, type Page } from '@playwright/test';
import { STORY } from '../src/story/script';
import { skipIntro } from './helpers';

function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

const savedJson = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('shardstorm.save') ?? '{}'));
const appState = (page: Page) => page.evaluate(() => (window as unknown as { shardstorm: { state: string } }).shardstorm.state);

async function skipCrawl(page: Page, isMobile: boolean): Promise<void> {
  // Input is ignored for a moment so a stray key can't skip it instantly.
  await page.waitForTimeout(900);
  if (isMobile) await page.locator('#crawl').click({ position: { x: 40, y: 300 } });
  else await page.keyboard.press('Escape');
}

test('the opening crawl plays on first launch, can be skipped and is remembered', async ({ page, isMobile }) => {
  const errors = trackErrors(page);
  await page.goto('/');
  const crawl = page.locator('#crawl');
  await expect(crawl).toBeVisible();
  await expect(crawl.locator('.crawl-title')).toHaveText(STORY.intro.title);
  await expect(crawl.locator('.crawl-p')).toHaveCount(STORY.intro.paragraphs.length);
  await expect(page.locator('#screen-title')).toBeHidden();
  await skipCrawl(page, !!isMobile);
  await expect(crawl).toHaveCount(0);
  await expect(page.locator('#screen-title')).toBeVisible();
  expect((await savedJson(page)).story?.introSeen).toBe(true);
  // Second launch goes straight to the title screen.
  await page.reload();
  await expect(page.locator('#screen-title')).toBeVisible();
  await page.waitForTimeout(500);
  await expect(page.locator('#crawl')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("the Ship's Log lists chapters, the cast and vessels, and replays the briefing", async ({ page, isMobile }) => {
  const errors = trackErrors(page);
  await skipIntro(page);
  await page.goto('/');
  await page.locator('#screen-title [data-act="log"]').click();
  const log = page.locator('#screen-log');
  await expect(log).toBeVisible();
  await expect(log.locator('.log-row')).toHaveCount(STORY.logbook.length);
  // A fresh save has everything locked, each with an unlock hint.
  await expect(log.locator('.log-row.locked')).toHaveCount(STORY.logbook.length);
  await expect(log.locator('.log-row').first().locator('.log-hint')).toHaveText('Finish your first run');
  await log.locator('[data-tab="cast"]').click();
  await expect(log.locator('.cast-card')).toHaveCount(STORY.characters.length);
  await log.locator('[data-tab="fleet"]').click();
  await expect(log.locator('.vessel')).toHaveCount(Object.keys(STORY.vessels).length);
  await expect(log.locator('.vessel').first()).toContainText(STORY.vessels.spark.className);
  // Replay the briefing, then land back in the log.
  await log.locator('[data-act="intro"]').click();
  await expect(page.locator('#crawl')).toBeVisible();
  await skipCrawl(page, !!isMobile);
  await expect(log).toBeVisible();
  await log.locator('[data-act="back"]').click();
  await expect(page.locator('#screen-title')).toBeVisible();
  expect(errors).toEqual([]);
});

/** Ends the current run as a loss (every pilot destroyed). */
const wipe = (page: Page) =>
  page.evaluate(() => {
    const w = (window as unknown as { shardstorm: { world: { player: unknown; teamWipe(p: unknown): void } } }).shardstorm.world;
    w.teamWipe(w.player);
  });

test('finishing a run unlocks and announces the first log entry, with a game-over quip', async ({ page }) => {
  const errors = trackErrors(page);
  await skipIntro(page);
  await page.goto('/');
  await page.locator('#screen-title [data-act="play"]').click();
  await expect.poll(() => appState(page)).toBe('playing');
  await page.waitForTimeout(500);
  await wipe(page);
  const results = page.locator('#screen-results');
  await expect(results).toBeVisible();
  await expect(results.locator('.results-head .eyebrow')).toContainText(/ship lost/i);
  await expect(results.locator('.res-quip q')).not.toBeEmpty();
  const entry = results.locator('.log-unlock');
  await expect(entry).toHaveCount(1);
  await expect(entry).toContainText(STORY.logbook[0]!.title);
  const save = await savedJson(page);
  expect(save.story.logUnlocked).toEqual([STORY.logbook[0]!.id]);
  expect(save.story.quipHistory).toHaveLength(1);
  // "Read" opens the entry in the Ship's Log and marks it read.
  await page.waitForTimeout(1000);
  await entry.locator('[data-log]').click();
  await expect(page.locator('#screen-log .log-reader .log-title')).toHaveText(STORY.logbook[0]!.title);
  await expect(page.locator('#screen-log .log-reader')).toBeVisible();
  expect((await savedJson(page)).story.logSeen).toEqual([STORY.logbook[0]!.id]);
  expect(errors).toEqual([]);
});

test('a comms line appears at the start of a run', async ({ page }) => {
  const errors = trackErrors(page);
  await skipIntro(page);
  await page.goto('/');
  await page.locator('#screen-title [data-act="play"]').click();
  const comms = page.locator('#comms');
  await expect(comms).toBeVisible({ timeout: 3000 });
  // The run opens with the first sector's arrival sequence (a story line).
  await expect(comms).toHaveAttribute('data-source', 'sector:0');
  await expect(comms).toHaveClass(/prio-story/);
  await expect(comms.locator('.comms-name')).not.toBeEmpty();
  // The typewriter finishes the first line.
  const first = STORY.sectors[0]!.arrival[0]!.text;
  await expect(comms.locator('.comms-text')).toHaveText(first);
  await expect.poll(() => comms.locator('.comms-text .shown').textContent(), { timeout: 4000 }).toBe(first);
  // Comms never block input: the panel ignores pointer events.
  expect(await comms.evaluate((e) => getComputedStyle(e).pointerEvents)).toBe('none');
  expect(errors).toEqual([]);
});

test('the crew chatter setting persists and silences comms', async ({ page }) => {
  const errors = trackErrors(page);
  await skipIntro(page);
  await page.goto('/');
  await page.locator('#screen-title [data-act="settings"]').click();
  const select = page.locator('#set-chatter');
  await expect(select).toHaveValue('all');
  await select.selectOption('off');
  expect((await savedJson(page)).settings.chatter).toBe('off');
  await page.reload();
  await page.locator('#screen-title [data-act="settings"]').click();
  await expect(page.locator('#set-chatter')).toHaveValue('off');
  await page.locator('#screen-settings [data-act="back"]').click();
  await page.locator('#screen-title [data-act="play"]').click();
  await expect.poll(() => appState(page)).toBe('playing');
  await page.waitForTimeout(1500);
  await expect(page.locator('#comms')).toBeHidden();
  expect(errors).toEqual([]);
});

test('quitting from the pause menu reads as a retreat, without a game-over quip', async ({ page }) => {
  const errors = trackErrors(page);
  await skipIntro(page);
  await page.goto('/');
  await page.locator('#screen-title [data-act="play"]').click();
  await expect.poll(() => appState(page)).toBe('playing');
  await page.waitForTimeout(300);
  await page.locator('#pause-btn').click();
  await page.locator('#screen-pause [data-act="quit"]').click();
  const results = page.locator('#screen-results');
  await expect(results).toBeVisible();
  await expect(results.locator('.results-head .eyebrow')).toContainText(/retreated/i);
  await expect(results.locator('.res-quip')).toHaveCount(0);
  await expect(results.locator('.res-taunt')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a tap that skips the crawl does not also press the button underneath', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'touch click-through only happens on touch screens');
  const errors = trackErrors(page);
  await page.goto('/');
  await expect(page.locator('#crawl')).toBeVisible();
  // Where the title's Play button will appear once the crawl closes.
  const play = await page.evaluate(() => {
    const s = document.querySelector<HTMLElement>('#screen-title')!;
    s.hidden = false;
    const r = s.querySelector('[data-act="play"]')!.getBoundingClientRect();
    s.hidden = true;
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.waitForTimeout(900);
  await page.touchscreen.tap(play.x, play.y);
  await expect(page.locator('#crawl')).toHaveCount(0);
  await expect(page.locator('#screen-title')).toBeVisible();
  await page.waitForTimeout(400);
  expect(await appState(page)).toBe('title');
  expect(errors).toEqual([]);
});

test("a veteran save's Ship's Log is filled in on launch", async ({ page }) => {
  const errors = trackErrors(page);
  await page.addInitScript(() => {
    localStorage.setItem(
      'shardstorm.save',
      JSON.stringify({
        story: { introSeen: true },
        rank: 8,
        stats: { runs: 60, bestTime: 640, bestCombo: 300, victories: 3 },
        achievements: { warden: 1, hydra: 1, voidheart: 1 },
      }),
    );
  });
  await page.goto('/');
  await expect(page.locator('#screen-title [data-act="log"] .badge')).toContainText('NEW');
  expect((await savedJson(page)).story.logUnlocked.length).toBeGreaterThan(5);
  await page.locator('#screen-title [data-act="log"]').click();
  await expect(page.locator('#screen-log .log-row').first()).not.toHaveClass(/locked/);
  expect(errors).toEqual([]);
});

test("one Escape leaves the Ship's Log after reading an entry on a wide screen", async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'keyboard');
  await skipIntro(page);
  await page.goto('/');
  await page.locator('#screen-title [data-act="log"]').click();
  await page.locator('#screen-log [data-entry]').nth(2).click();
  await expect(page.locator('#screen-log .log-row').nth(2)).toHaveClass(/sel/);
  await page.keyboard.press('Escape');
  await expect(page.locator('#screen-title')).toBeVisible();
});

test('dying in Overtime after a victory never shows the boss "you lost" taunt', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'same code path on every device');
  const errors = trackErrors(page);
  await page.addInitScript(() => {
    if (!localStorage.getItem('shardstorm.save')) localStorage.setItem('shardstorm.save', JSON.stringify({ story: { introSeen: true }, tutorialDone: true }));
  });
  await page.goto('/?warp=3');
  await page.locator('#screen-title [data-act="play"]').click();
  type W = { time: number; boss: unknown; player: { x: number; y: number }; spawnEnemy(k: string, x: number, y: number): unknown };
  for (let i = 0; i < 40 && (await appState(page)) !== 'victory'; i++) {
    if ((await appState(page)) === 'levelup') await page.locator('#screen-levelup .offer').first().click();
    await page.evaluate(() => {
      const w = (window as unknown as { shardstorm: { world: W | null } }).shardstorm.world;
      if (w && w.time < 599) w.time = 599.8;
    });
    await page.waitForTimeout(250);
  }
  await expect(page.locator('#screen-victory')).toBeVisible();
  await page.waitForTimeout(800);
  await page.locator('#screen-victory [data-act="continue"]').click();
  await expect.poll(() => appState(page)).toBe('playing');
  await page.evaluate(() => {
    const w = (window as unknown as { shardstorm: { world: W } }).shardstorm.world;
    if (!w.boss) w.spawnEnemy('warden', w.player.x + 300, w.player.y);
  });
  expect(await page.evaluate(() => !!(window as unknown as { shardstorm: { world: W } }).shardstorm.world.boss)).toBe(true);
  await wipe(page);
  const results = page.locator('#screen-results');
  await expect(results).toBeVisible();
  await expect(results.locator('.results-head .eyebrow')).toContainText(/victory/i);
  await expect(results.locator('.res-taunt')).toHaveCount(0);
  await expect(results.locator('.res-quip')).toHaveCount(0);
  expect(errors).toEqual([]);
});
