/**
 * Co-op device bindings, shared by Input (routing) and the UI (on-screen hints).
 *
 * Solo play does not use these tables: every device merges into P1 through the
 * solo maps in input.ts, exactly as before co-op existed.
 *
 * Two pilots can share one keyboard. Their key sets are disjoint, so a Steam
 * Remote Play guest typing on their own keyboard simply plays as kbB.
 *   kbA: WASD move · Space / LeftShift dash · E confirm · Q back · R reroll · 1 2 3 pick
 *   kbB: arrows move · RightShift / Numpad0 dash (RightCtrl on desktop only) ·
 *        Enter confirm · Backspace back/reroll · Numpad 1 2 3 pick
 * Enter is kbB's confirm and never a dash key, so the level-up anti-mash rule
 * ("the picker's dash keys never confirm") holds for both keyboard pilots.
 * RightCtrl is opt-in (`allowCtrl`) because in a browser RightCtrl + kbA's W is
 * Ctrl+W, which closes the tab and cannot be prevented.
 */

export type KeyboardSlot = 'kbA' | 'kbB';
export type PadSlot = 'pad0' | 'pad1' | 'pad2' | 'pad3';
export type InputSlot = KeyboardSlot | PadSlot;

export const INPUT_SLOTS: readonly InputSlot[] = ['kbA', 'kbB', 'pad0', 'pad1', 'pad2', 'pad3'];
export const PAD_SLOTS: readonly PadSlot[] = ['pad0', 'pad1', 'pad2', 'pad3'];

export type MenuAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'reroll' | 'pick0' | 'pick1' | 'pick2';
/** Which slot-routed menu is open: the co-op lobby, or a co-op level-up pick. */
export type MenuContext = 'lobby' | 'pick';

export interface KeyBinding {
  slot: KeyboardSlot;
  move?: readonly [number, number];
  dash?: boolean;
  /** Action in the co-op lobby. */
  lobby?: MenuAction;
  /** Action on a co-op level-up screen (never a dash key: anti-mash). */
  pick?: MenuAction;
}

type Entry = Omit<KeyBinding, 'slot'>;

const KB_A: Record<string, Entry> = {
  KeyW: { move: [0, -1], lobby: 'up', pick: 'up' },
  KeyS: { move: [0, 1], lobby: 'down', pick: 'down' },
  KeyA: { move: [-1, 0], lobby: 'left', pick: 'left' },
  KeyD: { move: [1, 0], lobby: 'right', pick: 'right' },
  Space: { dash: true, lobby: 'confirm' },
  ShiftLeft: { dash: true },
  KeyE: { lobby: 'confirm', pick: 'confirm' },
  KeyQ: { lobby: 'back' },
  KeyR: { pick: 'reroll' },
  Digit1: { pick: 'pick0' },
  Digit2: { pick: 'pick1' },
  Digit3: { pick: 'pick2' },
};

const KB_B: Record<string, Entry> = {
  ArrowUp: { move: [0, -1], lobby: 'up', pick: 'up' },
  ArrowDown: { move: [0, 1], lobby: 'down', pick: 'down' },
  ArrowLeft: { move: [-1, 0], lobby: 'left', pick: 'left' },
  ArrowRight: { move: [1, 0], lobby: 'right', pick: 'right' },
  ShiftRight: { dash: true },
  Numpad0: { dash: true },
  Enter: { lobby: 'confirm', pick: 'confirm' },
  NumpadEnter: { lobby: 'confirm', pick: 'confirm' },
  Backspace: { lobby: 'back', pick: 'reroll' },
  Numpad1: { pick: 'pick0' },
  Numpad2: { pick: 'pick1' },
  Numpad3: { pick: 'pick2' },
};

/** Desktop-only extra kbB dash key (see the file comment). */
const KB_B_CTRL: Entry = { dash: true };

/** Classifies a KeyboardEvent.code for co-op. Returns null for keys no pilot owns. */
export function slotForKey(code: string, allowCtrl: boolean): KeyBinding | null {
  const a = KB_A[code];
  if (a) return { slot: 'kbA', ...a };
  const b = KB_B[code];
  if (b) return { slot: 'kbB', ...b };
  if (code === 'ControlRight' && allowCtrl) return { slot: 'kbB', ...KB_B_CTRL };
  return null;
}

/** Every key code bound to a keyboard slot. */
export function slotKeys(slot: KeyboardSlot, allowCtrl = false): string[] {
  const keys = Object.keys(slot === 'kbA' ? KB_A : KB_B);
  if (slot === 'kbB' && allowCtrl) keys.push('ControlRight');
  return keys;
}

/** Movement vector for a held key, if it belongs to `slot`. */
export function moveFor(slot: KeyboardSlot, code: string): readonly [number, number] | undefined {
  return (slot === 'kbA' ? KB_A : KB_B)[code]?.move;
}

export function isPadSlot(slot: string): slot is PadSlot {
  return slot === 'pad0' || slot === 'pad1' || slot === 'pad2' || slot === 'pad3';
}

export function padIndex(slot: PadSlot): number {
  return Number(slot.slice(3));
}

/** Standard-mapping gamepad buttons. */
export const PAD = {
  a: 0,
  b: 1,
  x: 2,
  y: 3,
  lb: 4,
  rb: 5,
  lt: 6,
  rt: 7,
  start: 9,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
} as const;
export const PAD_DASH_BUTTONS: readonly number[] = [PAD.a, PAD.lb, PAD.rb, PAD.lt, PAD.rt];

/** On-screen labels for a device (lobby cards, level-up hint row). */
export interface DeviceLabels {
  /** Short device name, e.g. "Keyboard · WASD". */
  name: string;
  move: string;
  dash: string;
  join: string;
  /** Lobby ship ◀ ▶ keys. */
  cycle: string;
  confirm: string;
  back: string;
  reroll: string;
  /** Direct-pick keys for the three cards (null: none, e.g. a gamepad). */
  picks: readonly [string, string, string] | null;
}

export function deviceLabels(slot: InputSlot, allowCtrl = false): DeviceLabels {
  if (slot === 'kbA') {
    return { name: 'Keyboard · WASD', move: 'WASD', dash: 'SPACE', join: 'SPACE', cycle: 'A / D', confirm: 'E', back: 'Q', reroll: 'R', picks: ['1', '2', '3'] };
  }
  if (slot === 'kbB') {
    return {
      name: 'Keyboard · Arrows',
      move: 'ARROWS',
      dash: allowCtrl ? 'R-SHIFT / R-CTRL' : 'R-SHIFT',
      join: 'ENTER',
      cycle: '← / →',
      confirm: 'ENTER',
      back: 'BKSP',
      reroll: 'BKSP',
      picks: ['NUM1', 'NUM2', 'NUM3'],
    };
  }
  return { name: `Controller ${padIndex(slot) + 1}`, move: 'STICK', dash: 'Ⓐ', join: 'Ⓐ', cycle: 'D-PAD', confirm: 'Ⓐ', back: 'Ⓑ', reroll: 'Ⓧ', picks: null };
}
