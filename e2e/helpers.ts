import type { Page } from '@playwright/test';

/**
 * Marks the opening briefing (story crawl) as already seen, so tests that are
 * not about the story start straight on the title screen. Only seeds a save
 * when none exists, so reloads inside a test keep the game's own progress.
 */
export async function skipIntro(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      if (!localStorage.getItem('shardstorm.save')) {
        localStorage.setItem('shardstorm.save', JSON.stringify({ story: { introSeen: true } }));
      }
    } catch {
      /* storage unavailable */
    }
  });
}
