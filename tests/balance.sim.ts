import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
  for (const [label, count] of [['Warden killed', results.filter(r => r.bosses.includes('warden')).length], ['reached 10:00', results.filter(r => r.time >= 600).length]] as const) {
    console.log(`${label}: ${count}/${results.length} (${(100 * count / results.length).toFixed(1)}%)`);
  }
  const ticks = results.flatMap(r => r.tickMs).sort((a, b) => a - b);
  if (ticks.length) console.log(`world.update at >=350 enemies: mean ${(ticks.reduce((a, b) => a + b, 0) / ticks.length).toFixed(3)}ms p95 ${ticks[Math.floor(ticks.length * 0.95)]!.toFixed(3)}ms (${ticks.length} ticks)`);
  if (results.some((r) => r.players > 1)) {
    const firstDownWipes = results.filter((r) => r.downs <= 1 && r.time < 600).length;
    const fights = results.filter(r => r.wardenSpawnAt >= 0 && r.bosses.includes('warden')).map(r => r.bossKillAt[r.bosses.indexOf('warden')]! - r.wardenSpawnAt);
    console.log(`Warden fight duration median ${fights.length ? median(fights).toFixed(1) : 'n/a'}s`);
    console.log(
      `co-op: downs median ${median(results.map((r) => r.downs))}  revives median ${median(results.map((r) => r.revives))}  runs ending on the first down: ${firstDownWipes}/${results.length}`,
    );
  }
  for (const t of [60, 120, 180, 300, 420, 540]) {
    const xs = results.map((r) => r.enemiesAt[t]).filter((x): x is number => x !== undefined);
    const ls = results.map((r) => r.levelAt[t]).filter((x): x is number => x !== undefined);
    if (xs.length) console.log(`  t=${formatTime(t)} alive=${xs.length}  enemies median ${median(xs)}  level median ${median(ls)}`);
  }
  for (const r of results) {
    console.log(
      `  seed ${r.seed}: ${formatTime(r.time)} L${r.level} kills ${r.kills} score ${r.score} combo ${r.maxCombo} bosses [${r.bosses.join(',')}] peak ${r.peakEnemies} hits ${r.hitsTaken}` +
        (r.players > 1 ? ` downs ${r.downs} revives ${r.revives} builds ${r.builds.map((b) => b.join(' ')).join(' | ')}` : ` weapons ${r.weapons.join(' ')}`),
    );
  }
  if (process.env.SIM_OUTPUT_DIR) {
    mkdirSync(process.env.SIM_OUTPUT_DIR, { recursive: true });
    writeFileSync(join(process.env.SIM_OUTPUT_DIR, `${label.replace(/[^a-z0-9]+/gi, '-')}.json`), JSON.stringify(results, null, 2));
  }
}

const RUNS = Number(process.env.SIM_RUNS ?? 12);
const SKILL = Number(process.env.SIM_SKILL ?? 0.6);
const BASE = Number(process.env.SIM_SEED_BASE ?? 1000);
const TIME_TICKS = process.env.SIM_TICK_MS === '1';
/** Comma-separated profile filter, e.g. SIM_ONLY=fresh,coop2,coop3,coop4. */
const ONLY = process.env.SIM_ONLY?.split(',') ?? null;
const run = (id: string): typeof it | typeof it.skip => (ONLY === null || ONLY.includes(id) ? it : it.skip);
const VETERAN = { hull: 3, might: 3, reach: 3, haste: 2, growth: 3, greed: 2, reflex: 2, recovery: 1, armor: 1, reroll: 1 };

describe('balance simulation', () => {
  run('fresh')('fresh save, Spark', () => {
    const results: SimResult[] = [];
    for (let i = 0; i < RUNS; i++) results.push(simulateRun({ seed: BASE + i, rank: 1 }, 660, SKILL, TIME_TICKS));
    report(`fresh save (skill ${SKILL})`, results);
    expect(results.length).toBe(RUNS);
  });

  run('clumsy')('fresh save, clumsy player', () => {
    const results: SimResult[] = [];
    for (let i = 0; i < RUNS; i++) results.push(simulateRun({ seed: 3000 + i, rank: 1 }, 660, 0.3));
    report('fresh save (skill 0.3)', results);
    expect(results.length).toBe(RUNS);
  });

  run('veteran')('veteran save (rank 8, workshop half upgraded)', () => {
    const results: SimResult[] = [];
    for (let i = 0; i < RUNS; i++) results.push(simulateRun({ seed: BASE + 1000 + i, rank: 8, workshop: VETERAN }, 660, SKILL, TIME_TICKS));
    report(`veteran save (skill ${SKILL})`, results);
    expect(results.length).toBe(RUNS);
  });

  run('coop2')('co-op 2P fresh (spark + vanguard)', () => {
    const results: SimResult[] = [];
    for (let i = 0; i < RUNS; i++) results.push(simulateRun({ seed: BASE + i, rank: 1, players: ['spark', 'vanguard'] }, 660, SKILL, TIME_TICKS));
    report(`co-op 2P fresh (skill ${SKILL})`, results);
    expect(results.length).toBe(RUNS);
  });

  run('coop2vet')('co-op 2P veteran (rank 8 workshop)', () => {
    const results: SimResult[] = [];
    for (let i = 0; i < RUNS; i++) {
      results.push(simulateRun({ seed: BASE + 1000 + i, rank: 8, workshop: VETERAN, players: ['spark', 'vanguard'] }, 660, SKILL, TIME_TICKS));
    }
    report(`co-op 2P veteran (skill ${SKILL})`, results);
    expect(results.length).toBe(RUNS);
  });

  run('coop3')('co-op 3P fresh (spark + vanguard + spark)', () => {
    const results: SimResult[] = [];
    for (let i = 0; i < RUNS; i++) results.push(simulateRun({ seed: BASE + i, rank: 1, players: ['spark', 'vanguard', 'spark'] }, 660, SKILL, TIME_TICKS));
    report(`co-op 3P fresh (skill ${SKILL})`, results);
    expect(results.length).toBe(RUNS);
  });

  run('coop4')('co-op 4P fresh', () => {
    const results: SimResult[] = [];
    for (let i = 0; i < RUNS; i++) {
      results.push(simulateRun({ seed: BASE + i, rank: 1, players: ['spark', 'vanguard', 'spark', 'vanguard'] }, 660, SKILL, TIME_TICKS));
    }
    report(`co-op 4P fresh (skill ${SKILL})`, results);
    expect(results.every((r) => r.peakEnemies <= 600)).toBe(true);
    expect(results.length).toBe(RUNS);
  });
});
