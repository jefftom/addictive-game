import type { EnemyKind, ShipId } from '../game/types';
import type { World } from '../game/world';

/** One pilot's line on the co-op results screen. */
export interface PilotResult {
  ship: ShipId;
  kills: number;
  damage: number;
  perfects: number;
  dashKills: number;
  downs: number;
  revivesGiven: number;
  maxWeapons: number;
  evolutions: number;
}

/** Everything the meta layer needs to know about a finished (or in-progress) run. */
export interface RunResult {
  score: number;
  time: number;
  level: number;
  kills: number;
  elites: number;
  bossesKilled: EnemyKind[];
  dashKills: number;
  /** Perfect dashes. Co-op: the best single pilot (keeps "N perfect dashes in one run" honest). */
  perfects: number;
  gems: number;
  maxCombo: number;
  evolutions: number;
  coresCollected: number;
  hitsTaken: number;
  longestNoHit: number;
  /** Most weapons held at once (co-op: by any one pilot). */
  maxWeapons: number;
  victory: boolean;
  daily: boolean;
  /** Date (YYYY-MM-DD) whose Daily Run this was; a run can end after midnight. */
  dailyDate?: string;
  /** P1's ship. */
  ship: ShipId;
  hard: boolean;
  /** Core multiplier (co-op: the best on the team). */
  coreGain: number;
  /** Pilots in the run; absent = solo. */
  players?: number;
  /** Co-op: one entry per pilot, in pid order. */
  team?: PilotResult[];
  /** Co-op: team total of perfect dashes (lifetime stat). */
  perfectsTeam?: number;
  /**
   * Co-op: team score divided by the spawn multiplier, so cores and rank XP
   * track a solo-equivalent run (co-op is not a core farm).
   */
  scoreNorm?: number;
}

export function resultFromWorld(world: World): RunResult {
  const s = world.runStats;
  const ps = world.players;
  const p1 = ps[0]!;
  let coreGain = p1.stats.coreGain;
  for (const p of ps) coreGain = Math.max(coreGain, p.stats.coreGain);
  const out: RunResult = {
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
    coreGain,
  };
  if (!world.coop) return out;
  const team = ps.map(
    (p): PilotResult => ({
      ship: p.ship,
      kills: p.run.kills,
      damage: Math.round(p.run.damage),
      perfects: p.run.perfects,
      dashKills: p.run.dashKills,
      downs: p.run.downs,
      revivesGiven: p.run.revivesGiven,
      maxWeapons: p.run.maxWeapons,
      evolutions: p.run.evolutions,
    }),
  );
  out.players = ps.length;
  out.team = team;
  out.perfectsTeam = s.perfects;
  out.perfects = Math.max(0, ...team.map((t) => t.perfects));
  out.maxWeapons = Math.max(1, ...team.map((t) => t.maxWeapons));
  out.scoreNorm = Math.floor(world.score / world.scaling.spawn);
  out.daily = false;
  return out;
}

/** Pilot count of a result (1 = solo). */
export function pilotCount(r: RunResult): number {
  return Math.max(1, r.players ?? 1);
}

export function isCoopResult(r: RunResult): boolean {
  return pilotCount(r) > 1;
}
