import { TAU, clamp } from '../core/math';
import { coopScaling, type CoopScaling } from './content/coop';
import { BOSS_SCHEDULE, ENEMIES, SPAWNABLE, VICTORY_TIME } from './content/enemies';
import type { Rng } from '../core/rng';
import type { EnemyKind, RunConfig } from './types';
import type { World } from './world';

const OVERTIME_BOSS_INTERVAL = 120;

/**
 * Decides what spawns and when. Spawn *timing and composition* come only from
 * the seeded spawn stream and the run clock, so a Daily Run plays out the
 * same way for everyone.
 */
export class Director {
  private budget = 0;
  private openingDone = false;
  /** The next enemy to spawn; the director saves budget until it can afford it. */
  private pendingKind: EnemyKind | null = null;
  private packSize = 6;
  private surgeT = 40;
  private eliteT = 45;
  private bossIdx = 0;
  private overtimeCycle = 0;
  private nextOvertimeBoss = VICTORY_TIME + OVERTIME_BOSS_INTERVAL;
  private readonly cfg: RunConfig;
  /** Co-op difficulty row (all 1 in solo). */
  private readonly scale: CoopScaling;

  constructor(cfg: RunConfig) {
    this.cfg = cfg;
    this.scale = coopScaling(cfg.players.length);
    this.eliteT = 45 * this.scale.eliteEvery;
  }

  /** Threat points per second. */
  rate(t: number): number {
    let r = 1.2 + 0.03 * t + 0.45 * Math.pow(t / 60, 2);
    if (this.cfg.daily === 'swarm') r *= 1.6;
    if (this.cfg.daily === 'giants') r *= 0.5;
    if (this.cfg.hardMode) r *= 1.15;
    return r * this.scale.spawn;
  }

  hpMult(t: number): number {
    let m = 1 + t / 100 + Math.pow(t / 220, 2.4);
    if (t > VICTORY_TIME) m += (t - VICTORY_TIME) / 20;
    return m * this.scale.hp;
  }

  speedMult(t: number): number {
    return 1 + Math.min(0.25, t / 1200);
  }

  dmgMult(t: number): number {
    return 1 + t / 300;
  }

  bossHpMult(): number {
    return (1 + this.overtimeCycle * 0.8) * this.scale.bossHp;
  }

  nextBossInfo(t: number): { name: string; at: number } | null {
    const next = BOSS_SCHEDULE[this.bossIdx];
    if (next) return { name: ENEMIES[next.kind].name, at: next.at };
    if (t >= VICTORY_TIME) {
      const kind = BOSS_SCHEDULE[this.overtimeCycle % BOSS_SCHEDULE.length]!.kind;
      return { name: ENEMIES[kind].name, at: this.nextOvertimeBoss };
    }
    return null;
  }

  update(world: World, dt: number): void {
    const t = world.time;
    const rng = world.spawnRng;

    // Opening wave: a loose ring just off the team so the first kills (and level-up) come fast.
    if (!this.openingDone && t >= 0.6) {
      this.openingDone = true;
      const c = world.teamCenter();
      const p = { x: c.x, y: c.y };
      const n = Math.round(12 * this.scale.opening);
      const offset = rng.next() * TAU;
      for (let i = 0; i < n; i++) {
        const a = offset + (i / n) * TAU;
        const d = 330 + rng.range(-30, 60);
        world.spawnEnemy('drifter', p.x + Math.cos(a) * d, p.y + Math.sin(a) * d);
      }
    }

    // Bosses.
    const scheduled = BOSS_SCHEDULE[this.bossIdx];
    if (scheduled && t >= scheduled.at) {
      this.bossIdx++;
      this.spawnBoss(world, scheduled.kind, scheduled.title);
    } else if (!scheduled && t >= this.nextOvertimeBoss) {
      const entry = BOSS_SCHEDULE[this.overtimeCycle % BOSS_SCHEDULE.length]!;
      this.overtimeCycle++;
      this.nextOvertimeBoss += OVERTIME_BOSS_INTERVAL;
      this.spawnBoss(world, entry.kind, 'Overtime');
    }

    // Continuous budget.
    const bossFactor = world.boss ? 0.4 : 1;
    this.budget = Math.min(60 * this.scale.spawn, this.budget + this.rate(t) * bossFactor * dt);
    if (this.pendingKind === null) this.pendingKind = this.chooseKind(t, rng);
    let guard = 0;
    while (this.pendingKind !== null && guard++ < 40) {
      const kind: EnemyKind = this.pendingKind;
      const def = ENEMIES[kind];
      const pack = kind === 'swarmling' ? this.packSize : 1;
      const cost = def.cost * pack;
      if (this.budget < cost) break;
      this.budget -= cost;
      if (pack > 1) {
        const pt = world.spawnPoint(80);
        for (let i = 0; i < pack; i++) world.spawnEnemy(kind, pt.x + rng.range(-40, 40), pt.y + rng.range(-40, 40));
      } else {
        const pt = world.spawnPoint(70);
        world.spawnEnemy(kind, pt.x, pt.y);
      }
      this.pendingKind = this.chooseKind(t, rng);
    }

    // Surges: a ring of enemies closing in from every side.
    this.surgeT -= dt;
    if (this.surgeT <= 0) {
      this.surgeT = 45;
      // Draw from the seeded stream unconditionally so the sequence never depends on play.
      const kind: EnemyKind = t > 150 && rng.chance(0.5) ? 'swarmling' : 'drifter';
      const offset = rng.next() * TAU;
      if (!world.boss) {
        const n = Math.round((12 + t / 10) * (this.cfg.daily === 'giants' ? 0.5 : 1) * this.scale.surge);
        const radius = Math.max(world.effHalfW(), world.effHalfH()) * 0.95 + 40;
        const c = world.teamCenter();
        const p = { x: c.x, y: c.y };
        for (let i = 0; i < n; i++) {
          const a = offset + (i / n) * TAU;
          world.spawnEnemy(kind, p.x + Math.cos(a) * radius, p.y + Math.sin(a) * radius);
        }
        world.events.push({ t: 'surge' });
      }
    }

    // Elites.
    this.eliteT -= dt;
    if (this.eliteT <= 0) {
      this.eliteT = (this.cfg.daily === 'bounty' ? 25 : 50) * this.scale.eliteEvery;
      const options = SPAWNABLE.filter((k) => k !== 'swarmling' && ENEMIES[k].unlockAt <= t);
      const kind = options.length > 0 ? rng.pick(options) : 'drifter';
      const pt = world.spawnPoint(80);
      world.spawnEnemy(kind, pt.x, pt.y, true);
    }
  }

  private chooseKind(t: number, rng: Rng): EnemyKind | null {
    const idx = rng.weightedIndex(SPAWNABLE.map((k) => this.weightFor(k, t)));
    if (idx < 0) return null;
    const kind = SPAWNABLE[idx]!;
    if (kind === 'swarmling') this.packSize = rng.int(5, 8);
    return kind;
  }

  private weightFor(kind: EnemyKind, t: number): number {
    const def = ENEMIES[kind];
    if (t < def.unlockAt) return 0;
    // Ramp new enemy types in over 30 seconds.
    const ramp = clamp((t - def.unlockAt) / 30, 0.25, 1);
    let w = def.weight * ramp;
    if (kind === 'drifter') w *= clamp(1.2 - t / 400, 0.35, 1);
    if (this.cfg.daily === 'swarm' && kind === 'swarmling') w *= 2;
    return w;
  }

  private spawnBoss(world: World, kind: EnemyKind, title: string): void {
    const c = world.teamCenter();
    const p = { x: c.x, y: c.y };
    const a = world.spawnRng.next() * TAU;
    const d = Math.min(world.effHalfW(), world.effHalfH()) * 0.9 + 120;
    const e = world.spawnEnemy(kind, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d);
    if (e) {
      e.fireT = 2;
      e.summonT = 5;
      e.stateT = 2;
    }
    world.events.push({ t: 'boss', name: ENEMIES[kind].name, title });
  }
}
