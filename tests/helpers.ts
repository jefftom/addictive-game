import { Rng } from '../src/core/rng';
import { botInput, botResolvePending } from '../src/game/bot';
import { makeRunConfig, type RunConfigInput } from '../src/game/runconfig';
import type { ShipId } from '../src/game/types';
import { applyOffer } from '../src/game/upgrades';
import { World } from '../src/game/world';

export interface SimResult {
  seed: number;
  time: number;
  level: number;
  kills: number;
  score: number;
  maxCombo: number;
  bosses: string[];
  perfects: number;
  peakEnemies: number;
  enemiesAt: Record<number, number>;
  levelAt: Record<number, number>;
  firstLevelUpAt: number;
  weapons: string[];
  hitsTaken: number;
  cores: number;
  /** Pilot count (1 = solo). */
  players: number;
  /** Times any pilot went down (co-op). */
  downs: number;
  /** Teammate revives (co-op). */
  revives: number;
  /** Per-pilot builds (co-op; `weapons` is P1's). */
  builds: string[][];
}

export const DT = 1 / 60;

export type SimInput = Omit<Partial<RunConfigInput>, 'players'> & { seed: number; players?: ShipId[] };

/** Bot rng for pilot `pid` (solo keeps the original seed derivation). */
export function botRngFor(seed: number, pid: number, coop: boolean): Rng {
  return new Rng(coop ? seed ^ 0xabcdef ^ Math.imul(pid + 1, 0x9e3779b1) : seed ^ 0xabcdef);
}

/**
 * Plays one headless run with the bot until death (team wipe) or `maxTime`
 * seconds. `players` (ship ids) makes it a co-op run with one bot per pilot.
 */
export function simulateRun(input: SimInput, maxTime = 600, skill = 0.6): SimResult {
  const { players: ships, ...rest } = input;
  const coop = (ships?.length ?? 0) > 1;
  const world = new World(makeRunConfig({ ...rest, players: ships?.map((ship) => ({ ship })) }));
  const rngs = world.players.map((p) => botRngFor(input.seed, p.pid, coop));
  const rng = rngs[0]!;
  const enemiesAt: Record<number, number> = {};
  const levelAt: Record<number, number> = {};
  let peak = 0;
  let firstLevelUpAt = -1;
  let nextSample = 30;
  while (!world.gameOver && world.time < maxTime) {
    if (coop) world.update(DT, world.players.map((p) => botInput(world, rngs[p.pid]!, { skill }, p.pid)));
    else world.update(DT, botInput(world, rng, { skill }));
    if (firstLevelUpAt < 0 && world.level > 1) firstLevelUpAt = world.time;
    botResolvePending(world, rng, (o, pid) => applyOffer(world, o, pid));
    world.events.length = 0;
    peak = Math.max(peak, world.enemies.length);
    if (world.time >= nextSample) {
      enemiesAt[nextSample] = world.enemies.length;
      levelAt[nextSample] = world.level;
      nextSample += 30;
    }
  }
  return {
    seed: input.seed,
    time: world.time,
    level: world.level,
    kills: world.runStats.kills,
    score: world.score,
    maxCombo: world.runStats.maxCombo,
    bosses: world.runStats.bossesKilled,
    perfects: world.runStats.perfects,
    peakEnemies: peak,
    enemiesAt,
    levelAt,
    firstLevelUpAt,
    weapons: world.players[0]!.build.weapons.map((w) => `${w.id}${w.evolved ? '*' : w.level}`),
    hitsTaken: world.runStats.hitsTaken,
    cores: world.runStats.coresCollected,
    players: world.players.length,
    downs: world.players.reduce((n, p) => n + p.run.downs, 0),
    revives: world.players.reduce((n, p) => n + p.run.revivesGiven, 0),
    builds: world.players.map((p) => p.build.weapons.map((w) => `${w.id}${w.evolved ? '*' : w.level}`)),
  };
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
