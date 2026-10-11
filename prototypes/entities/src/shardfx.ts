/**
 * Pooled crystal-shatter system (structure of arrays, like particles.ts).
 *
 * Kind 0 = shard: a spinning triangle cut from the dead vessel's outline. It
 *          lives in two phases (art review E2):
 *            - HOT (the first ~0.12 s): an additive, white-hot fill + white edge.
 *              Drawn with the explosions (`drawHot`), above the enemies.
 *            - COOLED (the rest): a dim, desaturated OUTLINE with alpha <= 0.35,
 *              normal blending, drawn BELOW the enemies (`drawCooled`), so debris
 *              can never be mistaken for a live crystal vessel.
 * Kind 1 = ember: a small slow spark that flickers out (additive, hot pass).
 *
 * Drawing is batched with a counting sort on (colour, alpha bucket), so a
 * 600-shard storm costs a few dozen fill()/stroke() calls, not 600.
 */
const CAP = 1400;
const BUCKETS = 5;
const MAX_COLORS = 48;
/** Above this many live entries new kills spawn half the shards with shorter lives. */
const LOD_COUNT = 400;
/** Max alpha of cooled debris. */
const COOL_ALPHA = 0.35;

const lightMemo = new Map<string, string>();
/** Hot fill: the hull colour pushed most of the way to white. */
function hot(c: string): string {
  let v = lightMemo.get(c);
  if (!v) {
    const n = parseInt(c.slice(1, 7), 16);
    const f = (x: number) => Math.round(x + (255 - x) * 0.6);
    v = `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
    lightMemo.set(c, v);
  }
  return v;
}

const coolMemo = new Map<string, string>();
/** Cooled debris: desaturated toward a cold grey so it reads as dead glass, not a warm alien. */
function cooled(c: string): string {
  let v = coolMemo.get(c);
  if (!v) {
    const n = parseInt(c.slice(1, 7), 16);
    const g = [150, 158, 178];
    const f = (x: number, k: number) => Math.round(x * 0.4 + g[k]! * 0.6);
    v = `rgb(${f((n >> 16) & 255, 0)},${f((n >> 8) & 255, 1)},${f(n & 255, 2)})`;
    coolMemo.set(c, v);
  }
  return v;
}

export class ShardFx {
  private x = new Float32Array(CAP);
  private y = new Float32Array(CAP);
  private vx = new Float32Array(CAP);
  private vy = new Float32Array(CAP);
  private rot = new Float32Array(CAP);
  private vrot = new Float32Array(CAP);
  private life = new Float32Array(CAP);
  private maxLife = new Float32Array(CAP);
  private drag = new Float32Array(CAP);
  /** Seconds of white-hot phase left (<= 0: cooled debris). */
  private heat = new Float32Array(CAP);
  /** Hot-phase length, for the hot fade. */
  private heat0 = new Float32Array(CAP);
  /** Local triangle vertices (relative to the shard centroid), 6 floats each. Embers keep their size in [0]. */
  private tri = new Float32Array(CAP * 6);
  private kind = new Uint8Array(CAP);
  private col = new Uint8Array(CAP);
  private palette: string[] = [];
  private paletteIdx = new Map<string, number>();
  // Counting-sort scratch.
  private keyOf = new Int16Array(CAP);
  private order = new Int16Array(CAP);
  private counts = new Int32Array(MAX_COLORS * BUCKETS + 1);
  count = 0;
  /** 0..1 spawn-count scale from the quality controller (EntityFx.lod). */
  quality = 1;
  /** Profiling: fill/stroke calls issued by the last frame's draws. */
  drawCalls = 0;
  /** Alpha of the white-hot edge pass (lowered for reduced flashing). */
  hotAlpha = 0.9;
  /** Hot-fill multiplier (reduced flashing: 0.6). */
  hotFill = 1;

  /** Effective spawn scale: quality × crowd LOD. */
  get density(): number {
    return this.quality * (this.count > LOD_COUNT ? 0.5 : 1);
  }

  /** Life multiplier for new shards (shorter in a crowd). */
  get lifeScale(): number {
    return this.count > LOD_COUNT ? 0.7 : 1;
  }

  private colorIndex(c: string): number {
    let i = this.paletteIdx.get(c);
    if (i === undefined) {
      if (this.palette.length >= MAX_COLORS) return 0;
      i = this.palette.length;
      this.palette.push(c);
      this.paletteIdx.set(c, i);
    }
    return i;
  }

  private alloc(): number {
    if (this.count < CAP) return this.count++;
    // Full: recycle the entry closest to death among a few random probes.
    let best = (Math.random() * CAP) | 0;
    for (let k = 0; k < 3; k++) {
      const j = (Math.random() * CAP) | 0;
      if (this.life[j]! < this.life[best]!) best = j;
    }
    return best;
  }

  /**
   * Adds one shard. (ax..cy) are the triangle's vertices in world units relative
   * to (x, y), which should be the triangle's centroid. `heat` is the hot-phase length (s).
   */
  shard(x: number, y: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number, vx: number, vy: number, spin: number, life: number, heat: number, color: string, drag = 2.4): void {
    const i = this.alloc();
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.rot[i] = 0;
    this.vrot[i] = spin;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.drag[i] = drag;
    this.heat[i] = heat;
    this.heat0[i] = Math.max(1e-3, heat);
    const o = i * 6;
    const t = this.tri;
    t[o] = ax;
    t[o + 1] = ay;
    t[o + 2] = bx;
    t[o + 3] = by;
    t[o + 4] = cx;
    t[o + 5] = cy;
    this.kind[i] = 0;
    this.col[i] = this.colorIndex(color);
  }

  /** Slow flickering embers thrown out of an explosion. */
  embers(x: number, y: number, color: string, n: number, speed: number, life: number, size: number): void {
    const count = Math.round(n * this.density);
    const ci = this.colorIndex(color);
    for (let k = 0; k < count; k++) {
      const i = this.alloc();
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.2 + Math.random() * 0.8);
      this.x[i] = x;
      this.y[i] = y;
      this.vx[i] = Math.cos(a) * s;
      this.vy[i] = Math.sin(a) * s;
      this.rot[i] = 0;
      this.vrot[i] = 0;
      const l = life * (0.5 + Math.random() * 0.8) * this.lifeScale;
      this.life[i] = l;
      this.maxLife[i] = l;
      this.drag[i] = 2.2;
      this.heat[i] = 0;
      this.heat0[i] = 1;
      this.tri[i * 6] = size * (0.5 + Math.random() * 0.8);
      this.kind[i] = 1;
      this.col[i] = ci;
    }
  }

  update(dt: number): void {
    if (dt <= 0) return;
    let i = 0;
    while (i < this.count) {
      const l = this.life[i]! - dt;
      if (l <= 0) {
        this.kill(i);
        continue;
      }
      this.life[i] = l;
      const k = Math.exp(-this.drag[i]! * dt);
      this.vx[i]! *= k;
      this.vy[i]! *= k;
      this.x[i]! += this.vx[i]! * dt;
      this.y[i]! += this.vy[i]! * dt;
      this.rot[i]! += this.vrot[i]! * dt;
      this.heat[i]! -= dt;
      i++;
    }
  }

  private kill(i: number): void {
    const last = --this.count;
    if (i === last) return;
    this.x[i] = this.x[last]!;
    this.y[i] = this.y[last]!;
    this.vx[i] = this.vx[last]!;
    this.vy[i] = this.vy[last]!;
    this.rot[i] = this.rot[last]!;
    this.vrot[i] = this.vrot[last]!;
    this.life[i] = this.life[last]!;
    this.maxLife[i] = this.maxLife[last]!;
    this.drag[i] = this.drag[last]!;
    this.heat[i] = this.heat[last]!;
    this.heat0[i] = this.heat0[last]!;
    this.tri.copyWithin(i * 6, last * 6, last * 6 + 6);
    this.kind[i] = this.kind[last]!;
    this.col[i] = this.col[last]!;
  }

  /**
   * Counting sort of the visible entries of one layer (0 hot shards, 1 embers,
   * 2 cooled shards) by (colour, bucket). Returns the number of keys; the sorted
   * indices are in `order`, and counts[k] holds the END of bucket k.
   */
  private sortLayer(layer: number, minX: number, minY: number, maxX: number, maxY: number): number {
    const nKeys = this.palette.length * BUCKETS;
    const counts = this.counts;
    counts.fill(0, 0, nKeys + 1);
    const keyOf = this.keyOf;
    for (let i = 0; i < this.count; i++) {
      const kd = this.kind[i]!;
      const h = this.heat[i]!;
      const lay = kd === 1 ? 1 : h > 0 ? 0 : 2;
      const x = this.x[i]!;
      const y = this.y[i]!;
      if (lay !== layer || x < minX || x > maxX || y < minY || y > maxY) {
        keyOf[i] = -1;
        continue;
      }
      // Hot shards bucket by heat left; embers and debris by life left.
      const t = lay === 0 ? h / this.heat0[i]! : this.life[i]! / this.maxLife[i]!;
      const b = Math.min(BUCKETS - 1, (t * BUCKETS) | 0);
      const key = this.col[i]! * BUCKETS + b;
      keyOf[i] = key;
      counts[key + 1]!++;
    }
    for (let k = 1; k <= nKeys; k++) counts[k]! += counts[k - 1]!;
    const order = this.order;
    for (let i = 0; i < this.count; i++) {
      const key = keyOf[i]!;
      if (key >= 0) order[counts[key]!++] = i;
    }
    return nKeys;
  }

  private tracePath(ctx: CanvasRenderingContext2D, i: number, s: number): void {
    const T = this.tri;
    const x = this.x[i]!;
    const y = this.y[i]!;
    const r = this.rot[i]!;
    const cs = Math.cos(r) * s;
    const sn = Math.sin(r) * s;
    const o = i * 6;
    ctx.moveTo(x + T[o]! * cs - T[o + 1]! * sn, y + T[o]! * sn + T[o + 1]! * cs);
    ctx.lineTo(x + T[o + 2]! * cs - T[o + 3]! * sn, y + T[o + 2]! * sn + T[o + 3]! * cs);
    ctx.lineTo(x + T[o + 4]! * cs - T[o + 5]! * sn, y + T[o + 4]! * sn + T[o + 5]! * cs);
    ctx.closePath();
  }

  /** Cooled debris: dim desaturated outlines, normal blending. Draw BELOW the enemies (world transform set). */
  drawCooled(ctx: CanvasRenderingContext2D, minX: number, minY: number, maxX: number, maxY: number): void {
    this.drawCalls = 0;
    if (this.count === 0 || this.palette.length === 0) return;
    const nKeys = this.sortLayer(2, minX, minY, maxX, maxY);
    const counts = this.counts;
    const order = this.order;
    ctx.lineWidth = 0.9;
    ctx.lineJoin = 'round';
    let start = 0;
    for (let key = 0; key < nKeys; key++) {
      const end = counts[key]!;
      if (end === start) continue;
      const b = key % BUCKETS;
      const t = (b + 0.5) / BUCKETS;
      ctx.globalAlpha = Math.min(COOL_ALPHA, t * 0.5);
      ctx.strokeStyle = cooled(this.palette[(key / BUCKETS) | 0]!);
      ctx.beginPath();
      // Shrink as it fades.
      const s = 0.6 + 0.4 * t;
      for (let q = start; q < end; q++) this.tracePath(ctx, order[q]!, s);
      ctx.stroke();
      this.drawCalls++;
      start = end;
    }
    ctx.globalAlpha = 1;
  }

  /** White-hot shards and embers. Caller sets the world transform and 'lighter'. */
  drawHot(ctx: CanvasRenderingContext2D, minX: number, minY: number, maxX: number, maxY: number, time: number): void {
    if (this.count === 0 || this.palette.length === 0) return;
    const counts = this.counts;
    const order = this.order;
    const T = this.tri;
    // Hot shards: fill pushed toward white, alpha by heat left.
    let nKeys = this.sortLayer(0, minX, minY, maxX, maxY);
    let start = 0;
    ctx.lineJoin = 'round';
    for (let key = 0; key < nKeys; key++) {
      const end = counts[key]!;
      if (end === start) continue;
      const b = key % BUCKETS;
      const t = (b + 0.5) / BUCKETS;
      ctx.globalAlpha = (0.35 + 0.6 * t) * this.hotFill;
      ctx.fillStyle = hot(this.palette[(key / BUCKETS) | 0]!);
      ctx.beginPath();
      for (let q = start; q < end; q++) this.tracePath(ctx, order[q]!, 1);
      ctx.fill();
      this.drawCalls++;
      start = end;
    }
    // White-hot edges on all hot shards (one batched stroke, ordered list still valid).
    if (start > 0) {
      ctx.globalAlpha = this.hotAlpha;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      for (let q = 0; q < start; q++) this.tracePath(ctx, order[q]!, 1);
      ctx.stroke();
      this.drawCalls++;
    }
    // Embers.
    nKeys = this.sortLayer(1, minX, minY, maxX, maxY);
    start = 0;
    for (let key = 0; key < nKeys; key++) {
      const end = counts[key]!;
      if (end === start) continue;
      const b = key % BUCKETS;
      const a = Math.min(1, ((b + 0.5) / BUCKETS) * 1.6);
      ctx.globalAlpha = a * (0.6 + 0.4 * Math.sin(time * 37 + key * 2.3));
      ctx.fillStyle = this.palette[(key / BUCKETS) | 0]!;
      ctx.beginPath();
      const s0 = 0.5 + (0.5 * (b + 0.5)) / BUCKETS;
      for (let q = start; q < end; q++) {
        const i = order[q]!;
        const s = T[i * 6]! * s0;
        ctx.rect(this.x[i]! - s / 2, this.y[i]! - s / 2, s, s);
      }
      ctx.fill();
      this.drawCalls++;
      start = end;
    }
    ctx.globalAlpha = 1;
  }

  clear(): void {
    this.count = 0;
    // Palette entries are only ever appended; reset it between runs so it cannot fill up.
    this.palette.length = 0;
    this.paletteIdx.clear();
  }
}
