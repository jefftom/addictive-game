import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { defaultSave } from '../src/meta/save';
import { StoryDirector, type CommsMessage } from '../src/story/director';
import { checkLogbook, logbookFraction, logbookHint, logbookView } from '../src/story/logbook';
import { STORY } from '../src/story/script';
import { castRole, signatureLine } from '../src/ui/cast';
import { focusScore } from '../src/ui/dom';

/** Runs the director with `ships`, fires low-HP signals for `player` and returns every message shown. */
function lowHpLines(ships: ('spark' | 'phantom')[], player: number, seed: number): CommsMessage[] {
  const d = new StoryDirector(new Rng(seed));
  d.startRun({ ships, coop: ships.length > 1, opening: false });
  const shown: CommsMessage[] = [];
  for (let i = 0; i < 12; i++) {
    d.signal({ kind: 'lowHp', player });
    for (let t = 0; t < 30; t += 0.25) {
      d.update(0.25);
      shown.push(...d.consumeShown());
    }
  }
  return shown.filter((m) => m.source === 'low_hp');
}

describe('comms speaker player index', () => {
  it('tags the right pilot when two pilots fly the same ship', () => {
    let captainLines = 0;
    for (const player of [0, 1]) {
      for (let seed = 1; seed <= 6; seed++) {
        for (const m of lowHpLines(['spark', 'spark'], player, seed)) {
          if (m.ship === 'spark') {
            captainLines++;
            expect(m.player).toBe(player);
          }
        }
      }
    }
    // The low-HP pool mixes captain and crew lines; make sure captains were exercised.
    expect(captainLines).toBeGreaterThan(5);
  });

  it('is null for crew and villain lines, and the pilot index for solo captain lines', () => {
    const all = [1, 2, 3].flatMap((seed) => lowHpLines(['phantom'], 0, seed));
    expect(all.length).toBeGreaterThan(0);
    for (const m of all) expect(m.player).toBe(m.ship === null ? null : 0);
  });
});

describe('Ship\'s Log presentation', () => {
  it('writes boss hints mid-sentence ("Defeat the Warden")', () => {
    const boss = STORY.logbook.filter((e) => e.unlock.kind === 'boss');
    expect(boss.length).toBeGreaterThan(0);
    for (const e of boss) expect(logbookHint(e)).toMatch(/^Defeat the [A-Z]/);
  });

  it('starts a rank goal at an empty bar (rank starts at 1)', () => {
    const rank = STORY.logbook.find((e) => e.unlock.kind === 'rank')!;
    const goal = Number(rank.unlock.value);
    expect(logbookFraction(rank, 1, goal)).toBe(0);
    expect(logbookFraction(rank, goal, goal)).toBe(1);
    const runs = STORY.logbook.find((e) => e.unlock.kind === 'runs' && Number(e.unlock.value) > 1)!;
    expect(logbookFraction(runs, 0, Number(runs.unlock.value))).toBe(0);
    expect(logbookFraction(runs, 1, Number(runs.unlock.value))).toBeGreaterThan(0);
  });

  it('back-fills entries for a veteran save that predates the log', () => {
    const save = defaultSave();
    save.stats.runs = 60;
    save.stats.bestTime = 640;
    save.stats.bestCombo = 300;
    save.stats.victories = 3;
    save.rank = 8;
    save.achievements = { warden: 1, hydra: 1, voidheart: 1 };
    const got = checkLogbook(save);
    expect(got.length).toBeGreaterThan(5);
    const view = logbookView(save);
    for (const r of view) if (r.progress[0] >= r.progress[1]) expect(r.unlocked).toBe(true);
    // Idempotent: a second check finds nothing new.
    expect(checkLogbook(save)).toEqual([]);
  });

  it('drops role text the name already says and keeps player-facing quotes', () => {
    expect(castRole({ name: 'Chief Engineer Gus Gasket', role: 'Chief engineer; runs the Workshop' })).toBe('Runs the Workshop');
    expect(castRole({ name: 'Captain Ambrose Starling', role: 'Captain of the Glimmer of Hope (spark)' })).toBe('Captain of the Glimmer of Hope');
    for (const c of STORY.characters) {
      const q = signatureLine(c.id);
      expect(q.length, c.id).toBeGreaterThan(0);
      expect(q).not.toContain(c.voice);
    }
  });
});

describe('spatial focus navigation', () => {
  const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height });

  it('prefers the next row over a centred button further away', () => {
    const daily = rect(0, 0, 400, 50); // wide button
    const hangar = rect(0, 60, 195, 50); // half, next row, left
    const settings = rect(0, 240, 400, 50); // wide, three rows down
    expect(focusScore(daily, hangar, 0, 1)).toBeLessThan(focusScore(daily, settings, 0, 1));
    // And back up from the wide Settings button to the row right above it.
    const records = rect(205, 180, 195, 50);
    expect(focusScore(settings, records, 0, -1)).toBeLessThan(focusScore(settings, daily, 0, -1));
  });

  it('moves right to a panel beside the list rather than a tab above it', () => {
    const row = rect(100, 300, 360, 40);
    const reader = rect(475, 190, 705, 360);
    const tab = rect(262, 132, 170, 36);
    expect(focusScore(row, reader, 1, 0)).toBeLessThan(focusScore(row, tab, 1, 0));
  });

  it('ignores items behind or level with the current one', () => {
    expect(focusScore(rect(0, 100, 50, 50), rect(0, 0, 50, 50), 0, 1)).toBe(Infinity);
    expect(focusScore(rect(0, 0, 50, 50), rect(100, 0, 50, 50), 0, 1)).toBe(Infinity);
  });
});
