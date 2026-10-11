import { describe, expect, it } from 'vitest';
import { pow } from '../src/core/dmath';
import { Rng } from '../src/core/rng';
import { botInput, botResolvePending } from '../src/game/bot';
import { COOP_SCALING, REVIVE_HP, SPAWN_CLEARANCE, ZOOM_MAX } from '../src/game/content/coop';
import { Director } from '../src/game/director';
import { makeRunConfig } from '../src/game/runconfig';
import { xpForLevel } from '../src/game/stats';
import type { ControlInput, GameEvent, ShipId } from '../src/game/types';
import { applyOffer, generateOffers, offerKey } from '../src/game/upgrades';
import { World } from '../src/game/world';
import { simulateRun } from './helpers';

const DT = 1 / 60;
const still: ControlInput = { mx: 0, my: 0, dash: false };
const right: ControlInput = { mx: 1, my: 0, dash: false };
const left: ControlInput = { mx: -1, my: 0, dash: false };

function coopWorld(ships: ShipId[] = ['spark', 'vanguard'], seed = 1): World {
  return new World(makeRunConfig({ seed, players: ships.map((ship) => ({ ship })) }));
}

/** Stops the director so a test controls every enemy. */
function quiet(w: World): void {
  const d = w.director as unknown as Record<string, unknown>;
  d.openingDone = true;
  d.surgeT = 1e9;
  d.eliteT = 1e9;
  d.budget = -1e9;
  d.bossIdx = 99;
  d.nextOvertimeBoss = 1e9;
}

/** Ticks `n` times with per-pid inputs, returning every event emitted. */
function tick(w: World, n: number, inputs: readonly ControlInput[] = [still, still]): GameEvent[] {
  const out: GameEvent[] = [];
  for (let i = 0; i < n; i++) {
    w.update(DT, inputs);
    out.push(...w.events);
    w.events.length = 0;
  }
  return out;
}

function down(w: World, pid: number): void {
  const p = w.players[pid]!;
  p.invuln = 0;
  p.dashT = 0;
  w.hurtPlayer(1e6, p.x + 1, p.y, pid);
}

describe('co-op config', () => {
  it('builds the roster, keeps ship = P1 and forces daily off', () => {
    const cfg = makeRunConfig({ seed: 1, daily: 'swarm', players: [{ ship: 'tempest' }, { ship: 'spark' }] });
    expect(cfg.players).toHaveLength(2);
    expect(cfg.ship).toBe('tempest');
    expect(cfg.daily).toBeNull();
    const five = makeRunConfig({ seed: 1, players: Array.from({ length: 5 }, () => ({ ship: 'spark' as const })) });
    expect(five.players).toHaveLength(4);
    const solo = makeRunConfig({ seed: 1, ship: 'phantom', daily: 'swarm' });
    expect(solo.players).toEqual([{ ship: 'phantom' }]);
    expect(solo.daily).toBe('swarm');
  });

  it('places pilots side by side and scales the world', () => {
    const w = coopWorld(['spark', 'spark', 'spark']);
    expect(w.coop).toBe(true);
    expect(w.players.map((p) => p.x)).toEqual([-70, 0, 70]);
    expect(w.maxEnemies).toBe(COOP_SCALING[3].maxEnemies);
    expect(w.xpNext).toBe(Math.round(xpForLevel(1) * COOP_SCALING[3].xpReq));
  });
});

describe('per-player state', () => {
  it('each pilot has their own ship stats and start weapon', () => {
    const w = coopWorld();
    const [p1, p2] = w.players;
    expect(p1!.stats.maxHp).toBe(100);
    expect(p1!.build.weapons.map((x) => x.id)).toEqual(['pulse']);
    expect(p2!.stats.maxHp).toBe(140);
    expect(p2!.hp).toBe(140);
    expect(p2!.build.weapons.map((x) => x.id)).toEqual(['orbit']);
    const p1Stats = p1!.stats;
    p2!.build.passives.power = 3;
    w.refreshStats(1);
    expect(p2!.stats.damage).toBeGreaterThan(p1!.stats.damage);
    expect(p1!.stats).toBe(p1Stats);
  });
});

describe('shared XP and level rounds', () => {
  it('one team level-up gives every pilot a pick, in pid order', () => {
    const w = coopWorld();
    w.addXp(w.xpNext, 1);
    expect(w.level).toBe(2);
    expect(w.pendingLevelUps).toBe(1);
    expect(w.xpNext).toBe(Math.round(xpForLevel(2) * 1.6));
    expect(w.pendingPicksFor(0)).toBe(1);
    expect(w.beginPick()).toEqual({ pid: 0, cache: false });
    expect(w.pendingLevelUps).toBe(0);
    expect(w.levelRound).toEqual([1]);
    expect(w.hasPendingPicks()).toBe(true);
    expect(w.pendingPicksFor(0)).toBe(0);
    expect(w.pendingPicksFor(1)).toBe(1);
    expect(w.beginPick()).toEqual({ pid: 1, cache: false });
    expect(w.beginPick()).toBeNull();
    expect(w.hasPendingPicks()).toBe(false);
  });

  it("uses the collector's xpGain", () => {
    const a = coopWorld();
    const b = coopWorld();
    b.players[1]!.build.passives.fortune = 5;
    b.refreshStats(1);
    a.addXp(1, 1);
    b.addXp(1, 1);
    b.addXp(1, 0);
    expect(a.xp).toBe(1);
    expect(b.xp).toBeCloseTo(1.4 + 1);
  });

  it('downed pilots still pick in the round', () => {
    const w = coopWorld();
    quiet(w);
    down(w, 1);
    expect(w.players[1]!.downed).toBe(true);
    w.addXp(w.xpNext, 0);
    expect(w.beginPick()).toEqual({ pid: 0, cache: false });
    expect(w.beginPick()).toEqual({ pid: 1, cache: false });
    // The heal card is hidden for a downed pilot.
    for (let i = 0; i < 20; i++) expect(generateOffers(w, 6, false, 1).some((o) => o.kind === 'heal')).toBe(false);
  });
});

describe('per-player offers', () => {
  it('offers come from the picker build and apply only to it', () => {
    let sawOrbitUpgrade = false;
    for (let seed = 0; seed < 40; seed++) {
      const w = coopWorld(['spark', 'vanguard'], seed);
      const offers = generateOffers(w, 3, false, 1);
      expect(offers.some((o) => o.kind === 'weapon' && o.id === 'pulse' && !o.isNew)).toBe(false);
      if (offers.some((o) => o.kind === 'weapon' && o.id === 'orbit' && o.level === 2)) sawOrbitUpgrade = true;
      const before = JSON.stringify(w.players[0]!.build);
      const p2Before = JSON.stringify(w.players[1]!.build);
      applyOffer(w, offers[0]!, 1);
      expect(JSON.stringify(w.players[0]!.build)).toBe(before);
      if (offers[0]!.kind !== 'heal' && offers[0]!.kind !== 'cores' && offers[0]!.kind !== 'score') {
        expect(JSON.stringify(w.players[1]!.build)).not.toBe(p2Before);
      }
      expect(new Set(offers.map(offerKey)).size).toBe(offers.length);
    }
    expect(sawOrbitUpgrade).toBe(true);
  });
});

describe('caches and hearts', () => {
  it('a cache goes to the pilot who collects it, and caches resolve before level picks', () => {
    const w = coopWorld();
    quiet(w);
    const p2 = w.players[1]!;
    const e = w.spawnEnemy('brute', p2.x + 30, p2.y, true)!;
    w.damageEnemy(e, 1e9, false, 1, 0, 0, false, 1);
    for (const pk of w.pickups) pk.vx = pk.vy = 0;
    tick(w, 120);
    expect(w.players[1]!.pendingCaches).toBe(1);
    expect(w.players[0]!.pendingCaches).toBe(0);
    expect(w.beginPick()).toEqual({ pid: 1, cache: true });
  });

  it('a boss drops one cache and one heart per pilot', () => {
    const w = coopWorld(['spark', 'spark', 'spark']);
    quiet(w);
    const boss = w.spawnEnemy('warden', 400, 0)!;
    w.killEnemy(boss, false, 2);
    expect(w.pickups.filter((p) => p.kind === 'cache')).toHaveLength(3);
    expect(w.pickups.filter((p) => p.kind === 'heart')).toHaveLength(3);
    expect(w.players[2]!.run.kills).toBe(1);
  });

  it('hearts heal the collector only', () => {
    const w = coopWorld();
    quiet(w);
    const [p1, p2] = w.players;
    p1!.hp = 50;
    p2!.hp = 50;
    w.dropPickup('heart', p2!.x + 20, p2!.y, 25);
    for (const pk of w.pickups) pk.vx = pk.vy = 0;
    const evs = tick(w, 60);
    expect(p2!.hp).toBeGreaterThan(50);
    expect(p1!.hp).toBe(50);
    expect(evs.some((ev) => ev.t === 'pickup' && ev.kind === 'heart' && ev.pid === 1)).toBe(true);
  });
});

describe('enemy targeting', () => {
  it('chases the nearest active pilot and retargets when they go down', () => {
    const w = coopWorld();
    quiet(w);
    const p2 = w.players[1]!;
    const e = w.spawnEnemy('drifter', p2.x + 200, 0)!;
    const x0 = e.x;
    tick(w, 5);
    expect(e.tgt).toBe(1);
    expect(e.x).toBeLessThan(x0);
    down(w, 1);
    tick(w, 1);
    expect(e.tgt).toBe(0);
  });

  it('a new enemy far away picks the nearest pilot, not P1 by default', () => {
    const w = coopWorld(['spark', 'spark']);
    quiet(w);
    const enemies = [];
    for (let i = 0; i < 120; i++) {
      const a = (i / 120) * Math.PI * 2 + 0.01;
      const e = w.spawnEnemy('drifter', Math.cos(a) * 800, Math.sin(a) * 800)!;
      e.speed = 0;
      enemies.push(e);
    }
    tick(w, 1);
    let onP2 = 0;
    for (const e of enemies) {
      const want = Math.hypot(e.x - w.players[1]!.x, e.y) < Math.hypot(e.x - w.players[0]!.x, e.y) ? 1 : 0;
      expect(e.tgt).toBe(want);
      onP2 += want;
    }
    expect(onP2).toBe(60);
  });

  it('does not jitter between two nearly equidistant pilots (hysteresis)', () => {
    const w = coopWorld();
    quiet(w);
    const e = w.spawnEnemy('drifter', 3, 300)!;
    e.speed = 0;
    e.tgt = 0;
    for (let i = 0; i < 60; i++) {
      tick(w, 1);
      expect(e.tgt).toBe(0);
    }
    // A clearly closer pilot wins.
    e.x = 200;
    e.y = 0;
    tick(w, 1);
    expect(e.tgt).toBe(1);
  });
});

describe('downed, revive and team wipe', () => {
  it('a lethal hit downs a pilot while a teammate is up', () => {
    const w = coopWorld(['spark', 'spark']);
    quiet(w);
    w.players[0]!.x = -500;
    w.addCombo(40);
    const p2 = w.players[1]!;
    p2.invuln = 0;
    w.hurtPlayer(1e6, p2.x + 1, p2.y, 1);
    expect(p2.downed).toBe(true);
    expect(p2.alive).toBe(true);
    expect(p2.hp).toBe(0);
    expect(w.gameOver).toBe(false);
    expect(w.combo).toBe(20);
    expect(w.events.some((ev) => ev.t === 'downed' && ev.pid === 1)).toBe(true);
    expect(w.events.some((ev) => ev.t === 'laststand' && ev.pid === 0)).toBe(true);
    expect(w.events.some((ev) => ev.t === 'death')).toBe(false);
    w.events.length = 0;

    // Ghosts ignore contact damage and bullets.
    const e = w.spawnEnemy('drifter', p2.x, p2.y)!;
    e.spawnT = 0;
    w.fireBullet(p2.x + 8, p2.y, Math.PI, 10, 10);
    const evs = tick(w, 1);
    expect(evs.some((ev) => ev.t === 'hurt' && ev.pid === 1)).toBe(false);
    expect(p2.downed).toBe(true);
    e.dead = true;

    // Ghosts don't fire.
    tick(w, 120);
    expect(w.projectiles.some((pr) => pr.owner === 1)).toBe(false);

    // Ghosts drift at GHOST_SPEED.
    tick(w, 90, [still, right]);
    expect(p2.vx).toBeCloseTo(w.moveSpeed(p2) * 0.55, 0);
  });

  it('self-revives (Second Wind) are spent before going down', () => {
    const w = coopWorld();
    quiet(w);
    const p2 = w.players[1]!;
    p2.build.relics.push('secondwind');
    w.refreshStats(1);
    p2.invuln = 0;
    w.hurtPlayer(1e6, p2.x + 1, p2.y, 1);
    expect(p2.downed).toBe(false);
    expect(p2.hp).toBeGreaterThan(0);
    expect(w.events.some((ev) => ev.t === 'revive' && ev.pid === 1)).toBe(true);
    expect(w.events.some((ev) => ev.t === 'downed')).toBe(false);
  });

  it('a nearby teammate revives a downed pilot', () => {
    const w = coopWorld(['spark', 'spark']);
    quiet(w);
    const [p1, p2] = w.players;
    down(w, 1);
    p1!.x = p2!.x - 60;
    p1!.y = p2!.y;
    let evs = tick(w, 140);
    expect(p2!.downed).toBe(true);
    evs = tick(w, 11);
    expect(p2!.downed).toBe(false);
    expect(p2!.hp).toBeCloseTo(p2!.stats.maxHp * REVIVE_HP);
    expect(p2!.invuln).toBeGreaterThan(0);
    expect(evs.filter((ev) => ev.t === 'revived')).toEqual([{ t: 'revived', pid: 1, by: 0, x: p2!.x, y: p2!.y }]);
    expect(p1!.run.revivesGiven).toBe(1);
    expect(p2!.run.downs).toBe(1);

    // Each later down takes longer.
    down(w, 1);
    expect(p2!.downed).toBe(true);
    expect(w.reviveNeed(p2!)).toBeCloseTo(3.75);
  });

  it('revive progress decays at half speed when the reviver leaves', () => {
    const w = coopWorld(['spark', 'spark']);
    quiet(w);
    const [p1, p2] = w.players;
    down(w, 1);
    p1!.x = p2!.x - 60;
    tick(w, 60);
    expect(p2!.reviveT).toBeCloseTo(1, 5);
    p1!.x = p2!.x - 400;
    tick(w, 60);
    expect(p2!.reviveT).toBeCloseTo(0.5, 5);
    expect(p2!.downed).toBe(true);
  });

  it('the run ends when every pilot is down', () => {
    const w = coopWorld();
    quiet(w);
    down(w, 1);
    expect(w.gameOver).toBe(false);
    down(w, 0);
    expect(w.gameOver).toBe(true);
    expect(w.players.every((p) => !p.alive)).toBe(true);
    expect(w.events.filter((ev) => ev.t === 'death')).toHaveLength(1);
    expect(w.events.filter((ev) => ev.t === 'downed')).toHaveLength(1);
  });
});

describe('leash and zoom', () => {
  it('blocks a pilot at the max view span without dragging the other', () => {
    const w = coopWorld(['spark', 'spark']);
    quiet(w);
    const [p1, p2] = w.players;
    const x2 = p2!.x;
    const span = w.maxSpan();
    for (let i = 0; i < 60 * 20; i++) {
      tick(w, 1, [right, still]);
      expect(p1!.x - p2!.x).toBeLessThanOrEqual(span.x + 1e-9);
      expect(w.zoom).toBeLessThanOrEqual(ZOOM_MAX);
      expect(w.zoom).toBeGreaterThanOrEqual(1);
    }
    expect(p1!.x - p2!.x).toBeCloseTo(span.x, 6);
    expect(p1!.vx).toBe(0);
    expect(p2!.x).toBe(x2);
    expect(w.zoom).toBeCloseTo(ZOOM_MAX, 6);
    // Both pilots stay inside the zoomed view around the team centre.
    const c = w.teamCenter();
    for (const p of w.players) expect(Math.abs(p.x - c.x)).toBeLessThanOrEqual(w.effHalfW());

    // Regroup: zoom eases back toward 1.
    p1!.x = p2!.x - 70;
    tick(w, 60 * 10);
    expect(w.zoom).toBeLessThan(1.01);
  });

  it('a pilot walking away never tows a teammate (any pid, 2-4 pilots)', () => {
    const cases: { ships: ShipId[]; inputs: ControlInput[] }[] = [
      { ships: ['spark', 'spark'], inputs: [still, right] },
      { ships: ['spark', 'spark'], inputs: [right, still] },
      { ships: ['spark', 'spark', 'spark'], inputs: [still, left, still] },
      { ships: ['spark', 'spark', 'spark', 'spark'], inputs: [still, still, still, right] },
    ];
    for (const { ships, inputs } of cases) {
      const w = coopWorld(ships);
      quiet(w);
      const span = w.maxSpan().x;
      const start = w.players.map((p) => p.x);
      for (let i = 0; i < 60 * 20; i++) {
        tick(w, 1, inputs);
        const xs = w.players.map((p) => p.x);
        expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(span + 1e-9);
      }
      w.players.forEach((p, pid) => {
        if (inputs[pid] === still) expect(p.x).toBe(start[pid]);
      });
      const xs = w.players.map((p) => p.x);
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(span, 6);
    }
  });

  it('pilots moving apart (and dashing) stay within the max span', () => {
    const w = coopWorld(['spark', 'spark', 'spark']);
    quiet(w);
    const span = w.maxSpan();
    const dashL: ControlInput = { mx: -1, my: 1, dash: true };
    const dashR: ControlInput = { mx: 1, my: -1, dash: true };
    for (let i = 0; i < 60 * 15; i++) {
      tick(w, 1, i % 30 === 0 ? [dashL, still, dashR] : [left, { mx: 0, my: 1, dash: false }, right]);
      const xs = w.players.map((p) => p.x);
      const ys = w.players.map((p) => p.y);
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(span.x + 1e-9);
      expect(Math.max(...ys) - Math.min(...ys)).toBeLessThanOrEqual(span.y + 1e-9);
    }
  });

  it('solo zoom stays exactly 1', () => {
    const w = new World(makeRunConfig({ seed: 3 }));
    for (let i = 0; i < 60 * 30 && !w.gameOver; i++) {
      w.update(DT, i % 120 < 60 ? right : left);
      w.events.length = 0;
      w.pendingLevelUps = 0;
      w.pendingCaches = 0;
      expect(w.zoom).toBe(1);
    }
  });
});

describe('pickups', () => {
  it('a gem flies to the pilot whose magnet caught it, and retargets if they go down', () => {
    const w = coopWorld(['spark', 'spark']);
    quiet(w);
    const [p1, p2] = w.players;
    p1!.x = -400;
    w.dropXp(p2!.x + 100, p2!.y, 1);
    const gem = w.pickups[0]!;
    gem.vx = gem.vy = 0;
    tick(w, 10);
    expect(gem.magnetized).toBe(true);
    expect(gem.owner).toBe(1);
    expect(gem.vx).toBeLessThan(0);
    down(w, 1);
    tick(w, 1);
    expect(gem.owner).toBe(0);
    tick(w, 120);
    expect(gem.dead || !w.pickups.includes(gem)).toBe(true);
    expect(p1!.run.gems).toBe(1);
    expect(p2!.run.gems).toBe(0);
  });

  it('a gem in reach of only P2 is collected by P2', () => {
    const w = coopWorld(['spark', 'spark']);
    quiet(w);
    const p2 = w.players[1]!;
    w.dropXp(p2.x + 50, p2.y, 1);
    w.pickups[0]!.vx = w.pickups[0]!.vy = 0;
    const evs = tick(w, 60);
    expect(evs.some((ev) => ev.t === 'pickup' && ev.kind === 'xp' && ev.pid === 1)).toBe(true);
    expect(w.players[1]!.run.gems).toBe(1);
    expect(w.players[0]!.run.gems).toBe(0);
  });
});

describe('kill credit and relic scope', () => {
  it("a kill by P2's weapon is credited to P2", () => {
    const w = coopWorld(['spark', 'spark']);
    quiet(w);
    const [p1, p2] = w.players;
    p1!.x = -600;
    const e = w.spawnEnemy('drifter', p2!.x + 120, 0)!;
    e.speed = 0;
    let n = 0;
    while (!e.dead && n++ < 600) tick(w, 1);
    expect(e.dead).toBe(true);
    expect(p2!.run.kills).toBe(1);
    expect(p2!.run.damage).toBeGreaterThan(0);
    expect(p1!.run.kills).toBe(0);
    expect(w.runStats.kills).toBe(1);
  });

  it("Executioner only applies to its owner's hits", () => {
    const w = coopWorld(['spark', 'spark']);
    quiet(w);
    w.players[1]!.build.relics.push('exec');
    const e = w.spawnEnemy('brute', 400, 0)!;
    e.hp = e.maxHp * 0.1;
    w.damageEnemy(e, 0.001, false, 0, 0, 0, false, 0);
    expect(e.dead).toBe(false);
    w.damageEnemy(e, 0.001, false, 0, 0, 0, false, 1);
    expect(e.dead).toBe(true);
    expect(w.players[1]!.run.kills).toBe(1);
  });

  it("P2's Chrono Field slows every enemy", () => {
    const step = (chrono: boolean): number => {
      const w = coopWorld(['spark', 'spark']);
      quiet(w);
      if (chrono) w.players[1]!.build.relics.push('chrono');
      const e = w.spawnEnemy('drifter', w.players[0]!.x - 300, 0)!;
      e.spawnT = 0;
      const x0 = e.x;
      tick(w, 1);
      return e.x - x0;
    };
    expect(step(true) / step(false)).toBeCloseTo(0.88, 6);
  });
});

describe('difficulty scaling', () => {
  const base = {
    rate: (t: number) => 1.2 + 0.03 * t + 0.45 * pow(t / 60, 2),
    hp: (t: number) => 1 + t / 100 + pow(t / 220, 2.4),
  };

  it('solo multipliers are exactly the old formulas', () => {
    const d = new Director(makeRunConfig({ seed: 1 }));
    for (const t of [0, 13.7, 60, 299.5, 720]) {
      expect(d.rate(t)).toBe(base.rate(t));
      if (t <= 600) expect(d.hpMult(t)).toBe(base.hp(t));
    }
    expect(d.bossHpMult()).toBe(1);
  });

  it('co-op multiplies by the COOP_SCALING row', () => {
    const d = new Director(makeRunConfig({ seed: 1, players: [{ ship: 'spark' }, { ship: 'spark' }] }));
    const row = COOP_SCALING[2];
    for (const t of [0, 13.7, 60, 299.5]) {
      expect(d.rate(t)).toBe(base.rate(t) * row.spawn);
      expect(d.hpMult(t)).toBe(base.hp(t) * row.hp);
    }
    expect(d.bossHpMult()).toBe(row.bossHp);
    const w = coopWorld();
    const e = w.spawnEnemy('drifter', 500, 0)!;
    const solo = new World(makeRunConfig({ seed: 1 })).spawnEnemy('drifter', 500, 0)!;
    expect(e.maxHp).toBeCloseTo(solo.maxHp * row.hp, 9);
  });

  it('the opening wave scales with the player count', () => {
    const w = coopWorld(['spark', 'spark', 'spark', 'spark']);
    (w.director as unknown as Record<string, unknown>).budget = -1e9;
    tick(w, 40, []);
    expect(w.enemies.length).toBe(Math.round(12 * COOP_SCALING[4].opening));
  });
});

describe('spawn clearance', () => {
  it('co-op spawn points keep their distance from every active pilot', () => {
    const w = coopWorld(['spark', 'spark']);
    w.players[0]!.x = -600;
    w.players[1]!.x = 600;
    let close = 0;
    for (let i = 0; i < 200; i++) {
      const pt = w.spawnPoint(70);
      if (!w.clearOfPlayers(pt.x, pt.y, SPAWN_CLEARANCE)) close++;
    }
    expect(close).toBeLessThanOrEqual(4);
  });
});

describe('surge and boss clearance', () => {
  const edgeWorld = (axis: 'x' | 'y'): World => {
    const w = coopWorld(['spark', 'spark']);
    quiet(w);
    w.zoom = ZOOM_MAX;
    const half = w.maxSpan()[axis] / 2;
    w.players[0]!.x = axis === 'x' ? -half : 0;
    w.players[0]!.y = axis === 'y' ? -half : 0;
    w.players[1]!.x = axis === 'x' ? half : 0;
    w.players[1]!.y = axis === 'y' ? half : 0;
    return w;
  };
  const minDist = (w: World): number => {
    let m = Infinity;
    for (const e of w.enemies) for (const p of w.players) m = Math.min(m, Math.hypot(e.x - p.x, e.y - p.y));
    return m;
  };

  it('surge rings keep SPAWN_CLEARANCE from pilots at the edge of a spread team', () => {
    for (const axis of ['x', 'y'] as const) {
      const w = edgeWorld(axis);
      const d = w.director as unknown as { surgeT: number };
      let surges = 0;
      for (let i = 0; i < 20; i++) {
        w.enemies.length = 0;
        d.surgeT = 0;
        w.director.update(w, DT);
        surges += w.events.filter((ev) => ev.t === 'surge').length;
        w.events.length = 0;
        expect(w.enemies.length).toBeGreaterThan(0);
        expect(minDist(w)).toBeGreaterThanOrEqual(SPAWN_CLEARANCE);
      }
      expect(surges).toBe(20);
    }
  });

  it('a boss never enters on top of an edge pilot', () => {
    for (const axis of ['x', 'y'] as const) {
      const w = edgeWorld(axis);
      const spawnBoss = (w.director as unknown as { spawnBoss(w: World, k: string, t: string): void }).spawnBoss.bind(w.director);
      for (let i = 0; i < 40; i++) {
        w.enemies.length = 0;
        w.boss = null;
        spawnBoss(w, 'warden', 'Test');
        expect(w.enemies).toHaveLength(1);
        expect(minDist(w)).toBeGreaterThanOrEqual(SPAWN_CLEARANCE);
      }
    }
  });
});

describe('combat between pilots', () => {
  it('two pilots dashing through the same enemy hit it once each', () => {
    const w = coopWorld(['spark', 'spark']);
    quiet(w);
    for (const p of w.players) {
      p.build.weapons.length = 0;
      p.invuln = 1e9;
      p.x = -35;
      p.y = 0;
    }
    w.players[1]!.y = 10;
    const e = w.spawnEnemy('warden', 120, 0)!;
    e.hp = e.maxHp = 1e9;
    e.speed = 0;
    e.mass = 1e9;
    const dash: ControlInput = { mx: 1, my: 0, dash: true };
    const evs = [...tick(w, 1, [dash, dash]), ...tick(w, 30, [right, right])];
    expect(evs.filter((ev) => ev.t === 'hit')).toHaveLength(2);
    expect(w.players[0]!.run.damage).toBeGreaterThan(0);
    expect(w.players[1]!.run.damage).toBeGreaterThan(0);
  });

  it('enemy bullets hurt an up P2, and P2 can graze them with a perfect dash', () => {
    const w = coopWorld(['spark', 'spark']);
    quiet(w);
    const [p1, p2] = w.players;
    p1!.x = -400;
    p2!.invuln = 0;
    w.fireBullet(p2!.x + 40, p2!.y, Math.PI, 300, 10);
    const evs = tick(w, 20);
    expect(evs.some((ev) => ev.t === 'hurt' && ev.pid === 1)).toBe(true);
    expect(evs.some((ev) => ev.t === 'hurt' && ev.pid === 0)).toBe(false);
    expect(p2!.hp).toBeLessThan(p2!.stats.maxHp);
    expect(p1!.hp).toBe(p1!.stats.maxHp);

    const hp = p2!.hp;
    p2!.invuln = 0;
    w.fireBullet(p2!.x + 60, p2!.y, Math.PI, 300, 10);
    const evs2 = [...tick(w, 1, [still, { mx: 1, my: 0, dash: true }]), ...tick(w, 8)];
    expect(evs2.some((ev) => ev.t === 'perfect' && ev.pid === 1)).toBe(true);
    expect(p2!.hp).toBe(hp);
  });

  it('orbit blades keep a hit timer per pilot (two Vanguards both hit)', () => {
    const w = coopWorld(['vanguard', 'vanguard']);
    quiet(w);
    for (const p of w.players) {
      p.x = 0;
      p.y = 0;
      p.invuln = 1e9;
    }
    const e = w.spawnEnemy('brute', 70, 0)!;
    e.hp = e.maxHp = 1e9;
    e.speed = 0;
    e.mass = 1e9;
    let both = false;
    for (let i = 0; i < 240 && !both; i++) {
      tick(w, 1);
      both = e.orbitHitT[0] === w.time && e.orbitHitT[1] === w.time;
    }
    expect(both).toBe(true);
    expect(w.players[0]!.run.damage).toBeGreaterThan(0);
    expect(w.players[1]!.run.damage).toBeGreaterThan(0);
  });

  it("follow rings and evolved lance beams track their owner, not P1", () => {
    const w = coopWorld(['spark', 'spark']);
    quiet(w);
    const [p1, p2] = w.players;
    p2!.build.weapons = [{ id: 'lance', level: 1, evolved: true, timer: 0, phase: 0 }];
    const e = w.spawnEnemy('brute', p2!.x + 200, 0)!;
    e.hp = e.maxHp = 1e9;
    e.speed = 0;
    w.addRing(p2!.x, p2!.y, 300, 2, 1, 0, true, '#fff', 0, 1);
    tick(w, 1);
    const ring = w.rings.find((r) => r.owner === 1)!;
    const beam = w.beams.find((b) => b.owner === 1)!;
    expect(ring).toBeDefined();
    expect(beam).toBeDefined();
    tick(w, 10, [still, { mx: 0, my: 1, dash: false }]);
    expect(p2!.y).toBeGreaterThan(10);
    for (const fx of [ring, beam]) {
      expect(fx.x).toBe(p2!.x);
      expect(fx.y).toBe(p2!.y);
      expect(fx.y).not.toBe(p1!.y);
    }
  });

  it('Nova Burst makes one ring per up pilot', () => {
    const w = coopWorld(['spark', 'spark', 'spark']);
    quiet(w);
    down(w, 2);
    w.rings.length = 0;
    (w as unknown as { triggerMilestone(n: string): void }).triggerMilestone('NOVA BURST');
    expect(w.rings.map((r) => r.owner)).toEqual([0, 1]);
    expect(w.rings.map((r) => r.x)).toEqual([w.players[0]!.x, w.players[1]!.x]);
  });

  it('Vampiric Core heals only the pilot who owns it and lands the kill', () => {
    const w = coopWorld(['spark', 'spark']);
    quiet(w);
    const [p1, p2] = w.players;
    p2!.build.relics.push('vamp');
    p1!.hp = 10;
    p2!.hp = 10;
    // Kills by P1 never trigger P2's relic.
    for (let i = 0; i < 200; i++) w.killEnemy(w.spawnEnemy('drifter', 500, 0)!, false, 0);
    expect(p1!.hp).toBe(10);
    expect(p2!.hp).toBe(10);
    for (let i = 0; i < 200; i++) w.killEnemy(w.spawnEnemy('drifter', 500, 0)!, false, 1);
    expect(p2!.hp).toBeGreaterThan(10);
    expect(p1!.hp).toBe(10);
  });
});

describe('bots in co-op', () => {
  it('two identical 2-player bot runs are identical (determinism)', () => {
    const play = () => {
      const w = coopWorld(['spark', 'vanguard'], 77);
      const rngs = [new Rng(1), new Rng(2)];
      for (let i = 0; i < 60 * 45 && !w.gameOver; i++) {
        w.update(DT, w.players.map((p) => botInput(w, rngs[p.pid]!, { skill: 0.6 }, p.pid)));
        botResolvePending(w, rngs[0]!, (o, pid) => applyOffer(w, o, pid));
        w.events.length = 0;
      }
      return {
        score: w.score,
        kills: w.runStats.kills,
        level: w.level,
        enemies: w.enemies.length,
        players: w.players.map((p) => ({ x: p.x, y: p.y, hp: p.hp, build: p.build, kills: p.run.kills })),
      };
    };
    const a = play();
    expect(a.level).toBeGreaterThan(2);
    expect(a.players[1]!.kills).toBeGreaterThan(0);
    expect(a).toEqual(play());
  });

  it('a bot can drive P2', () => {
    const w = coopWorld(['spark', 'spark']);
    quiet(w);
    const p2 = w.players[1]!;
    const e = w.spawnEnemy('drifter', p2.x + 60, p2.y)!;
    e.speed = 0;
    expect(botInput(w, new Rng(1), { skill: 1 }, 1).mx).toBeLessThan(0);
  });

  it('a bot goes to revive a downed teammate, and a ghost bot floats toward help', () => {
    const w = coopWorld(['spark', 'spark']);
    quiet(w);
    const [p1, p2] = w.players;
    p1!.x = -300;
    p2!.x = 0;
    down(w, 0);
    const toP1 = botInput(w, new Rng(1), { skill: 0.6 }, 1);
    expect(toP1.mx).toBeLessThan(-0.9);
    const ghost = botInput(w, new Rng(1), { skill: 0.6 }, 0);
    expect(ghost.mx).toBeGreaterThan(0.9);
    expect(ghost.dash).toBe(false);
    // Played out, the bot actually revives P1.
    const rngs = [new Rng(1), new Rng(2)];
    for (let i = 0; i < 60 * 8 && p1!.downed; i++) {
      w.update(DT, w.players.map((p) => botInput(w, rngs[p.pid]!, { skill: 0.6 }, p.pid)));
      w.events.length = 0;
    }
    expect(p1!.downed).toBe(false);
    expect(p2!.run.revivesGiven).toBe(1);
  });

  it('simulateRun plays a co-op run and keeps solo untouched', () => {
    const r = simulateRun({ seed: 5, players: ['spark', 'vanguard'] }, 60);
    expect(r.players).toBe(2);
    expect(r.builds).toHaveLength(2);
    expect(r.kills).toBeGreaterThan(50);
    const solo = simulateRun({ seed: 77, rank: 1 }, 45);
    expect([solo.score, solo.kills, solo.level]).toEqual([2395, 94, 5]);
  });
});
