/**
 * SHARDSTORM: procedural galaxy sector backdrops.
 *
 * Every sector is generated in code from a fixed seed (no image assets), once,
 * into a handful of images, then composited each frame with ~10-25 drawImage
 * calls, nearly all of them integer-snapped 1:1 blits:
 *
 *   tile      opaque, seamless nebula tile (domain-warped fBm density x a coarse
 *             coverage mask so ~40% is true black, dust lanes only inside bright
 *             clouds, thin lit cloud rims, ridged dust filaments, micro stars),
 *             parallax 0.045. Each sector has its own rich hue, but the gas is held
 *             below OKLab L ~0.2 (every gameplay glow sits at L >= 0.27), so it
 *             reads as deep colour and never as a sprite's halo
 *   center    the sector's centerpiece (spiral galaxy / ringed giant / black
 *             hole / storm vortex), parallax ~0.012 with a one-sided clamp that
 *             keeps it out of the central play area. Block-cropped into pieces.
 *             The vortex core spins (cached rotation, re-rendered every 8 frames)
 *   glow      <=128 px additive sprite on the centerpiece's focal point that
 *             breathes with the music beat
 *   comets    an occasional single streak
 *   planets   1-2 backlit bodies (crescent + thin rim), parallax <= 0.15
 *
 * The game's own star layers, grid and vignette stay on top (drawn by the
 * renderer). Sizes are authored in "backdrop px" = device px at 1080p height
 * and scaled by ref/1080 at draw time (ref = the screen height, or 0.8 x the
 * width on portrait / narrow screens); assets are generated at that scale, so
 * they blit 1:1.
 *
 * Generation is pure float maths up to quantisation and can run in a module
 * Worker (runGalaxyWorker); without one it runs as a chunked generator on the
 * main thread (update() pumps it with a per-frame budget).
 *
 * Sector switches are warps: spool (old sector zooms in and darkens) ->
 * tunnel (black + hyperspace streaks; held until the target is generated) ->
 * punch (100 ms tinted flash) -> arrival (new sector zooms out, centerpiece
 * overshoots). The renderer reads `warpFx` to stretch its stars and fade its
 * grid, and listens to `onEvent` for audio/story cues.
 */

export type RGB = [number, number, number];

// ─────────────────────────────────────────────────────────────── utilities ──

function hexRGB(h: string): RGB {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
function smoothstep(a: number, b: number, v: number): number {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
}
function mix3(o: RGB, a: RGB, b: RGB, t: number): RGB {
  o[0] = a[0] + (b[0] - a[0]) * t;
  o[1] = a[1] + (b[1] - a[1]) * t;
  o[2] = a[2] + (b[2] - a[2]) * t;
  return o;
}
/** 2-arg hypot (Math.hypot is several times slower in V8 hot loops). */
const hyp = (x: number, y: number): number => Math.sqrt(x * x + y * y);

/** sRGB (0..1) -> linear light. */
function toLinear(c: number): number {
  const v = c < 0 ? 0 : c > 1 ? 1 : c;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
/** Linear light -> sRGB (0..1). */
function toSrgb(v: number): number {
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}
/** Perceptual lightness (OKLab L, 0..1) of an sRGB colour (0..1 floats). */
function okL(r: number, g: number, b: number): number {
  const lr = toLinear(r);
  const lg = toLinear(g);
  const lb = toLinear(b);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787081 * lb);
  return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

export function hash2(x: number, y: number, s: number): number {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(s | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
function hash3(x: number, y: number, z: number, s: number): number {
  return hash2(x, hash2(y, z, s), s ^ 0x5bd1e995);
}

/** mulberry32: tiny deterministic PRNG. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0 || 1;
  }
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  gauss(): number {
    const u = Math.max(1e-9, this.next());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(6.283185307 * this.next());
  }
}

// ─────────────────────────────────────────────────────────────────── noise ──

const GX = Float64Array.of(1, -1, 0, 0, 0.7071, -0.7071, 0.7071, -0.7071);
const GY = Float64Array.of(0, 0, 1, -1, 0.7071, 0.7071, -0.7071, -0.7071);
const BIG = 1 << 20;

const PERM = (() => {
  const p = new Uint16Array(2048);
  const r = new Rng(0x1234567);
  for (let i = 0; i < 1024; i++) p[i] = i;
  for (let i = 1023; i > 0; i--) {
    const j = Math.floor(r.next() * (i + 1));
    const t = p[i]!;
    p[i] = p[j]!;
    p[j] = t;
  }
  for (let i = 0; i < 1024; i++) p[i + 1024] = p[i]!;
  return p;
})();

/** 20-bit lattice seed for a noise "seed" (hash once per fbm call, not per octave sample). */
const seedOf = (seed: number): number => hash2(seed, 0, 0x2545f491) & 0xfffff;
const octSeed = (base: number, o: number): number => (base + Math.imul(o, 0x2f0b3)) & 0xfffff;

/** 2D gradient noise, periodic with integer period (px, py), pre-hashed seed sd. ~[-1, 1]. */
function gnoise(x: number, y: number, px: number, py: number, sd: number): number {
  const xf = Math.floor(x);
  const yf = Math.floor(y);
  const fx = x - xf;
  const fy = y - yf;
  let i0 = xf % px;
  if (i0 < 0) i0 += px;
  let j0 = yf % py;
  if (j0 < 0) j0 += py;
  const i1 = i0 + 1 >= px ? 0 : i0 + 1;
  const j1 = j0 + 1 >= py ? 0 : j0 + 1;
  const sj = sd >>> 10;
  const a0 = PERM[(i0 + sd) & 1023]! + sj;
  const a1 = PERM[(i1 + sd) & 1023]! + sj;
  const h00 = PERM[(a0 + j0) & 1023]! & 7;
  const h10 = PERM[(a1 + j0) & 1023]! & 7;
  const h01 = PERM[(a0 + j1) & 1023]! & 7;
  const h11 = PERM[(a1 + j1) & 1023]! & 7;
  const n00 = GX[h00]! * fx + GY[h00]! * fy;
  const n10 = GX[h10]! * (fx - 1) + GY[h10]! * fy;
  const n01 = GX[h01]! * fx + GY[h01]! * (fy - 1);
  const n11 = GX[h11]! * (fx - 1) + GY[h11]! * (fy - 1);
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const a = n00 + (n10 - n00) * u;
  const b = n01 + (n11 - n01) * u;
  return 1.414 * (a + (b - a) * v);
}

/** Periodic fBm: period p (cells at octave 0) doubles with each octave so it stays seamless. */
function fbm(x: number, y: number, p: number, oct: number, seed: number, gain = 0.5): number {
  return fbmXY(x, y, p, p, oct, seed, gain);
}
/** Periodic fBm with separate integer periods per axis (anisotropic tiles). */
function fbmXY(x: number, y: number, px: number, py: number, oct: number, seed: number, gain = 0.5): number {
  const base = seedOf(seed);
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < oct; o++) {
    sum += amp * gnoise(x * f, y * f, px * f, py * f, octSeed(base, o));
    norm += amp;
    amp *= gain;
    f *= 2;
  }
  return sum / norm;
}
/** Non-periodic fBm (huge period). */
const fbmN = (x: number, y: number, oct: number, seed: number, gain = 0.5): number => fbm(x, y, BIG, oct, seed, gain);

/**
 * Band-limited periodic fBm: f0 is the local frequency of octave 0 in cycles
 * per output pixel. Each octave fades out between 0.12 and 0.25 cycles/px, so
 * nothing above ~half Nyquist is ever synthesised (no aliasing/hatching).
 */
function fbmBL(x: number, y: number, p: number, oct: number, seed: number, gain: number, f0: number): number {
  const base = seedOf(seed);
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < oct; o++) {
    const wgt = 1 - smoothstep(0.12, 0.25, f0 * f);
    if (wgt <= 0) break;
    sum += amp * wgt * gnoise(x * f, y * f, p * f, p * f, octSeed(base, o));
    norm += amp * wgt;
    amp *= gain;
    f *= 2;
  }
  return norm > 0 ? sum / norm : 0;
}

/** 3D value noise (non-periodic) for sphere surfaces. ~[-1, 1]. */
function vnoise3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = x - xi;
  const fy = y - yi;
  const fz = z - zi;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const w = fz * fz * (3 - 2 * fz);
  const c = (dx: number, dy: number, dz: number) => (hash3(xi + dx, yi + dy, zi + dz, seed) & 0xffff) / 32767.5 - 1;
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), u);
  const x10 = lerp(c(0, 1, 0), c(1, 1, 0), u);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), u);
  const x11 = lerp(c(0, 1, 1), c(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}
function fbm3(x: number, y: number, z: number, oct: number, seed: number, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let f = 1;
  for (let o = 0; o < oct; o++) {
    sum += amp * vnoise3(x * f + o * 17.3, y * f, z * f, seed + o * 7919);
    norm += amp;
    amp *= gain;
    f *= 2.03;
  }
  return sum / norm;
}

// ─────────────────────────────────────────────────────────── image buffers ──

type Gen<T> = Generator<void, T, void>;


/** A quantised RGBA image (straight alpha): what generation produces. No DOM, transferable. */
export interface RawImage {
  w: number;
  h: number;
  data: Uint8ClampedArray<ArrayBuffer>;
}
/** Anything drawImage takes that knows its size. */
export type Img = HTMLCanvasElement | ImageBitmap;

interface Piece<T> {
  /** Top-left relative to the object's centre, in sprite px. */
  x: number;
  y: number;
  img: T;
}
/** A block-cropped sprite: only the 128 px blocks that hold visible pixels, merged into row runs. */
interface Sprite<T> {
  pieces: Piece<T>[];
  /** Sprite px -> backdrop px. */
  unit: number;
  op: GlobalCompositeOperation;
  /** Half extents of the uncropped sprite (sprite px). */
  hw: number;
  hh: number;
}

/** Region (sprite px, relative to the object centre) that can ever be on screen; pixels outside are never generated. */
interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function sampledPercentile(a: Float32Array, q: number): number {
  const step = Math.max(1, Math.floor(a.length / 8192));
  const s = new Float64Array(Math.ceil(a.length / step));
  for (let i = 0, j = 0; i < a.length; i += step) s[j++] = a[i]!;
  s.sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))]!;
}
function remap(a: Float32Array, lo: number, hi: number): void {
  const a0 = sampledPercentile(a, lo);
  const a1 = sampledPercentile(a, hi);
  const inv = 1 / Math.max(1e-6, a1 - a0);
  for (let i = 0; i < a.length; i++) a[i] = (a[i]! - a0) * inv;
}

/**
 * Separable cubic B-spline resample of an interleaved float image (ch
 * channels), streamed: onRow(y, row) receives every output row (mw * ch
 * floats, reused buffer). wrap=true samples periodically (seamless tiles).
 * C2-smooth, no overshoot: ideal for magnifying low-res noise.
 */
function* bspline(
  src: Float32Array, nw: number, nh: number, ch: number, mw: number, mh: number, wrap: boolean,
  onRow: (y: number, row: Float32Array) => void, r0 = 0, r1 = mh,
): Gen<void> {
  const taps = (n: number, m: number) => {
    const idx = new Int32Array(m * 4);
    const wt = new Float32Array(m * 4);
    for (let i = 0; i < m; i++) {
      const sx = ((i + 0.5) * n) / m - 0.5;
      const b = Math.floor(sx);
      const t = sx - b;
      const t2 = t * t;
      const t3 = t2 * t;
      wt[i * 4] = ((1 - t) * (1 - t) * (1 - t)) / 6;
      wt[i * 4 + 1] = (3 * t3 - 6 * t2 + 4) / 6;
      wt[i * 4 + 2] = (-3 * t3 + 3 * t2 + 3 * t + 1) / 6;
      wt[i * 4 + 3] = t3 / 6;
      for (let k = 0; k < 4; k++) {
        let j = b - 1 + k;
        if (wrap) j = ((j % n) + n) % n;
        else j = j < 0 ? 0 : j >= n ? n - 1 : j;
        idx[i * 4 + k] = j;
      }
    }
    return { idx, wt };
  };
  const hx = taps(nw, mw);
  const hy = taps(nh, mh);
  const tmp = new Float32Array(mw * nh * ch);
  for (let y = 0; y < nh; y++) {
    const row = y * nw * ch;
    const orow = y * mw * ch;
    for (let x = 0; x < mw; x++) {
      const i4 = x * 4;
      const a0 = row + hx.idx[i4]! * ch;
      const a1 = row + hx.idx[i4 + 1]! * ch;
      const a2 = row + hx.idx[i4 + 2]! * ch;
      const a3 = row + hx.idx[i4 + 3]! * ch;
      const w0 = hx.wt[i4]!;
      const w1 = hx.wt[i4 + 1]!;
      const w2 = hx.wt[i4 + 2]!;
      const w3 = hx.wt[i4 + 3]!;
      for (let c = 0; c < ch; c++) tmp[orow + x * ch + c] = w0 * src[a0 + c]! + w1 * src[a1 + c]! + w2 * src[a2 + c]! + w3 * src[a3 + c]!;
    }
    if ((y & 15) === 15) yield;
  }
  const out = new Float32Array(mw * ch);
  for (let y = Math.max(0, r0); y < Math.min(mh, r1); y++) {
    const i4 = y * 4;
    const r0 = hy.idx[i4]! * mw * ch;
    const r1 = hy.idx[i4 + 1]! * mw * ch;
    const r2 = hy.idx[i4 + 2]! * mw * ch;
    const r3 = hy.idx[i4 + 3]! * mw * ch;
    const w0 = hy.wt[i4]!;
    const w1 = hy.wt[i4 + 1]!;
    const w2 = hy.wt[i4 + 2]!;
    const w3 = hy.wt[i4 + 3]!;
    for (let i = 0; i < mw * ch; i++) out[i] = w0 * tmp[r0 + i]! + w1 * tmp[r1 + i]! + w2 * tmp[r2 + i]! + w3 * tmp[r3 + i]!;
    onRow(y, out);
    if ((y & 7) === 7) yield;
  }
}

/** Separable box blur (running sum), clamp edges, in place. */
function* boxBlur(buf: Float32Array, w: number, h: number, ch: number, r: number): Gen<void> {
  const line = new Float32Array(Math.max(w, h) * ch);
  const inv = 1 / (2 * r + 1);
  for (let pass = 0; pass < 2; pass++) {
    const n = pass === 0 ? w : h;
    const m = pass === 0 ? h : w;
    const st = pass === 0 ? ch : w * ch;
    for (let j = 0; j < m; j++) {
      const base = pass === 0 ? j * w * ch : j * ch;
      for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++) line[i * ch + c] = buf[base + i * st + c]!;
      for (let c = 0; c < ch; c++) {
        let s = 0;
        for (let k = -r; k <= r; k++) s += line[Math.min(n - 1, Math.max(0, k)) * ch + c]!;
        for (let i = 0; i < n; i++) {
          buf[base + i * st + c] = s * inv;
          s += line[Math.min(n - 1, i + r + 1) * ch + c]! - line[Math.max(0, i - r) * ch + c]!;
        }
      }
      if ((j & 127) === 127) yield;
    }
  }
}

/** Small blurred copy of an RGB float image for bloom (sampled bilinearly during finalize). */
interface Bloom {
  buf: Float32Array;
  sw: number;
  sh: number;
  f: number;
  amount: number;
}
function* makeBloom(buf: Float32Array, w: number, h: number, f: number, radius: number, amount: number, y0 = 0, y1 = h): Gen<Bloom> {
  const sw = Math.ceil(w / f);
  const sh = Math.ceil(h / f);
  const s = new Float32Array(sw * sh * 3);
  for (let y = y0; y < y1; y++) {
    const j0 = Math.floor(y / f) * sw * 3;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const r = buf[i]!;
      const g = buf[i + 1]!;
      const b = buf[i + 2]!;
      if (r + g + b === 0) continue;
      const j = j0 + Math.floor(x / f) * 3;
      s[j] += r;
      s[j + 1] += g;
      s[j + 2] += b;
    }
    if ((y & 127) === 127) yield;
  }
  const nrm = 1 / (f * f);
  for (let i = 0; i < s.length; i++) s[i] *= nrm;
  yield* boxBlur(s, sw, sh, 3, radius);
  yield* boxBlur(s, sw, sh, 3, radius);
  return { buf: s, sw, sh, f, amount };
}

/** Splat a point light (bilinear) into an RGB float buffer, optionally periodic. */
function splat(buf: Float32Array, w: number, h: number, x: number, y: number, r: number, g: number, b: number, wrap: boolean): void {
  const x0 = Math.floor(x - 0.5);
  const y0 = Math.floor(y - 0.5);
  const fx = x - 0.5 - x0;
  const fy = y - 0.5 - y0;
  for (let dy = 0; dy < 2; dy++) {
    for (let dx = 0; dx < 2; dx++) {
      let xx = x0 + dx;
      let yy = y0 + dy;
      if (wrap) {
        xx = ((xx % w) + w) % w;
        yy = ((yy % h) + h) % h;
      } else if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const wgt = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
      const i = (yy * w + xx) * 3;
      buf[i] += r * wgt;
      buf[i + 1] += g * wgt;
      buf[i + 2] += b * wgt;
    }
  }
}
/** Small gaussian glow for bright stars. */
function splatGlow(buf: Float32Array, w: number, h: number, x: number, y: number, sigma: number, c: RGB, k: number, wrap: boolean): void {
  const R = Math.ceil(sigma * 3);
  const inv = 1 / (2 * sigma * sigma);
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      let xx = Math.floor(x) + dx;
      let yy = Math.floor(y) + dy;
      if (wrap) {
        xx = ((xx % w) + w) % w;
        yy = ((yy % h) + h) % h;
      } else if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const ex = Math.floor(x) + dx + 0.5 - x;
      const ey = Math.floor(y) + dy + 0.5 - y;
      const g = Math.exp(-(ex * ex + ey * ey) * inv) * k;
      const i = (yy * w + xx) * 3;
      buf[i] += c[0] * g;
      buf[i + 1] += c[1] * g;
      buf[i + 2] += c[2] * g;
    }
  }
}

/** xorshift32 triangular dither in [-1, 1]. */
class Dither {
  private s: number;
  constructor(seed: number) {
    this.s = (seed ^ 0x9e3779b9) >>> 0 || 1;
  }
  next(): number {
    let s = this.s;
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    this.s = s >>> 0;
    return ((s & 1023) + ((s >>> 10) & 1023)) / 1023 - 1;
  }
}

interface FinOpts {
  /** Highlight compression asymptote and pre-gain. */
  peak: number;
  gain: number;
  /** Hard luminance cap (hue preserving), applied last. */
  cap: number;
  /** Pre-tonemap multiplier; return 0 to skip the pixel entirely (window/cull). */
  win?: (x: number, y: number) => number;
  bloom?: Bloom | null;
  /** After tonemap, before cap (e.g. a photon ring that must not be flattened by the knee). */
  post?: (x: number, y: number, c: RGB) => void;
  /** After cap: split weight (vortex core vs outer). */
  weight?: (x: number, y: number) => number;
  y0?: number;
  y1?: number;
  x0?: number;
  x1?: number;
}

/**
 * Fused finalise for emissive sprites (stored as straight alpha, see below): bloom (bilinear from the
 * small buffer) + window + tonemap + post + cap + toe + dither + quantise to
 * RGBA in one pass. Unprocessed pixels stay fully transparent black.
 */
function* finalizeAdd(buf: Float32Array, w: number, h: number, seed: number, o: FinOpts): Gen<Uint8ClampedArray<ArrayBuffer>> {
  const out = new Uint8ClampedArray(w * h * 4);
  let ds = (seed ^ 0x9e3779b9) >>> 0 || 1;
  const bl = o.bloom ?? null;
  const win = o.win ?? null;
  const post = o.post ?? null;
  const weight = o.weight ?? null;
  const T0 = 4 / 255;
  const T1 = 10 / 255;
  const peak = o.peak;
  const knee = peak * 0.5;
  const cap = o.cap;
  const c: RGB = [0, 0, 0];
  const B = bl ? bl.buf : null;
  const bf = bl ? 1 / bl.f : 0;
  const bAmt = bl ? bl.amount : 0;
  const x0 = Math.max(0, o.x0 ?? 0);
  const x1 = Math.min(w, o.x1 ?? w);
  for (let y = Math.max(0, o.y0 ?? 0); y < Math.min(h, o.y1 ?? h); y++) {
    let by0 = 0;
    let by1 = 0;
    let fy = 0;
    if (bl) {
      const sy = (y + 0.5) * bf - 0.5;
      const yy = Math.floor(sy);
      fy = sy - yy;
      by0 = Math.min(bl.sh - 1, Math.max(0, yy)) * bl.sw * 3;
      by1 = Math.min(bl.sh - 1, Math.max(0, yy + 1)) * bl.sw * 3;
    }
    for (let x = x0; x < x1; x++) {
      const k = win ? win(x, y) : 1;
      if (k <= 0) continue;
      const i = (y * w + x) * 3;
      let r = buf[i]!;
      let g = buf[i + 1]!;
      let b = buf[i + 2]!;
      if (B && bl) {
        const sx = (x + 0.5) * bf - 0.5;
        const xx = Math.floor(sx);
        const fx = sx - xx;
        const xa = (xx < 0 ? 0 : xx >= bl.sw ? bl.sw - 1 : xx) * 3;
        const xb = (xx + 1 >= bl.sw ? bl.sw - 1 : xx + 1 < 0 ? 0 : xx + 1) * 3;
        const w00 = (1 - fx) * (1 - fy) * bAmt;
        const w10 = fx * (1 - fy) * bAmt;
        const w01 = (1 - fx) * fy * bAmt;
        const w11 = fx * fy * bAmt;
        r += B[by0 + xa]! * w00 + B[by0 + xb]! * w10 + B[by1 + xa]! * w01 + B[by1 + xb]! * w11;
        g += B[by0 + xa + 1]! * w00 + B[by0 + xb + 1]! * w10 + B[by1 + xa + 1]! * w01 + B[by1 + xb + 1]! * w11;
        b += B[by0 + xa + 2]! * w00 + B[by0 + xb + 2]! * w10 + B[by1 + xa + 2]! * w01 + B[by1 + xb + 2]! * w11;
      }
      const gk = k * o.gain;
      r *= gk;
      g *= gk;
      b *= gk;
      let L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (L > knee) {
        const t = (knee + (peak - knee) * (1 - Math.exp(-(L - knee) / (peak - knee)))) / L;
        r *= t;
        g *= t;
        b *= t;
      }
      if (post) {
        c[0] = r;
        c[1] = g;
        c[2] = b;
        post(x, y, c);
        r = c[0];
        g = c[1];
        b = c[2];
      }
      L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (L > cap) {
        const t = cap / L;
        r *= t;
        g *= t;
        b *= t;
      }
      if (weight) {
        const wt = weight(x, y);
        if (wt <= 0) continue;
        r *= wt;
        g *= wt;
        b *= wt;
      }
      const m = r > g ? (r > b ? r : b) : g > b ? g : b;
      if (m < T0) continue;
      const toe = m >= T1 ? 1 : smoothstep(T0, T1, m);
      ds ^= ds << 13;
      ds ^= ds >>> 17;
      ds ^= ds << 5;
      const d1 = ((ds & 1023) + ((ds >>> 10) & 1023)) / 1023 - 1;
      // Emissive light stored as straight alpha a = max channel, colour = rgb / a, drawn with plain
      // source-over: dst' = rgb + dst * (1 - a). That equals additive blending except that the gas
      // behind bright parts is attenuated (the galaxy is in front of it), and source-over blits are
      // ~5x cheaper than 'lighter' in software rasterisers.
      const a = m * toe;
      const inv = 255 / m;
      const p = (y * w + x) * 4;
      out[p] = r * inv + d1 * 0.5;
      out[p + 1] = g * inv - d1 * 0.35;
      out[p + 2] = b * inv + d1 * 0.2;
      out[p + 3] = a * 255 + d1;
    }
    if ((y & 31) === 31) yield;
  }
  return out;
}

/** Quantise a straight-alpha RGBA float image (planets) with dither. */
function* finalizeRGBA(buf: Float32Array, w: number, h: number, seed: number, cap = 1): Gen<Uint8ClampedArray<ArrayBuffer>> {
  const out = new Uint8ClampedArray(w * h * 4);
  const dz = new Dither(seed);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = buf[i + 3]!;
      if (a <= 0) continue;
      const L = 0.2126 * buf[i]! + 0.7152 * buf[i + 1]! + 0.0722 * buf[i + 2]!;
      if (L > cap) {
        const t = cap / L;
        buf[i] *= t;
        buf[i + 1] *= t;
        buf[i + 2] *= t;
      }
      const d1 = dz.next();
      out[i] = clamp01(buf[i]!) * 255 + d1;
      out[i + 1] = clamp01(buf[i + 1]!) * 255 - d1 * 0.7;
      out[i + 2] = clamp01(buf[i + 2]!) * 255 + d1 * 0.4;
      out[i + 3] = clamp01(a) * 255 + d1 * 0.5;
    }
    if ((y & 63) === 63) yield;
  }
  return out;
}

/**
 * Block-crop: split into 128 px blocks, drop blocks whose max (RGB for
 * additive, alpha for straight alpha) is below thr, merge the kept blocks of
 * each block row into runs and trim every run to its exact visible bbox.
 */
function* cropSprite(
  px: Uint8ClampedArray<ArrayBuffer>, w: number, h: number, alpha: boolean, thr: number, unit: number, op: GlobalCompositeOperation,
): Gen<Sprite<RawImage>> {
  const B = 128;
  const bw = Math.ceil(w / B);
  const bh = Math.ceil(h / B);
  const sig = (i: number) => (alpha ? px[i + 3]! : Math.max(px[i]!, px[i + 1]!, px[i + 2]!));
  const keep = new Uint8Array(bw * bh);
  for (let y = 0; y < h; y++) {
    const by = (y / B) | 0;
    for (let x = 0; x < w; x++) {
      if (sig((y * w + x) * 4) >= thr) keep[by * bw + ((x / B) | 0)] = 1;
    }
    if ((y & 127) === 127) yield;
  }
  const pieces: Piece<RawImage>[] = [];
  for (let by = 0; by < bh; by++) {
    let bx = 0;
    while (bx < bw) {
      if (!keep[by * bw + bx]) {
        bx++;
        continue;
      }
      let ex = bx;
      while (ex + 1 < bw && keep[by * bw + ex + 1]) ex++;
      const rx0 = bx * B;
      const rx1 = Math.min(w, (ex + 1) * B);
      const ry0 = by * B;
      const ry1 = Math.min(h, (by + 1) * B);
      let tx0 = rx1;
      let tx1 = -1;
      let ty0 = ry1;
      let ty1 = -1;
      for (let y = ry0; y < ry1; y++) {
        for (let x = rx0; x < rx1; x++) {
          if (sig((y * w + x) * 4) >= 2) {
            if (x < tx0) tx0 = x;
            if (x > tx1) tx1 = x;
            if (y < ty0) ty0 = y;
            if (y > ty1) ty1 = y;
          }
        }
      }
      if (tx1 >= 0) {
        const cw = tx1 - tx0 + 1;
        const chh = ty1 - ty0 + 1;
        const data = new Uint8ClampedArray(cw * chh * 4);
        for (let y = 0; y < chh; y++) data.set(px.subarray(((ty0 + y) * w + tx0) * 4, ((ty0 + y) * w + tx0 + cw) * 4), y * cw * 4);
        pieces.push({ x: tx0 - w / 2, y: ty0 - h / 2, img: { w: cw, h: chh, data } });
      }
      bx = ex + 1;
      yield;
    }
  }
  return { pieces, unit, op, hw: w / 2, hh: h / 2 };
}

// ─────────────────────────────────────────────────────────────── sector defs ──

export interface PlanetDef {
  kind: 'rocky' | 'ice' | 'ocean' | 'gas' | 'obsidian';
  /** Radius in backdrop px (1080p). Under 40 px a body is drawn as a silhouette with a 1 px rim. */
  radius: number;
  /** Surface palette: dark, mid, light. */
  colors: [string, string, string];
  /** Gas giants: posterised band colours, dark to light (3-4). */
  bands?: string[];
  atmo?: { color: string; strength: number; extent: number };
  ring?: { inner: number; outer: number; ratio: number; color: string; opacity: number };
  /** Band / ring tilt on screen (rad). */
  tilt: number;
  /** Direction towards the light: x right, y down, z towards viewer (negative = backlit). */
  light: [number, number, number];
  ambient: number;
  brightness: number;
  craters?: number;
  /** Faint emissive cracks (obsidian worlds). */
  glow?: { color: string; amount: number };
  seed: number;
}

export interface PlanetPlacement {
  def: PlanetDef;
  /** Offset from screen centre at camera (0,0), in screen heights. */
  x: number;
  y: number;
  /** <= 0.15 so planets always move slower than the renderer's farthest star layer (0.2). */
  parallax: number;
}

/** Beat-synced additive glow on the centerpiece's focal point (<=128 px source sprite). */
export interface PulseDef {
  /** Offset from the centerpiece anchor and radius, backdrop px. */
  x: number;
  y: number;
  r: number;
  /** 0 = soft blob; otherwise a ring at this fraction of r. */
  ring: number;
  color: string;
  /** Alpha at rest and added at a full beat. */
  base: number;
  amp: number;
}

interface CenterCommon {
  /** Screen-space anchor as a fraction of the viewport. Must sit outside the central play ellipse. */
  ax: number;
  ay: number;
  parallax: number;
  /** Rotation speed of the core (rad/s); vortex only. */
  spin?: number;
  pulse?: PulseDef;
}
export type CenterDef =
  | (CenterCommon & {
      kind: 'spiral';
      size: number; // canvas size in screen heights
      /** Elliptical window in the galaxy plane: fade from w0 to w1 (bounded halo -> tight crop). */
      window: [number, number];
      arms: number;
      pitch: number; // rad
      incline: number; // minor/major axis ratio
      rot: number;
      armColor: string;
      outerColor: string;
      coreColor: string;
      starTints: string[];
      brightness: number;
      bulge: number;
      stars: number;
    })
  | (CenterCommon & { kind: 'planet'; planet: PlanetDef })
  | (CenterCommon & {
      kind: 'blackhole';
      size: number;
      shadow: number; // shadow radius / canvas size
      incline: number;
      rot: number;
      hot: string;
      mid: string;
      cool: string;
      brightness: number;
    })
  | (CenterCommon & {
      kind: 'vortex';
      size: number;
      twist: number;
      arms: number;
      /** Noise period around the circle (cells). */
      per: number;
      dark: string;
      mid: string;
      hi: string;
      eye: string;
      brightness: number;
    });

export interface NebulaDef {
  void: string;
  deep: string;
  mid: string;
  /** Second mid-tone hue, mixed in by a low-frequency variation field. */
  alt: string;
  hi: string;
  /** Colour of the lit cloud rims. */
  rim: string;
  /** Texture family: plain fBm, billowy |fBm|, or ridged 1-|fBm|. */
  style: 'fbm' | 'billow' | 'ridged';
  /** Noise cells per tile along x / y (integers; unequal = streamers). */
  cells: [number, number];
  warp: number;
  gain: number;
  /** Fraction of the tile that is near-black void (coverage mask). */
  empty: number;
  /** Dust-lane strength (lanes are only carved inside bright clouds). */
  lanes: number;
  /** Lit-rim strength and the direction towards the light (screen space). */
  rimAmt: number;
  light: [number, number];
  /** Chroma budget of the whole tile: max(R,G,B) - min(R,G,B) <= satCap. */
  satCap: number;
  /**
   * Lightness budget of the gas (OKLab L, soft asymptote; stars excluded). Every gameplay colour's dim
   * glow (0.3 x the neon) sits at L >= 0.27, so gas held well below that can carry a rich hue and still
   * never look like a sprite's halo (the camouflage check).
   */
  okMax: number;
}

/** Visual definition of one sector. Its name and subtitle live in the story script (`STORY.sectors`). */
export interface SectorDef {
  id: string;
  seed: number;
  nebula: NebulaDef;
  wisps: { a: string; b: string; amount: number; sharp: number; cover: number };
  stars: { count: number; tints: string[]; brightness: number };
  center: CenterDef;
  planets: PlanetPlacement[];
  /** Warp streak / flash tint when arriving in this sector. */
  warpTint: string;
  /** RGB for the renderer's grid in this sector (a desaturated PAL.grid; never the sector's own hue). */
  gridRGB: [number, number, number];
}

const GRID_RGB: [number, number, number] = [112, 126, 196];

export const SECTORS: SectorDef[] = [
  {
    id: 'turquoise-whorl',
    seed: 0x51a7,
    nebula: {
      void: '#010509', deep: '#03121a', mid: '#043a42', alt: '#0a2a52', hi: '#0f7072', rim: '#7fe8ec',
      style: 'fbm', cells: [4, 3], warp: 1.4, gain: 0.48, empty: 0.45, lanes: 0.6, rimAmt: 0.12, light: [0.75, -0.66], satCap: 0.24, okMax: 0.215,
    },
    wisps: { a: '#16b4aa', b: '#3a5cc0', amount: 0.11, sharp: 5, cover: 0.5 },
    stars: { count: 2600, tints: ['#cfe0ff', '#dfeaff', '#fff3dc', '#d9dcff'], brightness: 0.45 },
    center: {
      kind: 'spiral', ax: 0.8, ay: 0.19, parallax: 0.012, size: 1.2, window: [0.5, 0.8],
      arms: 2, pitch: 0.3, incline: 0.5, rot: -0.2,
      armColor: '#6fb9c6', outerColor: '#4d6fa8', coreColor: '#f2dfbd',
      starTints: ['#d5f3ff', '#b8e4ff', '#e9f6ff', '#fff0d6'], brightness: 0.66, bulge: 0.5, stars: 12000,
      pulse: { x: 0, y: 0, r: 64, ring: 0, color: '#ffe6c0', base: 0.04, amp: 0.07 },
    },
    planets: [
      {
        x: -0.64, y: 0.3, parallax: 0.12,
        def: {
          kind: 'ocean', radius: 92, colors: ['#061a24', '#123c4a', '#3f6f72'], tilt: 0.3,
          atmo: { color: '#86d8f0', strength: 0.75, extent: 0.03 },
          light: [0.62, -0.5, -0.42], ambient: 0.02, brightness: 0.6, seed: 11,
        },
      },
      {
        x: 0.42, y: 0.4, parallax: 0.15,
        def: {
          kind: 'ice', radius: 30, colors: ['#10141c', '#4c5a66', '#9aa8b2'], tilt: 0,
          atmo: { color: '#a8c4e8', strength: 0.6, extent: 0.03 },
          light: [0.62, -0.5, -0.4], ambient: 0.02, brightness: 0.5, seed: 12,
        },
      },
    ],
    warpTint: '#7fe9ff',
    gridRGB: GRID_RGB,
  },
  {
    id: 'garnet-nebula',
    seed: 0xc1d3,
    nebula: {
      void: '#070203', deep: '#180508', mid: '#440c16', alt: '#4a1a08', hi: '#7a2418', rim: '#ffa080',
      style: 'fbm', cells: [4, 3], warp: 2.2, gain: 0.6, empty: 0.5, lanes: 0.65, rimAmt: 0.12, light: [-0.8, 0.6], satCap: 0.24, okMax: 0.205,
    },
    wisps: { a: '#d8501c', b: '#a01c3c', amount: 0.09, sharp: 6, cover: 0.5 },
    stars: { count: 2200, tints: ['#ffe8d8', '#ffdcc8', '#fff4e6', '#e4dcff'], brightness: 0.42 },
    center: {
      kind: 'planet', ax: 0.12, ay: 0.86, parallax: 0.014,
      planet: {
        kind: 'gas', radius: 230, colors: ['#1a0810', '#5a1a28', '#c8603e'],
        bands: ['#2a0a18', '#6a1630', '#a8322e', '#e07a4c'],
        tilt: -0.05,
        atmo: { color: '#ffa080', strength: 0.75, extent: 0.03 },
        ring: { inner: 1.38, outer: 2.3, ratio: 0.2, color: '#ffd0b0', opacity: 0.85 },
        light: [0.45, -0.6, -0.78], ambient: 0.03, brightness: 0.62, seed: 21,
      },
    },
    planets: [
      {
        x: 0.62, y: -0.32, parallax: 0.12,
        def: {
          kind: 'rocky', radius: 44, colors: ['#1c0f0c', '#4d2a20', '#86604a'], tilt: 0,
          atmo: { color: '#ffb898', strength: 0.55, extent: 0.03 },
          light: [-0.55, -0.6, -0.45], ambient: 0.02, brightness: 0.55, craters: 12, seed: 22,
        },
      },
      {
        x: -0.22, y: -0.43, parallax: 0.15,
        def: {
          kind: 'rocky', radius: 18, colors: ['#140e0e', '#40302c', '#6e5a50'], tilt: 0,
          atmo: { color: '#e8b8a0', strength: 0.55, extent: 0.03 },
          light: [-0.55, -0.6, -0.4], ambient: 0.02, brightness: 0.45, seed: 23,
        },
      },
    ],
    warpTint: '#ffb08a',
    gridRGB: GRID_RGB,
  },
  {
    id: 'amethyst-abyss',
    seed: 0x7a1e,
    nebula: {
      void: '#030210', deep: '#0a0626', mid: '#1c1252', alt: '#300e4c', hi: '#3c2c8c', rim: '#b0a0ff',
      style: 'fbm', cells: [3, 5], warp: 1.2, gain: 0.55, empty: 0.52, lanes: 0.5, rimAmt: 0.12, light: [-0.72, -0.7], satCap: 0.24, okMax: 0.18,
    },
    wisps: { a: '#5a40d0', b: '#8a2ab0', amount: 0.11, sharp: 6, cover: 0.5 },
    stars: { count: 2400, tints: ['#e6e4ff', '#cfd8ff', '#ffffff', '#ecdfff'], brightness: 0.42 },
    center: {
      kind: 'blackhole', ax: 0.22, ay: 0.27, parallax: 0.012, size: 1.0,
      shadow: 0.085, incline: 0.17, rot: -0.22,
      hot: '#f6f0ff', mid: '#9a6cf0', cool: '#3a1670', brightness: 0.8,
      pulse: { x: 0, y: 0, r: 128, ring: 0.74, color: '#e8dcff', base: 0.03, amp: 0.1 },
    },
    planets: [
      {
        x: 0.64, y: 0.3, parallax: 0.1,
        def: {
          kind: 'rocky', radius: 70, colors: ['#08060e', '#1c1630', '#3c3358'], tilt: 0,
          atmo: { color: '#8fb4ff', strength: 0.7, extent: 0.03 },
          light: [-0.7, -0.4, -0.45], ambient: 0.012, brightness: 0.6, craters: 8, seed: 31,
        },
      },
      {
        x: -0.1, y: 0.43, parallax: 0.15,
        def: {
          kind: 'ice', radius: 22, colors: ['#0e0c16', '#3c3650', '#7d7698'], tilt: 0,
          atmo: { color: '#b4c0ff', strength: 0.6, extent: 0.03 },
          light: [-0.6, -0.5, -0.4], ambient: 0.02, brightness: 0.45, seed: 32,
        },
      },
    ],
    warpTint: '#c9a8ff',
    gridRGB: GRID_RGB,
  },
  {
    id: 'gilded-throne',
    seed: 0x4ea7,
    nebula: {
      void: '#060402', deep: '#170e03', mid: '#4a320c', alt: '#3c1e0a', hi: '#82601a', rim: '#ffd88a',
      style: 'fbm', cells: [5, 4], warp: 3.2, gain: 0.55, empty: 0.38, lanes: 0.6, rimAmt: 0.12, light: [0.8, -0.6], satCap: 0.24, okMax: 0.215,
    },
    wisps: { a: '#d8a030', b: '#a05a20', amount: 0.1, sharp: 7, cover: 0.45 },
    stars: { count: 1800, tints: ['#fff4dc', '#ffeccc', '#ffffff', '#f0e8ff'], brightness: 0.38 },
    center: {
      kind: 'vortex', ax: 0.86, ay: 0.2, parallax: 0.01, size: 1.22,
      twist: 3.6, arms: 4, per: 36, spin: 0.03,
      dark: '#080603', mid: '#5c4422', hi: '#f6c460', eye: '#fff2d6', brightness: 0.62,
      pulse: { x: 0, y: 0, r: 72, ring: 0.6, color: '#fff0c8', base: 0.06, amp: 0.12 },
    },
    planets: [
      {
        x: -0.6, y: -0.26, parallax: 0.1,
        def: {
          kind: 'obsidian', radius: 76, colors: ['#060504', '#17130e', '#2e261a'], tilt: 0.45,
          atmo: { color: '#e8c070', strength: 0.6, extent: 0.03 },
          ring: { inner: 1.45, outer: 1.95, ratio: 0.2, color: '#c8a870', opacity: 0.6 },
          glow: { color: '#ffb347', amount: 0.3 },
          light: [0.6, -0.5, -0.45], ambient: 0.015, brightness: 0.6, seed: 41,
        },
      },
    ],
    warpTint: '#ffd27a',
    gridRGB: GRID_RGB,
  },
];

// ──────────────────────────────────────────────────────────── layout rules ──

/** Max inward drift of a centerpiece (screen heights). Outward drift is soft-limited to OUTWARD. */
const INWARD = 0.025;
const OUTWARD = 0.3;
/** Widest supported aspect ratio (cull rects are computed for it). */
const MAX_ASPECT = 2.4;
/** Central play ellipse (full width / height fractions) no centerpiece anchor may enter. */
export const PLAY_ELLIPSE = { w: 0.45, h: 0.32 };

/**
 * Reference size (device px) that backdrop px scale with: the screen height on landscape screens,
 * 0.8 x the width on portrait / narrow ones, so a phone held upright gets corner-sized
 * centerpieces instead of ones scaled to its tall side.
 */
export function backdropRef(w: number, h: number): number {
  return Math.min(h, w * 0.8);
}

/** Per-axis drift range [min, max] in screen heights for an anchor coordinate a (0..1). */
function driftRange(a: number): [number, number] {
  if (a > 0.52) return [-INWARD, OUTWARD];
  if (a < 0.48) return [-OUTWARD, INWARD];
  return [-INWARD, INWARD];
}

/** Region of a centerpiece (backdrop px, relative to its anchor) that can ever be on screen. */
function centerCull(ax: number, ay: number): Rect {
  const H = 1080;
  const [dx0, dx1] = driftRange(ax);
  const [dy0, dy1] = driftRange(ay);
  const m = 0.03;
  return {
    x0: (-ax * MAX_ASPECT - dx1 - m) * H,
    x1: ((1 - ax) * MAX_ASPECT - dx0 + m) * H,
    y0: (-ay - dy1 - m) * H,
    y1: (1 - ay - dy0 + m) * H,
  };
}

// ──────────────────────────────────────────────────────────── generators ──

/** Generated (not yet uploaded) sector. T = RawImage in the generator, Img once materialised. */
interface SectorData<T> {
  index: number;
  /** Sprite px per backdrop px for centerpiece + planets, and for the tile. */
  rs: number;
  tileRs: number;
  tile: T;
  center: Sprite<T>[];
  /** Spinning vortex core (drawn rotated through a cache), or null. */
  core: Sprite<T> | null;
  planets: Sprite<T>[];
  timings: Record<string, number>;
}

/** Nebula tile size in backdrop px (wider than tall: no repeat within a 16:9 screen); generated at x tileRs so it blits 1:1. */
const TILE_W = 2048;
const TILE_H = 1536;
/** Field grid of the tile (5.1x magnified by the B-spline). */
const FIELD_W = 400;
const FIELD_H = 300;
/**
 * Brightness budget (Rec.709 luma on sRGB values): additive centerpieces are
 * capped at SPRITE_CAP so sprite + nebula underneath stays ~<= 0.55; opaque
 * planets at OPAQUE_CAP. White-cored bullets / the player stay readable.
 */
const SPRITE_CAP = 0.44;
const OPAQUE_CAP = 0.5;
/** Generation scale cap: up to 1440p everything blits 1:1; above that it is drawn scaled (GPU territory). */
const Q_CAP = 1.34;

/**
 * Nebula tile. One periodic 400x300 pass computes every field (domain-warped
 * density, a coarse coverage mask eroded by the density so ~40-50% of the
 * tile is true black with fractal cloud edges, dust lanes that only exist
 * inside bright clouds, ridged dust filaments, colour variation) and colours
 * it, including a lit rim on cloud edges facing the sector's light. Then:
 * B-spline magnify to TW x TH, micro stars, chroma cap, dither, quantise.
 */
function* genTile(def: SectorDef, TW: number, TH: number, tm: Record<string, number> = {}): Gen<RawImage> {
  let tq = performance.now();
  const lapT = (k: string) => {
    const n = performance.now();
    tm[k] = (tm[k] ?? 0) + n - tq;
    tq = n;
  };
  const NW = FIELD_W;
  const NH = FIELD_H;
  const nb = def.nebula;
  const [PX, PY] = nb.cells;
  const s = def.seed * 31 + 1;
  const NN = NW * NH;
  const dens = new Float32Array(NN);
  const lane = new Float32Array(NN);
  const cov = new Float32Array(NN);
  const wisp = new Float32Array(NN);
  const hue = new Float32Array(NN);
  const W = nb.warp;
  const wsharp = def.wisps.sharp;
  const style = nb.style === 'billow' ? 1 : nb.style === 'ridged' ? 2 : 0;
  for (let y = 0; y < NH; y++) {
    for (let x = 0; x < NW; x++) {
      const u = (x / NW) * PX;
      const v = (y / NH) * PY;
      const qx = fbmXY(u, v, PX, PY, 2, s + 1);
      const qy = fbmXY(u + 5.2, v + 1.3, PX, PY, 2, s + 2);
      const raw = fbmXY(u + W * qx, v + W * qy, PX, PY, 4, s + 3, nb.gain);
      const i = y * NW + x;
      dens[i] = style === 1 ? Math.abs(raw) : style === 2 ? 1 - Math.abs(raw) : raw;
      lane[i] = 1 - Math.abs(fbmXY(2 * u + 1.2 * qy, 2 * v - 1.2 * qx, 2 * PX, 2 * PY, 2, s + 5));
      // Coarse coverage: 3 x 2 cells per tile (a few big cloud complexes), gently warped.
      cov[i] = fbmXY((x / NW) * 3 + 0.3 * qx, (y / NH) * 2 + 0.3 * qy, 3, 2, 2, s + 6);
      // Ridged filaments at twice the frequency, sharing the warp.
      const r = 1 - Math.abs(fbmXY(2 * u + 2.2 * qx, 2 * v + 2.2 * qy, 2 * PX, 2 * PY, 3, s + 7, 0.55));
      let rp = r * r;
      rp *= rp; // r^4
      wisp[i] = wsharp >= 6 ? rp * r * r : rp * r;
      hue[i] = qx - qy;
    }
    if ((y & 3) === 3) yield;
  }
  lapT('t.noise');
  remap(dens, 0.03, 0.995);
  remap(lane, 0.55, 0.995);
  remap(cov, 0.02, 0.98);
  remap(wisp, 0.0, 0.997);
  remap(hue, 0.05, 0.95);
  // Erode the coverage edge by the density so cloud boundaries are fractal, not blobs.
  for (let i = 0; i < NN; i++) cov[i] = cov[i]! + 0.45 * (clamp01(dens[i]!) - 0.5);
  const thr = sampledPercentile(cov, nb.empty);
  for (let i = 0; i < NN; i++) {
    const mask = smoothstep(thr - 0.05, thr + 0.3, cov[i]!);
    const dv = clamp01(dens[i]!);
    dens[i] = dv * Math.sqrt(Math.sqrt(dv)) * mask; // ^1.25
  }
  yield;
  const cv = hexRGB(nb.void);
  const cd = hexRGB(nb.deep);
  const cm = hexRGB(nb.mid);
  const ca = hexRGB(nb.alt);
  const ch = hexRGB(nb.hi);
  const cr = hexRGB(nb.rim);
  const wa = hexRGB(def.wisps.a);
  const wb = hexRGB(def.wisps.b);
  const ll = hyp(nb.light[0], nb.light[1]);
  const Lx = nb.light[0] / ll;
  const Ly = nb.light[1] / ll;
  const F = new Float32Array(NN * 3);
  const c: RGB = [0, 0, 0];
  const m2: RGB = [0, 0, 0];
  const w2: RGB = [0, 0, 0];
  const wAmt = def.wisps.amount * 4;
  const wCover = def.wisps.cover * 2;
  const okMax = nb.okMax;
  const okKnee = okMax * 0.7;
  for (let y = 0; y < NH; y++) {
    const yu = ((y + 1) % NH) * NW;
    const yd = ((y + NH - 1) % NH) * NW;
    for (let x = 0; x < NW; x++) {
      const i = y * NW + x;
      const d = dens[i]!;
      const hv = hue[i]!;
      mix3(c, cv, cd, smoothstep(0.0, 0.25, d));
      mix3(m2, cm, ca, smoothstep(0.25, 0.75, hv));
      mix3(c, c, m2, smoothstep(0.1, 0.8, d) * 0.8);
      const hs = smoothstep(0.55, 1.0, d);
      const hh = hs * hs * 0.35;
      c[0] += ch[0] * hh;
      c[1] += ch[1] * hh;
      c[2] += ch[2] * hh;
      const lv = clamp01(lane[i]!);
      const dd = lv * lv * nb.lanes * smoothstep(0.35, 0.75, d);
      c[0] *= 1 - dd;
      c[1] *= 1 - dd;
      c[2] *= 1 - dd;
      // Lit rim on the outer edge band of clouds, strongest where the edge faces the light.
      if (d > 0.01 && d < 0.28) {
        const gx = (dens[y * NW + ((x + 1) % NW)]! - dens[y * NW + ((x + NW - 1) % NW)]!) * 0.5;
        const gy = (dens[yu + x]! - dens[yd + x]!) * 0.5;
        const gm = Math.sqrt(gx * gx + gy * gy);
        if (gm > 1e-5) {
          const f = Math.max(0, -(gx * Lx + gy * Ly) / gm);
          const rim = nb.rimAmt * (0.2 + 0.8 * f * f) * smoothstep(0.004, 0.03, gm) * smoothstep(0.01, 0.06, d) * (1 - smoothstep(0.1, 0.28, d));
          c[0] += cr[0] * rim;
          c[1] += cr[1] * rim;
          c[2] += cr[2] * rim;
        }
      }
      // Filaments: mostly inside / around clouds, a faint few out in the void.
      const wv = clamp01(wisp[i]!) * wAmt * (0.05 + 0.95 * smoothstep(0.02, 0.35, d) * wCover) * (1 - 0.6 * dd);
      mix3(w2, wa, wb, smoothstep(0.2, 0.8, hv));
      let r = c[0] + w2[0] * wv;
      let g = c[1] + w2[1] * wv;
      let b = c[2] + w2[2] * wv;
      // Brightness budget: soft-compress the gas's perceptual lightness towards okMax, hue preserved
      // (stars are added later, uncapped). Scaling linear light by f scales OKLab L (and a, b) by cbrt(f).
      const L = okL(r, g, b);
      if (L > okKnee) {
        const Lt = okKnee + (okMax - okKnee) * (1 - Math.exp(-(L - okKnee) / (okMax - okKnee)));
        const f = (Lt / L) ** 3;
        r = toSrgb(toLinear(r) * f);
        g = toSrgb(toLinear(g) * f);
        b = toSrgb(toLinear(b) * f);
      }
      F[i * 3] = r;
      F[i * 3 + 1] = g;
      F[i * 3 + 2] = b;
    }
    if ((y & 31) === 31) yield;
  }
  lapT('t.colour');
  const out = new Float32Array(TW * TH * 3);
  yield* bspline(F, NW, NH, 3, TW, TH, true, (y, row) => out.set(row, y * TW * 3));
  lapT('t.upscale');
  // Micro stars, slightly clustered along the filaments (count is per 1536^2 of tile).
  const rng = new Rng(s + 99);
  const tints = def.stars.tints.map(hexRGB);
  const count = Math.round((def.stars.count * (TILE_W * TILE_H)) / (1536 * 1536));
  let placed = 0;
  let guard = 0;
  while (placed < count && guard++ < count * 6) {
    const x = rng.next() * TW;
    const y = rng.next() * TH;
    const fi = Math.floor((y / TH) * NH) * NW + Math.floor((x / TW) * NW);
    const near = clamp01(wisp[fi]! * 1.5);
    if (rng.next() > 0.35 + 0.65 * near) continue;
    placed++;
    const t = tints[Math.floor(rng.next() * tints.length)]!;
    const bv = rng.next();
    const b = def.stars.brightness * (0.12 + 0.88 * bv * bv * bv * bv * bv);
    splat(out, TW, TH, x, y, t[0] * b, t[1] * b, t[2] * b, true);
    if (rng.next() < 0.015) splatGlow(out, TW, TH, x, y, 1.6, t, b * 0.25, true);
    if ((placed & 1023) === 1023) yield;
  }
  lapT('t.stars');
  // Chroma cap + dither + quantise (opaque).
  const px = new Uint8ClampedArray(TW * TH * 4);
  let ds = (def.seed ^ 0x9e3779b9) >>> 0 || 1;
  const cap = nb.satCap;
  for (let y = 0; y < TH; y++) {
    let i = y * TW * 3;
    let p = y * TW * 4;
    for (let x = 0; x < TW; x++, i += 3, p += 4) {
      let r = out[i]!;
      let g = out[i + 1]!;
      let b = out[i + 2]!;
      const mx = r > g ? (r > b ? r : b) : g > b ? g : b;
      const mn = r < g ? (r < b ? r : b) : g < b ? g : b;
      if (mx - mn > cap) {
        const mean = (r + g + b) / 3;
        const k = cap / (mx - mn);
        r = mean + (r - mean) * k;
        g = mean + (g - mean) * k;
        b = mean + (b - mean) * k;
      }
      ds ^= ds << 13;
      ds ^= ds >>> 17;
      ds ^= ds << 5;
      const d1 = ((ds & 1023) + ((ds >>> 10) & 1023)) / 1023 - 1;
      px[p] = r * 255 + d1;
      px[p + 1] = g * 255 - d1 * 0.7;
      px[p + 2] = b * 255 + d1 * 0.4;
      px[p + 3] = 255;
    }
    if ((y & 31) === 31) yield;
  }
  lapT('t.quant');
  return { w: TW, h: TH, data: px };
}

/** Spiral galaxy: smooth half-res field (window-tested first) + arm stars at full res + bloom, fused finalise. */
function* genSpiral(d: Extract<CenterDef, { kind: 'spiral' }>, seed: number, rs: number, cull: Rect): Gen<Sprite<RawImage>[]> {
  const S = Math.round(d.size * 1080 * rs);
  const H = Math.ceil(S / 3);
  const cr = Math.cos(d.rot);
  const sr = Math.sin(d.rot);
  const armC = hexRGB(d.armColor);
  const outC = hexRGB(d.outerColor);
  const coreC = hexRGB(d.coreColor);
  const tanP = Math.tan(d.pitch);
  const [w0, w1] = d.window;
  const winR = (nx: number, ny: number): number => {
    const u = nx * cr + ny * sr;
    const v = (-nx * sr + ny * cr) / (d.incline * 1.25);
    return hyp(u, v);
  };
  // Cull in normalised units (nx = 1 at the canvas edge).
  const half = S / 2;
  const cx0 = (cull.x0 * rs) / half;
  const cx1 = (cull.x1 * rs) / half;
  const cy0 = (cull.y0 * rs) / half;
  const cy1 = (cull.y1 * rs) / half;
  const inCull = (nx: number, ny: number, m: number) => nx >= cx0 - m && nx <= cx1 + m && ny >= cy0 - m && ny <= cy1 + m;
  const field = new Float32Array(H * H * 3);
  const trans = new Float32Array(H * H).fill(1);
  const c: RGB = [0, 0, 0];
  const marg = 6 / H;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < H; x++) {
      const nx = ((x + 0.5) / H) * 2 - 1;
      const ny = ((y + 0.5) / H) * 2 - 1;
      if (winR(nx, ny) > w1 + marg || !inCull(nx, ny, marg)) continue;
      const u = nx * cr + ny * sr;
      const vs = -nx * sr + ny * cr;
      const v = vs / d.incline;
      const r = hyp(u, v);
      const th = Math.atan2(v, u);
      const wn = fbmN(u * 3 + 11, v * 3, 3, seed + 1);
      const phase = d.arms * (th - Math.log(Math.max(r, 0.015)) / tanP) + wn * 2.2;
      const arm = Math.pow(0.5 + 0.5 * Math.cos(phase), 2.6);
      const clump = 0.55 + 0.9 * Math.max(0, fbmN(u * 10, v * 10, 3, seed + 2) + 0.15);
      const disk = Math.exp(-r / 0.3) * (1 - smoothstep(0.72, 1.0, r));
      const light = disk * (0.14 + 1.3 * arm * clump);
      const dustA = Math.pow(0.5 + 0.5 * Math.cos(phase + 1.05), 7) * smoothstep(0.05, 0.2, r) * (1 - smoothstep(0.6, 0.95, r));
      const dust = dustA > 0.01 ? clamp01(dustA * (0.55 + 0.9 * Math.max(0, fbmN(u * 16, v * 16, 3, seed + 3) + 0.3))) : 0;
      const rb = hyp(u, vs / 0.78);
      const bulge = (Math.exp(-rb / 0.045) * 0.9 + Math.exp(-rb / 0.12) * 0.3) * (d.bulge / 0.9);
      mix3(c, armC, outC, smoothstep(0.15, 0.75, r));
      const i = (y * H + x) * 3;
      const T = 1 - 0.8 * dust;
      field[i] = (c[0] * light + coreC[0] * bulge) * T;
      field[i + 1] = (c[1] * light + coreC[1] * bulge) * T;
      field[i + 2] = (c[2] * light + coreC[2] * bulge) * T;
      trans[y * H + x] = T;
    }
    if ((y & 1) === 1) yield;
  }
  // Pixel bbox of the window ellipse, intersected with the cull rect.
  const eA = w1;
  const eB = w1 * d.incline * 1.25;
  const hx = hyp(eA * cr, eB * sr);
  const hy = hyp(eA * sr, eB * cr);
  const toPx = (n: number) => ((n + 1) / 2) * S;
  const bx0 = Math.max(0, Math.floor(toPx(Math.max(-hx, cx0))) - 1);
  const bx1 = Math.min(S, Math.ceil(toPx(Math.min(hx, cx1))) + 1);
  const by0 = Math.max(0, Math.floor(toPx(Math.max(-hy, cy0))) - 1);
  const by1 = Math.min(S, Math.ceil(toPx(Math.min(hy, cy1))) + 1);
  const buf = new Float32Array(S * S * 3);
  yield* bspline(field, H, H, 3, S, S, false, (y, row) => buf.set(row, y * S * 3), by0, by1);
  // Stars on logarithmic arms.
  const rng = new Rng(seed + 5);
  const tints = d.starTints.map(hexRGB);
  for (let n = 0; n < d.stars; n++) {
    let r = -Math.log(1 - rng.next() * 0.985) * 0.26;
    if (r > 0.95) r = rng.next() * 0.95;
    let th: number;
    const onArm = rng.next() < 0.72;
    if (onArm) {
      const k = Math.floor(rng.next() * d.arms);
      th = Math.log(Math.max(r, 0.015)) / tanP + (k * 2 * Math.PI) / d.arms + rng.gauss() * 0.28;
    } else th = rng.next() * Math.PI * 2;
    const tint = rng.next();
    const bri = rng.next();
    const glow = rng.next();
    const u = Math.cos(th) * r;
    const v = Math.sin(th) * r * d.incline;
    const nx = u * cr - v * sr;
    const ny = u * sr + v * cr;
    if (winR(nx, ny) > w1 || !inCull(nx, ny, 0)) continue;
    const px = (nx * 0.5 + 0.5) * S;
    const py = (ny * 0.5 + 0.5) * S;
    const fi = Math.min(H - 1, Math.max(0, Math.floor((py / S) * H))) * H + Math.min(H - 1, Math.max(0, Math.floor((px / S) * H)));
    const T = trans[fi] ?? 1;
    const t = r < 0.12 ? coreC : tints[Math.floor(tint * tints.length)]!;
    const b = (0.06 + 0.5 * Math.pow(bri, 4)) * T * (onArm ? 1 : 0.6) * (1 - smoothstep(0.7, 0.95, r));
    splat(buf, S, S, px, py, t[0] * b, t[1] * b, t[2] * b, false);
    if (glow < 0.012 && r > 0.1) splatGlow(buf, S, S, px, py, 1.8 * rs, t, b * 0.5, false);
    if ((n & 1023) === 1023) yield;
  }
  const bloom = yield* makeBloom(buf, S, S, 8, 3, 0.55, by0, by1);
  const px = yield* finalizeAdd(buf, S, S, seed, {
    peak: 0.5, gain: d.brightness, cap: SPRITE_CAP - 0.04, bloom, x0: bx0, x1: bx1, y0: by0, y1: by1,
    win: (x, y) => {
      const nx = ((x + 0.5) / S) * 2 - 1;
      const ny = ((y + 0.5) / S) * 2 - 1;
      if (!inCull(nx, ny, 0)) return 0;
      return 1 - smoothstep(w0, w1, winR(nx, ny));
    },
  });
  return [yield* cropSprite(px, S, S, true, 6, 1 / rs, 'source-over')];
}

/** Black hole: lensed accretion disk (primary + tight Einstein arcs), strong Doppler asymmetry, photon ring, shadow occluder. */
function* genBlackHole(d: Extract<CenterDef, { kind: 'blackhole' }>, seed: number, rs: number, cull: Rect): Gen<Sprite<RawImage>[]> {
  const S = Math.round(d.size * 1080 * rs);
  const Rs = d.shadow * S;
  const hot = hexRGB(d.hot);
  const mid = hexRGB(d.mid);
  const cool = hexRGB(d.cool);
  const cr = Math.cos(d.rot);
  const sr = Math.sin(d.rot);
  const e = d.incline;
  const buf = new Float32Array(S * S * 3);
  const c: RGB = [0, 0, 0];
  const PER = 24;
  const sd3 = seed + 3;
  const sd4 = seedOf(seed + 4);
  const diskI = (rr: number, phi: number): number => {
    // radial profile (rr in shadow radii), inner edge at ~2.0
    if (rr < 1.6 || rr > 6.6) return 0;
    const prof = smoothstep(1.6, 2.3, rr) * Math.exp(-(rr - 2.2) / 1.8) * (1 - smoothstep(4.4, 6.6, rr));
    const a = (phi / (2 * Math.PI)) * PER + rr * 2.2; // spiral streaks
    const st = 0.6 + 0.6 * fbm(a, rr * 2.2, PER, 3, sd3) + 0.12 * gnoise(a * 3, rr * 6, PER * 3, BIG, sd4);
    return prof * Math.max(0, st);
  };
  // Window: wide in the disk plane, short across it.
  const WU = 0.42 * S;
  const WV = 0.2 * S;
  const win = (px: number, py: number): number => {
    const u = (px * cr + py * sr) / WU;
    const v = (-px * sr + py * cr) / WV;
    return 1 - smoothstep(0.72, 0.99, hyp(u, v));
  };
  const bx = Math.ceil(hyp(WU * cr, WV * sr));
  const by = Math.ceil(hyp(WU * sr, WV * cr));
  const yA = Math.max(0, Math.floor(S / 2 - by), Math.floor(S / 2 + cull.y0 * rs));
  const yB = Math.min(S, Math.ceil(S / 2 + by), Math.ceil(S / 2 + cull.y1 * rs));
  const xA = Math.max(0, Math.floor(S / 2 - bx), Math.floor(S / 2 + cull.x0 * rs));
  const xB = Math.min(S, Math.ceil(S / 2 + bx), Math.ceil(S / 2 + cull.x1 * rs));
  for (let y = yA; y < yB; y++) {
    for (let x = xA; x < xB; x++) {
      const px = x + 0.5 - S / 2;
      const py = y + 0.5 - S / 2;
      if (win(px, py) <= 0) continue;
      const u = px * cr + py * sr;
      const v = -px * sr + py * cr;
      const q = hyp(u, v) / Rs;
      let I = 0;
      let heat = 0;
      let dopW = 0;
      // Primary image of the disk (thin ellipse). Back half hidden by the shadow.
      const rho = hyp(u, v / e) / Rs;
      const phi = Math.atan2(v / e, u);
      if (!(v < 0 && q < 1.0)) {
        const side = 0.5 + 0.5 * Math.cos(phi - Math.PI); // 1 = approaching (left)
        const dop = 0.22 + 1.28 * side;
        const di = diskI(rho, phi) * dop;
        I += di;
        heat += di * smoothstep(5, 2, rho);
        dopW += di * side;
      }
      // Lensed far side of the disk, hugging the shadow above (and faintly below) it.
      if (q > 1.0 && q < 1.8) {
        const ang = Math.atan2(v, u);
        const top = Math.pow(0.5 + 0.5 * -Math.sin(ang), 0.8);
        const bot = Math.pow(0.5 + 0.5 * Math.sin(ang), 2) * 0.45;
        const rrTop = 2.0 + (q - 1.05) * 5.5;
        const rrBot = 2.0 + (q - 1.03) * 14;
        const side = 0.5 + 0.5 * Math.cos(ang - Math.PI);
        const dop = 0.22 + 1.28 * side;
        const li = (diskI(rrTop, -ang) * top * 1.1 + diskI(rrBot, ang) * bot) * dop;
        I += li;
        heat += li * smoothstep(5, 2, rrTop);
        dopW += li * side;
      }
      const halo = q > 1 ? Math.exp(-(q - 1) / 1.2) * 0.05 : 0;
      let tcol = 0;
      if (I > 1e-4) tcol = clamp01(0.55 * (heat / I) + 0.75 * (dopW / I) - 0.2);
      mix3(c, cool, mid, smoothstep(0.0, 0.5, tcol));
      mix3(c, c, hot, smoothstep(0.5, 1.0, tcol));
      const i = (y * S + x) * 3;
      buf[i] = c[0] * I + cool[0] * halo;
      buf[i + 1] = c[1] * I + cool[1] * halo;
      buf[i + 2] = c[2] * I + cool[2] * halo;
    }
    yield;
  }
  yield* boxBlur(buf, S, S, 3, 1);
  const bloom = yield* makeBloom(buf, S, S, 6, 3, 0.7, yA, yB);
  const px = yield* finalizeAdd(buf, S, S, seed, {
    peak: 0.7, gain: d.brightness, cap: SPRITE_CAP, bloom, y0: yA, y1: yB,
    win: (x, y) => {
      const ppx = x + 0.5 - S / 2;
      const ppy = y + 0.5 - S / 2;
      if (ppx < cull.x0 * rs || ppx > cull.x1 * rs || ppy < cull.y0 * rs || ppy > cull.y1 * rs) return 0;
      return win(ppx, ppy);
    },
    // Photon ring after the tonemap so the knee does not flatten it (cap keeps it <= 0.6).
    post: (x, y, o) => {
      const ppx = x + 0.5 - S / 2;
      const ppy = y + 0.5 - S / 2;
      const q = hyp(ppx, ppy) / Rs;
      if (q < 0.85 || q > 1.3) return;
      const ang = Math.atan2(-ppx * sr + ppy * cr, ppx * cr + ppy * sr);
      const side = 0.5 + 0.5 * Math.cos(ang - Math.PI);
      const pr = Math.exp(-Math.pow((q - 1.035) / 0.028, 2)) * (0.25 + 0.75 * side) * 0.8;
      o[0] += hot[0] * pr;
      o[1] += hot[1] * pr;
      o[2] += hot[2] * pr;
    },
  });
  const light = yield* cropSprite(px, S, S, true, 6, 1 / rs, 'source-over');
  // Occluder: the shadow hides the nebula and stars behind it.
  const O = Math.ceil(Rs * 2.4);
  const occ = new Float32Array(O * O * 4);
  for (let y = 0; y < O; y++) {
    for (let x = 0; x < O; x++) {
      const dd = hyp(x + 0.5 - O / 2, y + 0.5 - O / 2) / Rs;
      occ[(y * O + x) * 4 + 3] = 1 - smoothstep(0.9, 1.12, dd);
    }
  }
  const opx = yield* finalizeRGBA(occ, O, O, seed + 1);
  return [yield* cropSprite(opx, O, O, true, 3, 1 / rs, 'source-over'), light];
}

/**
 * The storm's heart: log-spiral maelstrom of band-limited ridged filaments
 * around a bright eye ring. Returns [outer layers, spinning core].
 */
function* genVortex(d: Extract<CenterDef, { kind: 'vortex' }>, seed: number, rs: number, cull: Rect): Gen<{ layers: Sprite<RawImage>[]; core: Sprite<RawImage> }> {
  const S = Math.round(d.size * 1080 * rs);
  const R = S / 2;
  const dark = hexRGB(d.dark);
  const mid = hexRGB(d.mid);
  const hi = hexRGB(d.hi);
  const eye = hexRGB(d.eye);
  const PER = d.per;
  const twistN = Math.sqrt(1 + d.twist * d.twist);
  const CORE = 0.3;
  const RMAX = 0.9;
  const inCullPx = (px: number, py: number, m: number) => px >= cull.x0 * rs - m && px <= cull.x1 * rs + m && py >= cull.y0 * rs - m && py <= cull.y1 * rs + m;
  // Smooth fields on a 0.6x grid (band-limited for that grid): ridge value, arm weight, broad glow.
  // They are B-spline magnified and only then sharpened (cubed) at full res, so ridges stay crisp.
  const FR = 0.5;
  const G = Math.ceil(S * FR);
  const field = new Float32Array(G * G * 3);
  const Rg = G / 2;
  // Warp + broad glow are very low frequency: a coarse polar-aware grid (G/4), bilinear.
  const Q = Math.ceil(G / 4) + 1;
  const low = new Float32Array(Q * Q * 2);
  for (let y = 0; y < Q; y++) {
    for (let x = 0; x < Q; x++) {
      const nx = ((x * 4 + 0.5) / G) * 2 - 1;
      const ny = ((y * 4 + 0.5) / G) * 2 - 1;
      const r = hyp(nx, ny);
      if (r > RMAX + 0.08) continue;
      const th = Math.atan2(ny, nx);
      const lr = Math.log(Math.max(r, 0.01));
      const a = ((th + d.twist * lr) / (2 * Math.PI)) * PER;
      const b = lr * 3.2;
      low[(y * Q + x) * 2] = fbm(a * 0.5, b * 0.5, PER / 2, 2, seed + 1);
      low[(y * Q + x) * 2 + 1] = 0.5 + 0.5 * fbm(a * 0.25, b * 0.4, PER / 4, 2, seed + 3);
    }
  }
  for (let y = 0; y < G; y++) {
    const sy = y / 4;
    const iy = Math.min(Q - 2, Math.floor(sy));
    const fy = sy - iy;
    for (let x = 0; x < G; x++) {
      const nx = ((x + 0.5) / G) * 2 - 1;
      const ny = ((y + 0.5) / G) * 2 - 1;
      const r = hyp(nx, ny);
      if (r > RMAX + 0.03 || (r > CORE + 0.05 && !inCullPx(nx * R, ny * R, 12))) continue;
      const th = Math.atan2(ny, nx);
      const lr = Math.log(Math.max(r, 0.01));
      const a = ((th + d.twist * lr) / (2 * Math.PI)) * PER; // periodic around the circle
      const b = lr * 3.2;
      const sx = x / 4;
      const ix = Math.min(Q - 2, Math.floor(sx));
      const fx = sx - ix;
      const p0 = (iy * Q + ix) * 2;
      const p1 = p0 + Q * 2;
      const w = (low[p0]! * (1 - fx) + low[p0 + 2]! * fx) * (1 - fy) + (low[p1]! * (1 - fx) + low[p1 + 2]! * fx) * fy;
      const broad = (low[p0 + 1]! * (1 - fx) + low[p0 + 3]! * fx) * (1 - fy) + (low[p1 + 1]! * (1 - fx) + low[p1 + 3]! * fx) * fy;
      // Local frequency of octave 0 in cycles per grid sample.
      const f0 = ((PER / (2 * Math.PI)) * twistN) / (Math.max(r, 0.02) * Rg);
      const rid = 1 - Math.abs(fbmBL(a + w * 3, b + w * 2, PER, 3, seed + 2, 0.5, f0));
      const ac = 0.5 + 0.5 * Math.cos(d.arms * (th + d.twist * lr) + w * 2.5);
      const i = (y * G + x) * 3;
      field[i] = rid;
      field[i + 1] = ac * Math.sqrt(ac);
      field[i + 2] = broad;
    }
    if ((y & 1) === 1) yield;
  }
  const buf = new Float32Array(S * S * 3);
  const c: RGB = [0, 0, 0];
  const yA = Math.max(0, Math.floor(R + Math.max(-RMAX * R, Math.min(cull.y0 * rs, -CORE * R))) - 1);
  const yB = Math.min(S, Math.ceil(R + Math.min(RMAX * R, Math.max(cull.y1 * rs, CORE * R))) + 1);
  const xA = Math.max(0, Math.floor(R + Math.max(-RMAX * R, Math.min(cull.x0 * rs, -CORE * R))) - 1);
  const xB = Math.min(S, Math.ceil(R + Math.min(RMAX * R, Math.max(cull.x1 * rs, CORE * R))) + 1);
  yield* bspline(field, G, G, 3, S, S, false, (y, row) => {
    const ny = ((y + 0.5) / S) * 2 - 1;
    for (let x = xA; x < xB; x++) {
      const nx = ((x + 0.5) / S) * 2 - 1;
      const r = Math.sqrt(nx * nx + ny * ny);
      if (r >= RMAX) continue;
      if (r > CORE && !inCullPx(nx * R, ny * R, 2)) continue;
      const rid = clamp01(row[x * 3]!);
      const armw = row[x * 3 + 1]!;
      const broad = row[x * 3 + 2]!;
      const fil = rid * rid * rid;
      const eo = 1 - smoothstep(0.3, RMAX, r);
      const env = smoothstep(0.1, 0.42, r) * eo * Math.sqrt(eo);
      const ridge = fil * (0.2 + 0.8 * armw);
      const I = env * (0.2 * broad * (0.4 + 0.6 * armw) + 0.75 * ridge);
      // Bronze-grey body; gold only on the ridge highlights.
      mix3(c, dark, mid, smoothstep(0.0, 0.3, I));
      mix3(c, c, hi, smoothstep(0.3, 1.0, ridge) * smoothstep(0.08, 0.3, I));
      const e1 = (r - 0.06) / 0.018;
      const e2 = (r - 0.06) / 0.06;
      const eyeGlow = r < 0.3 ? Math.exp(-e1 * e1) * 0.4 + Math.exp(-e2 * e2) * 0.06 : 0;
      const i = (y * S + x) * 3;
      buf[i] = c[0] * I * 1.4 + eye[0] * eyeGlow;
      buf[i + 1] = c[1] * I * 1.4 + eye[1] * eyeGlow;
      buf[i + 2] = c[2] * I * 1.4 + eye[2] * eyeGlow;
    }
  }, yA, yB);
  const bloom = yield* makeBloom(buf, S, S, 6, 3, 0.45, yA, yB);
  const rAt = (x: number, y: number) => hyp(((x + 0.5) / S) * 2 - 1, ((y + 0.5) / S) * 2 - 1);
  const coreW = (x: number, y: number) => 1 - smoothstep(0.2, CORE, rAt(x, y));
  const base: FinOpts = {
    peak: 0.5, gain: d.brightness, cap: SPRITE_CAP, bloom,
    win: (x, y) => {
      const r = rAt(x, y);
      if (r >= RMAX) return 0;
      return r <= CORE || inCullPx(x + 0.5 - R, y + 0.5 - R, 0) ? 1 : 0;
    },
  };
  const outer = yield* finalizeAdd(buf, S, S, seed, { ...base, weight: (x, y) => 1 - coreW(x, y), x0: xA, x1: xB, y0: yA, y1: yB });
  const cy0 = Math.max(0, Math.floor(R - CORE * R) - 2);
  const cy1 = Math.min(S, Math.ceil(R + CORE * R) + 2);
  const corePx = yield* finalizeAdd(buf, S, S, seed + 1, { ...base, weight: coreW, y0: cy0, y1: cy1, x0: cy0, x1: cy1 });
  return {
    layers: [yield* cropSprite(outer, S, S, true, 6, 1 / rs, 'source-over')],
    core: yield* cropSprite(corePx, S, S, true, 6, 1 / rs, 'source-over'),
  };
}

function ringDensity(rho: number, inner: number, outer: number, seed: number): number {
  const t = (rho - inner) / (outer - inner);
  if (t <= 0 || t >= 1) return 0;
  const edge = smoothstep(0, 0.05, t) * (1 - smoothstep(0.93, 1, t));
  const bands = 0.55 + 0.45 * fbm(t * 9, 0.5, BIG, 3, seed, 0.45);
  const fine = 0.9 + 0.1 * gnoise(t * 70, 0.5, BIG, BIG, seedOf(seed + 1));
  const cassini = 1 - 0.9 * Math.exp(-Math.pow((t - 0.64) / 0.028, 2));
  const enke = 1 - 0.6 * Math.exp(-Math.pow((t - 0.88) / 0.008, 2));
  const inn = 0.35 + 0.65 * smoothstep(0, 0.45, t);
  return clamp01(edge * bands * fine * cassini * enke * inn * 1.3);
}

/**
 * Backlit sphere: mostly silhouette with a crisp crescent and a thin bright
 * atmosphere rim; posterised bands for gas giants; optional rings (brighter
 * than the body: forward scattering) with mutual shadows. Bodies under 40 px
 * are silhouettes with a 1 px rim.
 */
function* genPlanet(p: PlanetDef, rs: number, cull: Rect | null): Gen<Sprite<RawImage>> {
  const R = p.radius * rs;
  const small = p.radius < 40;
  const ext = p.atmo ? p.atmo.extent : 0;
  let hx = R * (1 + ext * 1.5) + 2;
  let hy = hx;
  const ct = Math.cos(p.tilt);
  const st = Math.sin(p.tilt);
  if (p.ring) {
    const a = p.ring.outer * R;
    const b = a * p.ring.ratio;
    hx = Math.max(hx, Math.sqrt(a * a * ct * ct + b * b * st * st));
    hy = Math.max(hy, Math.sqrt(a * a * st * st + b * b * ct * ct));
  }
  const W = Math.ceil(hx * 2 + 6);
  const Hh = Math.ceil(hy * 2 + 6);
  const buf = new Float32Array(W * Hh * 4);
  // Work in the tilted frame (u along the ring major axis).
  const Ls = p.light;
  const ll = Math.hypot(Ls[0], Ls[1], Ls[2]);
  const L: RGB = [(Ls[0] * ct + Ls[1] * st) / ll, (-Ls[0] * st + Ls[1] * ct) / ll, Ls[2] / ll];
  const l2 = hyp(L[0], L[1]) || 1;
  const L2x = L[0] / l2;
  const L2y = L[1] / l2;
  const back = Math.max(0, -L[2]);
  const e = p.ring ? p.ring.ratio : 0.25;
  const se = Math.sqrt(1 - e * e);
  const N: RGB = [0, -se, e]; // ring plane normal == planet spin axis
  const Y2: RGB = [0, e, se];
  const cols = p.colors.map(hexRGB) as [RGB, RGB, RGB];
  const bands = (p.bands ?? p.colors).map(hexRGB);
  const atmoC = p.atmo ? hexRGB(p.atmo.color) : ([0.6, 0.66, 0.78] as RGB);
  const atmoS = p.atmo ? p.atmo.strength : 0.4;
  const ringC = p.ring ? hexRGB(p.ring.color) : ([0, 0, 0] as RGB);
  const glowC = p.glow ? hexRGB(p.glow.color) : ([0, 0, 0] as RGB);
  const rng = new Rng(p.seed * 977);
  const craters: { x: number; y: number; z: number; r: number; cosr: number }[] = [];
  for (let i = 0; i < (small ? 0 : (p.craters ?? 0)); i++) {
    const z = rng.range(-1, 1);
    const a = rng.next() * Math.PI * 2;
    const q = Math.sqrt(1 - z * z);
    const r = 0.06 + 0.22 * Math.pow(rng.next(), 2.5);
    craters.push({ x: q * Math.cos(a), y: q * Math.sin(a), z, r, cosr: Math.cos(r * 1.35) });
  }
  const c: RGB = [0, 0, 0];
  const LdN = L[0] * N[0] + L[1] * N[1] + L[2] * N[2];
  const nb = bands.length;
  // Ring density depends only on the ring radius: 1-D lookup table instead of noise per pixel.
  const RL = 2048;
  const ringLut = new Float32Array(RL + 1);
  if (p.ring) for (let i = 0; i <= RL; i++) ringLut[i] = ringDensity(p.ring.inner + ((p.ring.outer - p.ring.inner) * i) / RL, p.ring.inner, p.ring.outer, p.seed + 7);
  const ringAt = (rho: number): number => {
    if (!p.ring) return 0;
    const t = ((rho - p.ring.inner) / (p.ring.outer - p.ring.inner)) * RL;
    if (t <= 0 || t >= RL) return 0;
    const i = t | 0;
    return ringLut[i]! + (ringLut[i + 1]! - ringLut[i]!) * (t - i);
  };
  for (let y = 0; y < Hh; y++) {
    for (let x = 0; x < W; x++) {
      const px = x + 0.5 - W / 2;
      const py = y + 0.5 - Hh / 2;
      if (cull && (px < cull.x0 * rs || px > cull.x1 * rs || py < cull.y0 * rs || py > cull.y1 * rs)) continue;
      const u = px * ct + py * st;
      const v = -px * st + py * ct;
      const d = hyp(u, v);
      let cr = 0;
      let cg = 0;
      let cb = 0;
      let ca = 0;
      const dir = d > 1e-3 ? (u * L2x + v * L2y) / d : 0;
      if (small) {
        if (d < R + 1.5) {
          const cov = clamp01(R - d + 0.5);
          const rimA = Math.exp(-Math.pow((R - d - 0.6) / 0.75, 2)) * smoothstep(-0.25, 0.75, dir) * atmoS * 1.1;
          cr = cols[0][0] * 0.5 * cov + atmoC[0] * rimA;
          cg = cols[0][1] * 0.5 * cov + atmoC[1] * rimA;
          cb = cols[0][2] * 0.5 * cov + atmoC[2] * rimA;
          ca = Math.max(cov, clamp01(rimA));
        }
      } else if (d < R + 1) {
        const cov = clamp01(R - d + 0.5);
        const nx = u / R;
        const ny = v / R;
        const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
        const lat = nx * N[0] + ny * N[1] + nz * N[2];
        let hgt: number;
        if (p.kind === 'gas') {
          const turb = fbm3(nx * 2.5, ny * 2.5, nz * 2.5, 2, p.seed) * 0.05 + fbm3(nx * 9, ny * 9, nz * 9, 1, p.seed + 1) * 0.012;
          const tt = lat + turb;
          hgt = 0.5 + 0.26 * Math.sin(tt * 9.0 + 0.6) + 0.14 * Math.sin(tt * 19.0 + 2.1) + 0.07 * Math.sin(tt * 41.0 + 0.3);
          const sx = (nx - 0.3) * 1.0;
          const sy = (lat + 0.34) * 2.6;
          hgt = lerp(hgt, 0.95, Math.exp(-(sx * sx + sy * sy) / 0.01) * 0.8);
          // Posterise into nb steps with short ramps (graphic, not muddy).
          const l = clamp01(hgt) * nb - 0.5;
          const i0 = Math.floor(l);
          const t = smoothstep(0.42, 0.58, l - i0);
          mix3(c, bands[Math.max(0, Math.min(nb - 1, i0))]!, bands[Math.max(0, Math.min(nb - 1, i0 + 1))]!, t);
        } else {
          hgt = 0.5 + 0.5 * fbm3(nx * 2.4, ny * 2.4, nz * 2.4, 4, p.seed) * 1.5;
          for (const k of craters) {
            const cd = nx * k.x + ny * k.y + nz * k.z;
            if (cd > k.cosr) {
              const t = Math.acos(Math.min(1, cd)) / k.r;
              hgt += t < 1 ? -0.22 * (1 - t * t) : 0;
              hgt += 0.16 * Math.exp(-Math.pow((t - 1) / 0.13, 2));
            }
          }
          hgt = clamp01(hgt);
          if (p.kind === 'ocean') {
            const land = smoothstep(0.55, 0.6, hgt);
            mix3(c, cols[0], cols[1], smoothstep(0.2, 0.55, hgt) * 0.6);
            mix3(c, c, cols[2], land * 0.7);
            const cloud = smoothstep(0.1, 0.5, fbm3(nx * 3 + 9, ny * 3 * 1.6, nz * 3, 3, p.seed + 5));
            mix3(c, c, [0.55, 0.68, 0.72], cloud * 0.6);
          } else {
            mix3(c, cols[0], cols[1], smoothstep(0.0, 0.55, hgt));
            mix3(c, c, cols[2], smoothstep(0.5, 1.0, hgt));
          }
        }
        const ndl = nx * L[0] + ny * L[1] + nz * L[2];
        const term = smoothstep(-0.06, 0.18, ndl);
        let diffuse = term * (0.35 + 0.65 * Math.max(0, ndl));
        if (p.ring && Math.abs(LdN) > 1e-3) {
          const qz = nz * R;
          const t = -(u * N[0] + v * N[1] + qz * N[2]) / LdN;
          if (t > 0) {
            const pr = hyp(u + t * L[0], (v + t * L[1]) * Y2[1] + (qz + t * L[2]) * Y2[2]) / R;
            diffuse *= 1 - 0.8 * p.ring.opacity * ringAt(pr);
          }
        }
        const shade = p.ambient + diffuse * 1.6;
        cr = c[0] * shade * p.brightness;
        cg = c[1] * shade * p.brightness;
        cb = c[2] * shade * p.brightness;
        if (p.glow) {
          const cracks = Math.pow(1 - Math.abs(fbm3(nx * 3.5, ny * 3.5, nz * 3.5, 4, p.seed + 9)), 14) * p.glow.amount;
          const night = 0.35 + 0.65 * (1 - term);
          cr += glowC[0] * cracks * night;
          cg += glowC[1] * cracks * night;
          cb += glowC[2] * cracks * night;
        }
        // Thin atmosphere rim inside the limb, strongest towards the light (forward scattering when backlit).
        const lit = smoothstep(-0.45, 0.6, dir) * (0.4 + 0.6 * back) + smoothstep(-0.1, 0.4, ndl) * (1 - back);
        const rim = Math.pow(1 - nz, 6) * lit * atmoS * 1.3;
        cr += atmoC[0] * rim;
        cg += atmoC[1] * rim;
        cb += atmoC[2] * rim;
        cr *= cov;
        cg *= cov;
        cb *= cov;
        ca = cov;
      }
      // Atmosphere halo just outside the limb.
      if (!small && d >= R - 1) {
        const xh = (d - R) / Math.max(1.5, R * Math.max(ext, 0.02));
        if (xh < 1) {
          const side = smoothstep(-0.45, 0.6, dir) * (0.4 + 0.6 * back) + smoothstep(-0.5, 0.7, dir) * (1 - back) * 0.5;
          const hh = Math.exp(-Math.max(0, xh) * 3.5) * (1 - Math.max(0, xh)) * side * atmoS * 0.9 * (1 - ca);
          cr += atmoC[0] * hh;
          cg += atmoC[1] * hh;
          cb += atmoC[2] * hh;
          ca += hh * 0.5;
        }
      }
      if (p.ring) {
        const rho = hyp(u, v / e) / R;
        if (rho > p.ring.inner && rho < p.ring.outer) {
          const zr = (se * v) / e;
          const zs = d < R ? Math.sqrt(R * R - d * d) : -Infinity;
          if (d >= R || zr > zs) {
            const dens = ringAt(rho) * p.ring.opacity;
            const pl = u * L[0] + v * L[1] + zr * L[2];
            let sh = 0;
            if (pl < 0) {
              const dist = Math.sqrt(Math.max(0, u * u + v * v + zr * zr - pl * pl));
              sh = 1 - smoothstep(R * 0.97, R * 1.03, dist);
            }
            const lit = (0.35 + 0.4 * Math.abs(LdN) + 0.75 * back) * (1 - 0.9 * sh);
            const k = lit * p.brightness * 1.25;
            cr = ringC[0] * k * dens + cr * (1 - dens);
            cg = ringC[1] * k * dens + cg * (1 - dens);
            cb = ringC[2] * k * dens + cb * (1 - dens);
            ca = dens + ca * (1 - dens);
          }
        }
      }
      const i = (y * W + x) * 4;
      const a = clamp01(ca);
      buf[i] = a > 1e-4 ? cr / a : 0;
      buf[i + 1] = a > 1e-4 ? cg / a : 0;
      buf[i + 2] = a > 1e-4 ? cb / a : 0;
      buf[i + 3] = a;
    }
    if ((y & 1) === 1) yield;
  }
  const px = yield* finalizeRGBA(buf, W, Hh, p.seed, OPAQUE_CAP);
  return yield* cropSprite(px, W, Hh, true, 3, 1 / rs, 'source-over');
}

function* genCenter(def: SectorDef, rs: number): Gen<{ layers: Sprite<RawImage>[]; core: Sprite<RawImage> | null }> {
  const d = def.center;
  const seed = def.seed * 13 + 3;
  const cull = centerCull(d.ax, d.ay);
  switch (d.kind) {
    case 'spiral':
      return { layers: yield* genSpiral(d, seed, rs, cull), core: null };
    case 'blackhole':
      return { layers: yield* genBlackHole(d, seed, rs, cull), core: null };
    case 'vortex':
      return yield* genVortex(d, seed, rs, cull);
    case 'planet':
      return { layers: [yield* genPlanet(d.planet, rs, cull)], core: null };
  }
}

/** Generation scales for a requested quality (backdropRef / 1080). */
function scalesFor(quality: number): { rs: number; tileRs: number } {
  const q = Math.max(0.25, Math.min(Q_CAP, quality));
  return { rs: q, tileRs: q };
}

function* genSector(index: number, quality: number, timings: Record<string, number>): Gen<SectorData<RawImage>> {
  const def = SECTORS[index]!;
  const { rs, tileRs } = scalesFor(quality);
  const timed = function* <T>(name: string, g: Gen<T>): Gen<T> {
    const t00 = performance.now();
    let r = g.next();
    let acc = performance.now() - t00;
    let mx = acc;
    while (!r.done) {
      yield;
      const t0 = performance.now();
      r = g.next();
      const dt = performance.now() - t0;
      acc += dt;
      if (dt > mx) mx = dt;
    }
    timings[name] = (timings[name] ?? 0) + acc;
    timings[name + 'MaxSlice'] = Math.max(timings[name + 'MaxSlice'] ?? 0, mx);
    return r.value;
  };
  const t0 = performance.now();
  const tile = yield* timed('tile', genTile(def, Math.round(TILE_W * tileRs), Math.round(TILE_H * tileRs), timings));
  const center = yield* timed('center', genCenter(def, rs));
  const planets: Sprite<RawImage>[] = [];
  for (const pl of def.planets) planets.push(yield* timed('planets', genPlanet(pl.def, rs, null)));
  timings.wall = performance.now() - t0;
  return { index, rs, tileRs, tile, center: center.layers, core: center.core, planets, timings };
}

/**
 * Synchronous, DOM-free generation of one sector (all images as RawImage).
 * For tools: profiling in Node, or baking the fixed-seed sectors to files at
 * build time (Steam build) instead of generating them at runtime.
 */
export function generateSectorSync(index: number, quality: number): { timings: Record<string, number>; images: RawImage[] } {
  const timings: Record<string, number> = {};
  const g = genSector(index, quality, timings);
  let r = g.next();
  while (!r.done) r = g.next();
  const images: RawImage[] = [];
  eachImage(r.value, (im) => images.push(im));
  return { timings, images };
}

// ───────────────────────────────────────────────────────── worker plumbing ──

interface GenRequest {
  id: number;
  index: number;
  quality: number;
}
interface GenReply {
  id: number;
  data: SectorData<RawImage | ImageBitmap>;
}

/** Minimal structural type of a dedicated worker's global scope (keeps this file on the DOM lib). */
export interface GalaxyWorkerScope {
  onmessage: ((ev: MessageEvent) => void) | null;
  postMessage(message: unknown, transfer: Transferable[]): void;
}

function mapSector<A, B>(s: SectorData<A>, f: (a: A) => B): SectorData<B> {
  const ms = (sp: Sprite<A>): Sprite<B> => ({ ...sp, pieces: sp.pieces.map((p) => ({ x: p.x, y: p.y, img: f(p.img) })) });
  return { ...s, tile: f(s.tile), center: s.center.map(ms), core: s.core ? ms(s.core) : null, planets: s.planets.map(ms) };
}
function eachImage<A>(s: SectorData<A>, f: (a: A) => void): void {
  f(s.tile);
  for (const sp of [...s.center, ...(s.core ? [s.core] : []), ...s.planets]) for (const p of sp.pieces) f(p.img);
}

/**
 * Worker entry: generate on request and post the images back as ImageBitmaps
 * (transferred, so the main thread does no pixel work at all), or as raw
 * buffers where createImageBitmap is unavailable in workers.
 *
 *   // src/render/galaxy.worker.ts
 *   import { runGalaxyWorker, type GalaxyWorkerScope } from './galaxy';
 *   runGalaxyWorker(self as unknown as GalaxyWorkerScope);
 */
export function runGalaxyWorker(scope: GalaxyWorkerScope): void {
  scope.onmessage = (ev: MessageEvent) => {
    const m = ev.data as GenRequest;
    const timings: Record<string, number> = {};
    const g = genSector(m.index, m.quality, timings);
    let r = g.next();
    while (!r.done) r = g.next();
    const raw = r.value;
    const canBitmap = typeof createImageBitmap === 'function' && typeof ImageData === 'function';
    if (!canBitmap) {
      const transfer: Transferable[] = [];
      eachImage(raw, (im) => transfer.push(im.data.buffer));
      scope.postMessage({ id: m.id, data: raw } satisfies GenReply, transfer);
      return;
    }
    const jobs: Promise<void>[] = [];
    const bitmaps = new Map<RawImage, ImageBitmap>();
    eachImage(raw, (im) => {
      jobs.push(createImageBitmap(new ImageData(im.data, im.w, im.h)).then((b) => void bitmaps.set(im, b)));
    });
    void Promise.all(jobs).then(() => {
      const out = mapSector(raw, (im) => bitmaps.get(im)!);
      const transfer: Transferable[] = [];
      eachImage(out, (b) => transfer.push(b));
      scope.postMessage({ id: m.id, data: out } satisfies GenReply, transfer);
    });
  };
}

// ─────────────────────────────────────────────────────────────── backdrop ──

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

/** RawImage -> canvas on the main thread, uploaded in strips (the chunked fallback path). */
function* uploadRaw(im: RawImage): Gen<HTMLCanvasElement> {
  const c = makeCanvas(im.w, im.h);
  const ctx = c.getContext('2d')!;
  const id = new ImageData(im.data, im.w, im.h);
  for (let y = 0; y < im.h; y += 192) {
    ctx.putImageData(id, 0, 0, 0, y, im.w, Math.min(192, im.h - y));
    yield;
  }
  return c;
}

/** Beat glow source sprite (<= 128 px): soft blob or ring. */
function makeGlow(pd: PulseDef): HTMLCanvasElement {
  const n = 128;
  const c = makeCanvas(n, n);
  const g = c.getContext('2d')!;
  const [r, gg, b] = hexRGB(pd.color).map((v) => Math.round(v * 255)) as RGB;
  const col = (a: number) => `rgba(${r},${gg},${b},${a})`;
  const grd = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  if (pd.ring > 0) {
    const k = pd.ring;
    grd.addColorStop(0, col(0));
    grd.addColorStop(Math.max(0, k - 0.22), col(0));
    grd.addColorStop(Math.max(0, k - 0.06), col(0.55));
    grd.addColorStop(k, col(1));
    grd.addColorStop(Math.min(1, k + 0.07), col(0.45));
    grd.addColorStop(1, col(0));
  } else {
    grd.addColorStop(0, col(1));
    grd.addColorStop(0.25, col(0.55));
    grd.addColorStop(0.6, col(0.12));
    grd.addColorStop(1, col(0));
  }
  g.fillStyle = grd;
  g.fillRect(0, 0, n, n);
  return c;
}

/** Warp-punch flash sprite (radial, tinted, pre-rendered once per warp target). */
function makeFlash(tint: string): HTMLCanvasElement {
  const n = 256;
  const c = makeCanvas(n, n);
  const g = c.getContext('2d')!;
  const [r, gg, b] = hexRGB(tint).map((v) => Math.round(lerp(v, 1, 0.35) * 255)) as RGB;
  const grd = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
  grd.addColorStop(0, `rgba(${r},${gg},${b},1)`);
  grd.addColorStop(0.35, `rgba(${r},${gg},${b},0.55)`);
  grd.addColorStop(1, `rgba(${r},${gg},${b},0)`);
  g.fillStyle = grd;
  g.fillRect(0, 0, n, n);
  return c;
}

interface SectorAssets extends SectorData<Img> {
  glow: HTMLCanvasElement | null;
}

interface Job {
  index: number;
  quality: number;
  gen: Gen<SectorAssets>;
  busy: number;
  slices: number;
  maxSlice: number;
  timings: Record<string, number>;
}

export type GalaxyEvent =
  /** A sector finished generating (and is now drawable). */
  | { t: 'ready'; sector: number; ms: number }
  /** Warp phases: start of spool (play the riser; the punch is due in `punchIn` s), tunnel, punch (boom + sector card), done. */
  | { t: 'warp-spool'; from: number; to: number; punchIn: number }
  | { t: 'warp-tunnel'; from: number; to: number }
  | { t: 'warp-punch'; from: number; to: number }
  | { t: 'warp-done'; from: number; to: number };

/** What the renderer needs to sync its own layers with the warp. */
export interface WarpFx {
  active: boolean;
  phase: 'spool' | 'tunnel' | 'arrive' | null;
  /** 0..1 over the whole warp (frozen while the tunnel holds for generation). */
  progress: number;
  /** True while the tunnel waits for the target sector to finish generating (extend the spawn calm if you like). */
  holding: boolean;
  /** 0..1: stretch the renderer's star layers radially into streaks by this much. */
  stretch: number;
  /** 0..1 multiplier for the renderer's grid alpha. */
  gridAlpha: number;
  /** Destination sector's warp tint. */
  tint: string;
}

export interface GalaxyOptions {
  /**
   * Generation scale relative to a 1080p-tall screen (backdropRef(w, h) / 1080).
   * Assets then blit exactly 1:1. Changes are also picked up automatically
   * from draw()'s h (debounced, regenerated in the background).
   */
  quality?: number;
  /** Max sectors kept in memory (current + prewarmed next). */
  keep?: number;
  /** Cheap motion: vortex core spin, beat-synced glows, comets. Off (reduced-motion setting) = fully static backdrop. */
  animate?: boolean;
  /** Warp punch flash and arrival overshoot at full strength. Off (reduced flashing) = a quarter of it. */
  flashes?: boolean;
  /** Module worker for off-main-thread generation (see runGalaxyWorker). null/absent = chunked main-thread fallback. */
  worker?: (() => Worker) | null;
  /** Main-thread fallback budget per update() (ms); doubled while a warp tunnel waits. */
  budgetMs?: number;
  onEvent?: (e: GalaxyEvent) => void;
}

const WARP_SPOOL = 0.3;
const WARP_TUNNEL = 0.55;
const PUNCH_S = 0.1;

interface Streak {
  a: number;
  r: number;
  sp: number;
  len: number;
}

export class GalaxyBackdrop {
  /** Current generation quality (backdropRef(w, h) / 1080). */
  quality: number;
  animate: boolean;
  flashes: boolean;
  onEvent: ((e: GalaxyEvent) => void) | null;
  /** Debug: bitmask of layers to draw (1 tile, 4 center, 8 planets, 16 glow+comets). */
  layerMask = 31;
  /** Per-sector generation stats (ms): busy = main-thread CPU, wall = request -> ready. */
  readonly genStats = new Map<number, { busy: number; slices: number; maxSlice: number; wall: number; worker: boolean; parts: Record<string, number> }>();

  private readonly keep: number;
  private readonly budget: number;
  private assets = new Map<number, SectorAssets>();
  private lastUse = new Map<number, number>();
  private useClock = 0;
  private jobs: Job[] = [];
  private worker: Worker | null = null;
  private inflight = new Map<number, { id: number; quality: number; t0: number }>();
  private nextId = 1;
  private cur = -1;
  private pendingSwap = -1;
  private fadeIn = 1;
  private warp: { from: number; to: number; t: number; dur: number; clock: number; held: number; phase: number } | null = null;
  private streaks: Streak[] = [];
  private flash: { tint: string; c: HTMLCanvasElement } | null = null;
  private coreCache: { c: HTMLCanvasElement; key: number; sector: number } | null = null;
  private wantQ = -1;
  private wantQT = 0;

  constructor(opts: GalaxyOptions = {}) {
    this.quality = opts.quality ?? 1;
    this.keep = opts.keep ?? 2;
    this.animate = opts.animate ?? true;
    this.flashes = opts.flashes ?? true;
    this.budget = opts.budgetMs ?? 3;
    this.onEvent = opts.onEvent ?? null;
    if (opts.worker) {
      try {
        this.worker = opts.worker();
        this.worker.onmessage = (ev: MessageEvent) => this.onWorker(ev.data as GenReply);
        this.worker.onerror = () => this.dropWorker();
      } catch {
        this.worker = null;
      }
    }
    const rng = new Rng(0xfeed);
    for (let i = 0; i < 260; i++) {
      const u = rng.next();
      this.streaks.push({ a: rng.next() * Math.PI * 2, r: rng.next(), sp: 0.5 + rng.next() * 1.1, len: 0.15 + 0.85 * u * u });
    }
  }

  get sector(): number {
    return this.cur;
  }
  isReady(i: number): boolean {
    return this.assets.has(i);
  }
  /** True while a worker (not the main thread) generates. */
  get usesWorker(): boolean {
    return this.worker !== null;
  }

  /** Free the worker and all images. */
  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    for (const a of this.assets.values()) closeAll(a);
    this.assets.clear();
    this.jobs = [];
    this.inflight.clear();
  }

  private emit(e: GalaxyEvent): void {
    this.onEvent?.(e);
  }
  private touch(i: number): void {
    this.lastUse.set(i, ++this.useClock);
  }
  private wanted(i: number): boolean {
    const a = this.assets.get(i);
    return !a || Math.abs(a.rs - scalesFor(this.quality).rs) > 1e-3;
  }

  /** Queue sector i for background generation (worker, else chunked main-thread jobs pumped by update()). */
  request(i: number): void {
    if (i < 0 || i >= SECTORS.length) return;
    this.touch(i);
    if (!this.wanted(i)) return;
    const q = this.quality;
    if (this.worker) {
      const f = this.inflight.get(i);
      if (f && Math.abs(f.quality - q) < 1e-3) return;
      const id = this.nextId++;
      this.inflight.set(i, { id, quality: q, t0: performance.now() });
      this.worker.postMessage({ id, index: i, quality: q } satisfies GenRequest);
      return;
    }
    const j = this.jobs.find((x) => x.index === i);
    if (j && Math.abs(j.quality - q) < 1e-3) return;
    if (j) this.jobs = this.jobs.filter((x) => x !== j);
    this.jobs.push(this.makeJob(i, q));
  }

  private makeJob(i: number, q: number): Job {
    const timings: Record<string, number> = {};
    const self = this;
    const gen = (function* (): Gen<SectorAssets> {
      const raw = yield* genSector(i, q, timings);
      const t0 = performance.now();
      const up = new Map<RawImage, HTMLCanvasElement>();
      const list: RawImage[] = [];
      eachImage(raw, (im) => list.push(im));
      for (const im of list) up.set(im, yield* uploadRaw(im));
      timings.upload = performance.now() - t0;
      return self.finish(mapSector(raw, (im) => up.get(im)! as Img));
    })();
    return { index: i, quality: q, gen, busy: 0, slices: 0, maxSlice: 0, timings };
  }

  private finish(d: SectorData<Img>): SectorAssets {
    const pd = SECTORS[d.index]!.center.pulse;
    return { ...d, glow: pd ? makeGlow(pd) : null };
  }

  private onWorker(r: GenReply): void {
    const f = this.inflight.get(r.data.index);
    if (!f || f.id !== r.id) {
      // Superseded (quality changed meanwhile): free it.
      eachImage(r.data, (im) => {
        if ('close' in im) im.close();
      });
      return;
    }
    this.inflight.delete(r.data.index);
    const data = r.data;
    let isRaw = false;
    eachImage(data, (im) => {
      if (!('close' in im)) isRaw = true;
    });
    let img: SectorData<Img>;
    if (isRaw) {
      // No createImageBitmap in the worker: one putImageData per image (still no pixel maths here).
      img = mapSector(data as SectorData<RawImage>, (im) => {
        const c = makeCanvas(im.w, im.h);
        c.getContext('2d')!.putImageData(new ImageData(im.data, im.w, im.h), 0, 0);
        return c as Img;
      });
    } else img = data as SectorData<ImageBitmap>;
    const wall = performance.now() - f.t0;
    this.genStats.set(data.index, { busy: 0, slices: 0, maxSlice: 0, wall, worker: true, parts: data.timings });
    this.install(this.finish(img), wall);
  }

  private dropWorker(): void {
    this.worker?.terminate();
    this.worker = null;
    const pending = [...this.inflight.keys()];
    this.inflight.clear();
    for (const i of pending) this.request(i);
  }

  private install(a: SectorAssets, ms: number): void {
    const old = this.assets.get(a.index);
    if (old) closeAll(old);
    this.assets.set(a.index, a);
    if (this.coreCache && this.coreCache.sector === a.index) this.coreCache = null;
    if (this.cur === a.index && !old) this.fadeIn = 0;
    this.evict();
    this.emit({ t: 'ready', sector: a.index, ms });
  }

  /** Synchronously generate sector i on the main thread (blocks ~0.3-0.5 s at 1080p). For the first sector at load / tests only. */
  prepare(i: number): void {
    this.touch(i);
    if (!this.wanted(i)) return;
    this.inflight.delete(i);
    let j = this.jobs.find((x) => x.index === i && Math.abs(x.quality - this.quality) < 1e-3);
    if (!j) {
      j = this.makeJob(i, this.quality);
      this.jobs.unshift(j);
    }
    while (!this.step(j));
  }

  /** Advance main-thread jobs for up to budgetMs. Returns true when none are left. */
  pump(budgetMs: number): boolean {
    const end = performance.now() + budgetMs;
    while (this.jobs.length && performance.now() < end) {
      const j = this.jobs[0]!;
      while (performance.now() < end) if (this.step(j)) break;
    }
    return this.jobs.length === 0;
  }

  /** Async convenience: generate in slices of sliceMs, yielding to the event loop between slices (or await the worker). */
  async prepareAsync(i: number, sliceMs = 6): Promise<void> {
    this.request(i);
    while (this.wanted(i)) {
      if (!this.worker) this.pump(sliceMs);
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  private step(j: Job): boolean {
    const t0 = performance.now();
    const r = j.gen.next();
    const dt = performance.now() - t0;
    j.busy += dt;
    j.slices++;
    if (dt > j.maxSlice) j.maxSlice = dt;
    if (r.done) {
      this.jobs = this.jobs.filter((x) => x !== j);
      this.genStats.set(j.index, { busy: j.busy, slices: j.slices, maxSlice: j.maxSlice, wall: j.timings.wall ?? 0, worker: false, parts: j.timings });
      this.install(r.value, j.busy);
      return true;
    }
    return false;
  }

  /** Drop least-recently-used sectors beyond `keep`; never the current one, the warp pair, or queued ones. */
  private evict(): void {
    if (this.assets.size <= this.keep) return;
    const pinned = new Set<number>([this.cur, this.pendingSwap, ...this.jobs.map((j) => j.index), ...this.inflight.keys()]);
    if (this.warp) {
      pinned.add(this.warp.from);
      pinned.add(this.warp.to);
    }
    const lru = [...this.assets.keys()].filter((k) => !pinned.has(k)).sort((a, b) => (this.lastUse.get(a) ?? 0) - (this.lastUse.get(b) ?? 0));
    for (const k of lru) {
      if (this.assets.size <= this.keep) break;
      closeAll(this.assets.get(k)!);
      this.assets.delete(k);
    }
  }

  /**
   * Switch sector. warp=true runs the ~2.2 s hyperspace transition (the
   * tunnel holds until the target is generated, so it never blocks). Without
   * warp: immediate if ready, otherwise swapped in (fading in from the plain
   * void if nothing was shown) as soon as it is ready; sync=true generates on
   * the spot instead (blocks; tools/tests). Always prewarms sector i+1.
   */
  setSector(i: number, opts: { warp?: boolean; duration?: number; sync?: boolean } = {}): void {
    // Already there (or already warping there): keep it, and drop any older pending swap.
    if (this.warp ? this.warp.to === i : i === this.cur) {
      this.pendingSwap = -1;
      return;
    }
    if (opts.warp && this.cur >= 0 && this.cur !== i) {
      this.request(i);
      const dur = opts.duration ?? 2.2;
      this.warp = { from: this.cur, to: i, t: 0, dur, clock: 0, held: 0, phase: 0 };
      this.pendingSwap = -1;
      if (!this.flash || this.flash.tint !== SECTORS[i]!.warpTint) this.flash = { tint: SECTORS[i]!.warpTint, c: makeFlash(SECTORS[i]!.warpTint) };
      this.emit({ t: 'warp-spool', from: this.cur, to: i, punchIn: WARP_TUNNEL * dur });
      // i + 1 is prewarmed when the warp is done (requesting it now would evict it again at once: the warp pins both ends).
      return;
    }
    this.warp = null;
    if (this.assets.has(i)) {
      this.cur = i;
      this.pendingSwap = -1;
    } else if (opts.sync) {
      this.prepare(i);
      this.cur = i;
      this.pendingSwap = -1;
    } else {
      this.pendingSwap = i;
      this.request(i);
    }
    this.touch(i);
    this.request(i + 1);
    this.evict();
  }

  /** Change generation quality (backdropRef(w, h) / 1080): regenerates in the background, keeps drawing the old images scaled meanwhile. */
  setQuality(q: number): void {
    if (Math.abs(scalesFor(q).rs - scalesFor(this.quality).rs) < 1e-3) {
      this.quality = q;
      return;
    }
    this.quality = q;
    this.jobs = this.jobs.filter((j) => j.index === this.cur || j.index === this.cur + 1);
    for (const i of [this.cur, this.cur + 1, ...(this.warp ? [this.warp.to] : [])]) if (i >= 0) this.request(i);
  }

  /** Per frame (real time): advances the warp, swaps pending sectors, applies debounced resizes, pumps fallback generation. */
  update(dt: number): void {
    if (this.wantQ > 0) {
      this.wantQT -= dt;
      if (this.wantQT <= 0) {
        const q = this.wantQ;
        this.wantQ = -1;
        this.setQuality(q);
      }
    }
    if (this.fadeIn < 1) this.fadeIn = Math.min(1, this.fadeIn + dt / 0.6);
    let holding = false;
    const W = this.warp;
    if (W) {
      W.clock += dt;
      const holdAt = WARP_TUNNEL * W.dur - 1e-4;
      let t = W.t + dt;
      if (t >= holdAt && !this.assets.has(W.to)) {
        t = Math.max(W.t, holdAt);
        W.held += dt;
        holding = true;
      }
      W.t = t;
      const p = t / W.dur;
      if (W.phase === 0 && p >= WARP_SPOOL) {
        W.phase = 1;
        this.emit({ t: 'warp-tunnel', from: W.from, to: W.to });
      }
      if (W.phase === 1 && p >= WARP_TUNNEL) {
        W.phase = 2;
        this.cur = W.to;
        this.touch(W.to);
        this.emit({ t: 'warp-punch', from: W.from, to: W.to });
      }
      if (t >= W.dur) {
        this.warp = null;
        this.cur = W.to;
        this.emit({ t: 'warp-done', from: W.from, to: W.to });
        this.request(W.to + 1);
        this.evict();
      }
    }
    if (this.pendingSwap >= 0 && this.assets.has(this.pendingSwap)) {
      if (this.cur < 0 || !this.assets.has(this.cur)) this.fadeIn = 0;
      this.cur = this.pendingSwap;
      this.pendingSwap = -1;
      this.request(this.cur + 1);
      this.evict();
    }
    if (this.jobs.length) this.pump(holding ? this.budget * 2.3 : this.budget);
  }

  /** Warp state for the renderer's own layers (stars, grid). */
  get warpFx(): WarpFx {
    const W = this.warp;
    if (!W) return { active: false, phase: null, progress: -1, holding: false, stretch: 0, gridAlpha: 1, tint: '#ffffff' };
    const p = clamp01(W.t / W.dur);
    const env = smoothstep(0.08, WARP_SPOOL, p) * (1 - smoothstep(WARP_TUNNEL, WARP_TUNNEL + 0.2, p));
    return {
      active: true,
      phase: p < WARP_SPOOL ? 'spool' : p < WARP_TUNNEL ? 'tunnel' : 'arrive',
      progress: p,
      holding: p >= WARP_TUNNEL - 0.01 && p < WARP_TUNNEL && !this.assets.has(W.to),
      stretch: env,
      gridAlpha: 1 - 0.85 * smoothstep(0.05, WARP_SPOOL, p) * (1 - smoothstep(WARP_TUNNEL + 0.05, 0.9, p)),
      tint: SECTORS[W.to]!.warpTint,
    };
  }

  /** Debug/harness: show a warp frozen at progress p (both sectors generated synchronously). */
  setWarpPreview(from: number, to: number, p: number, clock = p * 2.2): void {
    this.prepare(from);
    this.prepare(to);
    this.cur = p >= WARP_TUNNEL ? to : from;
    this.warp = { from, to, t: p * 2.2, dur: 2.2, clock, held: 0, phase: p < WARP_SPOOL ? 0 : p < WARP_TUNNEL ? 1 : 2 };
    if (!this.flash || this.flash.tint !== SECTORS[to]!.warpTint) this.flash = { tint: SECTORS[to]!.warpTint, c: makeFlash(SECTORS[to]!.warpTint) };
  }
  /** Debug/harness: end any warp. */
  clearWarp(): void {
    this.warp = null;
  }

  /**
   * Draw the backdrop (replaces the old base fill + radial nebula). Call
   * first each frame, before the renderer's stars/grid. k = world -> device
   * px (the zoom-aware one), w/h device px, time in seconds (real time),
   * intensity 0..1 (busy screen -> dimmer centerpiece/planets), beat 0..1.
   */
  draw(
    ctx: CanvasRenderingContext2D, camX: number, camY: number, k: number, w: number, h: number, time: number,
    opts: { intensity?: number; beat?: number } = {},
  ): void {
    const ref = backdropRef(w, h);
    const q = ref / 1080;
    if (Math.abs(scalesFor(q).rs - scalesFor(this.quality).rs) > 1e-3) {
      if (Math.abs(q - this.wantQ) > 1e-3) {
        this.wantQ = q;
        this.wantQT = 0.4;
      }
    } else this.wantQ = -1;
    const intensity = clamp01(opts.intensity ?? 0);
    const beat = clamp01(opts.beat ?? 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingEnabled = true;
    const W = this.warp;
    if (!W) {
      const cur = this.assets.get(this.cur);
      if (!cur) {
        ctx.fillStyle = '#05040f';
        ctx.fillRect(0, 0, w, h);
        return;
      }
      this.drawSector(ctx, cur, camX, camY, k, w, h, time, 1, intensity, beat, 0);
      if (this.fadeIn < 1) {
        ctx.globalAlpha = 1 - this.fadeIn;
        ctx.fillStyle = '#05040f';
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
      }
      return;
    }
    const p = clamp01(W.t / W.dur);
    if (p < WARP_SPOOL) {
      // Spool: the old sector zooms in (ease-in) and darkens.
      const a = p / WARP_SPOOL;
      const from = this.assets.get(W.from);
      if (from) this.drawSector(ctx, from, camX, camY, k, w, h, time, 1 + 0.25 * a * a * a, intensity, beat, 0);
      else {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, w, h);
      }
      ctx.globalAlpha = 0.94 * smoothstep(0, 1, a);
      ctx.fillStyle = '#010104';
      ctx.fillRect(0, 0, w, h);
    } else if (p < WARP_TUNNEL) {
      ctx.fillStyle = '#010104';
      ctx.fillRect(0, 0, w, h);
    } else {
      // Arrival: the new sector zooms out (ease-out) from 1.3, centerpiece overshoots in brightness.
      const a = (p - WARP_TUNNEL) / (1 - WARP_TUNNEL);
      const e = 1 - Math.pow(1 - a, 3);
      const to = this.assets.get(W.to);
      if (to) {
        const boost = (this.flashes ? 0.7 : 0.25) * Math.sin(Math.PI * Math.min(1, a * 1.4)) * (1 - a);
        this.drawSector(ctx, to, camX, camY, k, w, h, time, 1.3 - 0.3 * e, intensity, beat, boost);
      }
      const dark = 0.9 * (1 - smoothstep(0, 0.55, a));
      if (dark > 0.01) {
        ctx.globalAlpha = dark;
        ctx.fillStyle = '#010104';
        ctx.fillRect(0, 0, w, h);
      }
    }
    ctx.globalAlpha = 1;
    this.drawStreaks(ctx, w, h, p, W.clock, SECTORS[W.to]!.warpTint);
    // Punch: 100 ms tinted flash (pre-rendered sprite, <= 0.35 alpha near the player).
    const tp = (p - WARP_TUNNEL) * W.dur;
    if (tp >= 0 && tp < PUNCH_S && this.flash) {
      const D = hyp(w, h) * 1.1;
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (this.flashes ? 0.35 : 0.09) * (1 - tp / PUNCH_S);
      ctx.drawImage(this.flash.c, w / 2 - D / 2, h / 2 - D / 2, D, D);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Hyperspace streaks: 260 radial lines in the target tint with white heads.
   * Exactly two stroke() calls (body + heads): in software rasterisers each
   * stroke() has a large fixed cost, so lines are batched into one path each.
   */
  private drawStreaks(ctx: CanvasRenderingContext2D, w: number, h: number, p: number, clock: number, tint: string): void {
    const env = smoothstep(0.08, WARP_SPOOL, p) * (1 - smoothstep(WARP_TUNNEL, WARP_TUNNEL + 0.17, p));
    if (env <= 0.01) return;
    const diag = hyp(w, h) / 2;
    const bs = Math.max(0.6, backdropRef(w, h) / 1080);
    const cx = w / 2;
    const cy = h / 2;
    const tc = hexRGB(tint);
    const body = `rgb(${Math.round(tc[0] * 255)},${Math.round(tc[1] * 255)},${Math.round(tc[2] * 255)})`;
    const head = `rgb(${Math.round(lerp(tc[0], 1, 0.75) * 255)},${Math.round(lerp(tc[1], 1, 0.75) * 255)},${Math.round(lerp(tc[2], 1, 0.75) * 255)})`;
    // Speed ramps up through the spool, peaks in the tunnel.
    const speed = 0.35 + 1.2 * smoothstep(0.1, 0.45, p);
    // source-over, not 'lighter': over the (mostly black) tunnel it looks the same and strokes cost half.
    ctx.globalCompositeOperation = 'source-over';
    ctx.lineCap = 'butt';
    for (let pass = 0; pass < 2; pass++) {
      ctx.strokeStyle = pass ? head : body;
      ctx.globalAlpha = (pass ? 0.85 : 0.6) * env;
      ctx.lineWidth = (pass ? 3.4 : 2.0) * bs;
      ctx.beginPath();
      for (const s of this.streaks) {
        const rr = (s.r + clock * s.sp * speed * 0.5) % 1;
        const R0 = (0.06 + 1.05 * rr * rr) * diag;
        if (R0 > diag * 1.02) continue;
        const L = Math.min(0.6, s.len * (0.1 + 0.9 * rr) * (0.25 + 0.75 * env)) * diag;
        const ca = Math.cos(s.a);
        const sa = Math.sin(s.a);
        const H0 = pass ? R0 + L * 0.88 : R0;
        ctx.moveTo(cx + ca * H0, cy + sa * H0);
        ctx.lineTo(cx + ca * (R0 + L), cy + sa * (R0 + L));
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  private drawSector(
    ctx: CanvasRenderingContext2D, A: SectorAssets, camX: number, camY: number, k: number, w: number, h: number,
    time: number, zoom: number, intensity: number, beat: number, boost: number,
  ): void {
    const ref = backdropRef(w, h);
    const bs = ref / 1080;
    const cx = w / 2;
    const cy = h / 2;
    ctx.setTransform(zoom, 0, 0, zoom, cx * (1 - zoom), cy * (1 - zoom));
    const vx0 = cx - cx / zoom;
    const vy0 = cy - cy / zoom;
    const vx1 = cx + cx / zoom;
    const vy1 = cy + cy / zoom;
    const z1 = zoom === 1;
    const def = SECTORS[A.index]!;

    // Tile (opaque).
    if (this.layerMask & 1) {
      // On a tall portrait screen the tile is drawn larger than bs so one tile still covers most of the height.
      const sc = Math.max(ref, h / 1.5) / 1080 / A.tileRs;
      const tw = A.tile.width * sc;
      const th = A.tile.height * sc;
      const par = 0.045;
      const ox = cx - camX * par * k;
      const oy = cy - camY * par * k;
      const x0 = vx0 - ((((vx0 - ox) % tw) + tw) % tw);
      const y0 = vy0 - ((((vy0 - oy) % th) + th) % th);
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      if (z1 && Math.abs(sc - 1) < 1e-3) {
        ctx.imageSmoothingEnabled = false;
        for (let y = Math.round(y0); y < vy1; y += th) for (let x = Math.round(x0); x < vx1; x += tw) ctx.drawImage(A.tile, x, y);
        ctx.imageSmoothingEnabled = true;
      } else {
        // Scaled (warp zoom / pending resize): nearest sampling is ~2x cheaper in software rasterisers and invisible on soft gas in motion.
        ctx.imageSmoothingEnabled = zoom === 1;
        for (let y = y0; y < vy1; y += th) for (let x = x0; x < vx1; x += tw) ctx.drawImage(A.tile, x, y, tw + 0.5, th + 0.5);
        ctx.imageSmoothingEnabled = true;
      }
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(vx0, vy0, vx1 - vx0, vy1 - vy0);
    }

    const dim = 1 - 0.35 * intensity;
    // Centerpiece: low parallax, one-sided clamp (<= INWARD h towards the centre, soft OUTWARD h away).
    const d = def.center;
    const clampAxis = (a: number, off: number) => {
      const [lo, hi] = driftRange(a);
      const v = off / ref;
      return (v < 0 ? lo * Math.tanh(v / lo) : hi * Math.tanh(v / hi)) * ref;
    };
    // Anchors keep their distance (in ref units) from the nearest top / bottom edge, so a portrait screen
    // shows the same corner composition (and nothing outside the generated cull rect).
    const ay = d.ay < 0.5 ? d.ay * ref : h - (1 - d.ay) * ref;
    const px = cx + (d.ax - 0.5) * w + clampAxis(d.ax, -camX * d.parallax * k);
    const py = ay + clampAxis(d.ay, -camY * d.parallax * k);
    const drawSprite = (S: Sprite<Img>, x: number, y: number, alpha: number) => {
      ctx.globalCompositeOperation = S.op;
      ctx.globalAlpha = alpha;
      const sc = S.unit * bs;
      if (z1 && Math.abs(sc - 1) < 1e-3) {
        ctx.imageSmoothingEnabled = false;
        const rx = Math.round(x);
        const ry = Math.round(y);
        for (const pc of S.pieces) {
          const X = rx + pc.x;
          const Y = ry + pc.y;
          if (X > vx1 || Y > vy1 || X + pc.img.width < vx0 || Y + pc.img.height < vy0) continue;
          ctx.drawImage(pc.img, X, Y);
        }
        ctx.imageSmoothingEnabled = true;
      } else {
        for (const pc of S.pieces) {
          const X = x + pc.x * sc;
          const Y = y + pc.y * sc;
          const ww = pc.img.width * sc;
          const hh = pc.img.height * sc;
          if (X > vx1 || Y > vy1 || X + ww < vx0 || Y + hh < vy0) continue;
          ctx.drawImage(pc.img, X, Y, ww, hh);
        }
      }
    };
    if (this.layerMask & 4) {
      for (const L of A.center) drawSprite(L, px, py, dim);
      if (A.core) this.drawCore(ctx, A, px, py, bs, z1, time, dim, d.spin ?? 0);
      if (boost > 0.01) {
        // Arrival overshoot: the centerpiece once more, additively.
        for (const L of A.center) drawSprite({ ...L, op: 'lighter' }, px, py, boost);
      }
    }
    if (this.layerMask & 16) {
      if (A.glow && d.pulse) {
        const pd = d.pulse;
        const D = pd.r * 2 * bs;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = (pd.base + (this.animate ? pd.amp * beat : 0)) * dim;
        ctx.drawImage(A.glow, px + pd.x * bs - D / 2, py + pd.y * bs - D / 2, D, D);
      }
      if (this.animate) this.drawComet(ctx, A.index, w, h, time, bs);
    }
    // Planets: parallax <= 0.15, wrapped on a large period so they recur rarely. A body drifting
    // over the central play ellipse fades to a dim silhouette, so its lit rim never sits behind the action.
    if (this.layerMask & 8) {
      const ex = (PLAY_ELLIPSE.w * w) / 2;
      const ey = (PLAY_ELLIPSE.h * h) / 2;
      for (let i = 0; i < A.planets.length; i++) {
        const P = A.planets[i]!;
        const pl = def.planets[i]!;
        const perX = 4.2 * ref;
        const perY = 3.2 * ref;
        let ox = pl.x * ref - camX * pl.parallax * k;
        let oy = pl.y * ref - camY * pl.parallax * k;
        ox -= perX * Math.round(ox / perX);
        oy -= perY * Math.round(oy / perY);
        const R = Math.max(P.hw, P.hh) * P.unit * bs * 0.8;
        const q = hyp(ox / (ex + R), oy / (ey + R));
        drawSprite(P, cx + ox, cy + oy, dim * (0.2 + 0.8 * smoothstep(1.05, 1.9, q)));
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /** Vortex core: rotated into a cached canvas every 8 frames (edge moves < 1 px in between), blitted 1:1. */
  private drawCore(
    ctx: CanvasRenderingContext2D, A: SectorAssets, px: number, py: number, bs: number, z1: boolean, time: number, alpha: number, spin: number,
  ): void {
    const core = A.core!;
    // Bounding square of the core pieces.
    let ext = 0;
    for (const pc of core.pieces) ext = Math.max(ext, Math.abs(pc.x), Math.abs(pc.y), Math.abs(pc.x + pc.img.width), Math.abs(pc.y + pc.img.height));
    const n = Math.ceil(ext * 2) + 4;
    const key = this.animate && spin ? Math.floor((time * 60) / 8) : 0;
    let cc = this.coreCache;
    if (!cc || cc.sector !== A.index || cc.c.width !== n) {
      cc = this.coreCache = { c: makeCanvas(n, n), key: -1, sector: A.index };
    }
    if (cc.key !== key) {
      const g = cc.c.getContext('2d')!;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, n, n);
      const ang = ((key * 8) / 60) * spin;
      const c = Math.cos(ang);
      const s = Math.sin(ang);
      g.setTransform(c, s, -s, c, n / 2, n / 2);
      g.imageSmoothingEnabled = true;
      for (const pc of core.pieces) g.drawImage(pc.img, pc.x, pc.y);
      cc.key = key;
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = alpha;
    const sc = core.unit * bs;
    if (z1 && Math.abs(sc - 1) < 1e-3) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(cc.c, Math.round(px) - n / 2, Math.round(py) - n / 2);
      ctx.imageSmoothingEnabled = true;
    } else ctx.drawImage(cc.c, px - (n / 2) * sc, py - (n / 2) * sc, n * sc, n * sc);
  }

  /** An occasional comet: one gradient line, ~1.2 s, every ~15-30 s. Deterministic in time. */
  private drawComet(ctx: CanvasRenderingContext2D, sector: number, w: number, h: number, time: number, bs: number): void {
    const PERIOD = 19;
    const n = Math.floor(time / PERIOD);
    const hsh = hash2(n, sector, 0xc0e7);
    if ((hsh & 3) === 0) return;
    const start = ((hsh >>> 2) & 1023) / 1023 * (PERIOD - 2);
    const life = 1.2;
    const t = time - n * PERIOD - start;
    if (t < 0 || t > life) return;
    // Only in the top / bottom bands, travelling roughly horizontally: never across the play area.
    const r = new Rng(hsh);
    const sx = r.range(0.1, 0.9) * w;
    const sy = (r.next() < 0.5 ? r.range(0.04, 0.2) : r.range(0.8, 0.96)) * h;
    const ang = r.range(0.05, 0.3) * (r.next() < 0.5 ? 1 : -1) + (r.next() < 0.5 ? 0 : Math.PI);
    const speed = 0.55 * 1080 * bs;
    const u = t / life;
    const hx = sx + Math.cos(ang) * speed * t;
    const hy = sy + Math.sin(ang) * speed * t;
    const len = 0.16 * 1080 * bs;
    const tx = hx - Math.cos(ang) * len;
    const ty = hy - Math.sin(ang) * len;
    const a = Math.sin(Math.PI * u) * 0.55;
    const g = ctx.createLinearGradient(tx, ty, hx, hy);
    g.addColorStop(0, 'rgba(220,235,255,0)');
    g.addColorStop(1, `rgba(235,245,255,${a.toFixed(3)})`);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 1;
    ctx.strokeStyle = g;
    ctx.lineWidth = 1.3 * Math.max(1, bs);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(hx, hy);
    ctx.stroke();
  }

  /** Approximate resident memory of generated images (bytes). */
  memoryBytes(): number {
    let b = 0;
    for (const a of this.assets.values()) {
      eachImage(a, (im) => (b += im.width * im.height * 4));
      if (a.glow) b += a.glow.width * a.glow.height * 4;
    }
    if (this.coreCache) b += this.coreCache.c.width * this.coreCache.c.height * 4;
    return b;
  }
}

function closeAll(a: SectorAssets): void {
  eachImage(a, (im) => {
    if ('close' in im) im.close();
  });
}
