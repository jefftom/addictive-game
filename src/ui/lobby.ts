import type { InputSlot, MenuAction } from '../core/bindings';
import { MAX_PLAYERS } from '../game/content/coop';
import type { ShipId } from '../game/types';

/** A co-op roster device: a real input slot, or a bot-driven pilot (testing / `?bots`). */
export type RosterDevice = InputSlot | 'bot';

export interface RosterEntry {
  device: RosterDevice;
  ship: ShipId;
}

export interface LobbySlot extends RosterEntry {
  ready: boolean;
}

/** Seconds from "everyone ready" to launch. */
export const LOBBY_COUNTDOWN = 2;
export const MIN_COOP_PILOTS = 2;

/**
 * Co-op lobby state (pure: no DOM, unit-tested in tests/lobby.test.ts).
 *
 * Rules:
 * - A device's confirm joins it into the lowest free slot; one slot per device.
 * - Slots stay packed: when a pilot leaves, later pilots move up, so the slot
 *   index shown in the lobby (P#, colour) is always the pid they will fly as.
 * - Default ship: the device's remembered ship (last roster), else `p1Ship`
 *   for the first slot, else the next unlocked ship nobody has picked yet
 *   (duplicates are allowed once every unlocked ship is taken).
 * - left / right cycle the unlocked ships while not ready; confirm readies;
 *   back un-readies, or leaves when not ready.
 * - With 2+ pilots joined and all ready, a 2 s countdown starts. Any change
 *   cancels it. When it runs out, update() returns 'start' once.
 */
export class CoopLobby {
  slots: (LobbySlot | null)[] = [null, null, null, null];
  /** Seconds left before launch; -1 = idle. */
  countdown = -1;
  private started = false;
  private readonly unlocked: ShipId[];
  private readonly remembered = new Map<RosterDevice, ShipId>();

  constructor(
    unlocked: readonly ShipId[],
    private readonly p1Ship: ShipId,
    prev: readonly RosterEntry[] = [],
  ) {
    this.unlocked = unlocked.length > 0 ? [...unlocked] : [p1Ship];
    for (const r of prev) if (this.unlocked.includes(r.ship)) this.remembered.set(r.device, r.ship);
  }

  /** Joined pilots in slot (= pid) order. */
  joined(): LobbySlot[] {
    return this.slots.filter((s): s is LobbySlot => s !== null);
  }

  /** Slot index of a device, or -1. */
  indexOf(device: RosterDevice): number {
    return this.slots.findIndex((s) => s !== null && s.device === device);
  }

  allReady(): boolean {
    const j = this.joined();
    return j.length >= MIN_COOP_PILOTS && j.every((s) => s.ready);
  }

  /** The roster to launch with (joined slots, packed, in pid order). */
  roster(): RosterEntry[] {
    return this.joined().map((s) => ({ device: s.device, ship: s.ship }));
  }

  /** Applies a menu action from a device. Returns true if the lobby changed (re-render). */
  action(device: RosterDevice, a: MenuAction): boolean {
    if (this.started) return false;
    const i = this.indexOf(device);
    if (i < 0) {
      if (a !== 'confirm') return false;
      return this.join(device);
    }
    const s = this.slots[i]!;
    let changed = false;
    if (a === 'back') {
      if (s.ready) s.ready = false;
      else this.leave(i);
      changed = true;
    } else if (a === 'confirm') {
      if (!s.ready) {
        s.ready = true;
        changed = true;
      }
    } else if ((a === 'left' || a === 'right') && !s.ready) {
      changed = this.cycle(i, a === 'left' ? -1 : 1);
    }
    if (changed) this.touch();
    return changed;
  }

  /** Joins a device into the lowest free slot. Bots join ready. */
  join(device: RosterDevice, ship?: ShipId): boolean {
    if (this.started) return false;
    if (device !== 'bot' && this.indexOf(device) >= 0) return false;
    const free = this.slots.findIndex((s) => s === null);
    if (free < 0 || free >= MAX_PLAYERS) return false;
    const pick = ship && this.unlocked.includes(ship) ? ship : this.defaultShip(device, free);
    this.slots[free] = { device, ship: pick, ready: device === 'bot' };
    this.touch();
    return true;
  }

  /** Removes the pilot in slot `i` and packs the slots behind it. */
  leave(i: number): boolean {
    if (!this.slots[i]) return false;
    const rest = this.slots.filter((s, k) => s !== null && k !== i);
    this.slots = [0, 1, 2, 3].map((k) => rest[k] ?? null);
    this.touch();
    return true;
  }

  /** Steps the slot's ship through the unlocked list. */
  cycle(i: number, dir: -1 | 1): boolean {
    const s = this.slots[i];
    if (!s || s.ready || this.unlocked.length < 2) return false;
    const k = this.unlocked.indexOf(s.ship);
    const n = this.unlocked.length;
    s.ship = this.unlocked[(((k < 0 ? 0 : k) + dir) % n + n) % n]!;
    if (s.device !== 'bot') this.remembered.set(s.device, s.ship);
    this.touch();
    return true;
  }

  /** Mouse / touch toggle for a slot's ready state. */
  toggleReady(i: number): boolean {
    const s = this.slots[i];
    if (!s) return false;
    s.ready = !s.ready;
    this.touch();
    return true;
  }

  /** Advances the countdown. Returns 'start' once, when it runs out. */
  update(dt: number): 'start' | null {
    if (this.started || this.countdown < 0) return null;
    this.countdown -= dt;
    if (this.countdown <= 0) {
      this.countdown = 0;
      this.started = true;
      return 'start';
    }
    return null;
  }

  /** Removes a device (e.g. its controller disconnected). */
  drop(device: RosterDevice): boolean {
    const i = this.indexOf(device);
    return i >= 0 ? this.leave(i) : false;
  }

  private defaultShip(device: RosterDevice, slot: number): ShipId {
    const mem = this.remembered.get(device);
    if (mem) return mem;
    if (slot === 0 && this.unlocked.includes(this.p1Ship) && !this.joined().some((s) => s.ship === this.p1Ship)) return this.p1Ship;
    const taken = new Set(this.joined().map((s) => s.ship));
    const order = this.unlocked.includes(this.p1Ship) ? [this.p1Ship, ...this.unlocked.filter((id) => id !== this.p1Ship)] : this.unlocked;
    return order.find((id) => !taken.has(id)) ?? order[slot % order.length]!;
  }

  /** Any change cancels a running countdown; all-ready (re)starts it. */
  private touch(): void {
    this.countdown = this.allReady() ? LOBBY_COUNTDOWN : -1;
  }
}
