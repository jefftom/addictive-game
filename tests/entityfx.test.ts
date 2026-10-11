import { describe, expect, it } from 'vitest';
import { PLAYER_COLORS } from '../src/game/content/coop';
import { ENEMIES } from '../src/game/content/enemies';
import { SHIPS } from '../src/game/content/ships';
import { makeRunConfig } from '../src/game/runconfig';
import type { EnemyKind, GameEvent, ShipId } from '../src/game/types';
import { World } from '../src/game/world';
import { chargeLevel, EntityFx, pilotColors, visualAngle } from '../src/render/entityfx';
import { Particles } from '../src/render/particles';
import { ALIEN_ART, fragmentsOf, SHIP_ART } from '../src/render/vessels';

it('kill events describe the destroyed vessel and include the killing knockback', () => {
  const world = new World(makeRunConfig({ seed: 1 }));
  const e = world.spawnEnemy('drifter', 100, 0)!;
  e.angle = 0.7;
  world.damageEnemy(e, 1e6, false, 1, 0, 300, false, 0);
  const event = world.events.find(e => e.t === 'kill');
  expect(event).toMatchObject({ kind: 'drifter', angle: 0.7, kx: e.kx, ky: e.ky });
  expect(e.kx).toBeGreaterThan(0);
});

it.each([[5, 0], [0.35, 0.5], [0, 1], [-50, 1]])('charge at timer %s is bounded at %s', (timer, value) => {
  expect(chargeLevel(timer, 0.7)).toBeCloseTo(value);
});

describe('shatter recipes and quality', () => {
  const cases: [EnemyKind, boolean, number, boolean, number][] = [
    ['drifter', false, 4, true, 6], ['drifter', true, 4, true, 31],
    ['drifter', false, 0, true, 2], ['drifter', false, 4, false, 6],
    ['warden', false, 4, true, 126], ['brute', false, 4, true, 15],
  ];
  it.each(cases)('%s elite=%s tier=%s fields=%s yields %s pieces', (kind, elite, tier, fields, count) => {
    const fx = new EntityFx(), world = new World(makeRunConfig({ seed: 1 }));
    fx.setCostTier(tier);
    const event: GameEvent = { t: 'kill', x: 100, y: 0, color: ENEMIES[kind].color,
      r: ENEMIES[kind].r * (elite ? 1.35 : 1), elite, boss: kind === 'warden', score: 100, dash: false, pid: 0,
      ...(fields ? { kind, angle: 0.7, kx: 300, ky: 0 } : {}),
    };
    fx.onEvent(event, world, new Particles());
    expect(fx.shards.count).toBe(count);
    const booms = (fx as unknown as { booms: { count: number; kind: Uint8Array; max: Float32Array; peak: Float32Array; r: Float32Array } }).booms;
    for (let i = 0; i < booms.count; i++) if (booms.kind[i] === 0) {
      expect(booms.max[i]).toBeLessThanOrEqual(0.080001);
      expect(booms.peak[i]).toBeLessThanOrEqual(0.600001);
      expect(booms.r[i]).toBeLessThanOrEqual(event.r * 2.5);
    }
    fx.reset();
    expect(fx.shards.count).toBe(0);
  });
  it.each([[4, 1], [2, 1], [1, 0.5], [0, 0.35]])('tier %s gives quality %s', (tier, quality) => {
    const fx = new EntityFx(); fx.setCostTier(tier);
    expect(fx.shards.quality).toBe(quality);
  });
  it('bounds the pool and reduces new debris in a crowd', () => {
    const fx = new EntityFx(), world = new World(makeRunConfig({ seed: 1 })), particles = new Particles();
    for (let i = 0; i < 400; i++) fx.onEvent({ t: 'kill', x: 0, y: 0, color: '#ff4d6d', r: 13,
      elite: false, boss: false, score: 1, dash: false, pid: 0, kind: 'drifter' }, world, particles);
    expect(fx.shards.count).toBe(1400);
    expect(fx.shards.density).toBe(0.5);
    expect(fx.shards.lifeScale).toBe(0.7);
  });
});

it('solo retains class accents and the chosen exhaust colour', () => {
  const world = new World(makeRunConfig({ seed: 1, ship: 'phantom' }));
  expect(pilotColors(world, 0, '#abcdef')).toEqual({ accent: SHIPS.phantom.color, trail: '#abcdef' });
});
it('co-op assigns every pilot their own accent and exhaust colour', () => {
  const world = new World(makeRunConfig({ seed: 1, players: [{ ship: 'spark' }, { ship: 'bastion' }, { ship: 'tempest' }, { ship: 'phantom' }] }));
  for (let pid = 0; pid < 4; pid++) expect(pilotColors(world, pid, '#abcdef'))
    .toEqual({ accent: PLAYER_COLORS[pid], trail: PLAYER_COLORS[pid] });
});

describe('vessel geometry', () => {
  for (const id of Object.keys(SHIPS) as ShipId[]) {
    it(`${id} has bounded art and engines`, () => {
      expect(SHIP_ART[id].nozzles.length).toBeGreaterThan(0);
      expect(SHIP_ART[id].extent).toBeGreaterThanOrEqual(17);
      expect(SHIP_ART[id].extent).toBeLessThanOrEqual(25);
    });
  }
  for (const kind of Object.keys(ENEMIES) as EnemyKind[]) {
    it(`${kind} has a valid shatter outline`, () => {
      const art = ALIEN_ART[kind];
      expect(art.outline.length).toBeGreaterThanOrEqual(6);
      expect(art.outline.length % 2).toBe(0);
      for (const n of [4, 9]) {
        const triangles = fragmentsOf(art.outline, art.cx, art.cy, n);
        expect(triangles).toHaveLength(n);
        for (const triangle of triangles) {
          expect(triangle).toHaveLength(6);
          expect(triangle.every(Number.isFinite)).toBe(true);
        }
      }
    });
  }
  it('aimed hulls and their fragments face the target; other hulls retain their angle', () => {
    expect(visualAngle('shooter', 0.7, 0, 0, 0, 100)).toBe(Math.PI / 2);
    expect(visualAngle('brute', 0.7, 0, 0, -100, 0)).toBe(Math.PI);
    expect(visualAngle('drifter', 0.7, 0, 0, 0, 100)).toBe(0.7);
  });
});
