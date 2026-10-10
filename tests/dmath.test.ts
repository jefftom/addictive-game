import { describe, expect, it } from 'vitest';
import * as dm from '../src/core/dmath';
import { Rng } from '../src/core/rng';

/**
 * src/core/dmath.ts: deterministic replacements for Math's
 * implementation-approximated functions. Accuracy is checked against the
 * engine's Math.* (itself within ~1 ulp of the true value, and allowed to
 * differ per CPU, hence the 2 ulp tolerance; a wrong constant or branch is off
 * by far more). The exact output bits are pinned so any engine/CPU that
 * computes differently fails here, by function, instead of as a chaotic
 * golden-master diff.
 */

const F = new Float64Array(1);
const U = new Uint32Array(F.buffer);
const B = new BigInt64Array(F.buffer);

/** Distance in units in the last place (ordered integer representation). */
function ulps(a: number, b: number): number {
  if (Object.is(a, b) || (Number.isNaN(a) && Number.isNaN(b))) return 0;
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0 || b === 0) return Infinity;
  const ord = (x: number): bigint => {
    F[0] = x;
    const v = B[0]!;
    return v < 0n ? -(v & 0x7fffffffffffffffn) : v;
  };
  const d = ord(a) - ord(b);
  return Number(d < 0n ? -d : d);
}

const SPECIAL = [0, -0, 1, -1, 0.5, -0.5, 2, -2, 3, -3, 2.5, -2.5, Infinity, -Infinity, NaN, 5e-324, -5e-324, 1e-310, 1e308, -1e308, Math.PI, -Math.PI, Math.PI / 2, 1e-20];

const UNARY = { sin: [dm.sin, Math.sin], cos: [dm.cos, Math.cos], atan: [dm.atan, Math.atan], exp: [dm.exp, Math.exp], log: [dm.log, Math.log] } as const;
const BINARY = { atan2: [dm.atan2, Math.atan2], pow: [dm.pow, Math.pow], hypot: [dm.hypot, Math.hypot] } as const;

/** NaN, signed zeros and infinities must match exactly; finite results within `tol` ulps. */
function expectLikeMath(got: number, want: number, what: string, tol = 2): void {
  if (Number.isNaN(want) || want === 0 || !Number.isFinite(want)) expect(Object.is(got, want) || (Number.isNaN(got) && Number.isNaN(want)), `${what}: ${got} vs ${want}`).toBe(true);
  else expect(ulps(got, want), `${what}: ${got} vs ${want}`).toBeLessThanOrEqual(tol);
}

describe('dmath special values follow Math.*', () => {
  for (const [name, [f, g]] of Object.entries(UNARY)) {
    it(name, () => {
      for (const x of SPECIAL) expectLikeMath(f(x), g(x), `${name}(${x})`);
    });
  }
  for (const [name, [f, g]] of Object.entries(BINARY)) {
    it(name, () => {
      // V8's Math.hypot is itself up to ~1.5 ulp off (dmath.hypot is closer).
      const tol = name === 'hypot' ? 3 : 2;
      for (const a of SPECIAL) for (const b of SPECIAL) expectLikeMath(f(a, b), g(a, b), `${name}(${a}, ${b})`, tol);
    });
  }

  it('pow keeps the JS-specific rules and exact integer powers', () => {
    expect(dm.pow(1, Infinity)).toBeNaN();
    expect(dm.pow(-1, -Infinity)).toBeNaN();
    expect(dm.pow(1, NaN)).toBeNaN();
    expect(dm.pow(NaN, 0)).toBe(1);
    expect(dm.pow(-8, 1 / 3)).toBeNaN();
    expect(Object.is(dm.pow(-0, 3), -0)).toBe(true);
    expect(dm.pow(-0, -3)).toBe(-Infinity);
    expect(dm.pow(3, 20)).toBe(3486784401);
    expect(dm.pow(-3, 21)).toBe(-10460353203);
    expect(dm.pow(10, 15)).toBe(1e15);
    expect(dm.pow(2, -1074)).toBe(5e-324);
    expect(dm.pow(2, 1023)).toBe(8.98846567431158e307);
    expect(dm.pow(2, 1024)).toBe(Infinity);
  });

  it('exp and hypot cover the extremes', () => {
    expect(dm.exp(709.78)).toBeCloseTo(Math.exp(709.78), -300);
    expect(dm.exp(-745.1)).toBe(5e-324);
    expect(dm.exp(-746)).toBe(0);
    expect(dm.exp(710)).toBe(Infinity);
    expect(dm.hypot(3, 2.5)).toBe(Math.sqrt(15.25));
    expect(dm.hypot(1e300, 1e300)).toBe(1.4142135623730952e300);
    expect(dm.hypot(3e-320, 4e-320)).toBe(5e-320);
    expect(dm.hypot(Infinity, NaN)).toBe(Infinity);
    expect(dm.hypot(NaN, -Infinity)).toBe(Infinity);
  });
});

describe('dmath accuracy against Math.* over the game ranges', () => {
  const rng = new Rng(20261010);
  const cases: [string, () => number[], (...a: number[]) => number, (...a: number[]) => number, number][] = [
    ['sin, |x| < 1e5', () => [rng.range(-1e5, 1e5)], dm.sin, Math.sin, 2],
    ['cos, |x| < 1e5', () => [rng.range(-1e5, 1e5)], dm.cos, Math.cos, 2],
    ['sin, |x| < 2pi', () => [rng.range(-7, 7)], dm.sin, Math.sin, 2],
    ['atan2, game coordinates', () => [rng.range(-2000, 2000), rng.range(-2000, 2000)], dm.atan2, Math.atan2, 2],
    ['atan, wide', () => [(rng.next() - 0.5) * dm.pow(10, rng.range(-8, 8))], dm.atan, Math.atan, 2],
    ['exp, [-745, 709]', () => [rng.range(-745, 709)], dm.exp, Math.exp, 2],
    ['exp, damping', () => [-rng.range(0, 2)], dm.exp, Math.exp, 2],
    ['log, wide', () => [dm.pow(10, rng.range(-300, 300))], dm.log, Math.log, 2],
    ['pow, fractional', () => [rng.range(0, 10), rng.range(0, 5)], dm.pow, Math.pow, 2],
    ['pow, integer', () => [rng.range(0, 4), rng.int(-20, 20)], dm.pow, Math.pow, 2],
    ['hypot, game coordinates', () => [rng.range(-4000, 4000), rng.range(-4000, 4000)], dm.hypot, Math.hypot, 3],
  ];
  for (const [name, gen, f, g, tol] of cases) {
    it(name, () => {
      let worst = 0;
      for (let i = 0; i < 20000; i++) {
        const a = gen();
        worst = Math.max(worst, ulps(f(...a), g(...a)));
      }
      expect(worst).toBeLessThanOrEqual(tol);
    });
  }

  it('sin/cos stay accurate for huge arguments (BigInt reduction over every exponent)', () => {
    let worst = 0;
    for (let e = 21; e <= 1023; e++) {
      for (let i = 0; i < 4; i++) {
        const x = (1 + rng.next()) * dm.pow(2, e) * (i & 1 ? -1 : 1);
        worst = Math.max(worst, ulps(dm.sin(x), Math.sin(x)), ulps(dm.cos(x), Math.cos(x)));
      }
    }
    expect(worst).toBeLessThanOrEqual(2);
  });

  it('sin/cos stay accurate next to multiples of pi/2 (cancellation)', () => {
    let worst = 0;
    for (let i = 0; i < 20000; i++) {
      const x = rng.int(1, 4194304) * (Math.PI / 2);
      worst = Math.max(worst, ulps(dm.sin(x), Math.sin(x)), ulps(dm.cos(x), Math.cos(x)));
    }
    expect(worst).toBeLessThanOrEqual(2);
  });
});

/** FNV-1a over the output bits of `f` on a fixed input stream. */
function bitsHash(f: (...a: number[]) => number, gen: (r: Rng) => number[], n = 4000): string {
  const r = new Rng(424242);
  let h = 0x811c9dc5;
  for (let i = 0; i < n; i++) {
    F[0] = f(...gen(r));
    h = Math.imul(h ^ U[0]!, 0x01000193);
    h = Math.imul(h ^ U[1]!, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

describe('dmath output bits are pinned (identical on every engine and CPU)', () => {
  it('matches the recorded hashes', () => {
    const got = {
      sin: bitsHash(dm.sin, (r) => [r.range(-1e5, 1e5)]),
      cos: bitsHash(dm.cos, (r) => [r.range(-1e5, 1e5)]),
      sinHuge: bitsHash(dm.sin, (r) => [(r.next() - 0.5) * dm.pow(10, r.range(6, 300))], 500),
      atan: bitsHash(dm.atan, (r) => [(r.next() - 0.5) * dm.pow(10, r.range(-8, 8))]),
      atan2: bitsHash(dm.atan2, (r) => [r.range(-2000, 2000), r.range(-2000, 2000)]),
      exp: bitsHash(dm.exp, (r) => [r.range(-745, 709)]),
      log: bitsHash(dm.log, (r) => [dm.pow(10, r.range(-300, 300))]),
      pow: bitsHash(dm.pow, (r) => [r.range(0, 10), r.range(-5, 5)]),
      hypot: bitsHash(dm.hypot, (r) => [r.range(-4000, 4000), r.range(-4000, 4000)]),
    };
    // A change here means dmath now computes different bits: that re-randomizes
    // every seeded run, so it needs a deliberate golden re-capture too.
    expect(got).toEqual({
      sin: '97a76f4e',
      cos: '13261867',
      sinHuge: '8fd22a6c',
      atan: 'f140fed0',
      atan2: '46791210',
      exp: '47340c74',
      log: '4bd384a7',
      pow: '2e00a0de',
      hypot: '4b700311',
    });
  });
});
