import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { makeRunConfig } from '../src/game/runconfig';
import { World } from '../src/game/world';
import { ACHIEVEMENTS, checkAchievements } from '../src/meta/achievements';
import { missionsSatisfiedLive } from '../src/meta/missions';
import { applyRun, baseCores, coopBest } from '../src/meta/progression';
import { rankXpForRun } from '../src/meta/rank';
import { resultFromWorld, type PilotResult, type RunResult } from '../src/meta/result';
import { SAVE_VERSION, defaultSave, loadSave, migrate, writeSave, type Storage } from '../src/meta/save';

const pilot = (over: Partial<PilotResult> = {}): PilotResult => ({
  ship: 'spark',
  kills: 200,
  damage: 9000,
  perfects: 2,
  dashKills: 10,
  downs: 0,
  revivesGiven: 0,
  maxWeapons: 2,
  evolutions: 0,
  ...over,
});

/** A finished 2-pilot co-op run. */
function coopRun(over: Partial<RunResult> = {}): RunResult {
  return {
    score: 32000,
    time: 200,
    level: 12,
    kills: 400,
    elites: 3,
    bossesKilled: ['warden'],
    dashKills: 20,
    perfects: 6,
    gems: 600,
    maxCombo: 160,
    evolutions: 0,
    coresCollected: 4,
    hitsTaken: 12,
    longestNoHit: 30,
    maxWeapons: 3,
    victory: false,
    daily: false,
    ship: 'spark',
    hard: false,
    coreGain: 1,
    players: 2,
    team: [pilot({ perfects: 6, revivesGiven: 2 }), pilot({ ship: 'vanguard', perfects: 3, downs: 2, revivesGiven: 1 })],
    perfectsTeam: 9,
    scoreNorm: 20000,
    ...over,
  };
}

class MemStore implements Storage {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

describe('save v2 (co-op)', () => {
  it('a fresh save has an empty co-op block', () => {
    const s = defaultSave();
    expect(SAVE_VERSION).toBe(2);
    expect(s.coop).toEqual({ runs: 0, victories: 0, best: {}, revives: 0, lastRoster: [] });
  });

  it('migrates a v1 save: every field kept, co-op block added, story intact', () => {
    const v1 = {
      version: 1,
      cores: 777,
      ship: 'vanguard',
      achievements: { survive3: 5 },
      stats: { runs: 12, bestScore: 54321, bestCombo: 140 },
      daily: { last: '2026-10-01', streak: 2, best: { '2026-10-01': 900 } },
      history: [{ score: 10, time: 30, date: '2026-10-01', daily: false }],
      story: { introSeen: true, logUnlocked: ['first_light'], logSeen: [], quipHistory: ['a'] },
    };
    const m = migrate(v1);
    expect(m.version).toBe(2);
    expect(m.cores).toBe(777);
    expect(m.ship).toBe('vanguard');
    expect(m.stats.bestScore).toBe(54321);
    expect(m.daily.best['2026-10-01']).toBe(900);
    expect(m.history).toHaveLength(1);
    expect(m.story).toEqual({ introSeen: true, logUnlocked: ['first_light'], logSeen: [], quipHistory: ['a'] });
    expect(m.coop).toEqual({ runs: 0, victories: 0, best: {}, revives: 0, lastRoster: [] });
  });

  it('sanitises a stored co-op block', () => {
    const m = migrate({
      coop: {
        runs: 3,
        victories: -2,
        best: { 2: 5000, 5: 99, 3: 'x', 4: 120.7 },
        revives: 'lots',
        lastRoster: [{ device: 'kbA', ship: 'tempest' }, { device: 'kbB', ship: 'nope' }, null, { ship: 'spark' }],
      },
    });
    expect(m.coop).toEqual({ runs: 3, victories: 0, best: { '2': 5000, '4': 120 }, revives: 0, lastRoster: [{ device: 'kbA', ship: 'tempest' }] });
    expect(migrate({ coop: 'garbage' }).coop.runs).toBe(0);
  });

  it('round-trips co-op records through storage', () => {
    const store = new MemStore();
    const s = defaultSave();
    applyRun(s, coopRun(), new Rng(1), '2026-10-07');
    writeSave(s, store);
    const loaded = loadSave(store);
    expect(loaded.coop.runs).toBe(1);
    expect(loaded.coop.best['2']).toBe(32000);
    expect(loaded.history.at(-1)).toMatchObject({ players: 2, daily: false });
  });
});

describe('co-op results', () => {
  it('resultFromWorld: team stats, best-individual perfects, normalised score, never daily', () => {
    const w = new World(makeRunConfig({ seed: 5, players: [{ ship: 'spark' }, { ship: 'vanguard' }], daily: 'swarm' }));
    w.score = 16000;
    w.runStats.perfects = 7;
    w.players[0]!.run.perfects = 3;
    w.players[1]!.run.perfects = 4;
    w.players[1]!.run.kills = 55;
    w.players[1]!.run.revivesGiven = 2;
    w.players[1]!.run.maxWeapons = 3;
    const r = resultFromWorld(w);
    expect(r.players).toBe(2);
    expect(r.daily).toBe(false);
    expect(r.perfects).toBe(4);
    expect(r.perfectsTeam).toBe(7);
    expect(r.maxWeapons).toBe(3);
    expect(r.scoreNorm).toBe(Math.floor(16000 / w.scaling.spawn));
    expect(r.team!.map((t) => t.ship)).toEqual(['spark', 'vanguard']);
    expect(r.team![1]).toMatchObject({ kills: 55, revivesGiven: 2, perfects: 4 });
  });

  it('resultFromWorld is unchanged for solo (no co-op fields)', () => {
    const w = new World(makeRunConfig({ seed: 5, ship: 'tempest' }));
    const r = resultFromWorld(w);
    expect(r.players).toBeUndefined();
    expect(r.team).toBeUndefined();
    expect(r.scoreNorm).toBeUndefined();
    expect(r.ship).toBe('tempest');
  });
});

describe('co-op progression', () => {
  it('keeps solo bests apart and records the squad best per pilot count', () => {
    const s = defaultSave();
    s.stats.bestScore = 10000;
    s.stats.bestCombo = 50;
    const sum = applyRun(s, coopRun(), new Rng(1), '2026-10-07');
    expect(s.stats.bestScore).toBe(10000);
    expect(s.stats.bestCombo).toBe(50);
    expect(coopBest(s, 2)).toBe(32000);
    expect(s.coop.runs).toBe(1);
    expect(s.coop.revives).toBe(3);
    expect(sum.prevBest.score).toBe(0);
    expect(sum.newBest.score).toBe(false); // the first squad run is not a "new best"
    // Lifetime totals still count team values; best time/level progress unlocks.
    expect(s.stats.runs).toBe(1);
    expect(s.stats.kills).toBe(400);
    expect(s.stats.perfects).toBe(9);
    expect(s.stats.bestTime).toBe(200);
    expect(s.stats.bestLevel).toBe(12);

    const again = applyRun(s, coopRun({ score: 40000 }), new Rng(1), '2026-10-07');
    expect(again.newBest.score).toBe(true);
    expect(again.prevBest.score).toBe(32000);
    expect(coopBest(s, 2)).toBe(40000);
    expect(coopBest(s, 3)).toBe(0);
  });

  it('pays cores and rank XP from the normalised score', () => {
    const s = defaultSave();
    const r = coopRun();
    const sum = applyRun(s, r, new Rng(1), '2026-10-07');
    expect(sum.rewards[0]!.amount).toBe(baseCores(20000, r.time, 1));
    expect(sum.rankXpGained).toBe(rankXpForRun(20000, r.time));
  });

  it('never records a Daily and leaves the tutorial alone', () => {
    const s = defaultSave();
    const sum = applyRun(s, coopRun({ daily: true, dailyDate: '2026-10-07' }), new Rng(1), '2026-10-07');
    expect(sum.daily).toBeNull();
    expect(s.daily.last).toBeNull();
    expect(s.tutorialDone).toBe(false);
  });

  it('counts victories toward the squad achievement', () => {
    const s = defaultSave();
    const sum = applyRun(s, coopRun({ victory: true, time: 600 }), new Rng(1), '2026-10-07');
    expect(s.coop.victories).toBe(1);
    expect(s.stats.victories).toBe(1);
    expect(sum.achievements.map((a) => a.id)).toContain('squad');
  });
});

describe('co-op missions', () => {
  it('skips the score and daily missions, counts team values elsewhere', () => {
    const s = defaultSave();
    s.missions = [
      { def: 'score', tier: 0, target: 5000, progress: 0, done: false },
      { def: 'kills_run', tier: 0, target: 150, progress: 0, done: false },
      { def: 'daily', tier: 0, target: 1, progress: 0, done: false },
    ];
    expect(missionsSatisfiedLive(s, coopRun()).map((m) => m.def)).toEqual(['kills_run']);
    const sum = applyRun(s, coopRun({ daily: true }), new Rng(1), '2026-10-07');
    expect(sum.missionsCompleted.map((m) => m.mission.def)).toEqual(['kills_run']);
    const score = s.missions.find((m) => m.def === 'score');
    if (score) expect(score.progress).toBe(0);
  });

  it('perfect-dash missions use the best single pilot', () => {
    const s = defaultSave();
    s.missions = [{ def: 'perfect_run', tier: 0, target: 8, progress: 0, done: false }];
    // perfects (best individual) = 6, team = 9: not enough.
    expect(missionsSatisfiedLive(s, coopRun())).toEqual([]);
  });
});

describe('co-op achievements', () => {
  const ids = ACHIEVEMENTS.map((a) => a.id);

  it('defines squad and medic (Steam ACH_SQUAD / ACH_MEDIC)', () => {
    expect(ids).toContain('squad');
    expect(ids).toContain('medic');
  });

  it('medic unlocks at 10 revives, with progress', () => {
    const s = defaultSave();
    s.coop.revives = 9;
    const medic = ACHIEVEMENTS.find((a) => a.id === 'medic')!;
    expect(medic.progress!(s)).toEqual([9, 10]);
    expect(checkAchievements(s, null).map((a) => a.id)).not.toContain('medic');
    s.coop.revives = 10;
    expect(checkAchievements(s, null).map((a) => a.id)).toContain('medic');
  });

  it('perfect10 uses the best individual, not the team sum', () => {
    const s = defaultSave();
    applyRun(s, coopRun({ perfects: 6, perfectsTeam: 12 }), new Rng(1), '2026-10-07');
    expect(s.achievements.perfect10).toBeUndefined();
    applyRun(s, coopRun({ perfects: 10, perfectsTeam: 12 }), new Rng(1), '2026-10-07');
    expect(s.achievements.perfect10).toBeDefined();
  });

  it('combo achievements unlock from a co-op run even though bestCombo stays solo-only', () => {
    const s = defaultSave();
    applyRun(s, coopRun({ maxCombo: 160 }), new Rng(1), '2026-10-07');
    expect(s.stats.bestCombo).toBe(0);
    expect(s.achievements.combo150).toBeDefined();
    expect(s.achievements.combo500).toBeUndefined();
  });

  it('score100k stays solo-only', () => {
    const s = defaultSave();
    applyRun(s, coopRun({ score: 250000, scoreNorm: 150000 }), new Rng(1), '2026-10-07');
    expect(s.achievements.score100k).toBeUndefined();
  });
});
