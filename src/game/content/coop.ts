/**
 * Local co-op tuning. Every N = 1 multiplier is exactly 1, so applying the row
 * in solo is free (x * 1 === x in IEEE-754) and solo play stays bit-identical.
 */
export interface CoopScaling {
  /** Spawn budget rate and budget cap multiplier. */
  spawn: number;
  /** Non-boss enemy HP multiplier. */
  hp: number;
  /** Boss HP multiplier. */
  bossHp: number;
  /** XP needed per level multiplier (keeps each pilot's level pace near solo). */
  xpReq: number;
  /** Elite interval multiplier (< 1 = more often). */
  eliteEvery: number;
  /** Surge ring size multiplier. */
  surge: number;
  /** Opening wave size multiplier. */
  opening: number;
  /** Live enemy cap. */
  maxEnemies: number;
}

export const COOP_SCALING: Record<1 | 2 | 3 | 4, CoopScaling> = {
  1: { spawn: 1, hp: 1, bossHp: 1, xpReq: 1, eliteEvery: 1, surge: 1, opening: 1, maxEnemies: 420 },
  2: { spawn: 1.6, hp: 1.3, bossHp: 1.9, xpReq: 1.6, eliteEvery: 0.8, surge: 1.35, opening: 1.5, maxEnemies: 500 },
  3: { spawn: 2.15, hp: 1.45, bossHp: 2.5, xpReq: 2.15, eliteEvery: 0.68, surge: 1.65, opening: 2, maxEnemies: 560 },
  4: { spawn: 2.6, hp: 1.6, bossHp: 3.2, xpReq: 2.6, eliteEvery: 0.6, surge: 1.9, opening: 2.4, maxEnemies: 600 },
};

export const coopScaling = (n: number): CoopScaling =>
  COOP_SCALING[Math.min(4, Math.max(1, Math.floor(n))) as 1 | 2 | 3 | 4];

export const MAX_PLAYERS = 4;
/** Co-op start positions: x = (i - (n - 1) / 2) * SPAWN_SPACING. */
export const SPAWN_SPACING = 70;
/** A teammate this close to a downed pilot revives them. */
export const REVIVE_RADIUS = 70;
/** Seconds to revive on the first down. */
export const REVIVE_TIME = 2.5;
/** Extra fraction of REVIVE_TIME per previous down of the same pilot. */
export const REVIVE_GROWTH = 0.5;
export const REVIVE_TIME_MAX = 6;
/** Revive progress lost per second while nobody is near (relative to real time). */
export const REVIVE_DECAY = 0.5;
/** Fraction of max HP restored on revive. */
export const REVIVE_HP = 0.4;
export const REVIVE_INVULN = 2;
/** Ghost (downed) drift speed as a fraction of normal move speed. */
export const GHOST_SPEED = 0.55;
/** An enemy switches target only if the new one is closer than this fraction of the current distance. */
export const TARGET_HYSTERESIS = 0.85;
export const ZOOM_MAX = 1.45;
/** World units kept around the player bounding box when zooming. */
export const CAM_MARGIN = 160;
/** Minimum distance from a player to the view edge at max zoom (leash). */
export const LEASH_EDGE = 70;
export const ZOOM_OUT_RATE = 4;
export const ZOOM_IN_RATE = 1.2;
/** Co-op spawn points must be at least this far from every active player. */
export const SPAWN_CLEARANCE = 220;
/** Retries (extra posRng draws) a co-op spawn point may take to honour SPAWN_CLEARANCE. */
export const SPAWN_RETRIES = 3;

/**
 * Pilot identity colours (index = pid). Cool hues kept away from the warm enemy
 * palette and from the Shooter (pink) and Dasher (yellow) enemy colours. Each
 * pilot also gets a shape mark so colour-blind players can tell them apart.
 * Shared by the UI (lobby, level-up, results) and the co-op renderer/HUD.
 */
export const PLAYER_COLORS = ['#7ff9ff', '#b4ff6a', '#5aa8ff', '#f5f0ff'] as const;
export const PLAYER_MARKS = ['▲', '●', '■', '◆'] as const;
