import type { RunResult } from './result';
import type { SaveData } from './save';

export interface AchievementDef {
  id: string;
  name: string;
  text: string;
  /** Checked after every run (with the run) and after purchases (without one). */
  check: (save: SaveData, run: RunResult | null) => boolean;
  /** Progress (current, goal) shown on locked ships and in Records. */
  progress?: (save: SaveData) => [number, number];
}

const has = (run: RunResult | null, f: (r: RunResult) => boolean) => (run ? f(run) : false);

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_run', name: 'Into the Storm', text: 'Finish your first run', check: (s) => s.stats.runs >= 1 },
  {
    id: 'survive3', name: 'Gatecrasher', text: 'Survive 3:00 in a run (unlocks the Immovable Object)',
    check: (s) => s.stats.bestTime >= 180, progress: (s) => [Math.min(180, Math.floor(s.stats.bestTime)), 180],
  },
  { id: 'survive5', name: 'Holding the Line', text: 'Survive 5:00 in a run', check: (s) => s.stats.bestTime >= 300, progress: (s) => [Math.min(300, Math.floor(s.stats.bestTime)), 300] },
  { id: 'victory', name: 'Eye of the Storm', text: 'Survive 10:00', check: (s) => s.stats.victories >= 1 },
  {
    id: 'combo150', name: 'Chain Reaction', text: 'Reach a 150 combo (unlocks the Already Gone)',
    // bestCombo is solo-only, so the run itself also counts (a co-op team combo unlocks it).
    check: (s, r) => s.stats.bestCombo >= 150 || has(r, (x) => x.maxCombo >= 150), progress: (s) => [Math.min(150, s.stats.bestCombo), 150],
  },
  { id: 'combo500', name: 'Unbroken', text: 'Reach a 500 combo', check: (s, r) => s.stats.bestCombo >= 500 || has(r, (x) => x.maxCombo >= 500), progress: (s) => [Math.min(500, s.stats.bestCombo), 500] },
  { id: 'warden', name: 'Gatekeeper', text: 'Defeat the Warden (unlocks the Big Warm Hug)', check: (_s, r) => has(r, (x) => x.bossesKilled.includes('warden')) },
  { id: 'hydra', name: 'Spiral Breaker', text: 'Defeat the Hydra', check: (_s, r) => has(r, (x) => x.bossesKilled.includes('hydra')) },
  { id: 'voidheart', name: 'Heartstopper', text: 'Defeat the Void Heart', check: (_s, r) => has(r, (x) => x.bossesKilled.includes('voidheart')) },
  {
    id: 'perfect10', name: 'Untouchable Grace', text: '10 perfect dashes in one run (unlocks the Definitely Not Here)',
    check: (_s, r) => has(r, (x) => x.perfects >= 10),
  },
  { id: 'evolve', name: 'Metamorphosis', text: 'Evolve a weapon', check: (s) => s.stats.evolutions >= 1 },
  { id: 'arsenal', name: 'Full Arsenal', text: 'Hold 4 weapons at once', check: (_s, r) => has(r, (x) => x.maxWeapons >= 4) },
  { id: 'kills1k', name: 'Thousand Cuts', text: 'Destroy 1,000 enemies in total', check: (s) => s.stats.kills >= 1000, progress: (s) => [Math.min(1000, s.stats.kills), 1000] },
  { id: 'kills10k', name: 'Shardstorm', text: 'Destroy 10,000 enemies in total', check: (s) => s.stats.kills >= 10000, progress: (s) => [Math.min(10000, s.stats.kills), 10000] },
  { id: 'nohit2', name: 'Ghost', text: 'Go 2:00 without taking damage', check: (_s, r) => has(r, (x) => x.longestNoHit >= 120) },
  { id: 'daily3', name: 'Ritual', text: 'Reach a 3-day Daily Run streak', check: (s) => s.daily.streak >= 3, progress: (s) => [Math.min(3, s.daily.streak), 3] },
  { id: 'investor', name: 'Investor', text: 'Buy 10 workshop upgrades', check: (s) => s.stats.upgradesBought >= 10, progress: (s) => [Math.min(10, s.stats.upgradesBought), 10] },
  { id: 'score100k', name: 'Six Figures', text: 'Score 100,000 in one run', check: (s) => s.stats.bestScore >= 100000 },
  { id: 'level30', name: 'Ascendant', text: 'Reach level 30 in a run', check: (s) => s.stats.bestLevel >= 30 },
  { id: 'rank10', name: 'Veteran', text: 'Reach rank 10', check: (s) => s.rank >= 10, progress: (s) => [Math.min(10, s.rank), 10] },
  { id: 'nightmare', name: 'Nightmare Walker', text: 'Survive 5:00 on Nightmare', check: (_s, r) => has(r, (x) => x.hard && x.time >= 300) },
  // Co-op (ids match the Steam names ACH_SQUAD / ACH_MEDIC in src/platform/achievements.ts).
  { id: 'squad', name: 'Squad Goals', text: 'Win a co-op run', check: (s) => s.coop.victories >= 1 },
  {
    id: 'medic', name: 'No Pilot Left Behind', text: 'Revive teammates 10 times',
    check: (s) => s.coop.revives >= 10, progress: (s) => [Math.min(10, s.coop.revives), 10],
  },
];

export function achievementDef(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.id === id);
}

/** Unlocks any newly earned achievements; returns their definitions. */
export function checkAchievements(save: SaveData, run: RunResult | null, now = Date.now()): AchievementDef[] {
  const out: AchievementDef[] = [];
  for (const a of ACHIEVEMENTS) {
    if (save.achievements[a.id]) continue;
    if (a.check(save, run)) {
      save.achievements[a.id] = now;
      out.push(a);
    }
  }
  return out;
}
