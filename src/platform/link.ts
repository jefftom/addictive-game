/**
 * The game's side of the platform layer: what the App has to say to Steam (achievements,
 * rich presence, "a run just ended") turned into Platform calls. It holds no game logic and
 * never touches the simulation; the App hands it plain snapshots. Everything is a no-op on
 * the web platform. Unit tested without a DOM in tests/platform.test.ts.
 */
import type { ShipId } from '../game/types';
import type { BossId } from '../story/script';
import type { Platform } from './platform';
import { hangarPresence, menuPresence, resultsPresence, runPresence, type Presence } from './presence';

/** App states (src/app.ts) as far as rich presence cares. */
export type PresenceState = 'title' | 'lobby' | 'playing' | 'levelup' | 'paused' | 'victory' | 'dying' | 'results';

/** What the App knows at a given moment; enough to pick the rich presence. */
export interface PresenceSnapshot {
  state: PresenceState;
  /** UI screen on top while in a menu state (the Hangar and Workshop read as "in the shipyard"). */
  screen?: string;
  /** P1's ship in a run, the selected ship in menus. */
  ship: ShipId;
  /** The live run, or null in menus. */
  run: {
    /** Sim seconds. */
    time: number;
    /** world.sector (0-3). */
    sector: number;
    players: number;
    /** Past 10:00 and still flying. */
    overtime: boolean;
    /** The capital ship on the field, if any. */
    boss: BossId | null;
  } | null;
  /** Pilots of the last finished run (results screen). */
  lastPlayers?: number;
}

const SHIPYARD_SCREENS: ReadonlySet<string> = new Set(['hangar', 'workshop']);

/**
 * Rich presence for an App snapshot (steam.md 2.5): title and menus, the shipyard (Hangar,
 * Workshop, co-op lobby), a run with sector, clock, ship and pilot count, a boss fight, the
 * victory screen, Overtime, and the results.
 */
export function presenceFor(s: PresenceSnapshot): Presence {
  switch (s.state) {
    case 'title':
      return s.screen && SHIPYARD_SCREENS.has(s.screen) ? hangarPresence(s.ship) : menuPresence();
    case 'lobby':
      return hangarPresence(s.ship);
    case 'results':
      return resultsPresence(s.ship, s.lastPlayers ?? 1);
    default: {
      const r = s.run;
      if (!r) return menuPresence();
      return runPresence({
        time: r.time,
        ship: s.ship,
        players: r.players,
        sector: Math.max(1, Math.min(4, r.sector + 1)),
        victory: s.state === 'victory',
        overtime: r.overtime && s.state !== 'victory',
        boss: r.boss,
      });
    }
  }
}

/** Seconds between presence re-evaluations; the platform throttles what reaches Steam further. */
export const PRESENCE_EVERY = 1;

export class PlatformLink {
  private synced = false;
  private presenceT = 0;

  constructor(private readonly platform: Platform) {}

  /**
   * Startup re-sync: pushes every achievement the save has already earned (offline play,
   * unlocks Steam refused before the player's stats arrived, saves older than the Steam
   * release). Once per session; Steam skips the ones it already has.
   */
  syncAchievements(earned: readonly string[]): void {
    if (this.synced) return;
    this.synced = true;
    if (earned.length) this.platform.syncAchievements(earned);
  }

  /** Newly earned achievements (what checkAchievements returned). */
  unlocked(defs: readonly { id: string }[]): void {
    if (defs.length) this.platform.unlockAchievements(defs.map((a) => a.id));
  }

  /**
   * A run ended and the save was written: write the save file now (not 500 ms later),
   * retry queued achievement unlocks and store Steam stats.
   */
  runEnded(): void {
    void this.platform.flush();
  }

  /** True about once a second (call every frame with the real frame time). */
  presenceDue(realDt: number): boolean {
    this.presenceT -= realDt;
    if (this.presenceT > 0) return false;
    this.presenceT = PRESENCE_EVERY;
    return true;
  }

  setPresence(s: PresenceSnapshot): void {
    this.platform.setPresence(presenceFor(s));
  }
}
