import type { TrailId } from './save';

/** Rank XP needed to go from `rank` to `rank + 1`. */
export function rankXpNeeded(rank: number): number {
  const r = rank - 1;
  return 500 + 300 * r + 60 * r * r;
}

export function rankXpForRun(score: number, time: number): number {
  return Math.round(Math.sqrt(Math.max(0, score)) * 3 + time * 1.5);
}

export function rankCoreBonus(rank: number): number {
  return 15 + 5 * rank;
}

/** What reaching `rank` unlocks (shown on rank-up). */
export function rankReward(rank: number): string {
  switch (rank) {
    case 2:
      return 'Seeker Swarm joins the upgrade pool';
    case 3:
      return 'Relics can now appear in level-ups';
    case 4:
      return 'Gravity Mines joins the upgrade pool';
    case 5:
      return 'Prism Lance joins the upgrade pool';
    case 6:
      return '+1 reroll in every run';
    case 7:
      return 'Nightmare mode unlocked (settings)';
    case 8:
      return 'Ember trail unlocked';
    case 10:
      return 'Aurora trail unlocked';
    case 12:
      return 'Prism trail unlocked';
    default:
      return `+${rankCoreBonus(rank)} cores`;
  }
}

export const TRAILS: Record<TrailId, { name: string; color: string; rank: number }> = {
  default: { name: 'Ice', color: '#7ff9ff', rank: 1 },
  ember: { name: 'Ember', color: '#ff8c42', rank: 8 },
  aurora: { name: 'Aurora', color: '#6dff8a', rank: 10 },
  prism: { name: 'Prism', color: '#ff4fd2', rank: 12 },
};

export const HARD_MODE_RANK = 7;
