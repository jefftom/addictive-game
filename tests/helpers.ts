import { Rng } from '../src/core/rng';
import { botInput, botResolvePending } from '../src/game/bot';
import { makeRunConfig, type RunConfigInput } from '../src/game/runconfig';
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
}

export const DT = 1 / 60;

/** Plays one headless run with the bot until death or `maxTime` seconds. */
export function simulateRun(
  input: Partial<RunConfigInput> & { seed: number },
  maxTime = 600,
  skill = 0.6,
): SimResult {
  const world = new World(makeRunConfig(input));
  const rng = new Rng(input.seed ^ 0xabcdef);
  const enemiesAt: Record<number, number> = {};
  const levelAt: Record<number, number> = {};
  let peak = 0;
  let firstLevelUpAt = -1;
  let nextSample = 30;
  while (!world.gameOver && world.time < maxTime) {
    world.update(DT, botInput(world, rng, { skill }));
    if (firstLevelUpAt < 0 && world.level > 1) firstLevelUpAt = world.time;
    botResolvePending(world, rng, (o) => applyOffer(world, o));
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
    weapons: world.build.weapons.map((w) => `${w.id}${w.evolved ? '*' : w.level}`),
    hitsTaken: world.runStats.hitsTaken,
    cores: world.runStats.coresCollected,
  };
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
