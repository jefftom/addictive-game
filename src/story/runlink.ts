/**
 * StoryRunLink: the glue between one simulated run and the StoryDirector.
 *
 * Pure (no DOM): the app calls it once per simulated frame with the world and
 * the frame's events, and it turns them into director inputs:
 *   - every GameEvent goes to director.onEvent with the event's own pid
 *     (player-scoped events carry one), so captains resolve per pilot in co-op;
 *   - 'sector' events become sector signals (the galaxy backdrop changed);
 *   - co-op 'downed' / 'revived' events become coopDown / coopRevive signals;
 *   - per-pilot low-HP threshold crossings become lowHp signals (re-armed once
 *     the pilot heals back above `rearm`);
 *   - the boss crossing 50% HP becomes a bossHalf signal (once per boss).
 * The app also forwards upgrade picks and the Overtime decision.
 */
import type { GameEvent } from '../game/types';
import type { World } from '../game/world';
import { bossIdFromName, type StoryDirector } from './director';

export interface RunLinkConfig {
  /** HP fraction below which a pilot counts as low (matches the HUD's red bar). */
  lowHp: number;
  /** HP fraction a pilot must heal back above before the next lowHp signal. */
  rearm: number;
}

export const DEFAULT_RUNLINK_CONFIG: RunLinkConfig = { lowHp: 0.3, rearm: 0.5 };

/** The parts of the world the link reads (keeps unit tests light). */
export type LinkWorld = Pick<World, 'players' | 'coop' | 'boss'>;

export type PickKind = 'weapon' | 'passive' | 'relic' | 'evolve' | 'bonus' | string;

export class StoryRunLink {
  readonly config: RunLinkConfig;
  private low: boolean[] = [];
  private bossEntity = -1;
  private bossHalfSent = false;

  constructor(
    readonly director: StoryDirector,
    config: Partial<RunLinkConfig> = {},
  ) {
    this.config = { ...DEFAULT_RUNLINK_CONFIG, ...config };
  }

  /** Starts the director's run for this world (queues the sector 0 opening). */
  startRun(world: LinkWorld, opts: { daily?: boolean; local?: number } = {}): void {
    this.low = world.players.map(() => false);
    this.bossEntity = -1;
    this.bossHalfSent = false;
    this.director.startRun({
      ships: world.players.map((p) => p.ship),
      daily: !!opts.daily,
      coop: world.coop,
      local: opts.local ?? 0,
    });
  }

  /** Feeds one simulated frame. Call before the app clears world.events. */
  frame(world: LinkWorld, events: readonly GameEvent[]): void {
    const d = this.director;
    for (const ev of events) {
      switch (ev.t) {
        case 'sector':
          d.signal({ kind: 'sector', index: ev.index });
          break;
        case 'downed':
          d.signal({ kind: 'coopDown', player: ev.pid });
          break;
        case 'revived':
          d.signal({ kind: 'coopRevive', player: ev.pid, by: ev.by });
          break;
        default:
          d.onEvent(ev, 'pid' in ev ? ev.pid : undefined);
          break;
      }
    }
    this.checkLowHp(world);
    this.checkBossHalf(world);
  }

  /** An upgrade or cache pick was applied for `pid`. */
  pick(kind: PickKind, cache: boolean, pid = 0): void {
    if (kind === 'evolve') this.director.signal({ kind: 'evolve', player: pid });
    else if (kind === 'relic') this.director.signal({ kind: 'relic', player: pid });
    else if (cache) this.director.signal({ kind: 'cache', player: pid });
  }

  /** The player chose to continue into Overtime after the victory card. */
  overtime(): void {
    this.director.signal({ kind: 'overtime' });
  }

  endRun(): void {
    this.director.endRun();
  }

  private checkLowHp(world: LinkWorld): void {
    const { lowHp, rearm } = this.config;
    for (const p of world.players) {
      const max = p.stats.maxHp;
      if (!(max > 0)) continue;
      const k = p.hp / max;
      if (!p.alive || p.downed) {
        this.low[p.pid] = false;
      } else if (!this.low[p.pid] && k > 0 && k < lowHp) {
        this.low[p.pid] = true;
        this.director.signal({ kind: 'lowHp', player: p.pid });
      } else if (this.low[p.pid] && k >= rearm) {
        this.low[p.pid] = false;
      }
    }
  }

  private checkBossHalf(world: LinkWorld): void {
    const b = world.boss;
    if (!b || b.dead) return;
    if (b.id !== this.bossEntity) {
      this.bossEntity = b.id;
      // A boss that spawns already under half (never in practice) does not bark.
      this.bossHalfSent = b.hp <= b.maxHp * 0.5;
    }
    if (!this.bossHalfSent && b.hp <= b.maxHp * 0.5) {
      this.bossHalfSent = true;
      this.director.signal({ kind: 'bossHalf', boss: bossIdFromName(b.kind) ?? undefined });
    }
  }
}
