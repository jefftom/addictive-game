import { describe, expect, it } from 'vitest';
import { formatTime } from '../src/core/math';
import { median, simulateRun, type SimResult } from './helpers';

/**
 * Balance report. Not part of the regular test suite; run with `npm run sim`.
 * Prints survival, pacing, and enemy density for a batch of bot runs.
 */
function report(label: string, results: SimResult[]): void {
  const times = results.map((r) => r.time);
  console.log(`\n=== ${label} (${results.length} runs) ===`);
  console.log(`survival  median ${formatTime(median(times))}  min ${formatTime(Math.min(...times))}  max ${formatTime(Math.max(...times))}`);
  console.log(`first level-up median ${median(results.map((r) => r.firstLevelUpAt)).toFixed(1)}s`);
  console.log(`level @60s median ${median(results.map((r) => r.levelAt[60] ?? r.level))}`);
  console.log(`score median ${Math.round(median(results.map((r) => r.score)))}  kills median ${median(results.map((r) => r.kills))}`);
  console.log(`max combo median ${median(results.map((r) => r.maxCombo))}  perfects median ${median(results.map((r) => r.perfects))}`);
  const bossKills = results.filter((r) => r.bosses.length > 0).length;
  console.log(`runs that killed >=1 boss: ${bossKills}/${results.length}`);
  for (const t of [60, 120, 180, 300, 420, 540]) {
    const xs = results.map((r) => r.enemiesAt[t]).filter((x): x is number => x !== undefined);
    const ls = results.map((r) => r.levelAt[t]).filter((x): x is number => x !== undefined);
    if (xs.length) console.log(`  t=${formatTime(t)} alive=${xs.length}  enemies median ${median(xs)}  level median ${median(ls)}`);
  }
  for (const r of results) {
    console.log(
      `  seed ${r.seed}: ${formatTime(r.time)} L${r.level} kills ${r.kills} score ${r.score} combo ${r.maxCombo} bosses [${r.bosses.join(',')}] peak ${r.peakEnemies} hits ${r.hitsTaken} weapons ${r.weapons.join(' ')}`,
    );
  }
}

const RUNS = Number(process.env.SIM_RUNS ?? 12);
const SKILL = Number(process.env.SIM_SKILL ?? 0.6);

describe('balance simulation', () => {
  it('fresh save, Spark', () => {
    const results: SimResult[] = [];
    for (let i = 0; i < RUNS; i++) results.push(simulateRun({ seed: 1000 + i, rank: 1 }, 660, SKILL));
    report(`fresh save (skill ${SKILL})`, results);
    expect(results.length).toBe(RUNS);
  });

  it('fresh save, clumsy player', () => {
    const results: SimResult[] = [];
    for (let i = 0; i < RUNS; i++) results.push(simulateRun({ seed: 3000 + i, rank: 1 }, 660, 0.3));
    report('fresh save (skill 0.3)', results);
    expect(results.length).toBe(RUNS);
  });

  it('veteran save (rank 8, workshop half upgraded)', () => {
    const workshop = { hull: 3, might: 3, reach: 3, haste: 2, growth: 3, greed: 2, reflex: 2, recovery: 1, armor: 1, reroll: 1 };
    const results: SimResult[] = [];
    for (let i = 0; i < RUNS; i++) results.push(simulateRun({ seed: 2000 + i, rank: 8, workshop }, 660, SKILL));
    report(`veteran save (skill ${SKILL})`, results);
    expect(results.length).toBe(RUNS);
  });
});
