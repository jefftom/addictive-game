import type { ControlInput } from '../game/types';

export type Device = 'keyboard' | 'touch' | 'gamepad' | 'mouse';

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

/**
 * Unified input: keyboard, mouse (hold to steer, right-click to dash),
 * touch (floating stick + dash button / second finger) and gamepad.
 * Values from touch are in *device* pixels to match the canvas HUD.
 */
export class Input {
  private keys = new Set<string>();
  private dashQueued = false;
  private pauseQueued = false;
  lastDevice: Device = 'keyboard';
  readonly stick: StickState = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0 };
  private mouseSteer = { active: false, x: 0, y: 0 };
  private padPrev: boolean[] = [];
  private padAxes = { x: 0, y: 0 };
  private padNavPrev: GamepadNav = { up: false, down: false, left: false, right: false, confirm: false, back: false, alt: false };
  /** Fired for menu navigation edges from a gamepad. */
  onPadNav: ((nav: GamepadNav) => void) | null = null;
  /** Whether the game is consuming movement (disables page-level key handling). */
  gameActive = false;
  private canvas: HTMLCanvasElement | null = null;
  private dpr = () => Math.min(2, window.devicePixelRatio || 1);
  /** Hit test for the on-screen dash button (device px). */
  dashButtonHit: (x: number, y: number) => boolean = () => false;
  stickRadius = 56;

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    window.addEventListener('keydown', (e) => {
      if (e.repeat) {
        if (this.gameActive && (MOVE_KEYS[e.code] || DASH_KEYS.has(e.code))) e.preventDefault();
        return;
      }
      this.lastDevice = 'keyboard';
      this.keys.add(e.code);
      if (this.gameActive) {
        if (DASH_KEYS.has(e.code)) {
          this.dashQueued = true;
          e.preventDefault();
        }
        if (MOVE_KEYS[e.code]) e.preventDefault();
      }
      if (PAUSE_KEYS.has(e.code)) this.pauseQueued = true;
    });
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

  private devicePos(e: PointerEvent): [number, number] {
    const rect = this.canvas!.getBoundingClientRect();
    const d = this.dpr();
    return [(e.clientX - rect.left) * d, (e.clientY - rect.top) * d];
  }

  private pointerDown(e: PointerEvent): void {
    if (!this.gameActive) return;
    const [x, y] = this.devicePos(e);
    if (e.pointerType === 'mouse') {
      this.lastDevice = 'mouse';
      if (e.button === 2) {
        this.dashQueued = true;
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

  /** Polls gamepads; call once per frame. */
  pollGamepad(): void {
    const pads = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const p of pads) {
      if (p && p.connected) {
        pad = p;
        break;
      }
    }
    if (!pad) {
      this.padAxes.x = 0;
      this.padAxes.y = 0;
      return;
    }
    const pressed = pad.buttons.map((b) => b.pressed || b.value > 0.5);
    const edge = (i: number) => !!pressed[i] && !this.padPrev[i];
    let ax = pad.axes[0] ?? 0;
    let ay = pad.axes[1] ?? 0;
    if (pressed[14]) ax = -1;
    if (pressed[15]) ax = 1;
    if (pressed[12]) ay = -1;
    if (pressed[13]) ay = 1;
    const mag = Math.hypot(ax, ay);
    if (mag < 0.2) {
      ax = 0;
      ay = 0;
    }
    this.padAxes.x = ax;
    this.padAxes.y = ay;
    if (mag >= 0.2 || pressed.some(Boolean)) this.lastDevice = 'gamepad';
    if (this.gameActive && (edge(0) || edge(5) || edge(4) || edge(7) || edge(6))) this.dashQueued = true;
    if (edge(9)) this.pauseQueued = true;

    const nav: GamepadNav = {
      up: ay < -0.6,
      down: ay > 0.6,
      left: ax < -0.6,
      right: ax > 0.6,
      confirm: !!pressed[0],
      back: !!pressed[1],
      alt: !!pressed[2],
    };
    const prev = this.padNavPrev;
    const navEdge: GamepadNav = {
      up: nav.up && !prev.up,
      down: nav.down && !prev.down,
      left: nav.left && !prev.left,
      right: nav.right && !prev.right,
      confirm: nav.confirm && !prev.confirm,
      back: nav.back && !prev.back,
      alt: nav.alt && !prev.alt,
    };
    this.padNavPrev = nav;
    if (!this.gameActive && this.onPadNav && Object.values(navEdge).some(Boolean)) this.onPadNav(navEdge);
    this.padPrev = pressed;
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

  consumePause(): boolean {
    const p = this.pauseQueued;
    this.pauseQueued = false;
    return p;
  }

  clearQueued(): void {
    this.dashQueued = false;
    this.pauseQueued = false;
  }

  releaseAll(): void {
    this.keys.clear();
    this.stick.active = false;
    this.mouseSteer.active = false;
    this.clearQueued();
  }

  isTouch(): boolean {
    return this.lastDevice === 'touch';
  }
}
