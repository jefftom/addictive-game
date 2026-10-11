import type { ControlInput } from '../game/types';
import { INPUT_SLOTS, PAD, PAD_DASH_BUTTONS, isPadSlot, moveFor, padIndex, slotForKey, type InputSlot, type MenuAction, type MenuContext } from './bindings';

export type Device = 'keyboard' | 'touch' | 'gamepad' | 'mouse';

/** Solo maps: every keyboard key merges into P1 (co-op uses src/core/bindings.ts). */
const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, -1],
  ArrowUp: [0, -1],
  KeyS: [0, 1],
  ArrowDown: [0, 1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};
const DASH_KEYS = new Set(['Space', 'ShiftLeft', 'ShiftRight', 'KeyK', 'KeyJ']);
const PAUSE_KEYS = new Set(['Escape', 'KeyP']);

export interface StickState {
  active: boolean;
  id: number;
  ox: number;
  oy: number;
  x: number;
  y: number;
}

export interface GamepadNav {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
  confirm: boolean;
  back: boolean;
  alt: boolean;
}

/** Per-gamepad polling state (index = Gamepad.index, 0..3). */
interface PadState {
  connected: boolean;
  prev: boolean[];
  axes: { x: number; y: number };
  navPrev: GamepadNav;
}

const noNav = (): GamepadNav => ({ up: false, down: false, left: false, right: false, confirm: false, back: false, alt: false });

const NAV_ACTIONS: [keyof GamepadNav, MenuAction][] = [
  ['up', 'up'],
  ['down', 'down'],
  ['left', 'left'],
  ['right', 'right'],
  ['confirm', 'confirm'],
  ['back', 'back'],
  ['alt', 'reroll'],
];

const noSlots = (): Record<InputSlot, boolean> => ({ kbA: false, kbB: false, pad0: false, pad1: false, pad2: false, pad3: false });

/**
 * Unified input: keyboard, mouse (hold to steer, right-click to dash),
 * touch (floating stick + dash button / second finger) and gamepad.
 * Values from touch are in *device* pixels to match the canvas HUD.
 *
 * Solo mode (default, and always on touch): every device merges into P1 via
 * `read()`. Co-op mode: each pilot reads only their own device through
 * `readSlot()`; touch is ignored and the mouse steers kbA if kbA has joined.
 * While `menuMode` is set, keyboard and gamepad menu actions are routed per
 * device to `onMenu` (the co-op lobby and co-op level-up picks).
 */
export class Input {
  private keys = new Set<string>();
  private dashQueued = false;
  private pauseQueued = false;
  lastDevice: Device = 'keyboard';
  readonly stick: StickState = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  private mouseSteer = { active: false, x: 0, y: 0 };
  private padAxes = { x: 0, y: 0 };
  /** Fired for menu navigation edges from a gamepad (solo: the first pad; co-op: any pad). */
  onPadNav: ((nav: GamepadNav) => void) | null = null;

  /** 'coop' while a co-op run is live (set by the app). */
  mode: 'solo' | 'coop' = 'solo';
  /** Devices that joined the co-op run, in pid order. */
  slots: InputSlot[] = [];
  /** Slot-routed menu currently open ('none' = normal DOM menus). */
  menuMode: 'none' | MenuContext = 'none';
  /** Desktop (Electron) build only: RightCtrl is a kbB dash key (in a browser RightCtrl+W closes the tab). */
  allowCtrlDash = false;
  /** Per-device menu actions while `menuMode` is set. */
  onMenu: ((slot: InputSlot, action: MenuAction) => void) | null = null;
  /** A joined gamepad disconnected during a co-op run. */
  onSlotLost: ((slot: InputSlot) => void) | null = null;
  /** The set of connected gamepads changed (lobby hints). */
  onPadsChanged: (() => void) | null = null;
  private dashQueuedBy = noSlots();
  private readonly pads: PadState[] = [0, 1, 2, 3].map(() => ({ connected: false, prev: [], axes: { x: 0, y: 0 }, navPrev: noNav() }));
  /** Whether the game is consuming movement (disables page-level key handling). */
  gameActive = false;
  private canvas: HTMLCanvasElement | null = null;
  private dpr = () => Math.min(2, window.devicePixelRatio || 1);
  /** Hit test for the on-screen dash button (device px). */
  dashButtonHit: (x: number, y: number) => boolean = () => false;
  stickRadius = 56;

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    window.addEventListener('keydown', (e) => this.keyDown(e));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.stick.active = false;
      this.mouseSteer.active = false;
    });

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => this.pointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.pointerMove(e));
    const up = (e: PointerEvent) => this.pointerUp(e);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('lostpointercapture', up);
  }

  private keyDown(e: KeyboardEvent): void {
    const routed = this.menuMode !== 'none' || this.mode === 'coop';
    const b = routed ? slotForKey(e.code, this.allowCtrlDash) : null;
    const coopGame = this.mode === 'coop' && this.gameActive;
    if (e.repeat) {
      // Re-register held keys (they are cleared by releaseAll on pause/level-up) but skip edge actions.
      if (MOVE_KEYS[e.code]) this.keys.add(e.code);
      if (this.gameActive && (MOVE_KEYS[e.code] || DASH_KEYS.has(e.code))) e.preventDefault();
      if (b && (coopGame || this.menuMode !== 'none')) e.preventDefault();
      return;
    }
    this.lastDevice = 'keyboard';
    this.keys.add(e.code);
    if (this.menuMode !== 'none' && b) {
      // Bound keys never reach the page (no button activation, no scrolling, no browser back).
      e.preventDefault();
      const action = b[this.menuMode];
      if (action) this.onMenu?.(b.slot, action);
    }
    if (coopGame) {
      // Co-op: only the owning pilot's dash, and no browser shortcut on any game key.
      if (b) {
        e.preventDefault();
        if (b.dash && this.slots.includes(b.slot)) this.dashQueuedBy[b.slot] = true;
      } else if (e.code === 'ControlRight' || e.code === 'Tab') {
        e.preventDefault();
      }
    } else if (this.gameActive) {
      if (DASH_KEYS.has(e.code)) {
        this.dashQueued = true;
        e.preventDefault();
      }
      if (MOVE_KEYS[e.code]) e.preventDefault();
    }
    if (PAUSE_KEYS.has(e.code)) this.pauseQueued = true;
  }

  private devicePos(e: PointerEvent): [number, number] {
    const rect = this.canvas!.getBoundingClientRect();
    const d = this.dpr();
    return [(e.clientX - rect.left) * d, (e.clientY - rect.top) * d];
  }

  private pointerDown(e: PointerEvent): void {
    if (!this.gameActive) return;
    const [x, y] = this.devicePos(e);
    if (this.mode === 'coop') {
      // Touch is solo-only; the mouse belongs to kbA, if kbA joined.
      if (e.pointerType !== 'mouse' || !this.slots.includes('kbA')) return;
    }
    if (e.pointerType === 'mouse') {
      this.lastDevice = 'mouse';
      if (e.button === 2) {
        if (this.mode === 'coop') this.dashQueuedBy.kbA = true;
        else this.dashQueued = true;
      } else if (e.button === 0) {
        this.mouseSteer = { active: true, x, y };
        this.canvas?.setPointerCapture(e.pointerId);
      }
      return;
    }
    this.lastDevice = 'touch';
    e.preventDefault();
    if (this.dashButtonHit(x, y)) {
      this.dashQueued = true;
      return;
    }
    if (!this.stick.active) {
      this.stick.active = true;
      this.stick.id = e.pointerId;
      this.stick.ox = x;
      this.stick.oy = y;
      this.stick.x = x;
      this.stick.y = y;
      this.canvas?.setPointerCapture(e.pointerId);
    } else {
      // A second finger anywhere dashes.
      this.dashQueued = true;
    }
  }

  private pointerMove(e: PointerEvent): void {
    const [x, y] = this.devicePos(e);
    if (e.pointerType === 'mouse') {
      if (this.mouseSteer.active) {
        this.mouseSteer.x = x;
        this.mouseSteer.y = y;
      }
      return;
    }
    if (this.stick.active && e.pointerId === this.stick.id) {
      this.stick.x = x;
      this.stick.y = y;
      // Floating stick: drag the origin along when pulled far.
      const r = this.stickRadius * 1.6;
      const dx = x - this.stick.ox;
      const dy = y - this.stick.oy;
      const d = Math.hypot(dx, dy);
      if (d > r) {
        this.stick.ox = x - (dx / d) * r;
        this.stick.oy = y - (dy / d) * r;
      }
    }
  }

  private pointerUp(e: PointerEvent): void {
    if (e.pointerType === 'mouse') {
      if (e.button === 0 || e.type !== 'pointerup') this.mouseSteer.active = false;
      return;
    }
    if (this.stick.active && e.pointerId === this.stick.id) {
      this.stick.active = false;
      this.stick.id = -1;
    }
  }

  /**
   * Polls every gamepad; call once per frame. Solo reads the first connected
   * pad exactly as before co-op; co-op routes each pad to its own slot.
   */
  pollGamepad(): void {
    const list = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const seen: (Gamepad | null)[] = [null, null, null, null];
    let first = -1;
    for (const p of list) {
      if (!p || !p.connected || p.index < 0 || p.index > 3) continue;
      seen[p.index] = p;
      if (first < 0) first = p.index;
    }
    let changed = false;
    for (let i = 0; i < 4; i++) {
      const st = this.pads[i]!;
      const pad = seen[i];
      if (!pad) {
        if (st.connected) {
          st.connected = false;
          st.prev = [];
          st.navPrev = noNav();
          changed = true;
          const slot = INPUT_SLOTS[2 + i]!;
          if (this.mode === 'coop' && this.slots.includes(slot)) this.onSlotLost?.(slot);
        }
        st.axes.x = 0;
        st.axes.y = 0;
        continue;
      }
      if (!st.connected) changed = true;
      st.connected = true;
      this.pollPad(i, pad, i === first);
    }
    if (first < 0) {
      this.padAxes.x = 0;
      this.padAxes.y = 0;
    }
    if (changed) this.onPadsChanged?.();
  }

  private pollPad(i: number, pad: Gamepad, isFirst: boolean): void {
    const st = this.pads[i]!;
    const slot = INPUT_SLOTS[2 + i]!;
    const pressed = pad.buttons.map((b) => b.pressed || b.value > 0.5);
    const edge = (b: number) => !!pressed[b] && !st.prev[b];
    let ax = pad.axes[0] ?? 0;
    let ay = pad.axes[1] ?? 0;
    if (pressed[PAD.left]) ax = -1;
    if (pressed[PAD.right]) ax = 1;
    if (pressed[PAD.up]) ay = -1;
    if (pressed[PAD.down]) ay = 1;
    const mag = Math.hypot(ax, ay);
    if (mag < 0.2) {
      ax = 0;
      ay = 0;
    }
    st.axes.x = ax;
    st.axes.y = ay;
    const coop = this.mode === 'coop';
    if (isFirst && !coop) {
      this.padAxes.x = ax;
      this.padAxes.y = ay;
    }
    if (mag >= 0.2 || pressed.some(Boolean)) this.lastDevice = 'gamepad';
    if (this.gameActive && PAD_DASH_BUTTONS.some(edge)) {
      if (!coop) {
        if (isFirst) this.dashQueued = true;
      } else if (this.slots.includes(slot)) {
        this.dashQueuedBy[slot] = true;
      }
    }
    // Pause: the first pad in solo, any pad in co-op.
    if (edge(PAD.start) && (isFirst || coop)) this.pauseQueued = true;

    const nav: GamepadNav = {
      up: ay < -0.6,
      down: ay > 0.6,
      left: ax < -0.6,
      right: ax > 0.6,
      confirm: !!pressed[PAD.a],
      back: !!pressed[PAD.b],
      alt: !!pressed[PAD.x],
    };
    const prev = st.navPrev;
    const navEdge: GamepadNav = {
      up: nav.up && !prev.up,
      down: nav.down && !prev.down,
      left: nav.left && !prev.left,
      right: nav.right && !prev.right,
      confirm: nav.confirm && !prev.confirm,
      back: nav.back && !prev.back,
      alt: nav.alt && !prev.alt,
    };
    st.navPrev = nav;
    st.prev = pressed;
    if (!Object.values(navEdge).some(Boolean)) return;
    if (this.menuMode !== 'none') {
      for (const [k, action] of NAV_ACTIONS) if (navEdge[k]) this.onMenu?.(slot, action);
    } else if (!this.gameActive && this.onPadNav && (isFirst || coop)) {
      this.onPadNav(navEdge);
    }
  }

  /** Reads the control state for one simulation tick (dash is edge-triggered). */
  read(playerScreenX: number, playerScreenY: number): ControlInput {
    let mx = 0;
    let my = 0;
    for (const code of this.keys) {
      const v = MOVE_KEYS[code];
      if (v) {
        mx += v[0];
        my += v[1];
      }
    }
    if (this.stick.active) {
      const dx = this.stick.x - this.stick.ox;
      const dy = this.stick.y - this.stick.oy;
      const r = this.stickRadius;
      const d = Math.hypot(dx, dy);
      if (d > r * 0.12) {
        const k = Math.min(1, d / r);
        mx += (dx / d) * k;
        my += (dy / d) * k;
      }
    } else if (this.mouseSteer.active) {
      const dx = this.mouseSteer.x - playerScreenX;
      const dy = this.mouseSteer.y - playerScreenY;
      const d = Math.hypot(dx, dy);
      if (d > 12) {
        const k = Math.min(1, d / 120);
        mx += (dx / d) * k;
        my += (dy / d) * k;
      }
    }
    mx += this.padAxes.x;
    my += this.padAxes.y;
    const m = Math.hypot(mx, my);
    if (m > 1) {
      mx /= m;
      my /= m;
    }
    const dash = this.dashQueued;
    this.dashQueued = false;
    return { mx, my, dash };
  }

  /**
   * Co-op: the control state of one pilot's device for one tick (dash is
   * edge-triggered). The mouse steers kbA relative to that pilot's screen
   * position (device px).
   */
  readSlot(slot: InputSlot, playerScreenX: number, playerScreenY: number): ControlInput {
    let mx = 0;
    let my = 0;
    if (isPadSlot(slot)) {
      const st = this.pads[padIndex(slot)]!;
      if (st.connected) {
        mx += st.axes.x;
        my += st.axes.y;
      }
    } else {
      for (const code of this.keys) {
        const v = moveFor(slot, code);
        if (v) {
          mx += v[0];
          my += v[1];
        }
      }
      if (slot === 'kbA' && this.mouseSteer.active) {
        const dx = this.mouseSteer.x - playerScreenX;
        const dy = this.mouseSteer.y - playerScreenY;
        const d = Math.hypot(dx, dy);
        if (d > 12) {
          const k = Math.min(1, d / 120);
          mx += (dx / d) * k;
          my += (dy / d) * k;
        }
      }
    }
    const m = Math.hypot(mx, my);
    if (m > 1) {
      mx /= m;
      my /= m;
    }
    const dash = this.dashQueuedBy[slot];
    this.dashQueuedBy[slot] = false;
    return { mx, my, dash };
  }

  /** Solo (every device is P1) or co-op with the joined devices in pid order. */
  setMode(mode: 'solo' | 'coop', slots: readonly InputSlot[] = []): void {
    this.mode = mode;
    this.slots = mode === 'coop' ? [...slots] : [];
    this.releaseAll();
  }

  padConnected(i: number): boolean {
    return !!this.pads[i]?.connected;
  }

  /** Indices (0..3) of connected gamepads. */
  connectedPads(): number[] {
    const out: number[] = [];
    for (let i = 0; i < 4; i++) if (this.pads[i]!.connected) out.push(i);
    return out;
  }

  anyGamepad(): boolean {
    return this.pads.some((p) => p.connected);
  }

  consumePause(): boolean {
    const p = this.pauseQueued;
    this.pauseQueued = false;
    return p;
  }

  clearQueued(): void {
    this.dashQueued = false;
    this.pauseQueued = false;
    this.dashQueuedBy = noSlots();
  }

  /**
   * Drops pointer steering and queued actions when a menu opens. Held keys are
   * kept: keyup is tracked in every state, so a key still held when play
   * resumes keeps steering (they are cleared on window blur instead).
   */
  releaseAll(): void {
    this.stick.active = false;
    this.mouseSteer.active = false;
    this.clearQueued();
  }

  isTouch(): boolean {
    return this.lastDevice === 'touch';
  }
}
