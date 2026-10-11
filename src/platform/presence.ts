/**
 * Rich presence helpers (pure). The desktop main process maps a validated Presence
 * to Steam keys (steam_display token + sector/ship/players/time/boss); see
 * desktop/validate.cjs and steam/rich_presence_english.vdf.
 */
import { BOSS_SCHEDULE } from '../game/content/enemies';
import type { ShipId } from '../game/types';
import type { BossId } from '../story/script';

export type PresenceMode = 'menu' | 'hangar' | 'run' | 'boss' | 'victory' | 'overtime' | 'results';

export interface Presence {
  mode: PresenceMode;
  /** 1-4: Turquoise Whorl, Garnet Nebula, Amethyst Abyss, Gilded Throne. */
  sector?: number;
  ship?: ShipId;
  /** Local pilots, 1-4. */
  players?: number;
  /** "m:ss" run clock. */
  time?: string;
  /** The capital ship on the field ('boss' mode only). */
  boss?: BossId;
}

export const PRESENCE_MODES: readonly PresenceMode[] = ['menu', 'hangar', 'run', 'boss', 'victory', 'overtime', 'results'];
const SHIPS: readonly ShipId[] = ['spark', 'vanguard', 'tempest', 'bastion', 'phantom'];
const BOSSES: readonly BossId[] = ['warden', 'hydra', 'voidheart'];

/** Run seconds -> "m:ss" (clamped to 0..999:59). */
export function formatPresenceTime(seconds: number): string {
  const s = Math.max(0, Math.min(999 * 60 + 59, Math.floor(Number.isFinite(seconds) ? seconds : 0)));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Approximate sector from the run clock (a new sector per boss in BOSS_SCHEDULE).
 * The sector actually changes when a boss dies, so callers that know it should pass it.
 */
export function sectorForTime(seconds: number, bossTimes: readonly number[] = BOSS_SCHEDULE.map((b) => b.at)): number {
  let sector = 1;
  for (const t of bossTimes) if (seconds >= t) sector++;
  return Math.min(4, sector);
}

const int = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : undefined;

/** Drops invalid fields; returns null when the mode itself is invalid. Mirrors desktop/validate.cjs. */
export function sanitizePresence(p: unknown): Presence | null {
  if (!p || typeof p !== 'object') return null;
  const r = p as Record<string, unknown>;
  if (typeof r.mode !== 'string' || !PRESENCE_MODES.includes(r.mode as PresenceMode)) return null;
  const out: Presence = { mode: r.mode as PresenceMode };
  const sector = int(r.sector, 1, 4);
  if (sector !== undefined) out.sector = sector;
  if (typeof r.ship === 'string' && SHIPS.includes(r.ship as ShipId)) out.ship = r.ship as ShipId;
  const players = int(r.players, 1, 4);
  if (players !== undefined) out.players = players;
  if (typeof r.time === 'string' && /^\d{1,3}:[0-5]\d$/.test(r.time)) out.time = r.time;
  // A boss fight without a known boss reads as a plain run (its token names the boss).
  if (out.mode === 'boss') {
    if (typeof r.boss === 'string' && BOSSES.includes(r.boss as BossId)) out.boss = r.boss as BossId;
    else out.mode = 'run';
  }
  return out;
}

export const menuPresence = (): Presence => ({ mode: 'menu' });
export const hangarPresence = (ship?: ShipId): Presence => (ship ? { mode: 'hangar', ship } : { mode: 'hangar' });

export interface RunPresenceInput {
  time: number;
  ship: ShipId;
  players?: number;
  sector?: number;
  victory?: boolean;
  overtime?: boolean;
  /** A capital ship is on the field. */
  boss?: BossId | null;
}

/** Overtime beats the victory screen, which beats a boss fight, which beats a plain run. */
export function runPresence(r: RunPresenceInput): Presence {
  const mode: PresenceMode = r.overtime ? 'overtime' : r.victory ? 'victory' : r.boss ? 'boss' : 'run';
  const out: Presence = {
    mode,
    sector: r.sector ?? sectorForTime(r.time),
    ship: r.ship,
    players: Math.max(1, Math.min(4, Math.round(r.players ?? 1))),
    time: formatPresenceTime(r.time),
  };
  if (mode === 'boss' && r.boss) out.boss = r.boss;
  return out;
}

export function resultsPresence(ship: ShipId, players = 1): Presence {
  return { mode: 'results', ship, players: Math.max(1, Math.min(4, players)) };
}

export interface PresenceThrottle {
  /** Queues `p`; a mode change (or null) is sent at once, same-mode updates at most every intervalMs. */
  update(p: Presence | null): void;
  /** Sends the latest queued value now. */
  flush(): void;
}

export interface ThrottleClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
}

const systemClock: ThrottleClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** Steam asks games not to spam rich presence; 10 s matches what friends lists show. */
export function createPresenceThrottle(
  send: (p: Presence | null) => void,
  intervalMs = 10_000,
  clock: ThrottleClock = systemClock,
): PresenceThrottle {
  let lastSent: string | undefined;
  let lastMode: PresenceMode | null | undefined;
  let lastAt = -Infinity;
  let queued: { p: Presence | null } | null = null;
  let timer: unknown = null;

  const emit = (p: Presence | null) => {
    const key = JSON.stringify(p);
    queued = null;
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
    if (key === lastSent) return;
    lastSent = key;
    lastMode = p ? p.mode : null;
    lastAt = clock.now();
    send(p);
  };

  return {
    update(p) {
      const mode = p ? p.mode : null;
      if (mode !== lastMode || clock.now() - lastAt >= intervalMs) {
        emit(p);
        return;
      }
      queued = { p };
      if (timer === null) {
        timer = clock.setTimeout(() => {
          timer = null;
          if (queued) emit(queued.p);
        }, Math.max(0, intervalMs - (clock.now() - lastAt)));
      }
    },
    flush() {
      if (queued) emit(queued.p);
    },
  };
}
