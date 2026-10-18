import { describe, expect, it } from 'vitest';
import { SpatialGrid } from '../src/core/grid';
import { angleDiff, clamp, formatTime } from '../src/core/math';
import { Rng, dateKey, daysBetween, hashString } from '../src/core/rng';
import { COMBO_TIERS, comboMult, comboTier, comboTierProgress, milestoneAt } from '../src/game/combo';

describe('Rng', () => {
  it('is deterministic for a seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });

  it('produces values in range', () => {
    const r = new Rng(7);
    for (let i = 0; i < 2000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      const n = r.int(3, 6);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(6);
    }
  });

  it('weightedIndex follows weights and skips zero weights', () => {
    const r = new Rng(1);
    const counts = [0, 0, 0];
    for (let i = 0; i < 20000; i++) counts[r.weightedIndex([1, 0, 3])]!++;
    expect(counts[1]).toBe(0);
    expect(counts[2]! / counts[0]!).toBeGreaterThan(2.6);
    expect(counts[2]! / counts[0]!).toBeLessThan(3.4);
    expect(r.weightedIndex([0, 0])).toBe(-1);
  });

  it('forks into independent but reproducible streams', () => {
    const a = new Rng(9).fork(1);
    const b = new Rng(9).fork(1);
    const c = new Rng(9).fork(2);
    const va = a.next();
    expect(b.next()).toBe(va);
    expect(c.next()).not.toBe(va);
  });

  it('hashes strings stably', () => {
    expect(hashString('shardstorm')).toBe(hashString('shardstorm'));
    expect(hashString('a')).not.toBe(hashString('b'));
  });

  it('computes date keys and day gaps', () => {
    expect(dateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(daysBetween('2026-01-31', '2026-02-01')).toBe(1);
    expect(daysBetween('2026-03-01', '2026-03-01')).toBe(0);
    expect(daysBetween('2025-12-30', '2026-01-02')).toBe(3);
  });
});

describe('math helpers', () => {
  it('clamps and formats', () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(formatTime(0)).toBe('00:00');
    expect(formatTime(185.9)).toBe('03:05');
  });

  it('angleDiff wraps around', () => {
    expect(angleDiff(0.1, -0.1)).toBeCloseTo(-0.2);
    expect(angleDiff(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(0.2);
  });
});

describe('SpatialGrid', () => {
  it('finds every point within a radius (matches brute force)', () => {
    const rng = new Rng(3);
    const pts = Array.from({ length: 600 }, () => ({ x: rng.range(-2500, 2500), y: rng.range(-2500, 2500) }));
    const grid = new SpatialGrid(64, 2048);
    grid.build(pts, 100, -50);
    const out: number[] = [];
    for (let q = 0; q < 50; q++) {
      const x = rng.range(-2200, 2200);
      const y = rng.range(-2200, 2200);
      const r = rng.range(10, 300);
      const n = grid.query(x, y, r, out);
      const found = new Set(out.slice(0, n).filter((i) => Math.hypot(pts[i]!.x - x, pts[i]!.y - y) <= r));
      const expected = pts.map((p, i) => [p, i] as const).filter(([p]) => Math.hypot(p.x - x, p.y - y) <= r).map(([, i]) => i);
      expect(found.size).toBe(expected.length);
      for (const i of expected) expect(found.has(i)).toBe(true);
    }
  });
});

describe('combo', () => {
  it('maps counts to tiers and multipliers', () => {
    expect(comboTier(0)).toBe(0);
    expect(comboMult(14)).toBe(1);
    expect(comboMult(15)).toBe(2);
    expect(comboMult(80)).toBe(4);
    expect(comboMult(10_000)).toBe(10);
    expect(comboTierProgress(COMBO_TIERS[1]!)).toBe(0);
  });

  it('fires milestones at 50, 100 and every 100 after', () => {
    expect(milestoneAt(49)).toBeNull();
    expect(milestoneAt(50)).toBe('MAGNET PULSE');
    expect(milestoneAt(100)).toBe('NOVA BURST');
    expect(milestoneAt(200)).toBe('OVERDRIVE');
    expect(milestoneAt(300)).toBe('NOVA BURST');
    expect(milestoneAt(150)).toBeNull();
  });
});
