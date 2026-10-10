/**
 * Ship's Log: which logbook entries the player has unlocked, evaluated from the
 * save's existing meta data (stats, achievements, rank) plus `save.story`.
 *
 * App usage: after applyRun(save, result) call checkLogbook(save, { coopRun })
 * and show a "New log entry" toast for each returned entry; then writeSave(save).
 */
import type { ShipId } from '../game/types';
import { isShipUnlocked } from '../meta/progression';
import { normalizeStoryState, type SaveData, type StoryState } from '../meta/save';
import { pushQuipHistory } from './director';
import { BOSS_IDS, STORY, type BossId, type LogbookEntry } from './script';

/** Extra facts the save does not (yet) record. */
export interface LogbookContext {
  /** Total co-op runs finished. If omitted, read from save.stats.coopRuns when present. */
  coopRuns?: number;
  /** True when the run just finished was co-op (counts as at least one co-op run). */
  coopRun?: boolean;
}

/** Returns save.story, creating/normalising it in place when missing. */
export function storyState(save: SaveData): StoryState {
  if (!save.story) save.story = normalizeStoryState(undefined);
  return save.story;
}

function coopRuns(save: SaveData, ctx: LogbookContext): number {
  // Forward-compatible with a co-op stats counter added by the co-op save change.
  const fromSave = (save.stats as unknown as Record<string, unknown>)['coopRuns'];
  const saved = typeof fromSave === 'number' && Number.isFinite(fromSave) ? fromSave : 0;
  return Math.max(ctx.coopRuns ?? 0, saved, ctx.coopRun ? 1 : 0);
}

const isBossId = (v: unknown): v is BossId => typeof v === 'string' && (BOSS_IDS as readonly string[]).includes(v);
const SHIP_IDS: readonly string[] = Object.keys(STORY.pilots);

/** Current progress toward an entry's unlock as [current, goal] (boss/ship kinds are 0 or 1). */
export function logbookProgress(entry: LogbookEntry, save: SaveData, ctx: LogbookContext = {}): [number, number] {
  const { kind, value } = entry.unlock;
  const goal = typeof value === 'number' ? value : 1;
  const s = save.stats;
  let cur: number;
  switch (kind) {
    case 'runs':
      cur = s.runs;
      break;
    case 'time':
      cur = Math.floor(s.bestTime);
      break;
    case 'combo':
      cur = s.bestCombo;
      break;
    case 'rank':
      cur = save.rank;
      break;
    case 'victory':
      cur = s.victories;
      break;
    case 'coop':
      cur = coopRuns(save, ctx);
      break;
    case 'boss':
      // Boss achievements share the boss ids ('warden', 'hydra', 'voidheart').
      cur = isBossId(value) && save.achievements[value] ? 1 : 0;
      break;
    case 'ship':
      cur = typeof value === 'string' && SHIP_IDS.includes(value) && isShipUnlocked(save, value as ShipId) ? 1 : 0;
      break;
  }
  return [Math.min(cur, goal), goal];
}

/**
 * Progress bar fill in [0, 1]. Rank starts at 1, so a rank goal counts from there
 * (a fresh save shows an empty bar for "Reach rank 3", not a third of one).
 */
export function logbookFraction(entry: LogbookEntry, cur: number, goal: number): number {
  const base = entry.unlock.kind === 'rank' ? 1 : 0;
  if (goal <= base) return cur >= goal ? 1 : 0;
  return Math.min(1, Math.max(0, (cur - base) / (goal - base)));
}

export function isLogbookEntryMet(entry: LogbookEntry, save: SaveData, ctx: LogbookContext = {}): boolean {
  const [cur, goal] = logbookProgress(entry, save, ctx);
  return cur >= goal;
}

/** Unlocks every newly earned entry (mutates save.story.logUnlocked); returns them in script order. */
export function checkLogbook(save: SaveData, ctx: LogbookContext = {}): LogbookEntry[] {
  const st = storyState(save);
  const have = new Set(st.logUnlocked);
  const out: LogbookEntry[] = [];
  for (const e of STORY.logbook) {
    if (have.has(e.id) || !isLogbookEntryMet(e, save, ctx)) continue;
    st.logUnlocked.push(e.id);
    out.push(e);
  }
  return out;
}

export interface LogbookRow {
  entry: LogbookEntry;
  unlocked: boolean;
  seen: boolean;
  progress: [number, number];
}

/** All entries in script order with lock/seen state (for the Ship's Log menu). */
export function logbookView(save: SaveData, ctx: LogbookContext = {}): LogbookRow[] {
  const st = save.story ?? normalizeStoryState(undefined);
  const unlocked = new Set(st.logUnlocked);
  const seen = new Set(st.logSeen);
  return STORY.logbook.map((entry) => ({
    entry,
    unlocked: unlocked.has(entry.id),
    seen: seen.has(entry.id),
    progress: logbookProgress(entry, save, ctx),
  }));
}

/** Human-readable unlock hint for a locked entry. */
export function logbookHint(entry: LogbookEntry): string {
  const { kind, value } = entry.unlock;
  const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  switch (kind) {
    case 'runs':
      return value === 1 ? 'Finish your first run' : `Finish ${value} runs`;
    case 'time':
      return `Survive ${mmss(Number(value))} in a run`;
    case 'combo':
      return `Reach a ${value} combo`;
    case 'rank':
      return `Reach rank ${value}`;
    case 'victory':
      return value === 1 ? 'Win a run (survive 10:00)' : `Win ${value} runs`;
    case 'coop':
      return value === 1 ? 'Finish a co-op run' : `Finish ${value} co-op runs`;
    case 'boss': {
      const c = STORY.characters.find((ch) => ch.id === value);
      // Mid-sentence: "Defeat the Warden", not "Defeat The Warden".
      return `Defeat ${(c ? c.name : String(value)).replace(/^The /, 'the ')}`;
    }
    case 'ship': {
      const ship = value as ShipId;
      const v = STORY.vessels[ship];
      return v ? `Unlock ${v.shipName}` : `Unlock ${String(value)}`;
    }
  }
}

export function markLogSeen(save: SaveData, id: string): void {
  const st = storyState(save);
  if (st.logUnlocked.includes(id) && !st.logSeen.includes(id)) st.logSeen.push(id);
}

/** Unlocked entries the player has not opened yet (for a menu badge). */
export function unseenLogCount(save: SaveData): number {
  const st = save.story;
  if (!st) return 0;
  const seen = new Set(st.logSeen);
  return st.logUnlocked.filter((id) => !seen.has(id)).length;
}

export function markIntroSeen(save: SaveData): void {
  storyState(save).introSeen = true;
}

/** Records a shown game-over quip key (see pickGameOverQuip) in the save. */
export function recordQuip(save: SaveData, key: string, max = 16): void {
  const st = storyState(save);
  st.quipHistory = pushQuipHistory(st.quipHistory, key, max);
}
