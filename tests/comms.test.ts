import { describe, expect, it } from 'vitest';
import { makeRunConfig } from '../src/game/runconfig';
import type { Bullet } from '../src/game/types';
import { World } from '../src/game/world';
import { FadeGate, gameplayUnder } from '../src/ui/comms';

describe('comms occlusion', () => {
  it('counts threats, present pilots and ghosts with radius overlap', () => {
    const w = new World(makeRunConfig({ seed: 11 })), p = w.players[0]!;
    const under = () => gameplayUnder(w, 100, 100, 200, 200);
    p.x = p.y = 150; expect(under()).toBe(true);
    p.downed = true; expect(under()).toBe(true);
    p.alive = false; expect(under()).toBe(false);
    const e = w.spawnEnemy('drifter', 95, 150)!; e.r = 6; expect(under()).toBe(true);
    e.r = 5; expect(under()).toBe(false); e.x = 150; e.dead = true; expect(under()).toBe(false);
    const b = { x: 150, y: 205, r: 6, dead: false } as Bullet;
    w.bullets.push(b); expect(under()).toBe(true); b.dead = true; expect(under()).toBe(false);
    const extras = { enemies: [], bullets: [], players: [], pickups: [{ x: 150, y: 150, r: 100 }], projectiles: [{ x: 150, y: 150, r: 100 }] };
    expect(gameplayUnder(extras, 100, 100, 200, 200)).toBe(false);
  });

  it('probes immediately, throttles, holds clear for 0.4 seconds and resets', () => {
    const gate = new FadeGate(); let calls = 0, hit = true;
    const probe = () => { calls++; return hit; };
    expect(gate.update(0, probe)).toBe(true); expect(gate.under).toBe(true); hit = false;
    for (let i = 0; i < 39; i++) { expect(gate.update(0.01, probe)).toBe(false); expect(gate.under).toBe(true); }
    expect(gate.update(0.01, probe)).toBe(true); expect(gate.under).toBe(false);
    for (let i = 0; i < 960; i++) gate.update(0.01, probe);
    expect(calls).toBeLessThanOrEqual(Math.ceil(10 / 0.125) + 1);
    const before = calls; gate.reset(); hit = true; expect(gate.update(0, probe)).toBe(true); expect(calls).toBe(before + 1);
  });

  it('holds from the last positive probe, even across intermittent clear samples', () => {
    const gate = new FadeGate();
    gate.update(0, () => true); gate.update(0.25, () => false); gate.update(0.13, () => true);
    gate.update(0.39, () => false); expect(gate.under).toBe(true);
    gate.update(0.02, () => false); expect(gate.under).toBe(false);
  });
});
