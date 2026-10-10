/**
 * EntityFx: draws every moving thing in SHARDSTORM's starship theme and turns
 * simulation events into spectacle.
 *
 *   - Allied vessels (players): baked hull + engine flames scaled by speed,
 *     banking on turns, exhaust ribbon, dash afterimages, running lights,
 *     shield bubble shimmer.
 *   - Alien armada: baked crystal hulls + animated sub-parts (orbiting buds,
 *     counter-rotating turrets, armour plates that break off) + additive cores
 *     that pulse / charge before attacks. Hit flash + squash along the knockback.
 *   - Capital ships: Warden gate fortress, Hydra hunter-cruiser, Void Heart hive
 *     mothership, each multi-part with readable attack telegraphs.
 *   - ShardFx: enemies shatter into their own polygon fragments on death.
 *   - Ribbon trails (bolts, missiles, enemy plasma), layered explosions,
 *     branching lightning.
 *
 * No per-frame shadowBlur: everything glowing is either baked or additive.
 * Respects `flashes` (reduced flashing): no strobes, dimmer flashes, slower
 * lightning re-jitter.
 */
import { TAU, angleDiff, clamp, damp } from '../core/math';
import { ENEMIES } from '../game/content/enemies';
import { SHIPS } from '../game/content/ships';
import type { Enemy, EnemyKind, GameEvent, Player, Projectile } from '../game/types';
import type { World } from '../game/world';
import type { Particles } from './particles';
import { ShardFx } from './shardfx';
import { ALIEN_ART, FLEET_GLOW, FLEET_RIM, SHIP_ART, VesselArt, fragmentsOf, mix, rgba, type Poly, type Sprite } from './vessels';

/** World→device transform and visible world rect for this frame. */
export interface FxView {
  k: number;
  ox: number;
  oy: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Lightning arc data, as stored by effects.ts `Arcs.items`. */
export interface ArcLike {
  points: number[];
  life: number;
  evolved: boolean;
  seed: number;
}

/** Fields the kill event needs for shatter (see NOTES.md). Optional so old events still render. */
interface KillFx {
  kind?: EnemyKind;
  angle?: number;
  kx?: number;
  ky?: number;
}

const ARC_LIFE = 0.16;
/** Lightning passes [width, colour ('' = arc colour), alpha]. */
const LIGHTNING_PASSES: [number, string, number][] = [
  [5, '', 0.16],
  [2.6, '#d4c8ff', 0.8],
  [1.2, '#ffffff', 1],
];
const LIGHTNING_PASSES_FX: [number, string, number][] = [
  [2.6, '#d4c8ff', 0.8],
  [1.2, '#ffffff', 1],
];
const TRAIL_N = 24;
/** Exhaust ribbon length cap (world units): <= 2.5 ship lengths. */
const TRAIL_LEN = 92;
/** Locator ring: enemies within this range of a pilot... */
const LOCATOR_RANGE = 190;
/** ...at least this many, fade the locator in. */
const LOCATOR_CROWD = 16;
const MISSILE_N = 10;
const NECKS = 3;
const NECK_SEGS = 6;

function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Afterimage tint for a class colour: half-way to the fleet rim (stays cool). */
function ghostColor(c: string): string {
  return mix(c, FLEET_RIM, 0.5);
}

function frac(n: number): number {
  return n - Math.floor(n);
}

/** Which way a vessel's hull faces (radians). Shared by drawing and shatter so fragments line up. */
export function visualAngle(kind: EnemyKind, angle: number, x: number, y: number, tx: number, ty: number): number {
  switch (kind) {
    case 'shooter':
    case 'brute':
      return Math.atan2(ty - y, tx - x);
    default:
      return angle;
  }
}

/**
 * Fills a tapered ribbon through pts (head first, flat x,y), width w0 at the head
 * narrowing to 0 at the tail, fading out along its length. One fill per ribbon.
 */
function ribbon(ctx: CanvasRenderingContext2D, pts: Float32Array, n: number, w0: number, color: string, alpha: number): void {
  if (n < 2) return;
  const hx = pts[0]!;
  const hy = pts[1]!;
  const tx = pts[(n - 1) * 2]!;
  const ty = pts[(n - 1) * 2 + 1]!;
  if (Math.abs(hx - tx) + Math.abs(hy - ty) < 0.5) return;
  ctx.beginPath();
  for (let side = 0; side < 2; side++) {
    for (let j = 0; j < n; j++) {
      const i = side === 0 ? j : n - 1 - j;
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      let dx = pts[b * 2]! - pts[a * 2]!;
      let dy = pts[b * 2 + 1]! - pts[a * 2 + 1]!;
      const l = Math.hypot(dx, dy) || 1;
      dx /= l;
      dy /= l;
      const w = w0 * 0.5 * (1 - i / (n - 1)) * (side === 0 ? 1 : -1);
      const x = pts[i * 2]! - dy * w;
      const y = pts[i * 2 + 1]! + dx * w;
      if (j === 0 && side === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
  }
  ctx.closePath();
  const g = ctx.createLinearGradient(hx, hy, tx, ty);
  g.addColorStop(0, rgbaCache(color, alpha));
  g.addColorStop(1, rgbaCache(color, 0));
  ctx.fillStyle = g;
  ctx.fill();
}

const rgbaMemo = new Map<string, string>();
function rgbaCache(color: string, a: number): string {
  const key = color + a.toFixed(2);
  let v = rgbaMemo.get(key);
  if (!v) {
    v = rgba(color, a);
    rgbaMemo.set(key, v);
  }
  return v;
}

class PilotFx {
  trail = new Float32Array(TRAIL_N * 2);
  head = 0;
  n = 0;
  prevAng = 0;
  bank = 0;
  init = false;
  ghostT = 0;
  gx: number[] = [];
  gy: number[] = [];
  ga: number[] = [];
  gl: number[] = [];
  shieldHit = 0;
  thrust = 0;
  /** Low-passed hull position feeding the exhaust history. */
  sx = 0;
  sy = 0;
  /** 0..1 crowd locator fade. */
  locator = 0;
}

class BossFx {
  spin = 0;
  spin2 = 0;
  heading = 0;
  charge = 0;
  necks = new Float32Array(NECKS * NECK_SEGS * 2);
  init = false;
  seen = 0;
}

interface MissileTrail {
  pts: Float32Array;
  head: number;
  n: number;
}

/** Short-lived flashes and shockwave rings. */
class Booms {
  private static CAP = 256;
  x = new Float32Array(Booms.CAP);
  y = new Float32Array(Booms.CAP);
  r = new Float32Array(Booms.CAP);
  t = new Float32Array(Booms.CAP);
  max = new Float32Array(Booms.CAP);
  w = new Float32Array(Booms.CAP);
  delay = new Float32Array(Booms.CAP);
  /** Peak alpha (flashes are capped so bloom cannot double them into veils). */
  peak = new Float32Array(Booms.CAP);
  kind = new Uint8Array(Booms.CAP); // 0 white-hot flash, 1 ring, 2 tinted fireball
  color: string[] = new Array<string>(Booms.CAP).fill('#ffffff');
  count = 0;

  add(kind: number, x: number, y: number, r: number, max: number, color: string, w = 2, delay = 0, peak = 1): void {
    let i = this.count;
    if (i >= Booms.CAP) {
      // Replace the most finished one.
      let best = 0;
      for (let j = 1; j < Booms.CAP; j++) if (this.t[j]! / this.max[j]! > this.t[best]! / this.max[best]!) best = j;
      i = best;
    } else this.count++;
    this.kind[i] = kind;
    this.x[i] = x;
    this.y[i] = y;
    this.r[i] = r;
    this.t[i] = 0;
    this.max[i] = max;
    this.w[i] = w;
    this.delay[i] = delay;
    this.peak[i] = peak;
    this.color[i] = color;
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.count) {
      if (this.delay[i]! > 0) {
        this.delay[i]! -= dt;
        i++;
        continue;
      }
      this.t[i]! += dt;
      if (this.t[i]! >= this.max[i]!) {
        const l = --this.count;
        this.kind[i] = this.kind[l]!;
        this.x[i] = this.x[l]!;
        this.y[i] = this.y[l]!;
        this.r[i] = this.r[l]!;
        this.t[i] = this.t[l]!;
        this.max[i] = this.max[l]!;
        this.w[i] = this.w[l]!;
        this.delay[i] = this.delay[l]!;
        this.peak[i] = this.peak[l]!;
        this.color[i] = this.color[l]!;
        continue;
      }
      i++;
    }
  }

  draw(ctx: CanvasRenderingContext2D, fx: EntityFx, v: FxView, flashK: number): void {
    for (let i = 0; i < this.count; i++) {
      if (this.delay[i]! > 0) continue;
      const k = this.t[i]! / this.max[i]!;
      const x = this.x[i]!;
      const y = this.y[i]!;
      const r = this.r[i]!;
      if (x + r * 1.2 < v.minX || x - r * 1.2 > v.maxX || y + r * 1.2 < v.minY || y - r * 1.2 > v.maxY) continue;
      if (this.kind[i] !== 1) {
        const a = (1 - k) * (1 - k) * flashK * this.peak[i]!;
        if (a < 0.01) continue;
        ctx.globalAlpha = a;
        const c = this.color[i]!;
        fx.blit(ctx, this.kind[i] === 2 ? fx.art.glow(c, c) : fx.art.glow(c), x, y, 0, (r * (0.55 + 0.45 * k)) / 8);
      } else {
        const e = 1 - (1 - k) * (1 - k) * (1 - k);
        const rr = r * (0.12 + 0.88 * e);
        ctx.setTransform(v.k, 0, 0, v.k, v.ox, v.oy);
        ctx.globalAlpha = Math.pow(1 - k, 1.4) * 0.85 * this.peak[i]!;
        ctx.strokeStyle = this.color[i]!;
        ctx.lineWidth = this.w[i]! * (1 - k) + 0.6;
        ctx.beginPath();
        ctx.arc(x, y, rr, 0, TAU);
        ctx.stroke();
        if (k < 0.35) {
          ctx.globalAlpha = (1 - k / 0.35) * 0.7;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = Math.max(0.6, this.w[i]! * 0.35);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
  }
}

export class EntityFx {
  readonly art = new VesselArt();
  readonly shards = new ShardFx();
  private readonly booms = new Booms();
  private pilots: PilotFx[] = [];
  private bosses = new Map<number, BossFx>();
  private missiles = new WeakMap<Projectile, MissileTrail>();
  /** Brute plate counts, to detect plates breaking off. */
  private plates = new Map<number, number>();
  private frags = new Map<string, number[][]>();
  private bossList: Enemy[] = [];
  private time = 0;
  private sweepT = 0;
  private frameId = 0;
  private scratch = new Float32Array(512);
  /** Reduced flashing accessibility setting (mirror of renderer.settings.flashes). */
  flashes = true;
  /**
   * True while a post-FX bloom pass is active: drops the lightning glow pass
   * (bloom supplies the halo). Pair with `setGlowScale(0.15)`.
   */
  postFx = false;
  /** Profiling: ms spent in the last frame's EntityFx calls. */
  ms = 0;

  setResolution(pxPerUnit: number): void {
    if (this.art.setResolution(pxPerUnit) || this.warm.length === 0) this.queueWarm();
  }

  /** Baked-glow multiplier (post-FX: 0.15, 2D fallback: 1). Re-queues the prewarm when it changes. */
  setGlowScale(s: number): void {
    if (s === this.art.glowScale) return;
    this.art.setGlowScale(s);
    this.queueWarm();
  }

  /**
   * Quality hook for an auto-quality controller (post-FX `costTier`, 4 = best … 0 = cheapest).
   * Scales shards and embers per kill: tier >= 2 full, tier 1 half, tier 0 about a third
   * (on top of the automatic crowd LOD above 400 live entries).
   */
  setCostTier(tier: number): void {
    this.shards.quality = tier <= 0 ? 0.35 : tier <= 1 ? 0.5 : 1;
  }

  /** Sprites still to pre-bake (spread over frames so first sightings never hitch). */
  private warm: (() => void)[] = [];

  private queueWarm(): void {
    const A = this.art;
    const w: (() => void)[] = [];
    const kinds: EnemyKind[] = ['drifter', 'swarmling', 'dasher', 'splitter', 'splitling', 'shooter', 'brute'];
    for (const k of kinds) {
      const d = ENEMIES[k];
      for (const [r, v] of [[d.r, 'normal'], [d.r, 'flash'], [d.r * 1.35, 'elite'], [d.r * 1.35, 'flash']] as const) {
        w.push(() => A.alien(k, d.color, r, v));
        if (k === 'splitter') w.push(() => A.part('splitRing', d.color, r, v === 'elite' ? 'normal' : v));
        if (k === 'shooter') w.push(() => A.part('shooterHex', d.color, r, v === 'elite' ? 'normal' : v));
        if (k === 'brute') {
          w.push(() => A.part('brutePlate', d.color, r, v));
          w.push(() => A.part('bruteFrontPlate', d.color, r, v));
        }
      }
      w.push(() => A.glow(d.color));
    }
    for (const id of Object.keys(SHIPS) as (keyof typeof SHIPS)[]) {
      const c = SHIPS[id].color;
      for (const v of ['normal', 'flash'] as const) w.push(() => A.ship(id, c, v));
      w.push(() => A.ship(id, ghostColor(c), 'ghost'));
      w.push(() => A.glow(c), () => A.flame(c));
    }
    w.push(() => A.glow('#ffffff'), () => A.glow('#ffc93c', '#ffc93c'), () => A.glow(FLEET_GLOW, FLEET_GLOW), () => A.missile('#ffb3f0'), () => A.shadow());
    for (const id of Object.keys(SHIP_ART) as (keyof typeof SHIP_ART)[]) w.push(() => A.shield('#7ff9ff', SHIP_ART[id].shieldR));
    // Bosses last (largest bakes): they appear minutes into a run.
    w.push(
      () => A.part('wardenHull', ENEMIES.warden.color, ENEMIES.warden.r),
      () => A.part('wardenOuter', ENEMIES.warden.color, ENEMIES.warden.r),
      () => A.part('wardenInner', ENEMIES.warden.color, ENEMIES.warden.r),
      () => A.part('hydraBody', ENEMIES.hydra.color, ENEMIES.hydra.r),
      () => A.part('hydraHead', ENEMIES.hydra.color, ENEMIES.hydra.r),
      () => A.part('hydraSeg', ENEMIES.hydra.color, ENEMIES.hydra.r),
      () => A.part('voidHull', ENEMIES.voidheart.color, ENEMIES.voidheart.r),
      () => A.part('voidSpires', ENEMIES.voidheart.color, ENEMIES.voidheart.r),
    );
    this.warm = w.reverse();
  }

  /** Bakes queued sprites for up to `budgetMs` (call from a loading screen with a large budget). */
  prewarm(budgetMs: number): boolean {
    const t0 = performance.now();
    while (this.warm.length > 0 && performance.now() - t0 < budgetMs) this.warm.pop()!();
    return this.warm.length === 0;
  }

  reset(): void {
    this.shards.clear();
    this.booms.count = 0;
    this.pilots = [];
    this.bosses.clear();
    this.plates.clear();
  }

  // ───────────────────────────── helpers ─────────────────────────────

  private v: FxView = { k: 1, ox: 0, oy: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 };

  /** Sets a transform: translate(x,y)·rotate(ang)·scale(sx,sy), optionally squashed along (kx,ky). */
  xf(ctx: CanvasRenderingContext2D, x: number, y: number, ang: number, sx: number, sy: number, sq = 0, kx = 0, ky = 0): void {
    const k = this.v.k;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    let a = c * sx;
    let b = s * sx;
    let cc = -s * sy;
    let d = c * sy;
    if (sq > 0.001) {
      const l = Math.hypot(kx, ky);
      if (l > 1) {
        const ux = kx / l;
        const uy = ky / l;
        const along = 1 - sq;
        const perp = 1 + sq * 0.6;
        const q11 = ux * ux * along + uy * uy * perp;
        const q12 = ux * uy * (along - perp);
        const q22 = uy * uy * along + ux * ux * perp;
        const na = q11 * a + q12 * b;
        const nb = q12 * a + q22 * b;
        const nc = q11 * cc + q12 * d;
        const nd = q12 * cc + q22 * d;
        a = na;
        b = nb;
        cc = nc;
        d = nd;
      } else {
        a *= 1 + sq * 0.4;
        b *= 1 + sq * 0.4;
        cc *= 1 + sq * 0.4;
        d *= 1 + sq * 0.4;
      }
    }
    ctx.setTransform(a * k, b * k, cc * k, d * k, this.v.ox + x * k, this.v.oy + y * k);
  }

  /** Draws a centred sprite at (x, y) with rotation and uniform scale. */
  blit(ctx: CanvasRenderingContext2D, s: Sprite, x: number, y: number, ang: number, scale: number): void {
    this.xf(ctx, x, y, ang, scale, scale);
    ctx.drawImage(s.canvas, -s.size / 2, -s.size / 2, s.size, s.size);
  }

  private img(ctx: CanvasRenderingContext2D, s: Sprite): void {
    ctx.drawImage(s.canvas, -s.size / 2, -s.size / 2, s.size, s.size);
  }

  private world(ctx: CanvasRenderingContext2D): void {
    ctx.setTransform(this.v.k, 0, 0, this.v.k, this.v.ox, this.v.oy);
  }

  private vis(x: number, y: number, r: number): boolean {
    const v = this.v;
    return x + r > v.minX && x - r < v.maxX && y + r > v.minY && y - r < v.maxY;
  }

  private fragments(key: string, outline: Poly, cx: number, cy: number, n: number): number[][] {
    const id = `${key}|${n}`;
    let f = this.frags.get(id);
    if (!f) {
      f = fragmentsOf(outline, cx, cy, n);
      this.frags.set(id, f);
    }
    return f;
  }

  // ───────────────────────────── frame ─────────────────────────────

  /** Call once per frame before drawing (sim dt freezes on pause; rdt is real time). */
  begin(view: FxView, dt: number, rdt: number): void {
    this.v = view;
    this.time += rdt;
    this.frameId++;
    this.shards.update(dt);
    this.booms.update(dt);
    this.shards.hotAlpha = this.flashes ? 0.9 : 0.4;
    this.shards.hotFill = this.flashes ? 1 : 0.6;
    this.sweepT -= rdt;
    if (this.warm.length > 0) this.prewarm(2);
  }

  // ───────────────────────────── events ─────────────────────────────

  onEvent(ev: GameEvent, world: World, P: Particles): void {
    switch (ev.t) {
      case 'kill':
        this.shatter(ev, ev as KillFx, world, P);
        break;
      case 'explode':
        this.explosion(ev.x, ev.y, ev.r, ev.color, P);
        break;
      case 'enemyshoot':
        this.booms.add(0, ev.x, ev.y, 16, 0.12, '#ff4f7a');
        break;
      case 'perfect':
        // A thin expanding ring (no filled disc: the old filled blast hid the ship mid-dash).
        this.booms.add(1, ev.x, ev.y, 90, 0.4, '#7ff9ff', 2, 0, 0.8);
        break;
      case 'dash': {
        const pf = this.pilot(ev.pid);
        pf.ghostT = 0;
        break;
      }
      case 'shieldbreak': {
        const pf = this.pilot(ev.pid);
        pf.shieldHit = 1;
        const pl = world.players[ev.pid] ?? world.players[0]!;
        const R = SHIP_ART[pl.ship].shieldR;
        const n = 12;
        for (let i = 0; i < n; i++) {
          const a0 = (i / n) * TAU;
          const a1 = ((i + 1) / n) * TAU;
          const am = (a0 + a1) / 2;
          const cx = ev.x + Math.cos(am) * R;
          const cy = ev.y + Math.sin(am) * R;
          this.shards.shard(cx, cy, Math.cos(a0) * R - (cx - ev.x), Math.sin(a0) * R - (cy - ev.y), Math.cos(a1) * R - (cx - ev.x), Math.sin(a1) * R - (cy - ev.y), -Math.cos(am) * 3, -Math.sin(am) * 3, Math.cos(am) * 160, Math.sin(am) * 160, (Math.random() - 0.5) * 10, 0.45, 0.14, '#7ff9ff');
        }
        this.booms.add(1, ev.x, ev.y, R * 2.2, 0.35, '#7ff9ff', 3);
        break;
      }
      default:
        break;
    }
  }

  private pilot(pid: number): PilotFx {
    let p = this.pilots[pid];
    if (!p) {
      p = new PilotFx();
      this.pilots[pid] = p;
    }
    return p;
  }

  /** Layered explosion: white flash, double shockwave, sparks and lingering embers. */
  explosion(x: number, y: number, r: number, color: string, P: Particles): void {
    // Big splashes (evolved seekers, singularity mines) keep a bounded fireball so they never veil the screen.
    const fr = Math.min(r, 70);
    // White flash <= 80 ms; tinted fireballs capped at alpha 0.6 (bloom roughly doubles them).
    this.booms.add(0, x, y, fr * 0.7, 0.08, '#ffffff');
    this.booms.add(2, x, y, fr * 1.3, 0.34, color, 2, 0, 0.6);
    this.booms.add(2, x, y, fr * 0.9, 0.5, mix(color, '#ff9f43', 0.5), 0, 0.05, 0.5);
    this.booms.add(1, x, y, r, 0.32, color, 3 + r * 0.04);
    this.booms.add(1, x, y, r * 1.35, 0.5, mix(color, '#ffffff', 0.4), 1.2);
    P.spray(x, y, 1, 0, '#ffffff', 6 + r * 0.06, 260 + r * 3, Math.PI);
    this.shards.embers(x, y, mix(color, '#ffd27a', 0.45), 8 + r * 0.12, 60 + r * 2, 0.9, 2.4);
  }

  /** Breaks a dead alien into its polygon fragments. */
  private shatter(ev: { x: number; y: number; color: string; r: number; elite: boolean; boss: boolean }, extra: KillFx, world: World, P: Particles): void {
    const kind = extra.kind ?? 'drifter';
    const art = ALIEN_ART[kind];
    // Nearest pilot: the one this vessel was facing (co-op targets the nearest pilot).
    let tgt = world.players[0]!;
    let best = Infinity;
    for (const pl of world.players) {
      const d = (pl.x - ev.x) ** 2 + (pl.y - ev.y) ** 2;
      if (d < best) {
        best = d;
        tgt = pl;
      }
    }
    const ang = visualAngle(kind, extra.angle ?? Math.random() * TAU, ev.x, ev.y, tgt.x, tgt.y);
    const kx = clamp(extra.kx ?? 0, -500, 500);
    const ky = clamp(extra.ky ?? 0, -500, 500);
    const r = ev.r;
    const color = ev.color;
    if (ev.boss) {
      this.shatterBoss(ev.x, ev.y, r, color, kind, ang, P);
      return;
    }
    const baseN = kind === 'swarmling' || kind === 'splitling' ? 4 : kind === 'brute' ? 9 : kind === 'splitter' ? 8 : 6;
    const sh = this.shards;
    let n = Math.max(2, Math.round((baseN + (ev.elite ? 3 : 0)) * sh.density));
    const ls = sh.lifeScale;
    const outline = kind === 'brute' ? art.outline.map((q) => q * 0.66) : art.outline;
    // ~0.12 s white-hot, then dim cooled debris; ~0.45 s in all (elites 0.6 s).
    this.spawnShards(this.fragments(kind + (kind === 'brute' ? 'k' : ''), outline, art.cx, art.cy, n), ev.x, ev.y, r, ang, color, kx, ky, 55 + r * 2.6, (ev.elite ? 0.6 : 0.45) * ls, ev.elite ? 0.16 : 0.12);
    if (kind === 'brute') {
      // The front plate is always the last one standing; it breaks off as big slabs.
      this.plateShards(ev.x, ev.y, r, ang, color, kx, ky, true);
    }
    // White-hot core flash + thin shockwave ring. Flash radius <= 2.5r, peak alpha <= 0.6.
    this.booms.add(0, ev.x, ev.y, r * (ev.elite ? 2.5 : 1.5), 0.08, '#ffffff', 2, 0, 0.6);
    this.booms.add(2, ev.x, ev.y, r * (ev.elite ? 2.5 : 2), 0.2, color, 2, 0, 0.5);
    this.booms.add(1, ev.x, ev.y, r * 2.6, 0.3, color, 1.6, 0, 0.8);
    if (ev.elite) {
      n = Math.max(3, Math.round(6 * sh.density));
      // Second, inner layer: white-hot core crystal.
      this.spawnShards(this.fragments(kind + 'in', art.outline, art.cx, art.cy, n), ev.x, ev.y, r * 0.55, ang + 0.5, mix(color, '#ffffff', 0.6), kx, ky, 160 + r * 4, 0.5 * ls, 0.25);
      this.booms.add(1, ev.x, ev.y, r * 4.2, 0.5, '#ffc93c', 3);
      this.booms.add(1, ev.x, ev.y, r * 3, 0.36, '#ffffff', 1.4, 0.06, 0.7);
      sh.embers(ev.x, ev.y, '#ffc93c', 16, 220, 1, 2.2);
    } else if (r >= 15) {
      sh.embers(ev.x, ev.y, mix(color, '#ffd27a', 0.5), 3, 110, 0.6, 1.6);
    }
  }

  private spawnShards(tris: number[][], x: number, y: number, r: number, ang: number, color: string, kx: number, ky: number, speed: number, life: number, heat: number): void {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    for (const t of tris) {
      // Centroid (unit) → world offset.
      const ux = (t[0]! + t[2]! + t[4]!) / 3;
      const uy = (t[1]! + t[3]! + t[5]!) / 3;
      const wx = (ux * c - uy * s) * r;
      const wy = (ux * s + uy * c) * r;
      const rel = (i: number) => {
        const lx = (t[i]! - ux) * r;
        const ly = (t[i + 1]! - uy) * r;
        return [lx * c - ly * s, lx * s + ly * c] as const;
      };
      const A = rel(0);
      const B = rel(2);
      const C = rel(4);
      const d = Math.hypot(wx, wy) || 1;
      const sp = speed * (0.6 + Math.random() * 0.8);
      const vx = (wx / d) * sp + kx * 0.45 + (Math.random() - 0.5) * 40;
      const vy = (wy / d) * sp + ky * 0.45 + (Math.random() - 0.5) * 40;
      const area = Math.abs((B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]));
      const spin = ((Math.random() - 0.5) * 18) / Math.max(1, Math.sqrt(area) * 0.25);
      this.shards.shard(x + wx, y + wy, A[0], A[1], B[0], B[1], C[0], C[1], vx, vy, spin, life * (0.75 + Math.random() * 0.5), heat, color);
    }
  }

  private plateShards(x: number, y: number, r: number, a: number, color: string, kx: number, ky: number, front: boolean): void {
    const ro = front ? 0.98 : 0.9;
    const plate: Poly = [0.62, -0.46, ro, -0.34, ro, 0.34, 0.62, 0.46];
    this.spawnShards(this.fragments(front ? 'plateF' : 'plate', plate, 0.78, 0, 3), x, y, r, a, color, kx, ky, 140, 0.6 * this.shards.lifeScale, 0.12);
  }

  /** Capital ship death: layered hull break-up plus a chain of secondary detonations. */
  private shatterBoss(x: number, y: number, r: number, color: string, kind: EnemyKind, ang: number, P: Particles): void {
    const art = ALIEN_ART[kind];
    // Outer armour → hull → white-hot core, each faster and hotter.
    // Boss shards stay hot longer (a capital ship's death is the show), then cool like any debris.
    this.spawnShards(this.fragments(kind + 'o', art.outline, art.cx, art.cy, 14), x, y, r * 1.05, ang, color, 0, 0, 150, 1.5, 0.3);
    this.spawnShards(this.fragments(kind + 'h', art.outline, art.cx, art.cy, 10), x, y, r * 0.62, ang + 0.3, mix(color, '#ffffff', 0.35), 0, 0, 240, 1.2, 0.45);
    this.spawnShards(this.fragments(kind + 'c', art.outline, art.cx, art.cy, 7), x, y, r * 0.3, ang + 0.7, '#ffffff', 0, 0, 340, 0.9, 0.6);
    // Chain of secondary detonations over the next second.
    for (let i = 0; i < 9; i++) {
      const a = Math.random() * TAU;
      const d = r * (0.3 + Math.random() * 0.8);
      const ex = x + Math.cos(a) * d;
      const ey = y + Math.sin(a) * d;
      const delay = 0.08 + i * 0.11;
      const rr = r * (0.35 + Math.random() * 0.3);
      this.booms.add(0, ex, ey, rr * 1.4, 0.1, '#ffffff', 0, delay, 0.7);
      this.booms.add(2, ex, ey, rr * 1.6, 0.3, color, 0, delay, 0.5);
      this.booms.add(1, ex, ey, rr * 1.6, 0.4, color, 2.5, delay);
    }
    this.booms.add(0, x, y, r * 2.5, 0.12, '#ffffff', 2, 0, 0.8);
    this.booms.add(2, x, y, r * 3.5, 0.7, color, 2, 0, 0.5);
    this.booms.add(1, x, y, r * 3, 0.55, '#ffffff', 5);
    this.booms.add(1, x, y, r * 6, 1.1, color, 6, 0.1);
    this.booms.add(1, x, y, r * 9, 1.5, mix(color, '#ffffff', 0.3), 2, 0.3);
    this.shards.embers(x, y, mix(color, '#ffd27a', 0.4), 70, 380, 2.2, 2.6);
    this.shards.embers(x, y, '#ffffff', 25, 260, 1.4, 2);
    P.burst(x, y, '#ffffff', 40, 520, 0.9, 3);
  }

  // ───────────────────────────── telegraphs ─────────────────────────────

  /** World-space attack telegraphs; draw before enemies. */
  drawTelegraphs(ctx: CanvasRenderingContext2D, world: World): void {
    const prevOp = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    this.world(ctx);
    const t = this.time;
    for (const e of world.enemies) {
      if (e.dead) continue;
      if ((e.kind === 'dasher' || e.kind === 'hydra') && e.state === 1) {
        const hydra = e.kind === 'hydra';
        const color = ENEMIES[e.kind].color;
        const len = hydra ? 640 : 300;
        const total = hydra ? (e.hp < e.maxHp * 0.5 ? 0.6 : 0.85) : 0.6;
        const prog = clamp(1 - e.stateT / total, 0, 1);
        const w = hydra ? e.r * 1.4 : 6;
        const ax = e.aimX;
        const ay = e.aimY;
        const nx = -ay;
        const ny = ax;
        // Corridor (review E5): additive fill <= 0.12 so what is under it stays visible,
        // bright edge rails, and a fuse SWEEP racing down the lane as the charge winds up.
        const reach = len * (0.35 + 0.65 * Math.min(1, prog * 1.6));
        const hw = w * 0.5;
        const quad = (d0: number, d1: number, ww: number) => {
          ctx.beginPath();
          ctx.moveTo(e.x + ax * d0 + nx * ww, e.y + ay * d0 + ny * ww);
          ctx.lineTo(e.x + ax * d1 + nx * ww, e.y + ay * d1 + ny * ww);
          ctx.lineTo(e.x + ax * d1 - nx * ww, e.y + ay * d1 - ny * ww);
          ctx.lineTo(e.x + ax * d0 - nx * ww, e.y + ay * d0 - ny * ww);
          ctx.closePath();
        };
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.04 + 0.03 * prog;
        quad(0, reach, hw);
        ctx.fill();
        // Fuse: a short bright band whose head sits at prog × reach (fills <= 0.12 in all).
        const head = reach * prog;
        const band = Math.min(head, hydra ? 90 : 50);
        if (band > 1) {
          const g = ctx.createLinearGradient(e.x + ax * (head - band), e.y + ay * (head - band), e.x + ax * head, e.y + ay * head);
          g.addColorStop(0, rgbaCache(color, 0));
          g.addColorStop(1, rgbaCache(color, 1));
          ctx.fillStyle = g;
          ctx.globalAlpha = 0.05;
          quad(head - band, head, hw * 0.9);
          ctx.fill();
        }
        ctx.globalAlpha = 0.3 + 0.3 * prog;
        ctx.strokeStyle = color;
        ctx.lineWidth = hydra ? 2 : 1.2;
        ctx.beginPath();
        ctx.moveTo(e.x + nx * hw, e.y + ny * hw);
        ctx.lineTo(e.x + ax * reach + nx * hw, e.y + ay * reach + ny * hw);
        ctx.moveTo(e.x - nx * hw, e.y - ny * hw);
        ctx.lineTo(e.x + ax * reach - nx * hw, e.y + ay * reach - ny * hw);
        ctx.stroke();
        // Fuse head: a bright cross-bar.
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = mix(color, '#ffffff', 0.5);
        ctx.lineWidth = hydra ? 2.5 : 1.5;
        ctx.beginPath();
        ctx.moveTo(e.x + ax * head + nx * hw, e.y + ay * head + ny * hw);
        ctx.lineTo(e.x + ax * head - nx * hw, e.y + ay * head - ny * hw);
        ctx.stroke();
        // Chevrons racing toward the target.
        const step = hydra ? 64 : 40;
        const cw = hydra ? hw * 0.5 : 6;
        const off = (t * (hydra ? 380 : 260)) % step;
        ctx.lineWidth = hydra ? 3 : 2;
        ctx.lineJoin = 'miter';
        ctx.strokeStyle = mix(color, '#ffffff', 0.6);
        ctx.beginPath();
        for (let d = e.r + off; d < reach - cw; d += step) {
          const cx = e.x + ax * d;
          const cy = e.y + ay * d;
          ctx.moveTo(cx - ax * cw * 0.8 + nx * cw, cy - ay * cw * 0.8 + ny * cw);
          ctx.lineTo(cx, cy);
          ctx.lineTo(cx - ax * cw * 0.8 - nx * cw, cy - ay * cw * 0.8 - ny * cw);
        }
        ctx.globalAlpha = 0.25 + 0.35 * prog;
        ctx.stroke();
        ctx.lineJoin = 'round';
      } else if (e.kind === 'warden' && e.spawnT <= 0) {
        // Burst spokes: preview of the next radial volley's lanes. Short (<= 2.4r, ~0.6 of the screen at 1x) and
        // faded with distance by a radial gradient, so at 1x they never starburst the frame.
        const enraged = e.hp < e.maxHp * 0.5;
        const lead = 0.9;
        if (e.fireT < lead) {
          const k = clamp(1 - e.fireT / lead, 0, 1);
          const n = enraged ? 22 : 16;
          const rate = enraged ? 0.9 : 0.5;
          const off = ((e.state + 1) % 2) * 0.2 + e.angle + rate * e.fireT;
          const r0 = e.r * 1.15;
          const r1 = e.r * (1.5 + 0.9 * k);
          const g = ctx.createRadialGradient(e.x, e.y, r0, e.x, e.y, r1);
          g.addColorStop(0, rgbaCache(ENEMIES.warden.color, 1));
          g.addColorStop(1, rgbaCache(ENEMIES.warden.color, 0));
          ctx.strokeStyle = g;
          ctx.lineWidth = 2;
          ctx.globalAlpha = 0.1 + 0.25 * k * k;
          ctx.setLineDash([10, 12]);
          ctx.lineDashOffset = -t * 60;
          ctx.beginPath();
          for (let i = 0; i < n; i++) {
            const a = off + (i / n) * TAU;
            ctx.moveTo(e.x + Math.cos(a) * r0, e.y + Math.sin(a) * r0);
            ctx.lineTo(e.x + Math.cos(a) * r1, e.y + Math.sin(a) * r1);
          }
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.lineDashOffset = 0;
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = prevOp;
  }

  // ───────────────────────────── aliens ─────────────────────────────

  drawEnemies(ctx: CanvasRenderingContext2D, world: World): void {
    const t = this.time;
    const P0 = world.players[0]!;
    const flashes = this.flashes;
    const bosses = this.bossList;
    bosses.length = 0;
    // Pass 1: crystal hulls and solid sub-parts (source-over).
    for (const e of world.enemies) {
      if (e.boss) {
        if (!e.dead) bosses.push(e);
        continue;
      }
      if (e.dead || !this.vis(e.x, e.y, e.r * 2)) continue;
      const def = ENEMIES[e.kind];
      const r = e.r;
      const spawnK = e.spawnT > 0 ? 1 - e.spawnT / 0.35 : 1;
      const mul = 0.4 + 0.6 * spawnK;
      const hit = e.flash > 0 ? Math.min(1, e.flash / 0.08) : 0;
      let sx = mul;
      let sy = mul;
      if (e.kind === 'dasher') {
        if (e.state === 1) {
          const w = clamp(1 - e.stateT / 0.6, 0, 1);
          sx *= 1 - 0.2 * w;
          sy *= 1 + 0.14 * w;
        } else if (e.state === 2) {
          sx *= 1.34;
          sy *= 0.76;
        }
      }
      const tgt = world.players[e.tgt] ?? P0;
      const ang = visualAngle(e.kind, e.angle, e.x, e.y, tgt.x, tgt.y);
      const white = hit > 0.01 && flashes;
      const variant = white ? 'flash' : e.elite ? 'elite' : 'normal';
      ctx.globalAlpha = Math.min(1, 0.2 + spawnK);
      this.xf(ctx, e.x, e.y, ang, sx, sy, hit * 0.24, e.kx, e.ky);
      this.img(ctx, this.art.alien(e.kind, def.color, r, variant));
      switch (e.kind) {
        case 'splitter':
          ctx.rotate(t * 1.6 + e.id * 0.7 - ang * 2);
          this.img(ctx, this.art.part('splitRing', def.color, r, white ? 'flash' : 'normal'));
          break;
        case 'shooter':
          ctx.rotate(-e.angle * 2.4 - ang);
          this.img(ctx, this.art.part('shooterHex', def.color, r, white ? 'flash' : 'normal'));
          break;
        case 'brute':
          this.drawBrutePlates(ctx, e, ang, mul, hit, white, def.color);
          break;
        default:
          break;
      }
    }
    ctx.globalAlpha = 1;

    // Pass 2: additive cores, charge glows, reduced-flash hit tint. World transform +
    // destination rects only (no per-enemy setTransform): this pass runs for every alien.
    const prevOp = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    this.world(ctx);
    const goldGlow = this.art.glow('#ffc93c', '#ffc93c');
    const whiteGlow = this.art.glow('#ffffff');
    for (const e of world.enemies) {
      if (e.boss || e.dead || !this.vis(e.x, e.y, e.r * 2)) continue;
      const def = ENEMIES[e.kind];
      const art = ALIEN_ART[e.kind];
      const r = e.r;
      const spawnK = e.spawnT > 0 ? 1 - e.spawnT / 0.35 : 1;
      let pulse = 1;
      let extra = 0;
      switch (e.kind) {
        case 'drifter':
          pulse = 0.8 + 0.3 * Math.sin(t * 5 + e.id);
          break;
        case 'dasher':
          if (e.state === 1) pulse = 1.6 + (flashes ? 0.4 * Math.sin(t * 50) : 0.2);
          else if (e.state === 2) pulse = 1.7;
          break;
        case 'shooter':
          // Clamped: out of range (d >= 560) the AI keeps counting fireT down below 0, and an
          // unclamped charge grew the core glow to hundreds of px (the review's "magenta blob").
          if (e.fireT < 0.7 && e.spawnT <= 0) extra = clamp(1 - e.fireT / 0.7, 0, 1);
          pulse = 0.9 + extra * 1.1;
          break;
        case 'brute':
          // hp/maxHp clamped: a heal or debug hp > maxHp must never blow the core up to screen size.
          pulse = 0.85 + (1 - clamp(e.hp / e.maxHp, 0, 1)) * 0.5 * (0.6 + 0.4 * Math.sin(t * 9 + e.id));
          break;
        default:
          pulse = 0.9 + 0.15 * Math.sin(t * 3 + e.id);
      }
      const glow = this.art.glow(def.color);
      let cx = e.x;
      let cy = e.y;
      let c = 1;
      let s = 0;
      if (art.core.x !== 0 || extra > 0) {
        const tgt = world.players[e.tgt] ?? P0;
        const ang = visualAngle(e.kind, e.angle, e.x, e.y, tgt.x, tgt.y);
        c = Math.cos(ang);
        s = Math.sin(ang);
        cx += art.core.x * c * r;
        cy += art.core.x * s * r;
      }
      const D = art.core.r * r * 4.4 * pulse * (0.4 + 0.6 * spawnK);
      ctx.globalAlpha = Math.min(1, spawnK * 1.5) * 0.85;
      ctx.drawImage(glow.canvas, cx - D / 2, cy - D / 2, D, D);
      if (extra > 0) {
        // Gunship charging: muzzle bloom at the tips of the cannon spines.
        const M = r * 1.2 * extra;
        ctx.globalAlpha = extra;
        ctx.drawImage(glow.canvas, e.x + c * r * 1.5 - M / 2, e.y + s * r * 1.5 - M / 2, M, M);
      }
      if (e.elite) {
        const G = r * 3;
        ctx.globalAlpha = 0.12 + 0.06 * Math.sin(t * 4 + e.id);
        ctx.drawImage(goldGlow.canvas, e.x - G / 2, e.y - G / 2, G, G);
      }
      if (e.flash > 0 && !flashes) {
        // Reduced flashing: a soft tint instead of a white frame.
        const G = r * 2.4;
        ctx.globalAlpha = 0.35;
        ctx.drawImage(whiteGlow.canvas, e.x - G / 2, e.y - G / 2, G, G);
      }
    }
    // Warp-in: crystal materialising inside a contracting ring.
    ctx.lineWidth = 1.5;
    for (const e of world.enemies) {
      if (e.boss || e.dead || e.spawnT <= 0 || !this.vis(e.x, e.y, e.r * 3)) continue;
      const k = 1 - e.spawnT / 0.35;
      ctx.globalAlpha = 0.25 + 0.6 * k;
      ctx.strokeStyle = ENEMIES[e.kind].color;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r * (1 + 2.2 * (1 - k)), 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = prevOp;

    for (const e of bosses) {
      if (this.vis(e.x, e.y, e.r * 3)) this.drawBoss(ctx, e, world);
    }
    if (this.sweepT <= 0) this.sweep(world);
  }

  private drawBrutePlates(ctx: CanvasRenderingContext2D, e: Enemy, ang: number, mul: number, hit: number, white: boolean, color: string): void {
    const hpK = clamp(e.hp / e.maxHp, 0, 1);
    // Plates break off from the back as armour fails; the front plate goes last.
    const keep = hpK > 0.75 ? 4 : hpK > 0.5 ? 3 : hpK > 0.25 ? 2 : 1;
    const prev = this.plates.get(e.id) ?? 4;
    if (keep < prev) {
      for (let lost = prev - 1; lost >= keep; lost--) {
        const slot = [2, 1, 3, 0][3 - lost] ?? 2;
        this.plateShards(e.x, e.y, e.r, ang + (slot * Math.PI) / 2, color, e.kx, e.ky, slot === 0);
      }
      this.booms.add(1, e.x, e.y, e.r * 1.8, 0.25, color, 2);
    }
    this.plates.set(e.id, keep);
    const order = [0, 1, 3, 2];
    const breathe = 1 + hit * 0.1 + 0.015 * Math.sin(this.time * 4 + e.id);
    for (let i = 0; i < keep; i++) {
      const slot = order[i]!;
      const a = ang + (slot * Math.PI) / 2;
      this.xf(ctx, e.x, e.y, a, mul * breathe, mul * breathe, hit * 0.2, e.kx, e.ky);
      this.img(ctx, this.art.part(slot === 0 ? 'bruteFrontPlate' : 'brutePlate', color, e.r, white ? 'flash' : e.elite ? 'elite' : 'normal'));
    }
  }

  private sweep(world: World): void {
    this.sweepT = 2;
    if (this.plates.size > 0) {
      const alive = new Set<number>();
      for (const e of world.enemies) if (!e.dead) alive.add(e.id);
      for (const id of this.plates.keys()) if (!alive.has(id)) this.plates.delete(id);
    }
  }

  // ───────────────────────────── capital ships ─────────────────────────────

  private bossFx(e: Enemy): BossFx {
    let b = this.bosses.get(e.id);
    if (!b) {
      b = new BossFx();
      this.bosses.set(e.id, b);
    }
    b.seen = this.frameId;
    return b;
  }

  private drawBoss(ctx: CanvasRenderingContext2D, e: Enemy, world: World): void {
    const b = this.bossFx(e);
    const def = ENEMIES[e.kind];
    const color = def.color;
    const r = e.r;
    const spawnK = e.spawnT > 0 ? 1 - e.spawnT / 0.8 : 1;
    const mul = 0.4 + 0.6 * spawnK;
    const hit = e.flash > 0 ? Math.min(1, e.flash / 0.08) : 0;
    const enraged = e.hp < e.maxHp * 0.5;
    const t = this.time;
    const dt = 1 / 60;
    const prevOp = ctx.globalCompositeOperation;
    ctx.globalAlpha = Math.min(1, 0.2 + spawnK);
    const flashA = (this.flashes ? 0.22 : 0.08) * hit;

    if (e.kind === 'warden') {
      const lead = 1.0;
      const charge = e.spawnT <= 0 && e.fireT < lead ? clamp(1 - e.fireT / lead, 0, 1) : 0;
      b.spin += dt * ((enraged ? 1.2 : 0.7) + charge * charge * 5);
      b.spin2 -= dt * ((enraged ? 1.8 : 1.1) + charge * 3);
      const jit = charge > 0.6 && this.flashes ? (Math.random() - 0.5) * r * 0.02 * charge : 0;
      // Outer armour ring (segments pulled in as the core charges).
      const ringS = mul * (1 - 0.05 * charge * charge);
      this.xf(ctx, e.x + jit, e.y, b.spin, ringS, ringS, hit * 0.06, e.kx, e.ky);
      this.img(ctx, this.art.part('wardenOuter', color, r));
      this.xf(ctx, e.x, e.y, e.angle * 0.25, mul, mul, hit * 0.08, e.kx, e.ky);
      this.img(ctx, this.art.part('wardenHull', color, r));
      this.xf(ctx, e.x, e.y, b.spin2, mul, mul);
      this.img(ctx, this.art.part('wardenInner', color, r));
      ctx.globalCompositeOperation = 'lighter';
      // Energy converging from the armour into the gate.
      if (charge > 0) {
        this.world(ctx);
        ctx.strokeStyle = mix(color, '#ffffff', 0.5);
        ctx.lineWidth = 2;
        ctx.globalAlpha = charge * 0.7;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = b.spin + Math.PI / 6 + (i / 6) * TAU;
          const p0 = r * 0.82;
          const p1 = r * (0.82 - 0.5 * frac(t * 3 + i * 0.17));
          ctx.moveTo(e.x + Math.cos(a) * p0, e.y + Math.sin(a) * p0);
          ctx.lineTo(e.x + Math.cos(a) * p1, e.y + Math.sin(a) * p1);
        }
        ctx.stroke();
      }
      const core = (r * (0.22 + 0.28 * charge + (enraged ? 0.04 * Math.sin(t * 12) : 0.02 * Math.sin(t * 3)))) / 8;
      ctx.globalAlpha = 0.85 + 0.15 * charge;
      this.blit(ctx, this.art.glow(color), e.x, e.y, 0, core * 2.6);
      ctx.globalAlpha = 0.5 + 0.5 * charge;
      this.blit(ctx, this.art.glow('#ffffff'), e.x, e.y, 0, core * (0.6 + 0.5 * charge));
    } else if (e.kind === 'hydra') {
      // Heading: aim while telegraphing/charging, otherwise toward the prey.
      const tgt = world.players[e.tgt] ?? world.players[0]!;
      const want = e.state === 1 || e.state === 2 ? Math.atan2(e.aimY, e.aimX) : Math.atan2(tgt.y - e.y, tgt.x - e.x);
      if (!b.init) b.heading = want;
      b.heading += angleDiff(b.heading, want) * damp(e.state === 1 ? 14 : 4, dt);
      this.updateNecks(b, e, enraged);
      // Necks (spine + crystal vertebrae) first, then the body over their roots, then heads.
      const seg = this.art.part('hydraSeg', color, r);
      const N = b.necks;
      this.world(ctx);
      ctx.lineCap = 'round';
      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass === 0 ? mix(color, '#05040f', 0.45) : color;
        ctx.lineWidth = pass === 0 ? r * 0.13 : r * 0.035;
        ctx.beginPath();
        for (let n = 0; n < NECKS; n++) {
          const o0 = n * NECK_SEGS * 2;
          ctx.moveTo(N[o0]!, N[o0 + 1]!);
          for (let i = 1; i < NECK_SEGS; i++) ctx.lineTo(N[o0 + i * 2]!, N[o0 + i * 2 + 1]!);
        }
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
      for (let n = 0; n < NECKS; n++) {
        for (let i = 1; i < NECK_SEGS - 1; i++) {
          const o = (n * NECK_SEGS + i) * 2;
          const a = Math.atan2(N[o + 3]! - N[o + 1]!, N[o + 2]! - N[o]!);
          const sc = mul * (1.9 - i * 0.12);
          this.xf(ctx, N[o]!, N[o + 1]!, a, sc, sc);
          this.img(ctx, seg);
        }
      }
      this.xf(ctx, e.x, e.y, b.heading + Math.sin(t * 1.3) * 0.08, mul, mul, hit * 0.08, e.kx, e.ky);
      this.img(ctx, this.art.part('hydraBody', color, r));
      const head = this.art.part('hydraHead', color, r);
      for (let n = 0; n < NECKS; n++) {
        const o = (n * NECK_SEGS + NECK_SEGS - 1) * 2;
        const p = o - 2;
        const a = Math.atan2(N[o + 1]! - N[p + 1]!, N[o]! - N[p]!);
        this.xf(ctx, N[o]!, N[o + 1]!, a, mul, mul);
        this.img(ctx, head);
      }
      ctx.globalCompositeOperation = 'lighter';
      const tele = e.state === 1 ? 1 : e.state === 3 ? 0.6 : 0.25;
      for (let n = 0; n < NECKS; n++) {
        const o = (n * NECK_SEGS + NECK_SEGS - 1) * 2;
        const p = o - 2;
        const a = Math.atan2(N[o + 1]! - N[p + 1]!, N[o]! - N[p]!);
        const ex = N[o]! + Math.cos(a) * r * 0.12;
        const ey = N[o + 1]! + Math.sin(a) * r * 0.12;
        ctx.globalAlpha = 0.6 + 0.4 * tele;
        this.blit(ctx, this.art.glow(color), ex, ey, 0, (r * (0.12 + 0.16 * tele)) / 8);
      }
      ctx.globalAlpha = 0.9;
      this.blit(ctx, this.art.glow(color), e.x, e.y, 0, (r * (0.3 + (e.state === 2 ? 0.15 : 0) + 0.04 * Math.sin(t * 6))) / 8);
    } else {
      // Void Heart hive mothership.
      const summon = e.summonT < 1.2 && e.spawnT <= 0 ? clamp(1 - e.summonT / 1.2, 0, 1) : 0;
      const beat = this.heartbeat(t * (enraged ? 1.5 : 1));
      ctx.globalCompositeOperation = 'lighter';
      this.drawHalo(ctx, e, color, enraged);
      this.drawTendrils(ctx, e, color, beat, enraged);
      ctx.globalCompositeOperation = prevOp;
      ctx.globalAlpha = Math.min(1, 0.2 + spawnK);
      this.xf(ctx, e.x, e.y, e.angle, mul, mul, hit * 0.05, e.kx, e.ky);
      this.img(ctx, this.art.part('voidSpires', color, r));
      const hs = mul * (1 + beat * 0.03);
      this.xf(ctx, e.x, e.y, -e.angle * 0.5, hs, hs, hit * 0.06, e.kx, e.ky);
      this.img(ctx, this.art.part('voidHull', color, r));
      ctx.globalCompositeOperation = 'lighter';
      // Docking spire tips light up before a wave of escorts launches.
      if (summon > 0) {
        ctx.globalAlpha = summon;
        for (let i = 0; i < 8; i++) {
          const a = e.angle + (i / 8) * TAU;
          this.blit(ctx, this.art.glow(color), e.x + Math.cos(a) * r * 1.05, e.y + Math.sin(a) * r * 1.05, 0, (r * 0.22 * summon) / 8);
        }
      }
      ctx.globalAlpha = 0.95;
      this.blit(ctx, this.art.glow(color), e.x, e.y, 0, (r * (0.42 + beat * 0.12)) / 8);
      ctx.globalAlpha = 0.7 + beat * 0.3;
      this.blit(ctx, this.art.glow('#ffffff', '#ffffff'), e.x, e.y, 0, (r * (0.12 + beat * 0.06)) / 8);
    }

    if (flashA > 0.01) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = flashA;
      this.blit(ctx, this.art.glow('#ffffff'), e.x, e.y, 0, (r * 1.1) / 8);
    }
    if (e.spawnT > 0) {
      ctx.globalCompositeOperation = 'lighter';
      this.world(ctx);
      ctx.globalAlpha = spawnK;
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(e.x, e.y, r * (1 + 3 * (1 - spawnK)), 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = prevOp;
    b.init = true;
  }

  /** Lub-dub pulse in 0..1. */
  private heartbeat(t: number): number {
    const p = frac(t * 0.9);
    const a = Math.exp(-Math.pow((p - 0.1) * 18, 2));
    const b = Math.exp(-Math.pow((p - 0.28) * 18, 2)) * 0.7;
    return a + b;
  }

  private updateNecks(b: BossFx, e: Enemy, enraged: boolean): void {
    const r = e.r;
    const N = b.necks;
    const segLen = r * 0.18;
    const t = this.time;
    for (let n = 0; n < NECKS; n++) {
      // Rest directions: fanned forward; converge on the aim while telegraphing; whirl during the spiral volley.
      const spread = e.state === 1 ? 0.22 : e.state === 2 ? 0.35 : 0.85;
      let dir = b.heading + (n - 1) * spread;
      if (e.state === 3) dir = e.angle * (enraged ? 1.6 : 1.2) + (n / NECKS) * TAU;
      const sway = Math.sin(t * 2.2 + n * 2.1) * 0.25;
      const baseA = b.heading + (n - 1) * 0.9;
      const o0 = n * NECK_SEGS * 2;
      N[o0] = e.x + Math.cos(baseA) * r * 0.32;
      N[o0 + 1] = e.y + Math.sin(baseA) * r * 0.32;
      for (let i = 1; i < NECK_SEGS; i++) {
        const o = o0 + i * 2;
        const a = dir + sway * (i / NECK_SEGS);
        const tx = N[o - 2]! + Math.cos(a) * segLen;
        const ty = N[o - 1]! + Math.sin(a) * segLen;
        if (!b.init) {
          N[o] = tx;
          N[o + 1] = ty;
          continue;
        }
        // Follow with lag (trailing), then enforce the segment length.
        const f = 0.22 + 0.06 * (NECK_SEGS - i);
        let x = N[o]! + (tx - N[o]!) * f;
        let y = N[o + 1]! + (ty - N[o + 1]!) * f;
        const dx = x - N[o - 2]!;
        const dy = y - N[o - 1]!;
        const d = Math.hypot(dx, dy) || 1;
        x = N[o - 2]! + (dx / d) * segLen;
        y = N[o - 1]! + (dy / d) * segLen;
        N[o] = x;
        N[o + 1] = y;
      }
    }
  }

  /** Motes spiralling into the Void Heart (stateless: position is a function of time). */
  private drawHalo(ctx: CanvasRenderingContext2D, e: Enemy, color: string, enraged: boolean): void {
    const r = e.r;
    const t = this.time;
    const n = enraged ? 48 : 32;
    ctx.fillStyle = mix(color, '#ffffff', 0.35);
    this.world(ctx);
    for (let i = 0; i < n; i++) {
      // Five spiral arms streaming inward: reads as suction even in a still frame.
      const arm = i % 5;
      const ph = frac(t * (enraged ? 0.5 : 0.32) + Math.floor(i / 5) * 0.137 + hash(i) * 0.04);
      const rad = r * (2.6 - 2.0 * ph * ph);
      const a = arm * (TAU / 5) + e.angle * 0.5 + ph * 2.6;
      const x = e.x + Math.cos(a) * rad;
      const y = e.y + Math.sin(a) * rad;
      const s = 1.2 + 2.2 * ph;
      ctx.globalAlpha = Math.sin(ph * Math.PI) * ph * 0.9;
      // Streak along the inward spiral.
      const tx = -Math.cos(a) * 10 * (0.4 + ph) - Math.sin(a) * 4;
      const ty = -Math.sin(a) * 10 * (0.4 + ph) + Math.cos(a) * 4;
      ctx.beginPath();
      ctx.moveTo(x - tx * 0.6, y - ty * 0.6);
      ctx.lineTo(x + tx * 0.4, y + ty * 0.4);
      ctx.lineWidth = s;
      ctx.strokeStyle = ctx.fillStyle;
      ctx.stroke();
    }
  }

  private drawTendrils(ctx: CanvasRenderingContext2D, e: Enemy, color: string, beat: number, enraged: boolean): void {
    const r = e.r;
    const t = this.time;
    this.world(ctx);
    const n = 6;
    const len = r * (1.25 + (enraged ? 0.2 : 0));
    for (let pass = 0; pass < 2; pass++) {
      ctx.globalAlpha = pass === 0 ? 0.22 : 0.75;
      ctx.strokeStyle = pass === 0 ? color : mix(color, '#ffffff', 0.45);
      ctx.lineWidth = pass === 0 ? r * 0.12 * (1 + beat * 0.3) : r * 0.03;
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < n; i++) {
        const a = -e.angle * 0.5 + (i / n) * TAU + TAU / 24;
        const w1 = Math.sin(t * 2.1 + i * 1.7) * 0.5;
        const w2 = Math.sin(t * 3.3 + i * 2.3) * 0.7;
        const x0 = e.x + Math.cos(a) * r * 0.5;
        const y0 = e.y + Math.sin(a) * r * 0.5;
        const a1 = a + w1;
        const a2 = a + w1 + w2;
        const x1 = e.x + Math.cos(a1) * len * 0.75;
        const y1 = e.y + Math.sin(a1) * len * 0.75;
        const x2 = e.x + Math.cos(a2) * len * (0.95 + beat * 0.08);
        const y2 = e.y + Math.sin(a2) * len * (0.95 + beat * 0.08);
        ctx.moveTo(x0, y0);
        ctx.quadraticCurveTo(x1, y1, x2, y2);
      }
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  // ───────────────────────────── projectiles ─────────────────────────────

  /** Player projectiles. Caller sets 'lighter'. */
  drawProjectiles(ctx: CanvasRenderingContext2D, world: World, boltColor: string): void {
    this.world(ctx);
    // Bolts: tapered ribbons, batched into two paths.
    for (let pass = 0; pass < 2; pass++) {
      ctx.beginPath();
      let any = false;
      for (const pr of world.projectiles) {
        if (pr.kind !== 'bolt' || !this.vis(pr.x, pr.y, 40)) continue;
        if ((pass === 1) !== pr.evolved) continue;
        const sp = Math.hypot(pr.vx, pr.vy) || 1;
        const dx = pr.vx / sp;
        const dy = pr.vy / sp;
        const len = sp * (pr.evolved ? 0.06 : 0.045);
        const w = pr.r * (pr.evolved ? 0.85 : 0.7);
        const nx = -dy;
        const ny = dx;
        const mx = pr.x - dx * len * 0.22;
        const my = pr.y - dy * len * 0.22;
        ctx.moveTo(pr.x + dx * w * 0.6, pr.y + dy * w * 0.6);
        ctx.lineTo(mx + nx * w, my + ny * w);
        ctx.lineTo(pr.x - dx * len, pr.y - dy * len);
        ctx.lineTo(mx - nx * w, my - ny * w);
        ctx.closePath();
        any = true;
      }
      if (any) {
        ctx.globalAlpha = pass === 1 ? 0.75 : 0.6;
        ctx.fillStyle = pass === 1 ? mix(boltColor, '#ffffff', 0.45) : boltColor;
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    const dot = this.art.glow(boltColor);
    for (const pr of world.projectiles) {
      if (pr.kind !== 'bolt' || !this.vis(pr.x, pr.y, 20)) continue;
      this.blit(ctx, dot, pr.x, pr.y, 0, (pr.r * (pr.evolved ? 4.6 : 4)) / 16);
    }
    // Missiles: smoke-free ion ribbons + exhaust + alloy body.
    const mcol = '#ffb3f0';
    for (const pr of world.projectiles) {
      if (pr.kind !== 'missile') continue;
      let tr = this.missiles.get(pr);
      if (!tr) {
        tr = { pts: new Float32Array(MISSILE_N * 2), head: 0, n: 0 };
        this.missiles.set(pr, tr);
      }
      const last = (tr.head + MISSILE_N - 1) % MISSILE_N;
      if (tr.n === 0 || Math.hypot(pr.x - tr.pts[last * 2]!, pr.y - tr.pts[last * 2 + 1]!) > 4) {
        tr.pts[tr.head * 2] = pr.x;
        tr.pts[tr.head * 2 + 1] = pr.y;
        tr.head = (tr.head + 1) % MISSILE_N;
        tr.n = Math.min(MISSILE_N, tr.n + 1);
      }
      if (!this.vis(pr.x, pr.y, 80)) continue;
      this.world(ctx);
      const S = this.scratch;
      let m = 0;
      S[m++] = pr.x;
      S[m++] = pr.y;
      for (let j = 1; j <= tr.n; j++) {
        const idx = (tr.head - j + MISSILE_N * 2) % MISSILE_N;
        S[m++] = tr.pts[idx * 2]!;
        S[m++] = tr.pts[idx * 2 + 1]!;
      }
      ribbon(ctx, S, m / 2, pr.evolved ? 7 : 5.5, mcol, 0.55);
      ribbon(ctx, S, Math.min(m / 2, 5), 2.2, '#ffffff', 0.5);
      const a = Math.atan2(pr.vy, pr.vx);
      ctx.globalAlpha = 0.9;
      this.xf(ctx, pr.x - Math.cos(a) * 5, pr.y - Math.sin(a) * 5, a, 0.55 * (0.8 + 0.2 * Math.sin(this.time * 60 + pr.x)), 0.6);
      this.img(ctx, this.art.flame(mcol));
      ctx.globalAlpha = 1;
      this.xf(ctx, pr.x, pr.y, a, pr.evolved ? 1.15 : 0.95, pr.evolved ? 1.15 : 0.95);
      this.img(ctx, this.art.missile(mcol));
    }
    ctx.globalAlpha = 1;
  }

  /**
   * Alien plasma bolts: hot core + short tail, the most readable thing on screen.
   * Draw LAST in the world (after the player ship) so threats are never hidden. Sets 'lighter' itself.
   */
  drawBullets(ctx: CanvasRenderingContext2D, world: World, dot: HTMLCanvasElement): void {
    const prevOp = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    this.world(ctx);
    ctx.beginPath();
    let any = false;
    for (const b of world.bullets) {
      if (!this.vis(b.x, b.y, 20)) continue;
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - b.vx * 0.07, b.y - b.vy * 0.07);
      any = true;
    }
    if (any) {
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#ff4f7a';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.stroke();
      ctx.lineCap = 'butt';
      ctx.globalAlpha = 1;
    }
    const t = this.time;
    for (let i = 0; i < world.bullets.length; i++) {
      const b = world.bullets[i]!;
      if (!this.vis(b.x, b.y, 20)) continue;
      const d = b.r * 4.2 * (1 + 0.1 * Math.sin(t * 18 + i));
      ctx.drawImage(dot, b.x - d / 2, b.y - d / 2, d, d);
    }
    ctx.globalCompositeOperation = prevOp;
  }

  /**
   * Cooled shard debris: dim desaturated outlines, normal blending. Draw BELOW the
   * enemies (after the ground layer) so debris never reads as a live vessel.
   */
  drawDebris(ctx: CanvasRenderingContext2D): void {
    const v = this.v;
    const prevOp = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'source-over';
    this.world(ctx);
    this.shards.drawCooled(ctx, v.minX, v.minY, v.maxX, v.maxY);
    ctx.globalCompositeOperation = prevOp;
  }

  /** White-hot shards, embers, flashes and rings. Caller sets 'lighter'. */
  drawShards(ctx: CanvasRenderingContext2D): void {
    const v = this.v;
    this.world(ctx);
    this.shards.drawHot(ctx, v.minX, v.minY, v.maxX, v.maxY, this.time);
    this.booms.draw(ctx, this, v, this.flashes ? 1 : 0.35);
    this.world(ctx);
  }

  // ───────────────────────────── lightning ─────────────────────────────

  /** Branching lightning for Arc weapons (replaces Arcs.draw). Caller sets 'lighter'. */
  drawLightning(ctx: CanvasRenderingContext2D, arcs: readonly ArcLike[]): void {
    this.world(ctx);
    const tick = Math.floor(this.time * (this.flashes ? 30 : 8));
    const S = this.scratch;
    for (const a of arcs) {
      const k = clamp(a.life / ARC_LIFE, 0, 1);
      const pts = a.points;
      // Build the jagged main bolt into the scratch buffer.
      let n = 0;
      S[n++] = pts[0]!;
      S[n++] = pts[1]!;
      const seed = a.seed + tick * 13.37;
      for (let i = 2; i < pts.length && n < S.length - 20; i += 2) {
        const x0 = pts[i - 2]!;
        const y0 = pts[i - 1]!;
        const x1 = pts[i]!;
        const y1 = pts[i + 1]!;
        const L = Math.hypot(x1 - x0, y1 - y0) || 1;
        const nx = -(y1 - y0) / L;
        const ny = (x1 - x0) / L;
        const segs = Math.max(4, Math.min(14, Math.round(L / 10)));
        const amp = Math.min(13, L * 0.13);
        for (let s = 1; s <= segs; s++) {
          const u = s / segs;
          const env = Math.min(1, Math.sin(u * Math.PI) * 2);
          // Alternating sides with random magnitude: a crisp zigzag, not a noodle.
          const hj = hash(seed + i * 7.1 + s * 3.3);
          const flip = hash(seed + s * 5.9 + i) < 0.22 ? -1 : 1;
          const j = s === segs ? 0 : (s % 2 === 0 ? 1 : -1) * flip * (0.2 + 0.8 * hj) * amp * env;
          S[n++] = x0 + (x1 - x0) * u + nx * j;
          S[n++] = y0 + (y1 - y0) * u + ny * j;
        }
      }
      const color = a.evolved ? '#e8e2ff' : '#a08cff';
      // Glow pass thin and faint (it read as a dark outline at 10 px); dropped under post-FX bloom.
      const passes = this.postFx ? LIGHTNING_PASSES_FX : LIGHTNING_PASSES;
      for (const [w, c, al] of passes) {
        const cc = c === '' ? color : c;
        ctx.globalAlpha = al * k;
        ctx.strokeStyle = cc;
        ctx.lineWidth = w * (a.evolved ? 1.3 : 1);
        ctx.lineJoin = 'miter';
        ctx.beginPath();
        ctx.moveTo(S[0]!, S[1]!);
        for (let i = 2; i < n; i += 2) ctx.lineTo(S[i]!, S[i + 1]!);
        // Branches: forks off every few vertices.
        for (let i = 4; i < n - 4; i += 4) {
          const hb = hash(seed + i * 1.9);
          if (hb < 0.3) continue;
          const bx = S[i]!;
          const by = S[i + 1]!;
          const dx = S[i + 2]! - S[i - 2]!;
          const dy = S[i + 3]! - S[i - 1]!;
          const base = Math.atan2(dy, dx) + (hb > 0.67 ? 0.7 : -0.7);
          const bl = 16 + hash(seed + i) * 26;
          ctx.moveTo(bx, by);
          let x = bx;
          let y = by;
          for (let q = 1; q <= 3; q++) {
            const aa = base + (hash(seed + i + q * 5.7) - 0.5) * 1.2;
            x += Math.cos(aa) * bl * 0.33;
            y += Math.sin(aa) * bl * 0.33;
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      }
      // Impact flares at every chain node.
      ctx.globalAlpha = k;
      const g = this.art.glow('#a08cff');
      for (let i = 2; i < pts.length; i += 2) this.blit(ctx, g, pts[i]!, pts[i + 1]!, 0, (10 + 6 * k) / 8);
      this.world(ctx);
    }
    ctx.globalAlpha = 1;
  }

  // ───────────────────────────── allied vessels ─────────────────────────────

  /**
   * Draws every pilot's starship: contact shadow, exhaust ribbon, dash afterimages,
   * engine flames, banked hull, running lights, shield bubble, crowd locator ring.
   * Sets its own composite ops.
   */
  drawPlayers(ctx: CanvasRenderingContext2D, world: World, dt: number, rdt: number, trailColor: string): void {
    for (const p of world.players) {
      if (!p.alive) continue;
      const st = this.pilot(p.pid);
      // Crowd density round this pilot (cheap: one pass, early exit) drives the locator ring.
      let near = 0;
      const R2 = LOCATOR_RANGE * LOCATOR_RANGE;
      for (const e of world.enemies) {
        if (e.dead) continue;
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        if (dx * dx + dy * dy < R2 && ++near >= LOCATOR_CROWD) break;
      }
      st.locator += ((near >= LOCATOR_CROWD ? 1 : 0) - st.locator) * damp(near >= LOCATOR_CROWD ? 6 : 2, Math.max(rdt, 1e-4));
      this.drawPlayer(ctx, p, st, dt, rdt, trailColor);
    }
  }

  private drawPlayer(ctx: CanvasRenderingContext2D, p: Player, st: PilotFx, dt: number, rdt: number, trailColor: string): void {
    const t = this.time;
    const art = SHIP_ART[p.ship];
    const color = SHIPS[p.ship].color;
    const ang = Math.atan2(p.facingY, p.facingX);
    if (!st.init) {
      st.prevAng = ang;
      st.init = true;
    }
    // Bank into turns (roll reads as a narrowing of the hull).
    if (rdt > 0) {
      const turn = angleDiff(st.prevAng, ang) / Math.max(rdt, 1 / 240);
      st.bank += (clamp(turn * 0.09, -1, 1) - st.bank) * damp(9, rdt);
      st.prevAng = ang;
    }
    const speed = Math.hypot(p.vx, p.vy);
    const dashing = p.dashT > 0;
    const thrustTarget = dashing ? 2.4 : clamp(speed / 210, 0, 1.6);
    st.thrust += (thrustTarget - st.thrust) * damp(dashing ? 30 : 8, Math.max(rdt, 1e-4));
    const ghost = p.downed;
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const bankY = 1 - 0.3 * Math.abs(st.bank);
    const prevOp = ctx.globalCompositeOperation;

    // Contact shadow (normal blending): a dark pocket under the hull, ~1.6 r, so the
    // vessel separates from a bright swarm. Drawn first, under everything of ours.
    if (!ghost) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.48;
      this.blit(ctx, this.art.shadow(), p.x, p.y, 0, (p.r * 1.6) / 16);
    }

    // Exhaust ribbon. History is the hull CENTRE (low-passed, so stick/bot jitter and
    // hull rotation never make it squiggle), shifted rigidly onto the main nozzle,
    // cut to TRAIL_LEN, additive, tapered, brightness following speed.
    const nz = art.nozzles[0]!;
    const ex = p.x + c * nz.x - s * nz.y * bankY;
    const ey = p.y + s * nz.x + c * nz.y * bankY;
    if (dt > 0) {
      if (st.n === 0) {
        st.sx = p.x;
        st.sy = p.y;
      }
      const lp = damp(dashing ? 40 : 18, dt);
      st.sx += (p.x - st.sx) * lp;
      st.sy += (p.y - st.sy) * lp;
      st.trail[st.head * 2] = st.sx;
      st.trail[st.head * 2 + 1] = st.sy;
      st.head = (st.head + 1) % TRAIL_N;
      st.n = Math.min(TRAIL_N, st.n + 1);
    }
    ctx.globalCompositeOperation = 'lighter';
    this.world(ctx);
    if (!ghost && st.n > 2) {
      const S = this.scratch;
      const ox = ex - p.x;
      const oy = ey - p.y;
      let m = 0;
      S[m++] = ex;
      S[m++] = ey;
      let len = 0;
      let px = ex;
      let py = ey;
      for (let j = 1; j < st.n; j++) {
        const idx = (st.head - 1 - j + TRAIL_N * 2) % TRAIL_N;
        let qx = st.trail[idx * 2]! + ox;
        let qy = st.trail[idx * 2 + 1]! + oy;
        const d = Math.hypot(qx - px, qy - py);
        if (d < 1e-3) continue;
        if (len + d > TRAIL_LEN) {
          const f = (TRAIL_LEN - len) / d;
          qx = px + (qx - px) * f;
          qy = py + (qy - py) * f;
          S[m++] = qx;
          S[m++] = qy;
          break;
        }
        len += d;
        S[m++] = qx;
        S[m++] = qy;
        px = qx;
        py = qy;
      }
      const sp = dashing ? 1 : clamp(speed / 230, 0, 1);
      if (sp > 0.05 && m >= 6) {
        const wide = dashing ? 1.6 : 1;
        ribbon(ctx, S, m / 2, nz.w * 2.2 * wide, trailColor, 0.25 + 0.55 * sp);
        ribbon(ctx, S, Math.min(m / 2, 8), nz.w * 0.8 * wide, '#ffffff', 0.2 + 0.45 * sp);
      }
    }

    // Dash afterimages: hull-shaped ghosts stretched along the dash. With the shield
    // up, ghosts inside the bubble are skipped (they stacked into a solid disc).
    if (dashing && dt > 0) {
      st.ghostT -= dt;
      if (st.ghostT <= 0) {
        st.ghostT = 0.022;
        st.gx.push(p.x);
        st.gy.push(p.y);
        st.ga.push(ang);
        st.gl.push(0.3);
      }
    }
    for (let i = st.gl.length - 1; i >= 0; i--) {
      st.gl[i]! -= dt;
      if (st.gl[i]! <= 0) {
        st.gx.splice(i, 1);
        st.gy.splice(i, 1);
        st.ga.splice(i, 1);
        st.gl.splice(i, 1);
      }
    }
    const gs = this.art.ship(p.ship, ghostColor(color), 'ghost');
    const clearR = p.shieldReady ? art.shieldR : art.extent * 0.8;
    for (let i = 0; i < st.gl.length; i++) {
      const d = Math.hypot(st.gx[i]! - p.x, st.gy[i]! - p.y);
      const out = clamp((d - clearR * 0.85) / (clearR * 0.5), 0, 1);
      if (out <= 0) continue;
      const k = st.gl[i]! / 0.3;
      ctx.globalAlpha = k * 0.4 * out;
      this.xf(ctx, st.gx[i]!, st.gy[i]!, st.ga[i]!, 1 + (1 - k) * 0.5, 1 - (1 - k) * 0.25);
      this.img(ctx, gs);
    }

    // Engine flames: class colour plume with a white-hot core (the core blooms).
    const flame = this.art.flame(mix(color, trailColor, 0.35));
    if (!ghost) {
      for (let i = 0; i < art.nozzles.length; i++) {
        const n = art.nozzles[i]!;
        const flick = 0.85 + 0.15 * Math.sin(t * 47 + i * 2.1) + 0.08 * Math.sin(t * 91 + i);
        const L = (6 + 15 * st.thrust) * n.len * flick;
        const W = n.w * (0.9 + 0.25 * Math.min(1, st.thrust));
        const nx = p.x + c * n.x - s * n.y * bankY;
        const ny = p.y + s * n.x + c * n.y * bankY;
        ctx.globalAlpha = 0.7 + 0.3 * Math.min(1, st.thrust + 0.3);
        this.xf(ctx, nx, ny, ang, L / 16, W / 8);
        this.img(ctx, flame);
      }
      // Hot nozzle glow + white engine core.
      for (const n of art.nozzles) {
        const nx = p.x + c * n.x - s * n.y * bankY;
        const ny = p.y + s * n.x + c * n.y * bankY;
        ctx.globalAlpha = 0.75;
        this.blit(ctx, this.art.glow(color), nx, ny, 0, (n.w * 1.3) / 8);
        ctx.globalAlpha = 0.9;
        this.blit(ctx, this.art.glow('#ffffff'), nx, ny, 0, (n.w * 0.6) / 8);
      }
      // Cool fleet under-glow (one livery: never the class colour, so pink/violet hulls stay "ours").
      ctx.globalAlpha = 0.3;
      this.blit(ctx, this.art.glow(FLEET_GLOW, FLEET_GLOW), p.x, p.y, 0, (art.extent * 2.6) / 16);
    }
    ctx.globalCompositeOperation = prevOp;

    // Hull.
    const blink = p.invuln > 0 && !dashing && Math.floor(t * 16) % 2 === 0;
    ctx.globalAlpha = ghost ? 0.35 : blink ? 0.45 : 1;
    const hurt = p.hurtT > 0.2 && !ghost;
    this.xf(ctx, p.x, p.y, ang, 1, bankY);
    this.img(ctx, this.art.ship(p.ship, color, hurt && this.flashes ? 'flash' : 'normal'));
    // Banking highlight: the raised wing catches light.
    if (Math.abs(st.bank) > 0.15 && !ghost) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (Math.abs(st.bank) - 0.15) * 0.5;
      this.blit(ctx, this.art.glow(FLEET_RIM), p.x - s * Math.sign(st.bank) * 7, p.y + c * Math.sign(st.bank) * 7, 0, 1);
      ctx.globalCompositeOperation = prevOp;
    }
    if (p.hurtT > 0 && !ghost) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = Math.min(1, p.hurtT * 3) * (this.flashes ? 0.6 : 0.3);
      this.blit(ctx, this.art.glow('#ff4d6d'), p.x, p.y, 0, 2.6);
      ctx.globalCompositeOperation = prevOp;
    }

    // Running lights.
    ctx.globalCompositeOperation = 'lighter';
    if (!ghost) {
      for (let i = 0; i < art.lights.length; i++) {
        const L = art.lights[i]!;
        let a = 1;
        if (L.blink === 1) a = this.flashes ? 0.55 + 0.45 * (frac(t * 1.1 + i * 0.13) < 0.5 ? 1 : 0.2) : 0.75;
        else if (L.blink === 2) {
          const f = frac(t * 0.9);
          a = this.flashes ? (f < 0.05 || (f > 0.12 && f < 0.17) ? 1 : 0.08) : 0.35;
        }
        const lx = p.x + c * L.x - s * L.y * bankY;
        const ly = p.y + s * L.x + c * L.y * bankY;
        ctx.globalAlpha = a;
        this.blit(ctx, this.art.glow(L.color), lx, ly, 0, L.blink === 2 ? 0.55 : 0.4);
      }
    }

    // Shield bubble (fill <= 0.15: the hull always reads through it).
    if (p.shieldReady && !ghost) {
      const R = art.shieldR;
      ctx.globalAlpha = 0.62 + 0.1 * Math.sin(t * 4);
      this.blit(ctx, this.art.shield('#7ff9ff', R), p.x, p.y, t * 0.25, 1);
      // Shimmer: a highlight sweeping round the rim.
      this.world(ctx);
      ctx.strokeStyle = '#e8ffff';
      ctx.lineWidth = 1.2;
      ctx.lineCap = 'round';
      for (let i = 0; i < 2; i++) {
        const a0 = t * 1.7 + i * Math.PI;
        ctx.globalAlpha = 0.4;
        ctx.beginPath();
        ctx.arc(p.x, p.y, R, a0, a0 + 0.8);
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
    }
    if (st.shieldHit > 0) {
      st.shieldHit = Math.max(0, st.shieldHit - rdt * 3);
    }

    // Crowd locator: four thin brackets round the pilot, faded in only when the swarm is
    // dense. Slow steady rotation, no pulse (reduced-flash safe).
    if (st.locator > 0.02 && !ghost) {
      const R = Math.max(art.shieldR + 5, 30);
      const a0 = t * 0.6;
      this.world(ctx);
      ctx.strokeStyle = FLEET_RIM;
      ctx.lineWidth = 1.3;
      ctx.globalAlpha = 0.42 * st.locator;
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = a0 + (i * Math.PI) / 2;
        ctx.moveTo(p.x + Math.cos(a - 0.36) * R, p.y + Math.sin(a - 0.36) * R);
        ctx.arc(p.x, p.y, R, a - 0.36, a + 0.36);
      }
      ctx.stroke();
      // Inward ticks at the bracket centres point at the hull.
      ctx.beginPath();
      for (let i = 0; i < 4; i++) {
        const a = a0 + (i * Math.PI) / 2;
        ctx.moveTo(p.x + Math.cos(a) * R, p.y + Math.sin(a) * R);
        ctx.lineTo(p.x + Math.cos(a) * (R - 4), p.y + Math.sin(a) * (R - 4));
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = prevOp;
  }
}
