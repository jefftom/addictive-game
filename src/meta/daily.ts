import { dateKey, daysBetween, hashString } from '../core/rng';
import { DAILY_MODIFIERS, type DailyModifierDef } from '../game/content/workshop';
import type { SaveData } from './save';

export interface DailyInfo {
  date: string;
  seed: number;
  modifier: DailyModifierDef;
}

export function dailyInfo(date: string = dateKey()): DailyInfo {
  const seed = hashString(`shardstorm-daily-${date}`);
  const modifier = DAILY_MODIFIERS[seed % DAILY_MODIFIERS.length]!;
  return { date, seed, modifier };
}

/** Streak as it would be displayed today (0 if it has lapsed). */
export function currentStreak(save: SaveData, today: string = dateKey()): number {
  if (!save.daily.last) return 0;
  const gap = daysBetween(save.daily.last, today);
  return gap <= 1 ? save.daily.streak : 0;
}

export function playedDailyToday(save: SaveData, today: string = dateKey()): boolean {
  return save.daily.last === today;
}

/** Bonus cores for completing a Daily Run at the given streak. */
export function dailyBonus(streak: number): number {
  return Math.min(60, 10 + streak * 5);
}

/** Records a completed Daily Run. Returns the new streak and whether this was the first daily today. */
export function recordDaily(save: SaveData, score: number, today: string = dateKey()): { streak: number; first: boolean; best: boolean } {
  const first = save.daily.last !== today;
  if (first) {
    const gap = save.daily.last ? daysBetween(save.daily.last, today) : Infinity;
    save.daily.streak = gap === 1 ? save.daily.streak + 1 : 1;
    save.daily.last = today;
  }
  const prev = save.daily.best[today] ?? 0;
  const best = score > prev;
  if (best) save.daily.best[today] = score;
  // Keep the last 30 days only.
  const keys = Object.keys(save.daily.best).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - 30))) delete save.daily.best[k];
  return { streak: save.daily.streak, first, best };
}
