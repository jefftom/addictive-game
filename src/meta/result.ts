import type { EnemyKind, ShipId } from '../game/types';
import type { World } from '../game/world';

/** Everything the meta layer needs to know about a finished (or in-progress) run. */
export interface RunResult {
  score: number;
  time: number;
  level: number;
  kills: number;
  elites: number;
  bossesKilled: EnemyKind[];
  dashKills: number;
  perfects: number;
  gems: number;
  maxCombo: number;
  evolutions: number;
  coresCollected: number;
  hitsTaken: number;
  longestNoHit: number;
  maxWeapons: number;
  victory: boolean;
  daily: boolean;
  /** Date (YYYY-MM-DD) whose Daily Run this was; a run can end after midnight. */
  dailyDate?: string;
  ship: ShipId;
  hard: boolean;
  coreGain: number;
}

export function resultFromWorld(world: World): RunResult {
  const s = world.runStats;
  return {
    score: Math.floor(world.score),
    time: world.time,
    level: world.level,
    kills: s.kills,
    elites: s.elites,
    bossesKilled: [...s.bossesKilled],
    dashKills: s.dashKills,
    perfects: s.perfects,
    gems: s.gems,
    maxCombo: s.maxCombo,
    evolutions: s.evolutions,
    coresCollected: s.coresCollected,
    hitsTaken: s.hitsTaken,
    longestNoHit: s.longestNoHit,
    maxWeapons: s.maxWeapons,
    victory: world.victory,
    daily: world.cfg.daily !== null,
    ship: world.cfg.ship,
    hard: world.cfg.hardMode,
    coreGain: world.stats.coreGain,
  };
}
