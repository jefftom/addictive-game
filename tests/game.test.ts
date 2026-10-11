import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { botInput, botResolvePending } from '../src/game/bot';
import { MAX_PASSIVES } from '../src/game/content/passives';
import { MAX_WEAPONS, WEAPON_IDS } from '../src/game/content/weapons';
import { makeRunConfig, weaponPoolForRank } from '../src/game/runconfig';
import { computeStats, xpForLevel } from '../src/game/stats';
import type { ControlInput, PassiveId } from '../src/game/types';
import { applyOffer, availableEvolutions, generateOffers, offerKey } from '../src/game/upgrades';
import { DASH_TIME, MAX_ENEMIES, World } from '../src/game/world';

const DT = 1 / 60;
const still: ControlInput = { mx: 0, my: 0, dash: false };

function newWorld(seed = 1, rank = 1): World {
  return new World(makeRunConfig({ seed, rank }));
}

describe('stats', () => {
  it('xp requirement increases every level', () => {
    for (let l = 1; l < 80; l++) expect(xpForLevel(l + 1)).toBeGreaterThan(xpForLevel(l));
    expect(xpForLevel(1)).toBeLessThanOrEqual(5);
  });

  it('applies ship, workshop and passives', () => {
    const cfg = makeRunConfig({ seed: 1, ship: 'vanguard', workshop: { hull: 2, might: 1 } });
    const s = computeStats(cfg, { power: 2 }, []);
    expect(s.maxHp).toBe(100 + 40 + 20);
    expect(s.damage).toBeCloseTo(1.05 * 1.24);
    expect(s.armor).toBe(2);
  });

  it('unlocks weapons by rank', () => {
    expect(weaponPoolForRank(1)).not.toContain('seeker');
    expect(weaponPoolForRank(2)).toContain('seeker');
    expect(weaponPoolForRank(10)).toEqual(WEAPON_IDS);
  });
});

describe('upgrade offers', () => {
  it('offers distinct cards and always includes a weapon when possible', () => {
    for (let seed = 0; seed < 40; seed++) {
      const w = newWorld(seed);
      const offers = generateOffers(w, 3);
      expect(offers).toHaveLength(3);
      expect(new Set(offers.map(offerKey)).size).toBe(3);
      expect(offers.some((o) => o.kind === 'weapon')).toBe(true);
    }
  });

  it('respects slot limits', () => {
    const w = newWorld(5, 10);
    const rng = new Rng(5);
    for (let i = 0; i < 200; i++) applyOffer(w, rng.pick(generateOffers(w, 3)));
    expect(w.build.weapons.length).toBeLessThanOrEqual(MAX_WEAPONS);
    expect(Object.keys(w.build.passives).length).toBeLessThanOrEqual(MAX_PASSIVES);
    for (const lvl of Object.values(w.build.passives)) expect(lvl).toBeLessThanOrEqual(5);
  });

  it('puts an evolution first once a weapon is maxed and its partner is owned', () => {
    const w = newWorld(2);
    w.build.weapons[0]!.level = 5;
    expect(availableEvolutions(w)).toHaveLength(0);
    w.build.passives.overclock = 1;
    w.refreshStats();
    expect(availableEvolutions(w)).toEqual(['pulse']);
    const offers = generateOffers(w, 3);
    expect(offers[0]).toEqual({ kind: 'evolve', id: 'pulse' });
    applyOffer(w, offers[0]!);
    expect(w.build.weapons[0]!.evolved).toBe(true);
    expect(w.runStats.evolutions).toBe(1);
  });

  it('falls back to bonus cards when the build is complete', () => {
    const w = newWorld(3, 1);
    for (const id of ['orbit', 'nova', 'arc'] as const) w.addWeapon(id);
    for (const wp of w.build.weapons) {
      wp.level = 5;
      wp.evolved = true;
    }
    for (const id of ['power', 'amp', 'crit', 'thrusters'] as PassiveId[]) w.build.passives[id] = 5;
    w.refreshStats();
    const offers = generateOffers(w, 3);
    expect(offers.map((o) => o.kind).sort()).toEqual(['cores', 'heal', 'score']);
  });
});

describe('world simulation', () => {
  it('is fully deterministic for a seed and input sequence', () => {
    const run = () => {
      const w = newWorld(77);
      const rng = new Rng(9);
      for (let i = 0; i < 60 * 45; i++) {
        w.update(DT, botInput(w, rng));
        botResolvePending(w, rng, (o) => applyOffer(w, o));
        w.events.length = 0;
      }
      return { score: w.score, kills: w.runStats.kills, x: w.player.x, y: w.player.y, enemies: w.enemies.length, level: w.level };
    };
    expect(run()).toEqual(run());
  });

  it('runs two minutes with the bot without invalid state', () => {
    const w = newWorld(11);
    const rng = new Rng(11);
    let levelUps = 0;
    for (let i = 0; i < 60 * 120 && !w.gameOver; i++) {
      w.update(DT, botInput(w, rng));
      levelUps += w.events.filter((e) => e.t === 'levelup').length;
      botResolvePending(w, rng, (o) => applyOffer(w, o));
      w.events.length = 0;
      for (const e of w.enemies) {
        expect(Number.isFinite(e.x) && Number.isFinite(e.y)).toBe(true);
        expect(e.dead).toBe(false);
      }
      expect(Number.isFinite(w.player.x)).toBe(true);
    }
    expect(w.runStats.kills).toBeGreaterThan(50);
    expect(levelUps).toBeGreaterThan(4);
  });

  it('spawns the opening wave quickly', () => {
    const w = newWorld(4);
    for (let i = 0; i < 60; i++) w.update(DT, still);
    expect(w.enemies.length).toBeGreaterThanOrEqual(10);
  });

  it('dash grants invulnerability and consumes a charge', () => {
    const w = newWorld(1);
    w.update(DT, { mx: 1, my: 0, dash: true });
    expect(w.player.dashT).toBeGreaterThan(0);
    expect(w.player.dashCharges).toBe(0);
    expect(w.isPlayerInvulnerable()).toBe(true);
    const hp = w.player.hp;
    w.player.invuln = 0;
    w.hurtPlayer(50, w.player.x + 5, w.player.y);
    expect(w.player.hp).toBe(hp);
    for (let i = 0; i < Math.ceil(DASH_TIME / DT) + 30; i++) w.update(DT, still);
    expect(w.player.dashT).toBeLessThanOrEqual(0);
  });

  it('dashing through a bullet is a perfect dash that refunds cooldown and adds combo', () => {
    const w = newWorld(1);
    w.player.invuln = 0;
    w.update(DT, { mx: 1, my: 0, dash: true });
    const cooldown = w.stats.dashCooldown;
    expect(w.player.dashRecharge).toBeCloseTo(cooldown);
    w.fireBullet(w.player.x + 10, w.player.y, Math.PI, 10, 10);
    w.update(DT, still);
    expect(w.runStats.perfects).toBe(1);
    expect(w.combo).toBeGreaterThanOrEqual(3);
    expect(w.player.dashRecharge).toBeLessThan(cooldown * 0.5 + 0.05);
    // Only one perfect per dash.
    w.fireBullet(w.player.x + 10, w.player.y, Math.PI, 10, 10);
    w.update(DT, still);
    expect(w.runStats.perfects).toBe(1);
  });

  it('getting hit halves the combo and costs HP after armor', () => {
    const w = newWorld(1);
    w.player.invuln = 0;
    w.addCombo(40);
    w.hurtPlayer(20, w.player.x + 10, w.player.y);
    expect(w.combo).toBe(20);
    expect(w.player.hp).toBe(w.stats.maxHp - 20);
    expect(w.player.invuln).toBeGreaterThan(0);
  });

  it('killing an enemy drops a shard, scores and builds combo', () => {
    const w = newWorld(1);
    const e = w.spawnEnemy('drifter', 200, 0)!;
    w.damageEnemy(e, 9999, false, 1, 0, 0);
    expect(e.dead).toBe(true);
    expect(w.combo).toBe(1);
    expect(w.score).toBeGreaterThan(0);
    expect(w.pickups.some((p) => p.kind === 'xp')).toBe(true);
  });

  it('elites drop a cache that grants a bonus level-up', () => {
    const w = newWorld(1);
    const e = w.spawnEnemy('brute', 30, 0, true)!;
    w.damageEnemy(e, 1e9, false, 1, 0, 0);
    expect(w.pickups.some((p) => p.kind === 'cache')).toBe(true);
    for (let i = 0; i < 120; i++) w.update(DT, still);
    expect(w.pendingCaches).toBe(1);
  });

  it('a revive saves the player once', () => {
    const w = new World(makeRunConfig({ seed: 1, workshop: { revival: 1 } }));
    w.player.invuln = 0;
    w.hurtPlayer(9999, w.player.x + 1, w.player.y);
    expect(w.player.alive).toBe(true);
    expect(w.gameOver).toBe(false);
    w.player.invuln = 0;
    w.hurtPlayer(9999, w.player.x + 1, w.player.y);
    expect(w.gameOver).toBe(true);
  });

  it('spawns the Warden at 3:00', () => {
    const w = newWorld(1);
    w.time = 179.99;
    w.update(DT, still);
    expect(w.boss?.kind).toBe('warden');
    expect(w.events.some((e) => e.t === 'boss')).toBe(true);
  });
});

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

describe('regressions from code review', () => {
  it('a perfect-dash refund never delays a nearly ready charge (multi-charge ships)', () => {
    const w = new World(makeRunConfig({ seed: 5, ship: 'phantom' }));
    quiet(w);
    w.player.invuln = 0;
    w.update(DT, { mx: 1, my: 0, dash: true });
    while (w.player.dashRecharge > 0.2) w.update(DT, still);
    const remaining = w.player.dashRecharge;
    const e = w.spawnEnemy('drifter', w.player.x + 30, w.player.y)!;
    e.spawnT = 0;
    e.hp = e.maxHp = 1e9;
    w.update(DT, { mx: 1, my: 0, dash: true });
    expect(w.runStats.perfects).toBeGreaterThan(0);
    let ticks = 0;
    while (w.player.dashCharges < 1 && ticks < 600) {
      w.update(DT, still);
      ticks++;
    }
    expect(ticks * DT).toBeLessThan(remaining + 0.05);
  });

  it('each evolved lance beam hits an enemy at most once', () => {
    const w = new World(makeRunConfig({ seed: 7, rank: 10 }));
    quiet(w);
    w.build.weapons = [{ id: 'lance', level: 5, evolved: true, timer: 0, phase: 0 }];
    w.refreshStats();
    w.player.invuln = 1e9;
    const e = w.spawnEnemy('brute', w.player.x + 25, w.player.y + 25)!;
    e.spawnT = 0;
    e.hp = e.maxHp = 1e9;
    e.speed = 0;
    e.mass = 1e9;
    let hits = 0;
    for (let i = 0; i < 30; i++) {
      w.update(DT, still);
      hits += w.events.filter((ev) => ev.t === 'hit').length;
      w.events.length = 0;
      e.x = w.player.x + 25;
      e.y = w.player.y + 25;
      w.build.weapons[0]!.timer = 99;
    }
    expect(hits).toBeGreaterThan(0);
    expect(hits).toBeLessThanOrEqual(4);
  });

  it('keeps tracking a living boss when a newer one dies', () => {
    const w = newWorld(9);
    quiet(w);
    const warden = w.spawnEnemy('warden', 300, 0)!;
    const hydra = w.spawnEnemy('hydra', -300, 0)!;
    expect(w.boss).toBe(hydra);
    w.killEnemy(hydra);
    expect(w.boss).toBe(warden);
    w.killEnemy(warden);
    expect(w.boss).toBeNull();
  });

  it('the Daily Run spawn sequence does not depend on how the player moves', () => {
    const kinds = (input: ControlInput): string[] => {
      const w = new World(makeRunConfig({ seed: 1234, daily: 'swarm' }));
      const out: string[] = [];
      const seen = new Set<number>();
      // The enemy cap legitimately drops spawns, so only compare until it is reached.
      for (let i = 0; i < 60 * 90 && w.enemies.length < MAX_ENEMIES - 20; i++) {
        w.player.invuln = 99;
        w.player.hp = 1e6;
        w.update(DT, input);
        w.pendingLevelUps = 0;
        w.pendingCaches = 0;
        for (const e of w.enemies) {
          if (seen.has(e.id) || e.kind === 'splitling') continue;
          seen.add(e.id);
          out.push(e.kind);
        }
        w.events.length = 0;
      }
      return out;
    };
    const a = kinds(still);
    const b = kinds({ mx: 1, my: 0, dash: false });
    const n = Math.min(a.length, b.length);
    expect(n).toBeGreaterThan(100);
    expect(b.slice(0, n)).toEqual(a.slice(0, n));
  });
});

describe('galaxy sectors', () => {
  it('advance when a boss dies or the next boss arrives, emitting one event each', () => {
    const w = newWorld(3);
    expect(w.sector).toBe(0);
    w.time = 179.99;
    w.update(DT, still);
    const warden = w.enemies.find((e) => e.kind === 'warden')!;
    w.events.length = 0;
    w.killEnemy(warden);
    w.update(DT, still);
    expect(w.sector).toBe(1);
    expect(w.events.filter((e) => e.t === 'sector')).toEqual([{ t: 'sector', index: 1 }]);
    // The Hydra (6:00) is never killed; the Void Heart arriving at 9:00 moves us on anyway.
    w.time = 539.99;
    w.events.length = 0;
    w.update(DT, still);
    expect(w.sector).toBe(2);
    w.time = 600;
    w.update(DT, still);
    expect(w.sector).toBe(3);
    w.update(DT, still);
    expect(w.sector).toBe(3);
  });
});
