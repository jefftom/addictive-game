/**
 * WarpGrid — an infinite, warping energy grid for the arena floor.
 *
 * A mesh of points, each anchored to its rest position on a world-aligned
 * lattice and coupled to its four neighbours (a damped discrete membrane).
 * Gameplay feeds it forces (blast kicks, travelling shock fronts, gravity
 * wells, dash wakes); the springs carry those disturbances outward as ripples
 * and pull everything back to rest.
 *
 * - Infinite: the mesh covers only the visible world area plus a margin and is
 *   addressed toroidally (cell (gi,gj) lives in slot (gi mod cols, gj mod rows)),
 *   so when the camera moves only the columns/rows that scroll in are reset.
 *   The outer margin is extra-damped so waves die there instead of reflecting.
 * - Fixed-step integration (60 Hz, or 30 Hz on the lowest quality rung),
 *   symplectic Euler. No allocations after resize().
 * - Readability budget (art review v2):
 *   - every heat level has a PEAK brightness (max RGB channel over black);
 *     hot lines stay under the post-FX bloom threshold, only boss-death / bomb
 *     fronts ("flare") briefly go above it;
 *   - a per-point heat PERMIT caps what any force may light up: ordinary kills
 *     reach level 2, elites 4, capital-ship / bomb fronts 5. Ripples leaving an
 *     authorised area fall back to level 2;
 *   - impulses are merged (64 units) and budgeted (8 per frame);
 *   - big blasts are travelling fronts (shock()) so only the wave front glows;
 *   - continuous wells count their strain at 50 % and never pass level 3;
 *   - the calm lattice fades outside the play ellipse (where the galaxy keeps
 *     its bright centrepieces).
 * - Accessibility: `motion` 0 means no grid movement at all; forces then
 *   deposit heat directly ("glow-only"), so events still read. Reduced
 *   flashing: maxLevel 3, no flare, no beat pulse.
 *
 * All coordinates are world units; strengths are world units per second.
 */

export interface WarpGridOptions {
  /** Lattice spacing in world units (default 32). */
  spacing?: number;
  /** Every Nth line is a brighter major line (default 5). */
  majorEvery?: number;
}

/** Heat levels: 0 = at rest ... LEVELS-1 = hottest. */
const LEVELS = 6;
/** Heat thresholds for levels 1..5 (heat is in "cells of strain"). */
const HEAT_T = [0.08, 0.17, 0.3, 0.5, 0.8];
/**
 * Peak brightness per level (max RGB channel of a major-line pixel over black, 0..1).
 * Rest ≤ 0.12 at a full beat; hot ≤ 0.35 (below the 0.45 bloom threshold).
 */
const PEAK = [0.075, 0.125, 0.18, 0.245, 0.29, 0.34];
/** During a boss-death / bomb front ("flare" 1) levels 4/5 may reach these. */
const PEAK_FLARE = [0.075, 0.12, 0.17, 0.24, 0.4, 0.54];
/** Minor lines relative to major. */
const MINOR_K = 0.6;
/** Per level: how far the tint is pushed to its vivid (max-brightness) version, then mixed toward cool white. */
const VIVID = [0, 0.3, 0.6, 0.85, 1, 1];
const WHITE_MIX = [0, 0, 0.03, 0.06, 0.09, 0.12];
/** Calm-line alpha per screen zone (inside play ellipse, ring, outer corners) for edgeFade 1. */
const ZONE_K = [0, 0.5, 1];
/** Buckets: 0..2 = calm lines by zone, 3..7 = heat levels 1..5. */
const NB = 8;
/** Levels >= HALO_FROM get an offset-hairline halo at quality 1. */
const HALO_FROM = 4;
const HALO_OFF = 1.1;
const HALO_A = 0.4;
/** Auto-exposure: hot share allowed before dimming, dim rate, floor. */
const EXPO_FREE = 0.1;
const EXPO_SLOPE = 1.6;
const EXPO_MIN = 0.45;
/** Heat permit: resting level cap and decay back to it (levels / s). */
const BASE_PERMIT = 2;
const PERMIT_DECAY = 7;
/** Wells: share of their strain that counts as heat (review asked ~30 %; 50 % keeps the funnel legible on the darker galaxy v2), and their level cap. */
const WELL_HEAT = 0.5;
const WELL_CAP = 3;
/** Impulse budget per frame and merge distance (world units). */
const QCAP = 8;
const MERGE_D2 = 64 * 64;
/** Concurrent travelling fronts. */
const SCAP = 6;
/** Glow-only heat deposit (used in proportion to 1 - motion). */
const GLOW_IMPULSE = 6.5e-4;
const GLOW_CONT = 1.4e-4;
const GLOW_RING = 9e-4;
/**
 * Travelling fronts always light their band directly (independent of motion and of
 * the sim time scale), so a capital-ship front reads even through hitstop / slow-mo.
 */
const GLOW_FRONT = 1.6e-3;
const GLOW_DECAY = 5;
const GLOW_MAX = 1.2;

export class WarpGrid {
  readonly spacing: number;
  readonly majorEvery: number;

  /** Neighbour coupling (s^-2): sets ripple speed (~ spacing * sqrt(stiffness) units/s). */
  stiffness = 360;
  /** Pull back to rest (s^-2). */
  anchor = 22;
  /** Velocity damping (s^-1). */
  damping = 3.2;
  /** Damping inside the outer 2-cell margin (absorbs waves at the mesh edge). */
  edgeDamping = 14;
  /** Max displacement length as a multiple of spacing. */
  maxDispK = 2.2;
  /** Grid motion 0..1 (settings.gridMotion): scales every force; the rest becomes glow-only heat. */
  motion = 1;
  /** Highest heat level drawn (5 = full; 3 for "reduced flashing"). */
  maxLevel = LEVELS - 1;
  /** Overall brightness multiplier (intensity dimming x galaxy warp gridAlpha). */
  brightness = 1;
  /** Calm-line brightening on the music beat (0.5 default; 0 with reduced flashing). */
  beatPulse = 0.5;
  /** Allow boss-death / bomb fronts above the bloom threshold (false with reduced flashing). */
  flareAllowed = true;
  /** Calm-line fade outside the play ellipse: 0 = none, 1 = outer corners at 0. */
  edgeFade = 0.55;
  /**
   * 0 = hairlines only (post-FX on: bloom supplies the halo);
   * 1 = hairlines + offset-hairline halo on the two hottest levels (2D fallback).
   */
  quality = 1;

  private step = 1 / 60;
  private cols = 0;
  private rows = 0;
  private n = 0;
  private dx = new Float32Array(0);
  private dy = new Float32Array(0);
  private vx = new Float32Array(0);
  private vy = new Float32Array(0);
  /** Per storage slot: heat permit (level cap, decays to BASE_PERMIT), glow-only heat, well mask. */
  private perm = new Float32Array(0);
  private ex = new Float32Array(0);
  private well = new Uint8Array(0);
  /** Logical-order (c + r*cols) screen positions and bucket, filled by draw(). */
  private sx = new Float32Array(0);
  private sy = new Float32Array(0);
  private lvl = new Uint8Array(0);
  /** Bit 1: on the rest line horizontally (|dy| < ~0.3 px); bit 2: vertically. */
  private flat = new Uint8Array(0);
  /** Storage slot of logical column c / row r (row entries pre-multiplied by cols). */
  private colMap = new Int32Array(0);
  private rowMap = new Int32Array(0);
  /** Per logical column / row damping factor for the current step size. */
  private colDamp = new Float32Array(0);
  private rowDamp = new Float32Array(0);
  private dampFor = -1;
  private i0 = 0;
  private j0 = 0;
  private hasOrigin = false;
  private acc = 0;
  private halfW = 0;
  private halfH = 0;
  /** Query range output (logical indices, inclusive). */
  private qc0 = 0;
  private qc1 = -1;
  private qr0 = 0;
  private qr1 = -1;
  /** Pending impulses (merged, applied in update()). */
  private readonly qx = new Float32Array(QCAP);
  private readonly qy = new Float32Array(QCAP);
  private readonly qr = new Float32Array(QCAP);
  private readonly qs = new Float32Array(QCAP);
  private readonly ql = new Float32Array(QCAP);
  private qn = 0;
  /** Travelling fronts: centre, current radius, max radius, speed, band, strength, level, flare. */
  private readonly fx = new Float32Array(SCAP);
  private readonly fy = new Float32Array(SCAP);
  private readonly fr = new Float32Array(SCAP);
  private readonly fmax = new Float32Array(SCAP);
  private readonly fv = new Float32Array(SCAP);
  private readonly fb = new Float32Array(SCAP);
  private readonly fs = new Float32Array(SCAP);
  private readonly fl = new Float32Array(SCAP);
  private readonly ff = new Float32Array(SCAP);
  private readonly bucketN = new Int32Array(NB);

  private tintKey = '';
  private readonly styles: string[] = new Array<string>(LEVELS).fill('');
  /** Max channel (0..1) of each level's style, for the brightness budget. */
  private readonly styleMax = new Float32Array(LEVELS);

  /** Heat weights: strain (|Laplacian|), displacement, speed — all per cell. */
  strainGain = 2.2;
  dispGain = 0.4;
  speedGain = 0.012;

  /** Stats for profiling / tuning. */
  stepsLast = 0;
  maxHeat = 0;
  /** Share of points at heat level >= 3 last draw, and the resulting exposure (1 = none). */
  hotFrac = 0;
  exposure = 1;
  /** Current flare (0..1) from boss-death / bomb fronts. */
  flare = 0;
  /** Impulses requested / applied last update (budget check). */
  impulsesIn = 0;
  impulsesApplied = 0;

  constructor(opts: WarpGridOptions = {}) {
    this.spacing = opts.spacing ?? 32;
    this.majorEvery = opts.majorEvery ?? 5;
  }

  get pointCount(): number {
    return this.n;
  }

  /** Integration rate: 60 (default) or 30 (lowest auto-quality rung; slightly softer ripples). */
  setRate(hz: number): void {
    this.step = 1 / (hz >= 45 ? 60 : 30);
    this.dampFor = -1;
  }

  /** Visible world size (world units, include shake margin and co-op max zoom). Allocates only when the mesh grows. */
  resize(viewW: number, viewH: number): void {
    const S = this.spacing;
    this.halfW = viewW / 2;
    this.halfH = viewH / 2;
    // 2 margin cells each side (absorbing) + 1 for the floor() slack.
    const cols = Math.ceil(viewW / S) + 6;
    const rows = Math.ceil(viewH / S) + 6;
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    const n = cols * rows;
    if (n > this.dx.length) {
      this.dx = new Float32Array(n);
      this.dy = new Float32Array(n);
      this.vx = new Float32Array(n);
      this.vy = new Float32Array(n);
      this.perm = new Float32Array(n);
      this.ex = new Float32Array(n);
      this.well = new Uint8Array(n);
      this.sx = new Float32Array(n);
      this.sy = new Float32Array(n);
      this.lvl = new Uint8Array(n);
      this.flat = new Uint8Array(n);
    }
    if (cols > this.colMap.length) {
      this.colMap = new Int32Array(cols);
      this.colDamp = new Float32Array(cols);
    }
    if (rows > this.rowMap.length) {
      this.rowMap = new Int32Array(rows);
      this.rowDamp = new Float32Array(rows);
    }
    this.n = n;
    this.dampFor = -1;
    this.hasOrigin = false;
  }

  /** Zero every displacement, pending impulse and front (run start, sector warp). */
  reset(): void {
    this.dx.fill(0);
    this.dy.fill(0);
    this.vx.fill(0);
    this.vy.fill(0);
    this.perm.fill(BASE_PERMIT);
    this.ex.fill(0);
    this.well.fill(0);
    this.acc = 0;
    this.qn = 0;
    this.fmax.fill(0);
    this.flare = 0;
  }

  // ───────────────────────────────────────────────────────────── forces ──

  /**
   * Radial kick outward (negative strength = inward), falloff (1-d/r)^2. Queued:
   * kicks within 64 units merge, at most 8 apply per frame (the strongest win).
   * `lvl` = heat permit inside the radius (2 ordinary kill, 3 big explosion, 4 elite, 5 capital ship).
   */
  impulse(x: number, y: number, radius: number, strength: number, lvl = BASE_PERMIT): void {
    if (this.n === 0 || radius <= 0 || strength === 0) return;
    this.impulsesIn++;
    const as = Math.abs(strength);
    let best = -1;
    let bd = MERGE_D2;
    for (let q = 0; q < this.qn; q++) {
      if (this.qs[q]! * strength <= 0) continue;
      const ddx = this.qx[q]! - x;
      const ddy = this.qy[q]! - y;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 < bd) {
        bd = d2;
        best = q;
      }
    }
    if (best >= 0) {
      const a = Math.abs(this.qs[best]!);
      const w = a + as;
      this.qx[best] = (this.qx[best]! * a + x * as) / w;
      this.qy[best] = (this.qy[best]! * a + y * as) / w;
      const big = a >= as ? this.qs[best]! : strength;
      const small = a >= as ? strength : this.qs[best]!;
      // Sub-linear: a pile of kills reads as one bigger ripple, not a white blowout.
      this.qs[best] = big + small * 0.3;
      const rb = this.qr[best]!;
      this.qr[best] = Math.max(rb, radius) + Math.min(rb, radius) * 0.15;
      if (lvl > this.ql[best]!) this.ql[best] = lvl;
      return;
    }
    let q = this.qn;
    if (q >= QCAP) {
      // Full: replace the weakest if this one is stronger, else drop it.
      let weak = 0;
      for (let k = 1; k < QCAP; k++) if (Math.abs(this.qs[k]!) < Math.abs(this.qs[weak]!)) weak = k;
      if (Math.abs(this.qs[weak]!) >= as) return;
      q = weak;
    } else {
      this.qn++;
    }
    this.qx[q] = x;
    this.qy[q] = y;
    this.qr[q] = radius;
    this.qs[q] = strength;
    this.ql[q] = lvl;
  }

  /**
   * Travelling shock front (boss death, bomb, elite blast, player death): a ring that
   * expands from (x, y) at `speed` units/s up to `maxRadius`, shoving the mesh outward
   * along its band. Only the front glows. `flare` (0..1) lets the front exceed the
   * bloom threshold briefly (boss death / bomb; ignored when flareAllowed is false).
   */
  shock(x: number, y: number, maxRadius: number, strength: number, speed = 900, lvl = 5, flare = 0, band = 0): void {
    if (this.n === 0 || maxRadius <= 0) return;
    let slot = -1;
    let worst = -1;
    for (let k = 0; k < SCAP; k++) {
      if (this.fmax[k]! <= 0) {
        slot = k;
        break;
      }
      const done = this.fr[k]! / this.fmax[k]!;
      if (done > worst) {
        worst = done;
        slot = k;
      }
    }
    this.fx[slot] = x;
    this.fy[slot] = y;
    this.fr[slot] = 0;
    this.fmax[slot] = maxRadius;
    this.fv[slot] = speed;
    this.fb[slot] = band > 0 ? band : Math.min(80, Math.max(36, maxRadius * 0.06));
    this.fs[slot] = strength;
    this.fl[slot] = lvl;
    this.ff[slot] = flare;
  }

  /**
   * Continuous gravity well with swirl (call every frame with the frame dt).
   * `swirl` is the tangential share of the pull (0 = straight in). Wells count
   * their strain at 50 % into heat and never pass level 3.
   */
  implode(x: number, y: number, radius: number, strength: number, dt: number, swirl = 0.55): void {
    if (!this.range(x, y, radius)) return;
    const S = this.spacing;
    const raw = strength * dt;
    const s = raw * this.motion;
    const gk = (1 - this.motion) * GLOW_CONT * raw;
    const r2 = radius * radius;
    const inv = 1 / radius;
    const core = radius * 0.12;
    for (let r = this.qr0; r <= this.qr1; r++) {
      const ro = this.rowMap[r]!;
      const ry = (this.j0 + r) * S;
      for (let c = this.qc0; c <= this.qc1; c++) {
        const i = ro + this.colMap[c]!;
        const px = (this.i0 + c) * S + this.dx[i]! - x;
        const py = ry + this.dy[i]! - y;
        const d2 = px * px + py * py;
        if (d2 >= r2 || d2 < 1e-4) continue;
        const d = Math.sqrt(d2);
        const t = 1 - d * inv;
        // Smooth bell, softened at the core so points don't jitter through the centre.
        let sh = t * t * (3 - 2 * t);
        if (d < core) sh *= d / core;
        const f = (sh * s) / d;
        this.vx[i]! += (-px - py * swirl) * f;
        this.vy[i]! += (-py + px * swirl) * f;
        this.well[i] = 1;
        if (this.perm[i]! < WELL_CAP) this.perm[i] = WELL_CAP;
        if (gk > 0) this.ex[i] = Math.min(GLOW_MAX * 0.5, this.ex[i]! + sh * gk);
      }
    }
  }

  /**
   * Continuous push along an expanding shock front (call every frame while the
   * front moves): points within `band` of the circle of `radius` are pushed outward.
   */
  ring(x: number, y: number, radius: number, band: number, strength: number, dt: number, lvl = 3, glow = 0): void {
    const outer = radius + band;
    if (!this.range(x, y, outer)) return;
    const S = this.spacing;
    const raw = strength * dt;
    const s = raw * this.motion;
    const gk = ((1 - this.motion) * GLOW_RING + glow) * raw;
    const inner = Math.max(0, radius - band);
    const in2 = inner * inner;
    const out2 = outer * outer;
    const invB = 1 / band;
    for (let r = this.qr0; r <= this.qr1; r++) {
      const ro = this.rowMap[r]!;
      const ry = (this.j0 + r) * S;
      for (let c = this.qc0; c <= this.qc1; c++) {
        const i = ro + this.colMap[c]!;
        const px = (this.i0 + c) * S + this.dx[i]! - x;
        const py = ry + this.dy[i]! - y;
        const d2 = px * px + py * py;
        if (d2 >= out2 || d2 <= in2 || d2 < 1e-4) continue;
        const d = Math.sqrt(d2);
        const t = 1 - Math.abs(d - radius) * invB;
        const sh = t * t;
        const f = (sh * s) / d;
        this.vx[i]! += px * f;
        this.vy[i]! += py * f;
        if (this.perm[i]! < lvl) this.perm[i] = lvl;
        if (gk > 0) this.ex[i] = Math.min(GLOW_MAX, this.ex[i]! + sh * gk);
      }
    }
  }

  /**
   * Wake along a path segment (dash): points near the segment are shoved
   * sideways away from it and dragged a little along the motion.
   */
  wake(x0: number, y0: number, x1: number, y1: number, strength: number, radius = 72, lvl = 3): void {
    const mx = (x0 + x1) / 2;
    const my = (y0 + y1) / 2;
    const ex = x1 - x0;
    const ey = y1 - y0;
    const len2 = ex * ex + ey * ey;
    const len = Math.sqrt(len2);
    if (!this.range(mx, my, len / 2 + radius)) return;
    const S = this.spacing;
    const s = strength * this.motion;
    const gk = (1 - this.motion) * GLOW_IMPULSE * 0.35 * strength;
    const r2 = radius * radius;
    const invR = 1 / radius;
    const ux = len > 1e-4 ? ex / len : 0;
    const uy = len > 1e-4 ? ey / len : 0;
    for (let r = this.qr0; r <= this.qr1; r++) {
      const ro = this.rowMap[r]!;
      const ry = (this.j0 + r) * S;
      for (let c = this.qc0; c <= this.qc1; c++) {
        const i = ro + this.colMap[c]!;
        const px = (this.i0 + c) * S + this.dx[i]! - x0;
        const py = ry + this.dy[i]! - y0;
        let t = len2 > 1e-4 ? (px * ex + py * ey) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const qx = px - ex * t;
        const qy = py - ey * t;
        const d2 = qx * qx + qy * qy;
        if (d2 >= r2) continue;
        const d = Math.sqrt(d2);
        let sh = 1 - d * invR;
        sh *= sh;
        const f = sh * s;
        // Side shove (normalised offset from the path) + drag along the motion.
        const inv = d > 1e-3 ? 1 / d : 0;
        this.vx[i]! += (qx * inv + ux * 0.35) * f;
        this.vy[i]! += (qy * inv + uy * 0.35) * f;
        if (this.perm[i]! < lvl) this.perm[i] = lvl;
        if (gk > 0) this.ex[i] = Math.min(GLOW_MAX, this.ex[i]! + sh * gk);
      }
    }
  }

  // ─────────────────────────────────────────────────────────── simulate ──

  /**
   * Advance the mesh; re-anchors to the camera (call once per rendered frame).
   * dt = sim dt (pause / hitstop / slow-mo freeze the membrane). frontDt = clock for the
   * travelling fronts (default dt); the renderer passes real time while unpaused so a
   * capital-ship death front crosses the screen during the death slow-mo, before the
   * sector warp fades the grid.
   */
  update(dt: number, camX: number, camY: number, frontDt = dt): void {
    if (this.n === 0) return;
    this.reanchor(camX, camY);
    const d = dt > 0.1 ? 0.1 : dt < 0 ? 0 : dt;
    this.flushImpulses();
    this.advanceFronts(frontDt > 0.1 ? 0.1 : frontDt < 0 ? 0 : frontDt);
    if (d > 0) {
      const pk = PERMIT_DECAY * d;
      const ek = Math.exp(-GLOW_DECAY * d);
      const perm = this.perm;
      const ex = this.ex;
      for (let i = 0; i < this.n; i++) {
        const p = perm[i]! - pk;
        perm[i] = p < BASE_PERMIT ? BASE_PERMIT : p;
        ex[i]! *= ek;
      }
    }
    this.acc += d;
    let steps = 0;
    while (this.acc >= this.step && steps < 4) {
      this.integrate(this.step);
      this.acc -= this.step;
      steps++;
    }
    if (steps === 4) this.acc = 0;
    this.stepsLast = steps;
  }

  private flushImpulses(): void {
    this.impulsesApplied = this.qn;
    for (let q = 0; q < this.qn; q++) this.applyImpulse(this.qx[q]!, this.qy[q]!, this.qr[q]!, this.qs[q]!, this.ql[q]!);
    this.qn = 0;
    this.impulsesIn = 0;
  }

  private applyImpulse(x: number, y: number, radius: number, strength: number, lvl: number): void {
    if (!this.range(x, y, radius)) return;
    const S = this.spacing;
    const s = strength * this.motion;
    const gk = (1 - this.motion) * GLOW_IMPULSE * Math.abs(strength);
    const r2 = radius * radius;
    const inv = 1 / radius;
    for (let r = this.qr0; r <= this.qr1; r++) {
      const ro = this.rowMap[r]!;
      const ry = (this.j0 + r) * S;
      for (let c = this.qc0; c <= this.qc1; c++) {
        const i = ro + this.colMap[c]!;
        const px = (this.i0 + c) * S + this.dx[i]! - x;
        const py = ry + this.dy[i]! - y;
        const d2 = px * px + py * py;
        if (d2 >= r2 || d2 < 1e-4) continue;
        const d = Math.sqrt(d2);
        let sh = 1 - d * inv;
        sh *= sh;
        const f = (sh * s) / d;
        this.vx[i]! += px * f;
        this.vy[i]! += py * f;
        if (this.perm[i]! < lvl) this.perm[i] = lvl;
        if (gk > 0) this.ex[i] = Math.min(GLOW_MAX, this.ex[i]! + sh * gk);
      }
    }
  }

  private advanceFronts(d: number): void {
    let flare = 0;
    for (let k = 0; k < SCAP; k++) {
      const max = this.fmax[k]!;
      if (max <= 0) continue;
      const r = this.fr[k]! + this.fv[k]! * d;
      if (r >= max) {
        this.fmax[k] = 0;
        continue;
      }
      this.fr[k] = r;
      const fade = 1 - r / max;
      // Ramp in over the first 40 units so the front starts as a ring, not a disc.
      const ramp = r < 40 ? r / 40 : 1;
      if (d > 0) this.ring(this.fx[k]!, this.fy[k]!, r, this.fb[k]!, this.fs[k]! * fade * ramp, d, this.fl[k]!, GLOW_FRONT);
      const f = this.ff[k]! * Math.sqrt(fade);
      if (f > flare) flare = f;
    }
    this.flare = this.flareAllowed ? flare : 0;
  }

  private reanchor(camX: number, camY: number): void {
    const S = this.spacing;
    const cols = this.cols;
    const rows = this.rows;
    const i0 = Math.floor((camX - this.halfW) / S) - 3;
    const j0 = Math.floor((camY - this.halfH) / S) - 3;
    if (!this.hasOrigin) {
      this.reset();
      this.hasOrigin = true;
    } else if (i0 !== this.i0 || j0 !== this.j0) {
      const di = i0 - this.i0;
      const dj = j0 - this.j0;
      if (Math.abs(di) >= cols || Math.abs(dj) >= rows) {
        const qn = this.qn;
        this.reset();
        this.qn = qn;
      } else {
        // Clear the columns / rows that scroll in (they hold stale far-side data).
        const cFrom = di > 0 ? cols - di : 0;
        const cTo = di > 0 ? cols : -di;
        for (let c = cFrom; c < cTo; c++) {
          const sc = mod(i0 + c, cols);
          for (let sr = 0; sr < rows; sr++) this.clear(sc + sr * cols);
        }
        const rFrom = dj > 0 ? rows - dj : 0;
        const rTo = dj > 0 ? rows : -dj;
        for (let r = rFrom; r < rTo; r++) {
          const base = mod(j0 + r, rows) * cols;
          for (let sc = 0; sc < cols; sc++) this.clear(base + sc);
        }
      }
    }
    this.i0 = i0;
    this.j0 = j0;
    for (let c = 0; c < cols; c++) this.colMap[c] = mod(i0 + c, cols);
    for (let r = 0; r < rows; r++) this.rowMap[r] = mod(j0 + r, rows) * cols;
  }

  private clear(i: number): void {
    this.dx[i] = 0;
    this.dy[i] = 0;
    this.vx[i] = 0;
    this.vy[i] = 0;
    this.perm[i] = BASE_PERMIT;
    this.ex[i] = 0;
    this.well[i] = 0;
  }

  private integrate(h: number): void {
    const cols = this.cols;
    const rows = this.rows;
    if (this.dampFor !== h) {
      // Per-axis damping profile: heavy in the 2 outermost cells, normal inside.
      const inner = Math.exp(-this.damping * h * 0.5);
      const edge = Math.exp(-this.edgeDamping * h * 0.5);
      for (let c = 0; c < cols; c++) this.colDamp[c] = c < 2 || c >= cols - 2 ? edge : inner;
      for (let r = 0; r < rows; r++) this.rowDamp[r] = r < 2 || r >= rows - 2 ? edge : inner;
      this.dampFor = h;
    }
    const dx = this.dx;
    const dy = this.dy;
    const vx = this.vx;
    const vy = this.vy;
    const cm = this.colMap;
    const rm = this.rowMap;
    const kh = this.stiffness * h;
    const ah = this.anchor * h;
    // Pass 1: velocities from displacements (fixed boundary = 0 outside the mesh).
    for (let r = 0; r < rows; r++) {
      const ro = rm[r]!;
      const up = r > 0 ? rm[r - 1]! : -1;
      const dn = r < rows - 1 ? rm[r + 1]! : -1;
      const rd = this.rowDamp[r]!;
      for (let c = 0; c < cols; c++) {
        const sc = cm[c]!;
        const i = ro + sc;
        const x = dx[i]!;
        const y = dy[i]!;
        let sumX = 0;
        let sumY = 0;
        if (c > 0) {
          const j = ro + cm[c - 1]!;
          sumX += dx[j]!;
          sumY += dy[j]!;
        }
        if (c < cols - 1) {
          const j = ro + cm[c + 1]!;
          sumX += dx[j]!;
          sumY += dy[j]!;
        }
        if (up >= 0) {
          sumX += dx[up + sc]!;
          sumY += dy[up + sc]!;
        }
        if (dn >= 0) {
          sumX += dx[dn + sc]!;
          sumY += dy[dn + sc]!;
        }
        const damp = rd * this.colDamp[c]!;
        vx[i] = (vx[i]! + kh * (sumX - 4 * x) - ah * x) * damp;
        vy[i] = (vy[i]! + kh * (sumY - 4 * y) - ah * y) * damp;
      }
    }
    // Pass 2: positions, with a soft clamp on displacement length.
    const max = this.spacing * this.maxDispK;
    const max2 = max * max;
    const n = this.n;
    for (let i = 0; i < n; i++) {
      let x = dx[i]! + vx[i]! * h;
      let y = dy[i]! + vy[i]! * h;
      const l2 = x * x + y * y;
      if (l2 > max2) {
        const s = max / Math.sqrt(l2);
        x *= s;
        y *= s;
        vx[i]! *= 0.5;
        vy[i]! *= 0.5;
      }
      dx[i] = x;
      dy[i] = y;
    }
  }

  // ────────────────────────────────────────────────────────────── render ──

  /**
   * Draw the grid in device px (sets its own transform; source-over hairlines).
   * camX/camY: camera centre (world; include shake); k: device px per world unit;
   * w/h: canvas device px; color: sector tint '#rrggbb' (clamped to a cool hue);
   * beat: music pulse 0..1.
   */
  draw(ctx: CanvasRenderingContext2D, camX: number, camY: number, k: number, w: number, h: number, color: string, beat: number): void {
    if (this.n === 0 || !this.hasOrigin || this.brightness <= 0.001) return;
    if (color !== this.tintKey) this.buildStyles(color);
    const S = this.spacing;
    const cols = this.cols;
    const rows = this.rows;
    const ox = w / 2 - camX * k;
    const oy = h / 2 - camY * k;
    const sx = this.sx;
    const sy = this.sy;
    const lvl = this.lvl;
    const invS = 1 / S;
    const maxL = this.maxLevel;
    const dxa = this.dx;
    const dya = this.dy;
    const perm = this.perm;
    const ex = this.ex;
    const well = this.well;
    const sG = this.strainGain * invS;
    const dG = this.dispGain * invS;
    const vG = this.speedGain * invS;
    // Play-ellipse zones for calm lines (screen space).
    const zx = 1 / (0.42 * w);
    const zy = 1 / (0.4 * h);
    const zoned = this.edgeFade > 0.001;
    const cnt = this.bucketN;
    cnt.fill(0);
    let hmax = 0;
    let hot = 0;
    // Heat = local strain (|Laplacian|: bending relative to the neighbours, zero for a
    // block that is merely shifted) + a little displacement + speed, + glow-only heat.
    for (let r = 0; r < rows; r++) {
      const ro = this.rowMap[r]!;
      const up = r > 0 ? this.rowMap[r - 1]! : ro;
      const dn = r < rows - 1 ? this.rowMap[r + 1]! : ro;
      const ry = (this.j0 + r) * S;
      const lo = r * cols;
      for (let c = 0; c < cols; c++) {
        const sc = this.colMap[c]!;
        const i = ro + sc;
        const lft = ro + (c > 0 ? this.colMap[c - 1]! : sc);
        const rgt = ro + (c < cols - 1 ? this.colMap[c + 1]! : sc);
        const ddx = dxa[i]!;
        const ddy = dya[i]!;
        const lx = dxa[lft]! + dxa[rgt]! + dxa[up + sc]! + dxa[dn + sc]! - 4 * ddx;
        const ly = dya[lft]! + dya[rgt]! + dya[up + sc]! + dya[dn + sc]! - 4 * ddy;
        const vvx = this.vx[i]!;
        const vvy = this.vy[i]!;
        const li = lo + c;
        const px = ((this.i0 + c) * S + ddx) * k + ox;
        const py = (ry + ddy) * k + oy;
        sx[li] = px;
        sy[li] = py;
        let heat = Math.sqrt(lx * lx + ly * ly) * sG + Math.sqrt(ddx * ddx + ddy * ddy) * dG + Math.sqrt(vvx * vvx + vvy * vvy) * vG;
        let cap = perm[i]!;
        if (well[i] !== 0) {
          heat *= WELL_HEAT;
          if (cap > WELL_CAP) cap = WELL_CAP;
          well[i] = 0;
        }
        heat += ex[i]!;
        if (heat > hmax) hmax = heat;
        let L = 0;
        while (L < LEVELS - 1 && heat >= HEAT_T[L]!) L++;
        if (L > cap) L = cap | 0;
        if (L > maxL) L = maxL;
        let b: number;
        if (L === 0) {
          if (zoned) {
            const ex2 = (px - w * 0.5) * zx;
            const ey2 = (py - h * 0.5) * zy;
            const e = ex2 * ex2 + ey2 * ey2;
            b = e < 1 ? 0 : e < 2.1 ? 1 : 2;
          } else b = 0;
        } else {
          b = L + 2;
          if (L >= 3) hot++;
        }
        lvl[li] = b;
        cnt[b]!++;
        const fx = ddx * k;
        const fy = ddy * k;
        this.flat[li] = (fy < 0.3 && fy > -0.3 ? 1 : 0) | (fx < 0.3 && fx > -0.3 ? 2 : 0);
      }
    }
    this.maxHeat = hmax;
    // Auto-exposure: when a large share of the visible mesh is hot (stacked wells, kill storms),
    // dim the hot buckets so the grid never out-shouts the gameplay.
    this.hotFrac = hot / (rows * cols);
    const target = this.hotFrac > EXPO_FREE ? Math.max(EXPO_MIN, 1 - (this.hotFrac - EXPO_FREE) * EXPO_SLOPE) : 1;
    // Slow attack (~0.5 s): one-shot fronts still land; sustained hotness gets dimmed.
    this.exposure += (target - this.exposure) * (target < this.exposure ? 0.035 : 0.02);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // source-over 1 px hairlines: Skia's hairline path is ~5x cheaper than wider strokes and
    // 'lighter' doubles raster cost; on a near-black backdrop they look the same.
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1;
    const br = this.brightness;
    const pulse0 = 1 + this.beatPulse * beat;
    const pulseHot = 1 + this.beatPulse * 0.3 * beat;
    const flare = this.flare;
    const hoff = HALO_OFF * Math.max(1, k * 0.9);
    for (let b = 0; b < NB; b++) {
      if (cnt[b] === 0) continue;
      const L = b < 3 ? 0 : b - 2;
      let peak: number;
      if (L === 0) peak = PEAK[0]! * pulse0 * (1 - this.edgeFade * ZONE_K[b]!);
      else peak = (PEAK[L]! + (PEAK_FLARE[L]! - PEAK[L]!) * flare) * pulseHot * this.exposure;
      // Alpha that puts this level's colour at its peak budget.
      const a0 = (peak * br) / this.styleMax[L]!;
      ctx.strokeStyle = this.styles[L]!;
      for (let major = 1; major >= 0; major--) {
        const a = Math.min(1, major ? a0 : a0 * MINOR_K);
        if (a < 0.004) continue;
        if (this.emitBucket(ctx, b, major, 0, 0) === 0) continue;
        ctx.globalAlpha = a;
        ctx.stroke();
        if (this.quality >= 1 && L >= HALO_FROM) {
          // Halo: the same bucket re-emitted as hairlines offset diagonally to both sides.
          ctx.globalAlpha = a * HALO_A;
          this.emitBucket(ctx, b, major, hoff, hoff);
          ctx.stroke();
          this.emitBucket(ctx, b, major, -hoff, -hoff);
          ctx.stroke();
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
  }

  /** beginPath + every line piece of bucket b (major or minor lines), offset by (ox, oy) px. */
  private emitBucket(ctx: CanvasRenderingContext2D, b: number, major: number, ox: number, oy: number): number {
    const cols = this.cols;
    const rows = this.rows;
    const M = this.majorEvery;
    ctx.beginPath();
    let pieces = 0;
    for (let r = 1; r < rows - 1; r++) {
      if ((mod(this.j0 + r, M) === 0 ? 1 : 0) === major) pieces += this.emitLine(ctx, r * cols, 1, cols, b, 1, ox, oy);
    }
    for (let c = 1; c < cols - 1; c++) {
      if ((mod(this.i0 + c, M) === 0 ? 1 : 0) === major) pieces += this.emitLine(ctx, c, cols, rows, b, 2, ox, oy);
    }
    return pieces;
  }

  /**
   * Emit the pieces of one grid line (points base + c*stride, c in [0, count)) whose
   * point is in bucket b. Hot pieces are quadratic curves through the midpoints;
   * calm runs are polylines that skip points lying on the rest line (flatBit), so a
   * calm line costs one segment instead of one per point. Returns pieces emitted.
   */
  private emitLine(ctx: CanvasRenderingContext2D, base: number, stride: number, count: number, b: number, flatBit: number, ox: number, oy: number): number {
    const sx = this.sx;
    const sy = this.sy;
    const lvl = this.lvl;
    const flat = this.flat;
    const cold = b < 3;
    let pieces = 0;
    let pen = false;
    let last = 0;
    for (let c = 1; c < count - 1; c++) {
      const li = base + c * stride;
      if (lvl[li] !== b) {
        if (pen && cold) {
          ctx.lineTo((sx[last]! + sx[last + stride]!) * 0.5 + ox, (sy[last]! + sy[last + stride]!) * 0.5 + oy);
          pieces++;
        }
        pen = false;
        continue;
      }
      const px = sx[li]! + ox;
      const py = sy[li]! + oy;
      if (!pen) {
        ctx.moveTo((sx[li - stride]! + ox + px) * 0.5, (sy[li - stride]! + oy + py) * 0.5);
        pen = true;
      }
      if (cold) {
        if ((flat[li]! & flatBit) === 0) {
          ctx.lineTo(px, py);
          pieces++;
        }
        last = li;
      } else {
        ctx.quadraticCurveTo(px, py, (sx[li + stride]! + ox + px) * 0.5, (sy[li + stride]! + oy + py) * 0.5);
        pieces++;
      }
    }
    if (pen && cold) {
      ctx.lineTo((sx[last]! + sx[last + stride]!) * 0.5 + ox, (sy[last]! + sy[last + stride]!) * 0.5 + oy);
      pieces++;
    }
    return pieces;
  }

  private buildStyles(color: string): void {
    const [r, g, b] = coolRGB(color);
    // Vivid = same hue pushed to full brightness; the top levels then mix toward cool white.
    const vk = 255 / Math.max(1, r, g, b);
    const white = [226, 238, 255];
    for (let L = 0; L < LEVELS; L++) {
      const t = VIVID[L]!;
      const m = WHITE_MIX[L]!;
      const ch = (v: number, wv: number) => {
        const base = Math.min(255, v * 1.25);
        const vivid = base + (v * vk - base) * t;
        return Math.min(255, Math.round(vivid + (wv - vivid) * m));
      };
      const R = ch(r, white[0]!);
      const G = ch(g, white[1]!);
      const B = ch(b, white[2]!);
      this.styles[L] = `rgb(${R},${G},${B})`;
      this.styleMax[L] = Math.max(1, R, G, B) / 255;
    }
    this.tintKey = color;
  }

  /** Logical cell range covering a circle; false when it misses the mesh. */
  private range(x: number, y: number, radius: number): boolean {
    if (this.n === 0 || !this.hasOrigin) return false;
    const S = this.spacing;
    const c0 = Math.ceil((x - radius) / S) - this.i0;
    const c1 = Math.floor((x + radius) / S) - this.i0;
    const r0 = Math.ceil((y - radius) / S) - this.j0;
    const r1 = Math.floor((y + radius) / S) - this.j0;
    // Displaced points can sit up to maxDisp away from rest: pad by one cell.
    this.qc0 = c0 - 1 < 0 ? 0 : c0 - 1;
    this.qc1 = c1 + 1 >= this.cols ? this.cols - 1 : c1 + 1;
    this.qr0 = r0 - 1 < 0 ? 0 : r0 - 1;
    this.qr1 = r1 + 1 >= this.rows ? this.rows - 1 : r1 + 1;
    return this.qc0 <= this.qc1 && this.qr0 <= this.qr1;
  }
}

function mod(a: number, n: number): number {
  const m = a % n;
  return m < 0 ? m + n : m;
}

/**
 * Clamp a tint into the grid's cool family: hue 190°–270°, saturation ≤ 0.45,
 * lightness 0.5–0.7. Warm sector colours (crimson, gold) land on the nearest cool
 * edge, so the lattice never shares a hue family with the alien armada.
 */
export function coolRGB(color: string): [number, number, number] {
  const n = parseInt(color.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  let l = (mx + mn) / 2;
  const d = mx - mn;
  let s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let hue = 0;
  if (d > 0) {
    if (mx === r) hue = 60 * (((g - b) / d) % 6);
    else if (mx === g) hue = 60 * ((b - r) / d + 2);
    else hue = 60 * ((r - g) / d + 4);
  }
  if (hue < 0) hue += 360;
  if (hue < 190 || hue > 270) {
    // Nearest cool edge on the colour wheel.
    const to190 = Math.min(Math.abs(hue - 190), 360 - Math.abs(hue - 190));
    const to270 = Math.min(Math.abs(hue - 270), 360 - Math.abs(hue - 270));
    hue = to190 < to270 ? 190 : 270;
  }
  s = Math.min(0.45, s);
  l = Math.min(0.7, Math.max(0.5, l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = l - c / 2;
  let rr = 0;
  let gg = 0;
  let bb = 0;
  if (hue < 240) {
    // 180..240 (cyan -> blue)
    gg = x;
    bb = c;
  } else {
    // 240..300 (blue -> violet)
    rr = x;
    bb = c;
  }
  return [Math.round((rr + m) * 255), Math.round((gg + m) * 255), Math.round((bb + m) * 255)];
}

/**
 * Per-sector grid tints: cool, desaturated variants of each sector's signature
 * (teal / crimson / violet / gold-obsidian). Sector identity comes from the
 * backdrop; the grid only leans slightly toward it inside the cool family.
 */
export const GRID_TINTS = ['#6aa6c4', '#8a8acc', '#8e80d6', '#7e96bc'] as const;
