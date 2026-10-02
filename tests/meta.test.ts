import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { WORKSHOP } from '../src/game/content/workshop';
import { checkAchievements } from '../src/meta/achievements';
import { currentStreak, dailyInfo, recordDaily } from '../src/meta/daily';
import { MISSION_SLOTS, refillMissions } from '../src/meta/missions';
import { affordableUpgrades, applyRun, buyUpgrade, isShipUnlocked, nearMiss, nextWorkshopGoal } from '../src/meta/progression';
import { rankXpNeeded } from '../src/meta/rank';
import type { RunResult } from '../src/meta/result';
import { defaultSave, loadSave, migrate, writeSave, type Storage } from '../src/meta/save';

function run(over: Partial<RunResult> = {}): RunResult {
  return {
    score: 12000,
    time: 150,
    level: 10,
    kills: 400,
    elites: 2,
    bossesKilled: [],
    dashKills: 20,
    perfects: 4,
    gems: 380,
    maxCombo: 80,
    evolutions: 0,
    coresCollected: 6,
    hitsTaken: 9,
    longestNoHit: 40,
    maxWeapons: 2,
    victory: false,
    daily: false,
    ship: 'spark',
    hard: false,
    coreGain: 1,
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

describe('save', () => {
  it('round-trips through storage', () => {
    const store = new MemStore();
    const s = defaultSave();
    s.cores = 123;
    s.workshop.hull = 2;
    expect(writeSave(s, store)).toBe(true);
    const loaded = loadSave(store);
    expect(loaded.cores).toBe(123);
    expect(loaded.workshop.hull).toBe(2);
  });

  it('survives corrupt or partial data', () => {
    const store = new MemStore();
    store.setItem('shardstorm.save', '{not json');
    expect(loadSave(store).cores).toBe(0);
    const partial = migrate({ cores: 50, stats: { runs: 3 }, settings: { music: 0.1 } });
    expect(partial.cores).toBe(50);
    expect(partial.stats.runs).toBe(3);
    expect(partial.stats.kills).toBe(0);
    expect(partial.settings.music).toBe(0.1);
    expect(partial.settings.sfx).toBe(0.8);
    expect(migrate({ cores: -5 }).cores).toBe(0);
  });

  it('works when storage throws', () => {
    const throwing: Storage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {},
    };
    expect(loadSave(throwing).rank).toBe(1);
    expect(writeSave(defaultSave(), throwing)).toBe(false);
  });
});

describe('missions', () => {
  it('fills three distinct slots', () => {
    const s = defaultSave();
    refillMissions(s, new Rng(1));
    expect(s.missions).toHaveLength(MISSION_SLOTS);
    expect(new Set(s.missions.map((m) => m.def)).size).toBe(MISSION_SLOTS);
  });

  it('completes, pays out, and is replaced by a harder tier', () => {
    const s = defaultSave();
    s.missions = [{ def: 'kills_run', tier: 0, target: 150, progress: 0, done: false }];
    const sum = applyRun(s, run({ kills: 200 }), new Rng(2), '2026-10-02');
    expect(sum.missionsCompleted).toHaveLength(1);
    expect(sum.rewards.some((r) => r.label.startsWith('Mission'))).toBe(true);
    expect(s.missionTiers.kills_run).toBe(1);
    expect(s.missions).toHaveLength(MISSION_SLOTS);
    const again = s.missions.find((m) => m.def === 'kills_run');
    if (again) expect(again.target).toBe(400);
  });

  it('tracks best progress for run missions and totals for total missions', () => {
    const s = defaultSave();
    s.missions = [
      { def: 'combo', tier: 0, target: 25, progress: 0, done: false },
      { def: 'gems_total', tier: 0, target: 300, progress: 0, done: false },
    ];
    applyRun(s, run({ maxCombo: 10, gems: 100 }), new Rng(1), '2026-10-02');
    applyRun(s, run({ maxCombo: 7, gems: 100 }), new Rng(1), '2026-10-02');
    const combo = s.missions.find((m) => m.def === 'combo')!;
    const gems = s.missions.find((m) => m.def === 'gems_total')!;
    expect(combo.progress).toBe(10);
    expect(gems.progress).toBe(200);
  });
});

describe('progression', () => {
  it('awards cores, rank XP, and updates bests', () => {
    const s = defaultSave();
    const sum = applyRun(s, run(), new Rng(1), '2026-10-02');
    expect(sum.totalCores).toBeGreaterThan(0);
    expect(s.cores).toBe(sum.totalCores);
    expect(s.stats.runs).toBe(1);
    expect(s.stats.bestScore).toBe(12000);
    expect(s.history).toHaveLength(1);
    expect(sum.rankXpGained).toBeGreaterThan(0);
  });

  it('ranks up and grants rank bonuses', () => {
    const s = defaultSave();
    s.rankXp = rankXpNeeded(1) - 1;
    const sum = applyRun(s, run(), new Rng(1), '2026-10-02');
    expect(s.rank).toBeGreaterThanOrEqual(2);
    expect(sum.rankUps[0]?.reward).toMatch(/Seeker/);
  });

  it('marks a new best only after the first run', () => {
    const s = defaultSave();
    expect(applyRun(s, run({ score: 100 }), new Rng(1)).newBest.score).toBe(false);
    expect(applyRun(s, run({ score: 200 }), new Rng(1)).newBest.score).toBe(true);
    expect(applyRun(s, run({ score: 150 }), new Rng(1)).newBest.score).toBe(false);
  });

  it('frames a near miss against the personal best', () => {
    const s = defaultSave();
    expect(nearMiss(s, run({ score: 9000 }), { score: 10000, time: 0 })).toMatch(/1,000 short/);
    expect(nearMiss(s, run({ score: 100, time: 165 }), { score: 0, time: 0 })).toMatch(/Warden/);
  });

  it('buys workshop upgrades at increasing cost', () => {
    const s = defaultSave();
    const hull = WORKSHOP.find((d) => d.id === 'hull')!;
    s.cores = hull.baseCost - 1;
    expect(buyUpgrade(s, 'hull')).toBe(false);
    s.cores = 10_000;
    expect(buyUpgrade(s, 'hull')).toBe(true);
    const after1 = s.cores;
    expect(buyUpgrade(s, 'hull')).toBe(true);
    expect(after1 - s.cores).toBeGreaterThan(hull.baseCost);
    for (let i = 0; i < 10; i++) buyUpgrade(s, 'hull');
    expect(s.workshop.hull).toBe(hull.maxLevel);
    expect(s.stats.upgradesBought).toBe(hull.maxLevel);
  });

  it('suggests the next workshop goal and counts affordable upgrades', () => {
    const s = defaultSave();
    s.cores = 0;
    expect(affordableUpgrades(s)).toBe(0);
    const goal = nextWorkshopGoal(s)!;
    expect(goal.missing).toBe(goal.cost);
    s.cores = 1000;
    expect(affordableUpgrades(s)).toBeGreaterThan(3);
  });

  it('unlocks ships through achievements', () => {
    const s = defaultSave();
    expect(isShipUnlocked(s, 'spark')).toBe(true);
    expect(isShipUnlocked(s, 'vanguard')).toBe(false);
    const sum = applyRun(s, run({ time: 200 }), new Rng(1), '2026-10-02');
    expect(sum.unlockedShips).toContain('vanguard');
    expect(isShipUnlocked(s, 'bastion')).toBe(false);
    applyRun(s, run({ bossesKilled: ['warden'] }), new Rng(1), '2026-10-02');
    expect(isShipUnlocked(s, 'bastion')).toBe(true);
  });

  it('does not unlock achievements twice', () => {
    const s = defaultSave();
    s.stats.runs = 1;
    expect(checkAchievements(s, null).map((a) => a.id)).toContain('first_run');
    expect(checkAchievements(s, null)).toHaveLength(0);
  });
});

describe('daily run', () => {
  it('gives everyone the same seed and modifier for a date', () => {
    expect(dailyInfo('2026-10-02')).toEqual(dailyInfo('2026-10-02'));
    const seeds = new Set(['2026-10-01', '2026-10-02', '2026-10-03'].map((d) => dailyInfo(d).seed));
    expect(seeds.size).toBe(3);
  });

  it('builds a streak on consecutive days and resets after a gap', () => {
    const s = defaultSave();
    expect(recordDaily(s, 100, '2026-10-01').streak).toBe(1);
    expect(recordDaily(s, 50, '2026-10-01')).toMatchObject({ streak: 1, first: false, best: false });
    expect(recordDaily(s, 100, '2026-10-02').streak).toBe(2);
    expect(currentStreak(s, '2026-10-03')).toBe(2);
    expect(currentStreak(s, '2026-10-05')).toBe(0);
    expect(recordDaily(s, 100, '2026-10-05').streak).toBe(1);
  });

  it('pays a streak bonus once per day', () => {
    const s = defaultSave();
    const first = applyRun(s, run({ daily: true }), new Rng(1), '2026-10-02');
    expect(first.daily?.bonus).toBeGreaterThan(0);
    const second = applyRun(s, run({ daily: true }), new Rng(1), '2026-10-02');
    expect(second.daily?.bonus).toBe(0);
  });
});

describe('regressions from code review', () => {
  it('resets an unknown ship id instead of crashing', () => {
    expect(migrate({ ship: 'deleted-ship' }).ship).toBe('spark');
    expect(migrate({ ship: 'phantom' }).ship).toBe('phantom');
  });

  it('credits a Daily Run to the day it started, even if it ends after midnight', () => {
    const s = defaultSave();
    applyRun(s, run({ daily: true, dailyDate: '2026-10-01', score: 777 }), new Rng(1), '2026-10-02');
    expect(s.daily.last).toBe('2026-10-01');
    expect(s.daily.best['2026-10-01']).toBe(777);
    expect(s.daily.best['2026-10-02']).toBeUndefined();
  });

  it('applies core bonuses to collected cores', () => {
    const s = defaultSave();
    const sum = applyRun(s, run({ coresCollected: 10, coreGain: 1.5 }), new Rng(1), '2026-10-02');
    expect(sum.rewards.find((r) => r.label === 'Cores collected')?.amount).toBe(15);
  });
});
