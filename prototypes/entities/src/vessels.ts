/**
 * Starship art for SHARDSTORM: the allied fleet (player vessels) and the
 * crystalline alien armada. Every design is a set of canvas paths facing +x,
 * pre-rendered ("baked") once per resolution into glowing sprites. Nothing in
 * here runs per frame except cache lookups.
 *
 * Material language (readability in a 300-enemy fight):
 *   - Allied vessels: solid dark-alloy hulls with cool neon edge lines, a lit
 *     canopy, running lights and engine glow. Opaque, so they pop out of swarms.
 *   - Alien armada: translucent faceted crystal in warm neons with a glowing
 *     core. Facets are lit from a fixed light so they read as gems, not flat.
 */
import { TAU } from '../core/math';
import type { EnemyKind, ShipId } from '../game/types';

// ───────────────────────────── colour helpers ─────────────────────────────

export function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex: string, a: number): string {
  const [r, g, b] = rgbOf(hex);
  return `rgba(${r},${g},${b},${a})`;
}

/** Linear mix of two '#rrggbb' colours. */
export function mix(a: string, b: string, t: number): string {
  const A = rgbOf(a);
  const B = rgbOf(b);
  const c = (i: number) => Math.round(A[i]! + (B[i]! - A[i]!) * t);
  return `#${((1 << 24) | (c(0) << 16) | (c(1) << 8) | c(2)).toString(16).slice(1)}`;
}

const VOID = '#05040f';
const WHITE = '#ffffff';
/** Light direction for baked facet shading (sprite space, from the upper left/front). */
const LX = 0.45;
const LY = -0.89;

// ───────────────────────────── geometry helpers ─────────────────────────────

/** Flat [x0, y0, x1, y1, ...] list. */
export type Poly = number[];

/** Mirrors a half outline (from the nose, along the -y side) into a closed outline. */
function mirrorHalf(half: Poly): Poly {
  const out = half.slice();
  for (let i = half.length - 2; i >= 0; i -= 2) {
    const y = half[i + 1]!;
    if (Math.abs(y) < 1e-6) continue; // points on the axis are not doubled
    out.push(half[i]!, -y);
  }
  return out;
}

function scalePoly(p: Poly, s: number): Poly {
  return p.map((v) => v * s);
}

function trace(ctx: CanvasRenderingContext2D, p: Poly, close = true): void {
  ctx.beginPath();
  ctx.moveTo(p[0]!, p[1]!);
  for (let i = 2; i < p.length; i += 2) ctx.lineTo(p[i]!, p[i + 1]!);
  if (close) ctx.closePath();
}

function ngon(n: number, r: number, rot = 0, rAlt = r): Poly {
  const out: Poly = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU;
    const rr = i % 2 === 0 ? r : rAlt;
    out.push(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  return out;
}

function rotPoly(p: Poly, a: number, dx = 0, dy = 0): Poly {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const out: Poly = [];
  for (let i = 0; i < p.length; i += 2) out.push(p[i]! * c - p[i + 1]! * s + dx, p[i]! * s + p[i + 1]! * c + dy);
  return out;
}

function centroid(p: Poly): [number, number] {
  let x = 0;
  let y = 0;
  const n = p.length / 2;
  for (let i = 0; i < p.length; i += 2) {
    x += p[i]!;
    y += p[i + 1]!;
  }
  return [x / n, y / n];
}

// ───────────────────────────── painters ─────────────────────────────

interface PaintOpts {
  /** Glow radius in world units (shadowBlur at bake time). */
  glow: number;
  /** 'flash' = white-hot hit flash, 'ghost' = flat silhouette (afterimages), 'elite' = gold-trimmed. */
  variant: Variant;
  /** Global glow multiplier (post-FX bloom lowers this). */
  glowScale: number;
  res: number;
}

/**
 * Faceted translucent crystal: lit triangular facets fanned from (cx, cy),
 * bright facet ridges, a glowing outline.
 */
function paintCrystal(ctx: CanvasRenderingContext2D, p: Poly, cx: number, cy: number, color: string, o: PaintOpts, line: number, fillA = 1): void {
  const v = o.variant;
  ctx.lineJoin = 'round';
  // Glow + base fill.
  ctx.shadowColor = v === 'flash' ? WHITE : color;
  ctx.shadowBlur = o.glow * o.glowScale * o.res;
  trace(ctx, p);
  ctx.fillStyle = v === 'flash' ? 'rgba(255,255,255,0.92)' : v === 'ghost' ? rgba(color, 0.55) : rgba(mix(color, VOID, 0.45), 0.5 * fillA);
  ctx.fill();
  ctx.lineWidth = line;
  ctx.strokeStyle = v === 'flash' ? WHITE : color;
  ctx.stroke();
  ctx.shadowBlur = 0;
  if (v === 'flash' || v === 'ghost') return;
  // Facets.
  const n = p.length / 2;
  for (let i = 0; i < n; i++) {
    const ax = p[i * 2]!;
    const ay = p[i * 2 + 1]!;
    const bx = p[((i + 1) % n) * 2]!;
    const by = p[((i + 1) % n) * 2 + 1]!;
    // Facet normal ~ direction from the centre to the edge midpoint.
    let nx = (ax + bx) / 2 - cx;
    let ny = (ay + by) / 2 - cy;
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    const lit = Math.max(0, nx * LX + ny * LY);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.closePath();
    // Brightness budget: lit facets stay at max channel ~0.5 (they must not bloom; cores do).
    ctx.fillStyle = rgba(mix(color, WHITE, 0.1 + lit * 0.4), (0.07 + lit * 0.27) * fillA);
    ctx.fill();
  }
  // Ridges from the centre.
  ctx.lineWidth = Math.max(0.5, line * 0.45);
  ctx.strokeStyle = rgba(mix(color, WHITE, 0.5), 0.38);
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    ctx.moveTo(cx, cy);
    ctx.lineTo(p[i * 2]!, p[i * 2 + 1]!);
  }
  ctx.stroke();
  // Crisp rim + white highlight on lit edges.
  trace(ctx, p);
  ctx.lineWidth = line;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.lineWidth = Math.max(0.5, line * 0.36);
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const ax = p[i * 2]!;
    const ay = p[i * 2 + 1]!;
    const bx = p[((i + 1) % n) * 2]!;
    const by = p[((i + 1) % n) * 2 + 1]!;
    const nx = (ay - by) * -1;
    const ny = bx - ax;
    // Outward normal for a clockwise-in-screen outline; only light-facing edges.
    const l = Math.hypot(nx, ny) || 1;
    const midx = (ax + bx) / 2 - cx;
    const midy = (ay + by) / 2 - cy;
    const sgn = nx * midx + ny * midy >= 0 ? 1 : -1;
    if (((nx * sgn) / l) * LX + ((ny * sgn) / l) * LY > 0.35) {
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
    }
  }
  ctx.stroke();
}

// ───────────────────────────── fleet livery ─────────────────────────────
//
// One livery for every allied class (review E3): dark alloy hull, a white-cyan
// rim with a near-white inner edge, and the class colour ONLY on the canopy, an
// accent stripe and the engines. Cool allies vs warm crystal aliens stays true
// even for the pink Phantom and the violet Tempest.

/** Rim of every allied hull. */
export const FLEET_RIM = '#a9e9f6';
/** Baked glow / under-glow tint of every allied hull. */
export const FLEET_GLOW = '#6fe4ff';
const ALLOY = '#141c2b';

/** Solid allied hull: dark alloy fill, cool sheen, white-cyan rim with a hot inner edge. */
function paintHull(ctx: CanvasRenderingContext2D, p: Poly, color: string, o: PaintOpts, line: number): void {
  const v = o.variant;
  ctx.lineJoin = 'round';
  ctx.shadowColor = v === 'flash' ? WHITE : v === 'ghost' ? color : FLEET_GLOW;
  ctx.shadowBlur = o.glow * o.glowScale * o.res;
  trace(ctx, p);
  ctx.fillStyle = v === 'flash' ? '#ffffff' : v === 'ghost' ? rgba(color, 0.7) : ALLOY;
  ctx.fill();
  ctx.shadowBlur = 0;
  if (v === 'flash' || v === 'ghost') return;
  // Upper sheen: a cool wash clipped to the hull.
  ctx.save();
  trace(ctx, p);
  ctx.clip();
  const g = ctx.createLinearGradient(0, -14, 0, 14);
  g.addColorStop(0, 'rgba(190,232,255,0.26)');
  g.addColorStop(0.5, 'rgba(150,200,235,0.08)');
  g.addColorStop(1, rgba(VOID, 0.25));
  ctx.fillStyle = g;
  ctx.fillRect(-40, -40, 80, 80);
  ctx.restore();
  trace(ctx, p);
  ctx.lineWidth = line;
  ctx.strokeStyle = FLEET_RIM;
  ctx.stroke();
  // Near-white inner edge.
  ctx.lineWidth = line * 0.42;
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.stroke();
}

function strokeLines(ctx: CanvasRenderingContext2D, segs: Poly[], color: string, a: number, w: number): void {
  ctx.strokeStyle = rgba(color, a);
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  for (const s of segs) {
    trace(ctx, s, false);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
}

/** Panel seams in the rim colour (faint). */
function seams(ctx: CanvasRenderingContext2D, segs: Poly[]): void {
  strokeLines(ctx, segs, FLEET_RIM, 0.32, 0.55);
}

/** Class accent stripe: the class colour, bright and slightly glowing. */
function stripe(ctx: CanvasRenderingContext2D, segs: Poly[], color: string, w = 1.1): void {
  ctx.shadowColor = color;
  ctx.shadowBlur = 3;
  strokeLines(ctx, segs, mix(color, WHITE, 0.15), 0.95, w);
  ctx.shadowBlur = 0;
}

function canopy(ctx: CanvasRenderingContext2D, p: Poly, color: string): void {
  trace(ctx, p);
  const [cx, cy] = centroid(p);
  const g = ctx.createRadialGradient(cx + 0.8, cy - 0.6, 0, cx, cy, 4);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.45, mix(color, WHITE, 0.5));
  g.addColorStop(1, mix(color, VOID, 0.15));
  ctx.fillStyle = g;
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  ctx.fill();
  ctx.shadowBlur = 0;
}

function pod(ctx: CanvasRenderingContext2D, x0: number, y: number, x1: number, h: number, color: string, line: number): void {
  ctx.beginPath();
  ctx.roundRect(x0, y - h / 2, x1 - x0, h, h / 2);
  ctx.fillStyle = ALLOY;
  ctx.fill();
  ctx.lineWidth = line;
  ctx.strokeStyle = FLEET_RIM;
  ctx.stroke();
  // Class-coloured intake ring at the front of the pod.
  ctx.beginPath();
  ctx.moveTo(x1 - h * 0.45, y - h * 0.32);
  ctx.lineTo(x1 - h * 0.45, y + h * 0.32);
  ctx.strokeStyle = color;
  ctx.lineWidth = line * 0.9;
  ctx.stroke();
}

// ───────────────────────────── allied fleet ─────────────────────────────

export interface Nozzle {
  x: number;
  y: number;
  /** Flame width (world units). */
  w: number;
  /** Relative flame length. */
  len: number;
}

export interface NavLight {
  x: number;
  y: number;
  color: string;
  /** Blink pattern: 0 = steady, 1 = slow blink, 2 = double-strobe. */
  blink: number;
}

export interface ShipArt {
  id: ShipId;
  /** Class name for UI / lore. */
  klass: string;
  hull: Poly;
  /** Extra hull pieces painted with the hull material (pods, deflector arcs...). */
  extra: (ctx: CanvasRenderingContext2D, color: string, o: PaintOpts) => void;
  details: (ctx: CanvasRenderingContext2D, color: string) => void;
  /** Nozzles, lights, extent and shieldR are in WORLD units (design units × SHIP_SCALE). */
  nozzles: Nozzle[];
  lights: NavLight[];
  /** Max |coordinate| of the design (world units), for sprite sizing. */
  extent: number;
  /** Shield bubble radius (world units). */
  shieldR: number;
}

/**
 * Allied hulls are designed at ~17.5 units half-length and drawn this much larger
 * (half-length ~19.5) so the pilot's own vessel is the easiest thing to find on
 * screen (review E1). The hitbox (r = 11) is unchanged.
 */
export const SHIP_SCALE = 1.12;

const PORT = '#ff5f6d';
const STAR = '#5dffa0';
const STROBE = '#ffffff';

const SPARK_HULL = mirrorHalf([17, 0, 10, -2.2, 4, -3.6, 0, -4.4, -5, -11, -8.6, -11.6, -8, -6.2, -10, -4.8, -13, -3.4, -12, -1.4, -14, 0]);
/** Heavy cruiser: long armoured wedge (sharp prow) widening into aft engine sponsons. ~1.65:1. */
const VANGUARD_HULL = mirrorHalf([19.4, 0, 13, -2.5, 8, -4.9, 2.6, -6, -2.6, -6, -4.6, -9.4, -13.4, -10.2, -15.8, -7.4, -13.4, -4.8, -13.8, -2.2, -15.4, 0]);
/** Interceptor: twin prongs whose tips are bridged by the coil emitter (a closed loop, not a fork). */
const TEMPEST_HULL: Poly = [
  17.6, 0, 16.6, -4.4, 15.4, -6.8, 7, -7.3, 0, -5, -7, -11.6, -10.6, -11.3, -8.6, -5, -13.6, -3.6, -12.4, 0, -13.6, 3.6, -8.6, 5, -10.6, 11.3, -7, 11.6, 0, 5,
  7, 7.3, 15.4, 6.8, 16.6, 4.4,
];
const BASTION_HULL = mirrorHalf([10, 0, 7, -5, 0, -7.6, -8, -7.6, -13.4, -4.2, -13.4, 0]);
const PHANTOM_HULL = mirrorHalf([15.5, 0, 6, -3.6, -4, -14, -7.2, -15.2, -8.2, -11.6, -5.6, -9.6, -9.8, -7, -6.6, -4.6, -11.2, -2, -9.2, 0]);

/** Bastion's forward deflector: a crescent band in front of the hull. */
function bastionArc(): Poly {
  const out: Poly = [];
  const cx = -3;
  const a0 = -1.1;
  const a1 = 1.1;
  const steps = 14;
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    out.push(cx + Math.cos(a) * 17.6, Math.sin(a) * 17.6);
  }
  for (let i = steps; i >= 0; i--) {
    const a = a0 + ((a1 - a0) * i) / steps;
    const rr = 15.2 - Math.sin((i / steps) * Math.PI) * 0.4;
    out.push(cx + Math.cos(a) * rr, Math.sin(a) * rr);
  }
  return out;
}
const BASTION_ARC = bastionArc();

function turret(ctx: CanvasRenderingContext2D, x: number, y: number, rad: number, aim: number, color: string): void {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + Math.cos(aim) * rad * 2.2, y + Math.sin(aim) * rad * 2.2);
  ctx.strokeStyle = FLEET_RIM;
  ctx.lineWidth = 0.75;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, rad, 0, TAU);
  ctx.fillStyle = '#26324a';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 0.6;
  ctx.stroke();
}

export const SHIP_ART: Record<ShipId, ShipArt> = {
  spark: {
    id: 'spark',
    klass: 'Light frigate',
    hull: SPARK_HULL,
    extra: (ctx, color, o) => {
      if (o.variant === 'flash' || o.variant === 'ghost') {
        ctx.fillStyle = o.variant === 'flash' ? '#fff' : rgba(color, 0.7);
        ctx.beginPath();
        ctx.roundRect(-11.4, -13, 8.8, 2.8, 1.4);
        ctx.roundRect(-11.4, 10.2, 8.8, 2.8, 1.4);
        ctx.fill();
        return;
      }
      pod(ctx, -11.4, -11.6, -2.6, 2.8, color, 0.9);
      pod(ctx, -11.4, 11.6, -2.6, 2.8, color, 0.9);
    },
    details: (ctx, color) => {
      seams(ctx, [[4, 0, -10.5, 0], [9, -2.4, 4, -1.4], [9, 2.4, 4, 1.4]]);
      stripe(ctx, [[0, -4.4, -6.6, -9.4], [0, 4.4, -6.6, 9.4]], color);
      canopy(ctx, [11, 0, 7, -1.7, 3.6, -1.3, 3.6, 1.3, 7, 1.7], color);
    },
    nozzles: [
      { x: -13.4, y: 0, w: 3.4, len: 1 },
      { x: -11.6, y: -11.6, w: 1.9, len: 0.6 },
      { x: -11.6, y: 11.6, w: 1.9, len: 0.6 },
    ],
    lights: [
      { x: -3, y: -11.6, color: PORT, blink: 1 },
      { x: -3, y: 11.6, color: STAR, blink: 1 },
      { x: 1.5, y: 0, color: STROBE, blink: 2 },
    ],
    extent: 17.5,
    shieldR: 21,
  },
  vanguard: {
    id: 'vanguard',
    klass: 'Heavy cruiser',
    hull: VANGUARD_HULL,
    extra: () => {},
    details: (ctx, color) => {
      // Armour seams: prow plates (chevrons), sponson seams.
      seams(ctx, [
        [13.6, -2.3, 12, 0, 13.6, 2.3],
        [9.6, -4.1, 7.6, 0, 9.6, 4.1],
        [-4.6, -6, -4.6, 6],
        [-5.4, -8.2, -14.2, -8.2],
        [-5.4, 8.2, -14.2, 8.2],
      ]);
      // Class stripe down the spine of the prow.
      stripe(ctx, [[17.6, 0, 11.4, 0]], color, 1.2);
      // Long bridge superstructure (no "face": one forward turret on the centreline).
      ctx.beginPath();
      ctx.moveTo(4.6, 0);
      ctx.lineTo(2.2, -2.3);
      ctx.lineTo(-7.4, -2.3);
      ctx.lineTo(-8.6, 0);
      ctx.lineTo(-7.4, 2.3);
      ctx.lineTo(2.2, 2.3);
      ctx.closePath();
      ctx.fillStyle = '#212c40';
      ctx.fill();
      ctx.strokeStyle = FLEET_RIM;
      ctx.lineWidth = 0.6;
      ctx.stroke();
      canopy(ctx, [3.8, 0, 2.2, -1.4, 0.4, -1.1, 0.4, 1.1, 2.2, 1.4], color);
      // Turrets: a big forward mount on the centreline, two staggered sponson mounts aft.
      turret(ctx, 8.6, 0, 1.45, 0, color);
      turret(ctx, -9.6, -6.1, 1.05, -0.35, color);
      turret(ctx, -12.2, 6.1, 1.05, 0.35, color);
    },
    nozzles: [
      { x: -15.8, y: -7.4, w: 3.4, len: 0.95 },
      { x: -15.8, y: 7.4, w: 3.4, len: 0.95 },
      { x: -15.2, y: 0, w: 2.4, len: 0.7 },
    ],
    lights: [
      { x: -9, y: -10, color: PORT, blink: 1 },
      { x: -9, y: 10, color: STAR, blink: 1 },
      { x: 18.4, y: 0, color: STROBE, blink: 2 },
    ],
    extent: 19.4,
    shieldR: 22,
  },
  tempest: {
    id: 'tempest',
    klass: 'Interceptor',
    hull: TEMPEST_HULL,
    extra: () => {},
    details: (ctx, color) => {
      seams(ctx, [[15, -5.6, 2, -4.2], [15, 5.6, 2, 4.2], [0, -5, -8.6, -5], [0, 5, -8.6, 5], [-1, 0, -12, 0]]);
      stripe(ctx, [[-1.4, -5.6, -8.2, -10.4], [-1.4, 5.6, -8.2, 10.4]], color);
      // Coil emitter bridging the prongs: a lit core wound with coil rings.
      const g = ctx.createRadialGradient(12.6, 0, 0, 12.6, 0, 3.4);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.45, mix(color, WHITE, 0.4));
      g.addColorStop(1, rgba(color, 0.15));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(12.6, 0, 3.6, 3.3, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = mix(color, WHITE, 0.2);
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      for (const x of [10.4, 12.6, 14.8]) {
        ctx.moveTo(x, -3.6);
        ctx.quadraticCurveTo(x + 1.4, 0, x, 3.6);
      }
      ctx.stroke();
      canopy(ctx, [6.4, 0, 3.4, -1.6, 0.4, -1.2, 0.4, 1.2, 3.4, 1.6], color);
    },
    nozzles: [
      { x: -13.4, y: -2.2, w: 2.3, len: 1.1 },
      { x: -13.4, y: 2.2, w: 2.3, len: 1.1 },
    ],
    lights: [
      { x: -9.2, y: -11.4, color: PORT, blink: 1 },
      { x: -9.2, y: 11.4, color: STAR, blink: 1 },
      { x: 16.4, y: -5.4, color: STROBE, blink: 2 },
      { x: 16.4, y: 5.4, color: STROBE, blink: 2 },
    ],
    extent: 18,
    shieldR: 21,
  },
  bastion: {
    id: 'bastion',
    klass: 'Shield dreadnought',
    hull: BASTION_HULL,
    extra: (ctx, color, o) => {
      // Struts to the deflector, then the deflector crescent itself (class colour: it is an energy shield).
      ctx.strokeStyle = o.variant === 'flash' ? '#fff' : o.variant === 'ghost' ? rgba(color, 0.7) : FLEET_RIM;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(5, -5.6);
      ctx.lineTo(9.5, -8.6);
      ctx.moveTo(5, 5.6);
      ctx.lineTo(9.5, 8.6);
      ctx.moveTo(9, 0);
      ctx.lineTo(12.2, 0);
      ctx.stroke();
      if (o.variant === 'flash' || o.variant === 'ghost') {
        trace(ctx, BASTION_ARC);
        ctx.fillStyle = o.variant === 'flash' ? '#fff' : rgba(color, 0.7);
        ctx.fill();
        return;
      }
      ctx.shadowColor = color;
      ctx.shadowBlur = o.glow * 1.3 * o.glowScale * o.res;
      trace(ctx, BASTION_ARC);
      ctx.fillStyle = rgba(mix(color, WHITE, 0.3), 0.4);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 0.9;
      ctx.strokeStyle = mix(color, WHITE, 0.45);
      ctx.stroke();
    },
    details: (ctx, color) => {
      seams(ctx, [[7, -5, -13.4, -2.2], [7, 5, -13.4, 2.2], [-8, -7.6, -8, 7.6]]);
      stripe(ctx, [[0, -7.6, -3, -3.6], [0, 7.6, -3, 3.6]], color);
      // Bridge dome.
      ctx.beginPath();
      ctx.arc(-1.4, 0, 3.1, 0, TAU);
      const g = ctx.createRadialGradient(-0.4, -1, 0, -1.4, 0, 3.1);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.45, mix(color, WHITE, 0.4));
      g.addColorStop(1, mix(color, VOID, 0.3));
      ctx.fillStyle = g;
      ctx.fill();
    },
    nozzles: [
      { x: -13.8, y: 0, w: 2.8, len: 0.9 },
      { x: -13.6, y: -3.6, w: 2, len: 0.75 },
      { x: -13.6, y: 3.6, w: 2, len: 0.75 },
    ],
    lights: [
      { x: 6.6, y: -15.6, color: PORT, blink: 1 },
      { x: 6.6, y: 15.6, color: STAR, blink: 1 },
      { x: -8, y: 0, color: STROBE, blink: 2 },
    ],
    extent: 17.6,
    shieldR: 22,
  },
  phantom: {
    id: 'phantom',
    klass: 'Stealth raider',
    hull: PHANTOM_HULL,
    extra: () => {},
    details: (ctx, color) => {
      // Stealth facet lines + class-coloured missile rails.
      seams(ctx, [
        [15.5, 0, -6.6, -4.6],
        [15.5, 0, -6.6, 4.6],
        [6, -3.6, -5.6, -9.6],
        [6, 3.6, -5.6, 9.6],
        [2, -0, -9.2, 0],
      ]);
      stripe(ctx, [[3, -6.8, -2.6, -9], [3, 6.8, -2.6, 9]], color, 1.2);
      canopy(ctx, [9.6, 0, 5.4, -1.2, 2.4, 0, 5.4, 1.2], color);
    },
    nozzles: [
      { x: -10.6, y: -1.7, w: 1.7, len: 0.9 },
      { x: -10.6, y: 1.7, w: 1.7, len: 0.9 },
      { x: -7, y: -4.6, w: 1.2, len: 0.45 },
      { x: -7, y: 4.6, w: 1.2, len: 0.45 },
    ],
    lights: [
      { x: -6.6, y: -14.6, color: PORT, blink: 1 },
      { x: -6.6, y: 14.6, color: STAR, blink: 1 },
    ],
    extent: 16,
    shieldR: 20,
  },
};

// Design units → world units for everything the draw code places around the hull.
for (const a of Object.values(SHIP_ART)) {
  for (const n of a.nozzles) {
    n.x *= SHIP_SCALE;
    n.y *= SHIP_SCALE;
    n.w *= SHIP_SCALE;
  }
  for (const l of a.lights) {
    l.x *= SHIP_SCALE;
    l.y *= SHIP_SCALE;
  }
  a.extent *= SHIP_SCALE;
  a.shieldR = Math.round(a.shieldR * SHIP_SCALE);
}

function paintShip(ctx: CanvasRenderingContext2D, art: ShipArt, color: string, o: PaintOpts): void {
  const line = 1.35;
  ctx.save();
  ctx.scale(SHIP_SCALE, SHIP_SCALE);
  // Pieces under the hull (pods) first so the hull rim overlaps them.
  if (art.id === 'spark') art.extra(ctx, color, o);
  paintHull(ctx, art.hull, color, o, line);
  if (art.id !== 'spark') art.extra(ctx, color, o);
  if (o.variant === 'normal' || o.variant === 'elite') art.details(ctx, color);
  ctx.restore();
}

// ───────────────────────────── alien armada ─────────────────────────────

export interface AlienArt {
  /** Outline at unit radius (shatter fragments are cut from this). */
  outline: Poly;
  /** Facet centre at unit radius. */
  cx: number;
  cy: number;
  /** Glowing core (unit radius coords). */
  core: { x: number; y: number; r: number; sx: number };
  /** Sprite extent as a multiple of r. */
  extent: number;
}

function splitterOutline(): Poly {
  const out: Poly = [];
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + 0.1;
    const rr = i % 2 === 0 ? 1 : 0.8 + ((i * 37) % 7) * 0.012;
    out.push(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  return out;
}

export const ALIEN_ART: Record<EnemyKind, AlienArt> = {
  // Drone: an asymmetric cluster of jagged crystal spikes round one forward spike (no wings, no mirror symmetry).
  drifter: {
    outline: [1.16, 0.04, 0.55, -0.2, 0.66, -0.6, 0.24, -0.36, -0.1, -0.9, -0.34, -0.32, -0.94, -0.44, -0.66, -0.02, -1.0, 0.34, -0.42, 0.36, -0.28, 0.8, 0.04, 0.38, 0.5, 0.52, 0.42, 0.18],
    cx: 0.04,
    cy: 0,
    core: { x: 0.14, y: 0, r: 0.24, sx: 1 },
    extent: 1.2,
  },
  swarmling: {
    outline: mirrorHalf([1.25, 0, 0.12, -0.36, -0.98, -0.66, -0.56, 0]),
    cx: 0,
    cy: 0,
    core: { x: 0.12, y: 0, r: 0.28, sx: 1.4 },
    extent: 1.3,
  },
  // Lancer: one long crystal lance with a lopsided cluster of shards at its root.
  dasher: {
    outline: [1.34, 0, 0.5, -0.15, 0.22, -0.52, 0.0, -0.24, -0.44, -0.64, -0.5, -0.2, -1.02, -0.16, -0.78, 0.06, -0.96, 0.44, -0.36, 0.22, -0.06, 0.38, 0.3, 0.15],
    cx: 0.06,
    cy: 0,
    core: { x: 0.14, y: 0, r: 0.22, sx: 1.8 },
    extent: 1.4,
  },
  splitter: { outline: splitterOutline(), cx: -0.08, cy: 0.06, core: { x: 0, y: 0, r: 0.3, sx: 1 }, extent: 1.05 },
  splitling: { outline: ngon(7, 1, 0.3, 0.78), cx: -0.06, cy: 0.05, core: { x: 0, y: 0, r: 0.3, sx: 1 }, extent: 1.05 },
  shooter: { outline: ngon(6, 1, Math.PI / 6), cx: -0.1, cy: 0.04, core: { x: 0, y: 0, r: 0.22, sx: 1 }, extent: 1.55 },
  brute: { outline: ngon(8, 0.98, Math.PI / 8), cx: 0, cy: 0, core: { x: 0.05, y: 0, r: 0.2, sx: 1 }, extent: 1.12 },
  warden: { outline: ngon(6, 1, 0), cx: 0, cy: 0, core: { x: 0, y: 0, r: 0.2, sx: 1 }, extent: 1.12 },
  hydra: { outline: ngon(12, 0.8, 0, 0.44), cx: 0, cy: 0, core: { x: 0, y: 0, r: 0.2, sx: 1 }, extent: 1.0 },
  voidheart: { outline: ngon(16, 1, 0, 0.8), cx: 0, cy: 0, core: { x: 0, y: 0, r: 0.25, sx: 1 }, extent: 1.12 },
};

/** Draws the static crystal hull of a regular alien vessel at radius r. */
function paintAlienBody(ctx: CanvasRenderingContext2D, kind: EnemyKind, color: string, r: number, o: PaintOpts): void {
  const art = ALIEN_ART[kind];
  const line = Math.max(1.1, r * 0.075);
  const p = scalePoly(art.outline, r);
  const cx = art.cx * r;
  const cy = art.cy * r;
  switch (kind) {
    case 'shooter': {
      // Twin cannon spines first (under the hull).
      const spines: Poly[] = [
        [0.5 * r, -0.4 * r, 1.5 * r, -0.17 * r, 0.62 * r, -0.1 * r],
        [0.5 * r, 0.4 * r, 1.5 * r, 0.17 * r, 0.62 * r, 0.1 * r],
      ];
      for (const s of spines) paintCrystal(ctx, s, 0.85 * r, Math.sign(s[1]!) * 0.22 * r, color, { ...o, glow: o.glow * 0.6 }, line * 0.8);
      paintCrystal(ctx, p, cx, cy, color, o, line);
      break;
    }
    case 'brute': {
      // Inner keel only; armour plates are separate animated parts.
      paintCrystal(ctx, scalePoly(art.outline, r * 0.62), 0, 0, color, o, line);
      break;
    }
    case 'dasher': {
      paintCrystal(ctx, p, cx, cy, color, o, line);
      if (o.variant === 'normal' || o.variant === 'elite') {
        strokeLines(ctx, [[1.2 * r, 0, -0.2 * r, 0]], WHITE, 0.4, line * 0.5);
      }
      break;
    }
    default:
      paintCrystal(ctx, p, cx, cy, color, o, line);
  }
  if (o.variant === 'elite') {
    // Gold crown: a broken ring of gold crystal ticks.
    ctx.shadowColor = '#ffc93c';
    ctx.shadowBlur = o.glow * 1.2 * o.res;
    ctx.strokeStyle = '#ffc93c';
    ctx.lineWidth = Math.max(1.4, r * 0.09);
    const R = r * (Math.min(1.25, ALIEN_ART[kind].extent) * 0.95 + 0.2);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.26;
      ctx.beginPath();
      ctx.arc(0, 0, R, a, a + 0.62);
      ctx.stroke();
    }
    ctx.shadowBlur = 0;
  }
}

// ───────────────────────────── sprite cache ─────────────────────────────

export type Variant = 'normal' | 'flash' | 'elite' | 'ghost';

export interface Sprite {
  canvas: HTMLCanvasElement;
  /** Square size in world units. */
  size: number;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/** Named animated sub-parts of aliens and bosses. */
export type PartId =
  | 'splitRing'
  | 'shooterHex'
  | 'brutePlate'
  | 'bruteFrontPlate'
  | 'wardenHull'
  | 'wardenOuter'
  | 'wardenInner'
  | 'hydraBody'
  | 'hydraHead'
  | 'hydraSeg'
  | 'voidHull'
  | 'voidSpires';

/**
 * Bakes and caches every vessel sprite. Keys include colour, size and variant.
 * Cleared when the resolution changes (zoom / DPR change).
 */
const KIND_IDX: Record<EnemyKind, number> = { drifter: 0, swarmling: 1, dasher: 2, splitter: 3, splitling: 4, shooter: 5, brute: 6, warden: 7, hydra: 8, voidheart: 9 };
const VARIANT_IDX: Record<Variant, number> = { normal: 0, flash: 1, elite: 2, ghost: 3 };
const PART_IDX: Record<PartId, number> = {
  splitRing: 0, shooterHex: 1, brutePlate: 2, bruteFrontPlate: 3, wardenHull: 4, wardenOuter: 5, wardenInner: 6, hydraBody: 7, hydraHead: 8, hydraSeg: 9, voidHull: 10, voidSpires: 11,
};

export class VesselArt {
  private cache = new Map<string, Sprite>();
  /** Allocation-free per-frame lookups (numeric keys / nested maps); cleared with `cache`. */
  private fast = new Map<number, Sprite>();
  private glows = new Map<string, Map<string, Sprite>>();
  private res = 2;
  glowScale = 1;

  /** Returns true when the resolution changed (all sprites were dropped). */
  setResolution(pxPerUnit: number): boolean {
    const r = Math.min(4, Math.max(1, Math.round(pxPerUnit * 2) / 2));
    if (r !== this.res) {
      this.res = r;
      this.clear();
      return true;
    }
    return false;
  }

  setGlowScale(s: number): void {
    if (s !== this.glowScale) {
      this.glowScale = s;
      this.clear();
    }
  }

  private clear(): void {
    this.cache.clear();
    this.fast.clear();
    this.glows.clear();
  }

  /** Number of baked sprites (diagnostics). */
  get size(): number {
    return this.cache.size;
  }

  private bake(key: string, half: number, paint: (ctx: CanvasRenderingContext2D, res: number) => void): Sprite {
    let s = this.cache.get(key);
    if (s) return s;
    const size = half * 2;
    const res = this.res;
    const c = makeCanvas(size * res, size * res);
    const ctx = c.getContext('2d')!;
    ctx.translate(c.width / 2, c.height / 2);
    ctx.scale(res, res);
    paint(ctx, res);
    s = { canvas: c, size: c.width / res };
    this.cache.set(key, s);
    return s;
  }

  private opts(glow: number, variant: Variant): PaintOpts {
    return { glow, variant, glowScale: this.glowScale, res: this.res };
  }

  ship(id: ShipId, color: string, variant: Variant = 'normal'): Sprite {
    const art = SHIP_ART[id];
    const glow = variant === 'ghost' ? 3 : 6;
    return this.bake(`ship|${id}|${color}|${variant}`, art.extent + glow * this.glowScale + 3, (ctx) => paintShip(ctx, art, color, this.opts(glow, variant)));
  }

  alien(kind: EnemyKind, color: string, r: number, variant: Variant = 'normal'): Sprite {
    // Fast path: an alien's colour is fixed per kind, so (kind, variant, r) identifies the sprite.
    const fk = (KIND_IDX[kind] * 4 + VARIANT_IDX[variant]) * 1e5 + Math.round(r * 10);
    let f = this.fast.get(fk);
    if (!f) {
      f = this.alienSlow(kind, color, r, variant);
      this.fast.set(fk, f);
    }
    return f;
  }

  private alienSlow(kind: EnemyKind, color: string, r: number, variant: Variant): Sprite {
    const art = ALIEN_ART[kind];
    const glow = Math.max(4, r * 0.55);
    const half = r * art.extent + glow * this.glowScale + (variant === 'elite' ? r * 0.45 : 0) + 3;
    return this.bake(`alien|${kind}|${color}|${r.toFixed(1)}|${variant}`, half, (ctx) => paintAlienBody(ctx, kind, color, r, this.opts(glow, variant)));
  }

  part(id: PartId, color: string, r: number, variant: Variant = 'normal'): Sprite {
    const fk = -((PART_IDX[id] * 4 + VARIANT_IDX[variant]) * 1e5 + Math.round(r * 10)) - 1;
    let f = this.fast.get(fk);
    if (!f) {
      f = this.partSlow(id, color, r, variant);
      this.fast.set(fk, f);
    }
    return f;
  }

  private partSlow(id: PartId, color: string, r: number, variant: Variant): Sprite {
    const glow = Math.max(3, r * 0.3);
    const o = this.opts(glow, variant);
    const pad = glow * this.glowScale + 2;
    const line = Math.max(1, r * 0.05);
    const key = `part|${id}|${color}|${r.toFixed(1)}|${variant}`;
    switch (id) {
      case 'splitRing':
        // Orbiting ring with three budding daughter crystals.
        return this.bake(key, r * 0.85 + pad, (ctx) => {
          ctx.shadowColor = color;
          ctx.shadowBlur = glow * this.res * this.glowScale;
          ctx.strokeStyle = variant === 'flash' ? '#fff' : rgba(mix(color, WHITE, 0.5), 0.9);
          ctx.lineWidth = line * 1.1;
          ctx.setLineDash([r * 0.18, r * 0.1]);
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.56, 0, TAU);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.shadowBlur = 0;
          for (let i = 0; i < 3; i++) {
            const a = (i / 3) * TAU;
            const bud = rotPoly(ngon(4, r * 0.26, 0, r * 0.15), a, Math.cos(a) * r * 0.56, Math.sin(a) * r * 0.56);
            const [bx, by] = centroid(bud);
            paintCrystal(ctx, bud, bx, by, mix(color, WHITE, 0.35), { ...o, glow: glow * 0.9 }, line * 0.9, 1.4);
          }
        });
      case 'shooterHex':
        return this.bake(key, r * 0.6 + pad, (ctx) => {
          const hex = ngon(6, r * 0.5, 0);
          paintCrystal(ctx, hex, 0, 0, mix(color, WHITE, 0.2), { ...o, glow: glow * 0.6 }, line, 0.7);
          ctx.strokeStyle = 'rgba(255,255,255,0.7)';
          ctx.lineWidth = line * 0.5;
          trace(ctx, ngon(6, r * 0.3, Math.PI / 6));
          ctx.stroke();
        });
      case 'brutePlate':
      case 'bruteFrontPlate': {
        const front = id === 'bruteFrontPlate';
        return this.bake(key, r * 1.2 + pad, (ctx) => {
          // Plate centred on +x; inner edge at 0.62r, outer at 0.98r (front plate bulkier, spiked).
          const ro = front ? 0.98 : 0.9;
          const plate: Poly = front
            ? [0.6 * r, -0.5 * r, ro * r, -0.38 * r, 1.12 * r, -0.1 * r, 1.12 * r, 0.1 * r, ro * r, 0.38 * r, 0.6 * r, 0.5 * r]
            : [0.62 * r, -0.46 * r, ro * r, -0.34 * r, ro * r, 0.34 * r, 0.62 * r, 0.46 * r];
          paintCrystal(ctx, plate, 0.78 * r, 0, color, o, line * 1.1, 1.1);
          if (variant === 'normal' || variant === 'elite') {
            strokeLines(ctx, [[0.8 * r, -0.3 * r, 0.8 * r, 0.3 * r]], WHITE, 0.35, line * 0.6);
          }
        });
      }
      case 'wardenHull':
        return this.bake(key, r * 0.75 + pad, (ctx) => {
          const hex = ngon(6, r * 0.64, 0);
          paintCrystal(ctx, hex, 0, 0, color, o, line);
          if (variant === 'flash') return;
          // The gate aperture.
          ctx.lineWidth = line * 1.2;
          ctx.strokeStyle = mix(color, WHITE, 0.5);
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.3, 0, TAU);
          ctx.stroke();
          ctx.fillStyle = rgba(VOID, 0.65);
          ctx.fill();
          strokeLines(ctx, ngonSpokes(6, r * 0.3, r * 0.64), color, 0.6, line * 0.6);
        });
      case 'wardenOuter':
        return this.bake(key, r * 1.12 + pad, (ctx) => {
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * TAU + Math.PI / 6;
            const seg = arcSeg(r * 0.76, r * 0.98, a - 0.36, a + 0.36, r * 1.12);
            const [sx, sy] = centroid(seg);
            paintCrystal(ctx, seg, sx * 0.9, sy * 0.9, color, o, line);
          }
        });
      case 'wardenInner':
        return this.bake(key, r * 0.6 + pad, (ctx) => {
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * TAU;
            const kite = rotPoly([r * 0.54, 0, r * 0.44, -r * 0.07, r * 0.36, 0, r * 0.44, r * 0.07], a);
            const [kx, ky] = centroid(kite);
            paintCrystal(ctx, kite, kx, ky, mix(color, WHITE, 0.3), { ...o, glow: glow * 0.5 }, line * 0.8);
          }
        });
      case 'hydraBody':
        return this.bake(key, r * 1.0 + pad, (ctx) => {
          // Hull: a swept six-point crystal star with a raised inner citadel.
          const star = ngon(12, r * 0.8, 0, r * 0.44);
          paintCrystal(ctx, star, 0, 0, color, o, line);
          if (variant === 'flash') return;
          paintCrystal(ctx, ngon(6, r * 0.3, Math.PI / 6), 0, 0, mix(color, WHITE, 0.25), { ...o, glow: 0 }, line * 0.8, 0.8);
        });
      case 'hydraHead':
        // A hunter head: an arrowhead with mandible crystals; r is the boss radius.
        return this.bake(key, r * 0.4 + pad, (ctx) => {
          const head = mirrorHalf([r * 0.36, 0, r * 0.08, -r * 0.13, -r * 0.08, -r * 0.24, -r * 0.04, -r * 0.08, -r * 0.18, 0]);
          paintCrystal(ctx, head, 0, 0, color, { ...o, glow: glow * 0.8 }, line);
          if (variant === 'flash') return;
          ctx.fillStyle = '#fff';
          ctx.beginPath();
          ctx.arc(r * 0.1, 0, r * 0.045, 0, TAU);
          ctx.fill();
        });
      case 'hydraSeg':
        return this.bake(key, r * 0.12 + pad, (ctx) => {
          paintCrystal(ctx, ngon(4, r * 0.1, 0, r * 0.065), 0, 0, color, { ...o, glow: glow * 0.5 }, line * 0.7);
        });
      case 'voidHull':
        return this.bake(key, r * 0.7 + pad, (ctx) => {
          const hull = ngon(12, r * 0.62, 0, r * 0.56);
          paintCrystal(ctx, hull, 0, 0, color, o, line);
          if (variant === 'flash') return;
          // Hive honeycomb.
          ctx.strokeStyle = rgba(mix(color, WHITE, 0.4), 0.45);
          ctx.lineWidth = line * 0.5;
          const cell = r * 0.09;
          for (let q = -4; q <= 4; q++) {
            for (let s = -4; s <= 4; s++) {
              const x = (q + s * 0.5) * cell * 1.8;
              const y = s * cell * 1.56;
              const d = Math.hypot(x, y);
              if (d < r * 0.24 || d > r * 0.5) continue;
              trace(ctx, ngon(6, cell * 0.85, Math.PI / 6).map((v, i) => v + (i % 2 === 0 ? x : y)));
              ctx.stroke();
            }
          }
        });
      case 'voidSpires':
        return this.bake(key, r * 1.12 + pad, (ctx) => {
          for (let i = 0; i < 8; i++) {
            const a = (i / 8) * TAU;
            const spire = rotPoly([r * 0.5, -r * 0.09, r * 1.1, 0, r * 0.5, r * 0.09, r * 0.6, 0], a);
            paintCrystal(ctx, spire, Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62, color, o, line);
            // Docking clamps either side of each spire.
            const b = a + TAU / 16;
            ctx.strokeStyle = variant === 'flash' ? '#fff' : rgba(color, 0.75);
            ctx.lineWidth = line;
            ctx.beginPath();
            ctx.arc(0, 0, r * 0.74, b - 0.12, b + 0.12);
            ctx.stroke();
          }
        });
    }
  }

  /** Soft radial glow dot (cores, lights, flashes). Drawn additively, scaled at draw time. */
  glow(color: string, core = '#ffffff'): Sprite {
    let m = this.glows.get(color);
    if (!m) {
      m = new Map();
      this.glows.set(color, m);
    }
    let g = m.get(core);
    if (!g) {
      g = this.glowSlow(color, core);
      m.set(core, g);
    }
    return g;
  }

  private glowSlow(color: string, core: string): Sprite {
    return this.bake(`glow|${color}|${core}`, 8, (ctx) => {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 8);
      g.addColorStop(0, core);
      g.addColorStop(0.18, core);
      g.addColorStop(0.35, rgba(color, 0.85));
      g.addColorStop(0.65, rgba(color, 0.22));
      g.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(-8, -8, 16, 16);
    });
  }

  /** Engine flame: nozzle at the origin, plume along -x, unit length 16 and height 8. Scaled at draw time. */
  flame(color: string): Sprite {
    return this.bake(`flame|${color}`, 16, (ctx) => {
      ctx.save();
      ctx.scale(1, 0.25);
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 16);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.15, rgba(mix(color, WHITE, 0.6), 0.95));
      g.addColorStop(0.45, rgba(color, 0.55));
      g.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      // Teardrop: only the back half, plus a little lip in front of the nozzle.
      ctx.moveTo(1.5, -16);
      ctx.lineTo(1.5, 16);
      ctx.lineTo(-16, 16);
      ctx.lineTo(-16, -16);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    });
  }

  /** Shield bubble: faint faceted dome with a bright rim. */
  shield(color: string, R: number): Sprite {
    return this.bake(`shield|${color}|${R}`, R + 5, (ctx) => {
      const g = ctx.createRadialGradient(0, 0, R * 0.55, 0, 0, R);
      // Fill stays <= ~0.2 at the very rim (<= 0.15 after the draw alpha) so the hull is never hidden.
      g.addColorStop(0, rgba(color, 0));
      g.addColorStop(0.75, rgba(color, 0.04));
      g.addColorStop(1, rgba(color, 0.2));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, TAU);
      ctx.fill();
      // Hex lattice, faded to the rim.
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = rgba(mix(color, WHITE, 0.4), 0.16);
      ctx.lineWidth = 0.5;
      const cell = R * 0.24;
      for (let q = -5; q <= 5; q++) {
        for (let s = -5; s <= 5; s++) {
          const x = (q + s * 0.5) * cell * 1.73;
          const y = s * cell * 1.5;
          if (Math.hypot(x, y) > R * 1.05) continue;
          trace(ctx, ngon(6, cell, Math.PI / 6).map((v, i) => v + (i % 2 === 0 ? x : y)));
          ctx.stroke();
        }
      }
      ctx.restore();
      ctx.shadowColor = color;
      ctx.shadowBlur = 4 * this.res;
      ctx.strokeStyle = rgba(mix(color, WHITE, 0.3), 0.75);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(0, 0, R, 0, TAU);
      ctx.stroke();
      ctx.shadowBlur = 0;
    });
  }

  /**
   * Soft dark contact shadow (unit radius 16) drawn UNDER the pilot's hull with normal
   * blending: it cuts a calm pocket out of a bright swarm so the vessel separates.
   */
  shadow(): Sprite {
    return this.bake('shadow', 16, (ctx) => {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 16);
      g.addColorStop(0, 'rgba(2,4,12,1)');
      g.addColorStop(0.55, 'rgba(2,4,12,0.75)');
      g.addColorStop(1, 'rgba(2,4,12,0)');
      ctx.fillStyle = g;
      ctx.fillRect(-16, -16, 32, 32);
    });
  }

  /** Missile body (Phantom seekers): small crystal-free alloy dart with a fin cross. */
  missile(color: string): Sprite {
    return this.bake(`missile|${color}`, 9, (ctx) => {
      const body = mirrorHalf([6, 0, 3, -1.3, -3.4, -1.3, -5, -3, -5.6, -1.2, -4.6, 0]);
      paintHull(ctx, body, color, this.opts(3, 'normal'), 0.7);
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.ellipse(3.2, 0, 1.6, 0.7, 0, 0, TAU);
      ctx.fill();
    });
  }
}

function ngonSpokes(n: number, r0: number, r1: number): Poly[] {
  const out: Poly[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    out.push([Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a) * r1, Math.sin(a) * r1]);
  }
  return out;
}

/** An armour ring segment between radii r0..r1 and angles a0..a1, with a spike to rs at the middle. */
function arcSeg(r0: number, r1: number, a0: number, a1: number, rs: number): Poly {
  const out: Poly = [];
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    const rr = i === 2 ? rs : r1;
    out.push(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  for (let i = steps; i >= 0; i--) {
    const a = a0 + ((a1 - a0) * i) / steps;
    out.push(Math.cos(a) * r0, Math.sin(a) * r0);
  }
  return out;
}

// ───────────────────────────── fragments for shatter ─────────────────────────────

/**
 * Triangulates an outline (fan from its facet centre) and splits the largest
 * triangles until there are `target` shards. Returns flat triangles in unit
 * coordinates: [ax, ay, bx, by, cx, cy] per shard.
 */
export function fragmentsOf(outline: Poly, cx: number, cy: number, target: number): number[][] {
  const tris: number[][] = [];
  const n = outline.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    tris.push([cx, cy, outline[i * 2]!, outline[i * 2 + 1]!, outline[j * 2]!, outline[j * 2 + 1]!]);
  }
  const area = (t: number[]) => Math.abs((t[2]! - t[0]!) * (t[5]! - t[1]!) - (t[4]! - t[0]!) * (t[3]! - t[1]!)) / 2;
  // Merge tiny neighbours when there are too many (e.g. a 16-gon star).
  while (tris.length > target) {
    let best = 0;
    let bestA = Infinity;
    for (let i = 0; i < tris.length; i++) {
      const a = area(tris[i]!) + area(tris[(i + 1) % tris.length]!);
      if (a < bestA) {
        bestA = a;
        best = i;
      }
    }
    const a = tris[best]!;
    const b = tris[(best + 1) % tris.length]!;
    // Quad (centre, a1, a2==b1, b2) → triangle (centre, a1, b2) is a fair approximation of the pair.
    const merged = [a[0]!, a[1]!, a[2]!, a[3]!, b[4]!, b[5]!];
    tris.splice(best, 1, merged);
    tris.splice((best + 1) % tris.length, 1);
  }
  // Split the largest across its longest edge until we have enough.
  while (tris.length < target) {
    let best = 0;
    let bestA = -1;
    for (let i = 0; i < tris.length; i++) {
      const a = area(tris[i]!);
      if (a > bestA) {
        bestA = a;
        best = i;
      }
    }
    const t = tris[best]!;
    const pts: [number, number][] = [[t[0]!, t[1]!], [t[2]!, t[3]!], [t[4]!, t[5]!]];
    let e = 0;
    let el = -1;
    for (let k = 0; k < 3; k++) {
      const p = pts[k]!;
      const q = pts[(k + 1) % 3]!;
      const l = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (l > el) {
        el = l;
        e = k;
      }
    }
    const p = pts[e]!;
    const q = pts[(e + 1) % 3]!;
    const o = pts[(e + 2) % 3]!;
    // Off-centre split looks more like broken crystal.
    const s = 0.4 + ((tris.length * 7) % 5) * 0.05;
    const m: [number, number] = [p[0] + (q[0] - p[0]) * s, p[1] + (q[1] - p[1]) * s];
    tris.splice(best, 1, [p[0], p[1], m[0], m[1], o[0], o[1]], [m[0], m[1], q[0], q[1], o[0], o[1]]);
  }
  return tris;
}
