import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { botInput, botResolvePending } from '../src/game/bot';
import { makeRunConfig, type RunConfigInput } from '../src/game/runconfig';
import { applyOffer } from '../src/game/upgrades';
import { World } from '../src/game/world';

/**
 * Solo golden master. Captured on commit 18b7adc, before the co-op refactor.
 * Re-captured after moving the sim to deterministic math (src/core/dmath.ts)
 * so runs are identical on every CPU architecture.
 * Solo play must stay bit-for-bit identical, so these values must never change
 * unless a deliberate gameplay change is made (and then re-captured on purpose,
 * see `capture` below).
 */

const DT = 1 / 60;

interface Checkpoint {
  T: number | 'death';
  t: number;
  score: number;
  kills: number;
  level: number;
  x: number;
  y: number;
  hp: number;
  enemies: number;
  combo: number;
  weapons: string;
  next: number;
}

interface Case {
  name: string;
  input: RunConfigInput;
  checkpoints: Checkpoint[];
}

const CASES: Case[] = [
  {
    name: 'seed 77, rank 1',
    input: { seed: 77, rank: 1 },
    checkpoints: [
      { T: 45, t: 45, score: 2395, kills: 94, level: 5, x: 449.371294, y: -320.430724, hp: 100, enemies: 41, combo: 94, weapons: 'pulse3 arc1', next: 0.4707469723653048 },
      { T: 120, t: 120, score: 23075, kills: 610, level: 12, x: 213.704975, y: -460.705533, hp: 100, enemies: 49, combo: 457, weapons: 'pulse4 arc3 orbit2 nova1', next: 0.7262125718407333 },
      { T: 300, t: 300, score: 174290, kills: 2697, level: 23, x: 1499.355167, y: 19.173059, hp: 83.366667, enemies: 44, combo: 335, weapons: 'pulse5 arc* orbit* nova5', next: 0.7824732887092978 },
    ],
  },
  {
    name: 'seed 1001, rank 6, vanguard, workshop',
    input: { seed: 1001, rank: 6, ship: 'vanguard', workshop: { hull: 3, might: 2 } },
    checkpoints: [
      { T: 45, t: 45, score: 265, kills: 4, level: 1, x: -433.497459, y: -3581.225211, hp: 170, enemies: 140, combo: 1, weapons: 'orbit1', next: 0.7677986866328865 },
      { T: 120, t: 120, score: 19570, kills: 545, level: 10, x: 2572.645418, y: -5319.952264, hp: 170, enemies: 129, combo: 450, weapons: 'orbit3 mines1 lance1 nova2', next: 0.755538035184145 },
      { T: 300, t: 300, score: 93460, kills: 2142, level: 20, x: 3004.793807, y: -5068.281105, hp: 154.634, enemies: 89, combo: 148, weapons: 'orbit5 mines3 lance2 nova3', next: 0.48255403246730566 },
    ],
  },
  {
    name: 'seed 2024, rank 10, phantom, revival',
    input: { seed: 2024, rank: 10, ship: 'phantom', workshop: { revival: 1, reflex: 2 } },
    checkpoints: [
      { T: 45, t: 45, score: 3045, kills: 114, level: 5, x: 1423.415625, y: -514.493781, hp: 70, enemies: 17, combo: 114, weapons: 'seeker2 arc1 lance1', next: 0.9613311791326851 },
      { T: 120, t: 120, score: 29545, kills: 628, level: 11, x: 1425.382158, y: -751.040965, hp: 70, enemies: 35, combo: 628, weapons: 'seeker4 arc3 lance4', next: 0.8939121991861612 },
      { T: 'death', t: 207.1167, score: 78705, kills: 1468, level: 18, x: 2590.58732, y: -762.688605, hp: 0, enemies: 21, combo: 28, weapons: 'seeker5 arc5 lance5 mines1', next: 0.9223126692231745 },
    ],
  },
  {
    name: 'seed 31337, rank 8, bastion, hard mode',
    input: { seed: 31337, rank: 8, ship: 'bastion', hardMode: true },
    checkpoints: [
      { T: 45, t: 45, score: 3288, kills: 106, level: 5, x: 441.241455, y: -508.185778, hp: 120, enemies: 43, combo: 89, weapons: 'nova2 mines2 pulse1', next: 0.6961507233791053 },
      { T: 120, t: 120, score: 34466, kills: 678, level: 12, x: 1144.061311, y: -1052.431913, hp: 120, enemies: 20, combo: 302, weapons: 'nova4 mines3 pulse4', next: 0.8975157043896616 },
      { T: 'death', t: 236.1833, score: 130612, kills: 1776, level: 20, x: 1334.867825, y: -1974.550164, hp: 0, enemies: 37, combo: 9, weapons: 'nova5 mines3 pulse5 arc3', next: 0.37894208170473576 },
    ],
  },
  {
    name: 'seed 4242, rank 3, tempest, daily swarm',
    input: { seed: 4242, rank: 3, ship: 'tempest', daily: 'swarm' },
    checkpoints: [
      { T: 45, t: 45, score: 4630, kills: 158, level: 7, x: 497.883627, y: -226.757463, hp: 80, enemies: 45, combo: 158, weapons: 'arc5 seeker1', next: 0.44685144373215735 },
      { T: 120, t: 120, score: 60765, kills: 1183, level: 16, x: -1047.925628, y: -2809.137866, hp: 80, enemies: 17, combo: 1183, weapons: 'arc5 seeker* nova1', next: 0.5074346985202283 },
      { T: 300, t: 300, score: 500265, kills: 6365, level: 32, x: -992.274743, y: -4320.867488, hp: 80, enemies: 42, combo: 1827, weapons: 'arc5 seeker* nova5 orbit*', next: 0.8284199247136712 },
    ],
  },
];

const r6 = (v: number): number => Number(v.toFixed(6));

type Observed = Omit<Checkpoint, 'T' | 't'>;

/**
 * Plays `c` with the bot and calls `at` at each checkpoint time (or at the
 * death of the run); `at` returns false to stop early.
 */
function play(c: Case, at: (cp: Checkpoint, w: World, got: Observed) => boolean | void): void {
  const w = new World(makeRunConfig(c.input));
  const rng = new Rng(c.input.seed ^ 0xabcdef);
  for (const cp of c.checkpoints) {
    const end = cp.T === 'death' ? Infinity : cp.T;
    while (!w.gameOver && w.time < end - 1e-9) {
      w.update(DT, botInput(w, rng, { skill: 0.6 }));
      botResolvePending(w, rng, (o) => applyOffer(w, o));
      w.events.length = 0;
    }
    const p = w.player;
    const got: Observed = {
      score: w.score,
      kills: w.runStats.kills,
      level: w.level,
      x: r6(p.x),
      y: r6(p.y),
      hp: r6(p.hp),
      enemies: w.enemies.length,
      combo: w.combo,
      weapons: w.build.weapons.map((wp) => `${wp.id}${wp.evolved ? '*' : wp.level}`).join(' '),
      next: w.rng.next(),
    };
    if (at(cp, w, got) === false) return;
  }
}

/**
 * Re-capture on purpose (never to make a failing run pass by accident):
 *   GOLDEN_CAPTURE=1 npx vitest run tests/golden.solo.test.ts
 * prints every case's `checkpoints` in this file's format, to paste above.
 * A run that dies before a timed checkpoint is recorded as `T: 'death'`.
 */
function capture(c: Case): string {
  const lines: string[] = [];
  play(c, (cp, w, got) => {
    const T = w.gameOver ? `'death'` : String(cp.T);
    const t = Number(w.time.toFixed(4));
    const fields = Object.entries(got).map(([k, v]) => `${k}: ${typeof v === 'string' ? `'${v}'` : String(v)}`);
    lines.push(`      { T: ${T}, t: ${t}, ${fields.join(', ')} },`);
    return !w.gameOver;
  });
  return `    name: '${c.name}',\n    checkpoints: [\n${lines.join('\n')}\n    ],`;
}

if (process.env.GOLDEN_CAPTURE) {
  describe('solo golden master (capture mode)', () => {
    it('prints the checkpoints', () => {
      console.log(CASES.map(capture).join('\n\n'));
    }, 300_000);
  });
} else {
  describe('solo golden master (must stay bit-for-bit identical)', () => {
    for (const c of CASES) {
      it(c.name, () => {
        play(c, (cp, w, got) => {
          const { T: _T, t, ...want } = cp;
          expect(got, `${c.name} @ ${String(cp.T)}`).toEqual(want);
          expect(w.time).toBeCloseTo(t, 3);
          if (cp.T === 'death') expect(w.gameOver).toBe(true);
        });
      });
    }
  });
}
