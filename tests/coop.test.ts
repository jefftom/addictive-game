import { describe, expect, it } from 'vitest';
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
    rate: (t: number) => 1.2 + 0.03 * t + 0.45 * Math.pow(t / 60, 2),
    hp: (t: number) => 1 + t / 100 + Math.pow(t / 220, 2.4),
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
