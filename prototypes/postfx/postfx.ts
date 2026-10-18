/**
 * SHARDSTORM — WebGL2 post-processing.
 *
 * Takes the finished Canvas2D world frame as a texture every frame and draws
 * the final image into a visible WebGL2 canvas:
 *
 *   src (W x H, uploaded with texSubImage2D)
 *     └─ prefilter: soft-knee bright pass + 4-tap box down  → L0 (W/2 or W/4)
 *         └─ dual-Kawase down  L0 → L1 → … → Ln
 *         └─ dual-Kawase up, additively blended back       Ln → … → L0 (= bloom)
 *         └─ anamorphic streak: 3 widening horizontal passes from L1 (optional)
 *   composite (output res): shockwave refraction (≤ 8 rings), radial chromatic
 *   aberration (event spikes only), bloom + event-only lens streaks, additive
 *   tinted flash, low-HP edge pressure, hue-preserving soft-shoulder tone map,
 *   vignette, film grain (doubles as dither so the bloom gradients do not band).
 *
 * The source may be smaller than the output (renderScale < 1 at the lowest
 * auto-quality rung): the composite upsamples it with bilinear filtering.
 *
 * The module knows nothing about the game: waves are given in "source
 * units" mapped to source-canvas pixels by setView(k, ox, oy) — pass the
 * renderer's world transform and waves stick to the world while the camera moves.
 *
 * Failure model: PostFx.create returns null without WebGL2. On context loss
 * `active` turns false and `onActiveChange` fires; the caller should draw the
 * plain 2D canvas instead until it fires again with true (restored).
 */

export type FxQuality = 0 | 1 | 2 | 3;

export interface PostFxSettings {
  /** Master bloom strength (0 disables the bloom chain entirely). */
  bloom: number;
  /** Bright-pass threshold on max(r,g,b), 0..1. */
  threshold: number;
  /** Soft-knee half width around the threshold. */
  knee: number;
  /** false = "reduced flashing": no chromatic aberration, no bloom surges or streaks, softer shockwaves. */
  flashes: boolean;
  /** Screen-shake setting 0..1; scales shockwave refraction strength. */
  shake: number;
  vignette: number;
  grain: number;
  /** Anamorphic lens-streak gain. Streaks only appear during bloom surges (kickBloom). */
  streaks: number;
  /** 'auto' adapts quality to frame time; a number pins it. */
  quality: 'auto' | FxQuality;
  /**
   * Upper bound for the world render scale (1 = native device px). The auto ladder
   * may lower the effective scale further (see `renderScale`).
   */
  renderScale: number;
}

export const DEFAULT_POSTFX: PostFxSettings = {
  bloom: 1,
  threshold: 0.6,
  knee: 0.1,
  flashes: true,
  shake: 1,
  vignette: 1,
  grain: 1,
  streaks: 1,
  quality: 'auto',
  renderScale: 1,
};

/** Effective world scale on the lowest auto rung (with the renderer's DPR cap of 2 this caps world px at 1.5x CSS px). */
export const LOW_RENDER_SCALE = 0.75;

export interface ShockwaveOpts {
  /** Final radius in source units. */
  radius: number;
  /** Lifetime in seconds. */
  duration?: number;
  /** Peak refraction in device px at radius 0 (fades with life). */
  strength?: number;
  /** Ring band half-width in source units. */
  thickness?: number;
  /** Extra brightening of the wavefront (0..1), suppressed when flashes are reduced. */
  glow?: number;
  /**
   * Major waves (boss death, bomb, player death, boss kill) always play. Others
   * draw from a budget of ~3 per second (burst 3), so a missile swarm cannot
   * turn the screen into jelly; over budget they are dropped.
   */
  major?: boolean;
}

export interface PostFxStats {
  quality: FxQuality;
  /** JS time spent inside the last render() call (upload + command submission). */
  cpuMs: number;
  /** Part of cpuMs spent in texSubImage2D (forces the 2D canvas raster on software paths). */
  uploadMs: number;
  /** EMA of frame time fed through reportFrameTime(). */
  frameMs: number;
  waves: number;
  /** Minor waves dropped by the budget since creation. */
  wavesDropped: number;
  halfFloat: boolean;
  /** Effective world render scale (1, or LOW_RENDER_SCALE on the lowest rung). */
  renderScale: number;
}

interface Wave {
  x: number;
  y: number;
  t: number;
  dur: number;
  radius: number;
  strength: number;
  thick: number;
  glow: number;
}

interface Target {
  tex: WebGLTexture;
  fb: WebGLFramebuffer;
  w: number;
  h: number;
}

const MAX_WAVES = 8;
/** How much of the tight half-res blur survives into the final bloom (crisp small shapes). */
const L0_KEEP = 0.3;
const LN_KEEP = 0.9;
/** Up-chain weight for level i; the widest levels are damped so big bright areas do not veil the screen. */
const upWeight = (i: number): number => (i >= 4 ? 0.7 : 1);
/** Effective energy of the summed mip chain, so `bloom` means the same at every quality level. */
function chainEnergy(levels: number, l0Keep: number): number {
  let e = 0;
  for (let i = levels - 1; i >= 0; i--) e = (i === levels - 1 ? 1 : (i === 0 ? l0Keep : LN_KEEP)) + e * (i + 1 < levels ? upWeight(i + 1) : 0);
  return e;
}

// Per-quality knobs: prefilter divisor, number of mip levels, streaks on, grain on.
const QUALITY: Record<FxQuality, { div: number; levels: number; streaks: boolean; grain: boolean }> = {
  0: { div: 4, levels: 3, streaks: false, grain: false },
  1: { div: 4, levels: 4, streaks: false, grain: true },
  2: { div: 2, levels: 5, streaks: true, grain: true },
  3: { div: 2, levels: 6, streaks: true, grain: true },
};

// ───────────────────────────────────────────────────────────── shaders ──

const VS = `#version 300 es
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

// Source canvas rows are top-down; every pass that reads uSrc flips v.
const FS_PREFILTER = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uSrcTexel;
uniform float uThreshold;
uniform float uKnee;
uniform float uGain;
uniform float uWhite;
out vec4 o;
// 'bright' works on the brightest channel, so saturated neon reds/blues bloom
// as readily as white; the knee keeps facets just under the threshold quiet.
vec3 fetch(vec2 uv) { return texture(uSrc, vec2(uv.x, 1.0 - uv.y)).rgb; }
vec3 bright(vec3 c) {
  float mx = max(c.r, max(c.g, c.b));
  // uWhite > 0 measures 'heat' toward the min channel: white-hot cores pass,
  // fully saturated crystal facets at the same max channel pass less.
  float m = mix(mx, min(c.r, min(c.g, c.b)), uWhite);
  float soft = clamp(m - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  float w = max(soft, m - uThreshold) / max(m, 1e-4);
  // Karis-style weight tames single-pixel fireflies (stars, sparks).
  return c * w / (1.0 + mx * 0.15);
}
void main() {
  // 4 bilinear taps = 4x4 source texel box (works for both /2 and /4 targets).
  vec2 d = uSrcTexel;
  vec3 a = bright(fetch(vUv + vec2(-d.x, -d.y)));
  vec3 b = bright(fetch(vUv + vec2( d.x, -d.y)));
  vec3 c = bright(fetch(vUv + vec2(-d.x,  d.y)));
  vec3 e = bright(fetch(vUv + vec2( d.x,  d.y)));
  o = vec4((a + b + c + e) * 0.25 * uGain, 1.0);
}`;

const FS_DOWN = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
out vec4 o;
void main() {
  vec2 h = uTexel;
  vec3 s = texture(uTex, vUv).rgb * 4.0;
  s += texture(uTex, vUv - h).rgb;
  s += texture(uTex, vUv + h).rgb;
  s += texture(uTex, vUv + vec2(h.x, -h.y)).rgb;
  s += texture(uTex, vUv - vec2(h.x, -h.y)).rgb;
  o = vec4(s * 0.125, 1.0);
}`;

const FS_UP = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uTexel;
uniform float uWeight;
out vec4 o;
void main() {
  vec2 h = uTexel;
  vec3 s = texture(uTex, vUv + vec2(-h.x * 2.0, 0.0)).rgb;
  s += texture(uTex, vUv + vec2(-h.x, h.y)).rgb * 2.0;
  s += texture(uTex, vUv + vec2(0.0, h.y * 2.0)).rgb;
  s += texture(uTex, vUv + vec2(h.x, h.y)).rgb * 2.0;
  s += texture(uTex, vUv + vec2(h.x * 2.0, 0.0)).rgb;
  s += texture(uTex, vUv + vec2(h.x, -h.y)).rgb * 2.0;
  s += texture(uTex, vUv + vec2(0.0, -h.y * 2.0)).rgb;
  s += texture(uTex, vUv + vec2(-h.x, -h.y)).rgb * 2.0;
  o = vec4(s * (uWeight / 12.0), 1.0);
}`;

const FS_STREAK = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uStep;
uniform float uGain;
out vec4 o;
void main() {
  vec3 s = vec3(0.0);
  float wsum = 0.0;
  for (int i = -4; i <= 4; i++) {
    float fi = float(i);
    float w = exp(-fi * fi * 0.18);
    s += texture(uTex, vUv + vec2(fi * uStep, 0.0)).rgb * w;
    wsum += w;
  }
  o = vec4(s / wsum * uGain, 1.0);
}`;

const FS_COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uSrc;
uniform sampler2D uBloom;
uniform sampler2D uStreak;
uniform vec2 uRes;
uniform float uBloomAmt;
uniform float uStreakAmt;
uniform float uCA;
uniform float uDamage;
uniform vec4 uFlash;
uniform float uVignette;
uniform float uGrain;
uniform float uTime;
uniform int uWaveCount;
uniform vec4 uWave[${MAX_WAVES}];   // xy centre (frag px, y up), z radius px, w half-thickness px
uniform vec4 uWaveP[${MAX_WAVES}];  // x strength px, y wavefront glow
out vec4 o;

vec3 src(vec2 uv) { return texture(uSrc, vec2(uv.x, 1.0 - uv.y)).rgb; }

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 uv = vUv;
  vec2 px = uv * uRes;

  // ── Shockwaves: refract along the ring normal, lens-shaped profile. ──
  vec2 off = vec2(0.0);
  float front = 0.0;
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    if (i >= uWaveCount) break;
    vec4 w = uWave[i];
    vec2 d = px - w.xy;
    float dist = length(d);
    float x = (dist - w.z) / w.w;
    if (abs(x) < 1.0) {
      float s = 1.0 - x * x;
      // Outer half pushes out, inner half pulls in -> bright magnified band.
      off += (d / max(dist, 1e-3)) * (sin(x * 3.14159) * s * uWaveP[i].x);
      front += s * s * uWaveP[i].y;
    }
  }
  vec2 suv = uv - off / uRes;

  // ── Chromatic aberration: radial, plus a fringe proportional to refraction. ──
  vec2 rc = suv - 0.5;
  vec2 ca = rc * (uCA * dot(rc, rc) * 2.0) + off / uRes * (uCA > 0.0 ? 0.25 : 0.0);
  vec3 col;
  if (dot(ca, ca) > 1e-9) {
    col = vec3(src(suv + ca).r, src(suv).g, src(suv - ca).b);
  } else {
    col = src(suv);
  }

  vec3 bloom = texture(uBloom, suv).rgb;
  vec3 streak = texture(uStreak, suv).rgb;
  col += bloom * uBloomAmt;
  col += streak * uStreakAmt * vec3(0.55, 0.8, 1.25);
  col *= 1.0 + front;

  // Flash: additive and tinted, proportional to what is already lit, so blacks
  // stay black (no milky grey veil) and the neon simply flares.
  col += uFlash.rgb * uFlash.a * (col * 1.6 + 0.035);

  // Low-HP: pulsing red pressure at the edges. It darkens and tints the dark
  // backdrop only (weighted by 1 - luma), so ships, aliens and bullets keep their
  // colours and stay readable exactly when the player needs them.
  float edge = smoothstep(0.3, 1.0, length(rc * vec2(uRes.x / uRes.y, 1.0)) * 1.15);
  float ed = edge * uDamage;
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = col * (1.0 - 0.3 * ed) + vec3(0.42, 0.03, 0.08) * ed * (1.0 - clamp(lum * 2.0, 0.0, 1.0));

  // Hue-preserving soft shoulder: neon stays saturated instead of clipping to white.
  float m = max(col.r, max(col.g, col.b));
  const float K = 0.8;
  if (m > K) {
    float t = K + (1.0 - K) * (1.0 - exp(-(m - K) / (1.0 - K)));
    col *= t / m;
    // Let only really hot cores bleed toward white, like an overexposed filament.
    col = mix(col, vec3(t), clamp((m - 1.6) * 0.25, 0.0, 0.35));
  }

  // Vignette (replaces the 2D vignette pass).
  vec2 vq = rc * vec2(uRes.x / uRes.y, 1.0);
  col *= 1.0 - uVignette * smoothstep(0.45, 1.15, length(vq)) * 0.78;

  // Grain + dither (luma-weighted: visible in darks, invisible in neon).
  float n = hash(px + fract(uTime * 13.37) * 311.0) - 0.5;
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col += n * (uGrain * (1.0 - l) + 1.0 / 255.0);

  o = vec4(col, 1.0);
}`;

// ─────────────────────────────────────────────────────────────── class ──

interface Prog {
  p: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}

/** Aberration amount (UV units at the screen corner) for a kick of 1. */
const CA_SCALE = 0.006;
/** Bloom gain added at the peak of a surge (kickBloom(1)). */
const SURGE_GAIN = 0.4;
/** Peak streak gain (at a surge of 1). */
const STREAK_GAIN = 0.3;
/** Flash alpha cap in the shader (the 2D fallback keeps its own flash). */
const FLASH_MAX = 0.25;
/** Minor-wave budget: tokens per second and bucket size. */
const WAVE_RATE = 3;
const WAVE_BURST = 3;

export class PostFx {
  readonly canvas: HTMLCanvasElement;
  settings: PostFxSettings = { ...DEFAULT_POSTFX };
  /** Called when the pipeline becomes unusable (context lost / auto-off) or usable again. */
  onActiveChange: ((active: boolean) => void) | null = null;
  /**
   * Called when the auto ladder moves (and once on reenable). The renderer uses
   * it to resize the world canvas (renderScale) and to scale its own costs
   * (grid quality, shard level of detail) with the same controller.
   */
  onQualityChange: ((q: FxQuality, renderScale: number) => void) | null = null;
  /** Low-HP pressure 0..1 (renderer feeds it each frame). Drives the red edge only. */
  damage = 0;
  /** Art-direction knobs (not user settings): tight-halo share, overall bloom gain, grain amplitude. */
  readonly tune = { l0Keep: L0_KEEP, gain: 4, grain: 0.02, white: 0.6 };

  private gl: WebGL2RenderingContext;
  private lost = false;
  private disabled = false;
  private halfFloat = false;
  private progs: Record<'pre' | 'down' | 'up' | 'streak' | 'comp', Prog> | null = null;
  private srcTex: WebGLTexture | null = null;
  private srcW = 0;
  private srcH = 0;
  private levels: Target[] = [];
  private streakA: Target | null = null;
  private streakB: Target | null = null;
  private black: WebGLTexture | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  /** Output (canvas) size in device px. */
  private w = 0;
  private h = 0;
  private builtFor = '';
  private q: FxQuality = 2;
  /** Auto ladder's own scale (1 or LOW_RENDER_SCALE). */
  private autoScale = 1;
  private waves: Wave[] = [];
  private waveTokens = WAVE_BURST;
  private dropped = 0;
  private view = { k: 1, ox: 0, oy: 0 };
  private time = 0;
  private ca = 0;
  private bloomKick = 0;
  private flashRGBA: [number, number, number, number] = [1, 1, 1, 0];
  private frameEma = 16.7;
  private slowFor = 0;
  private fastFor = 0;
  private downgrades = 0;
  private lastCpu = 0;
  private lastUpload = 0;
  private readonly waveBuf = new Float32Array(MAX_WAVES * 4);
  private readonly waveParBuf = new Float32Array(MAX_WAVES * 4);

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    canvas.addEventListener('webglcontextlost', this.onLost, false);
    canvas.addEventListener('webglcontextrestored', this.onRestored, false);
    this.init();
  }

  /** Returns null when WebGL2 (or a required feature) is unavailable. */
  static create(canvas: HTMLCanvasElement): PostFx | null {
    let gl: WebGL2RenderingContext | null = null;
    try {
      gl = canvas.getContext('webgl2', {
        alpha: false,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
      });
    } catch {
      gl = null;
    }
    if (!gl) return null;
    try {
      return new PostFx(canvas, gl);
    } catch (err) {
      console.warn('PostFx disabled:', err);
      return null;
    }
  }

  /** True while the GL pipeline can present frames. */
  get active(): boolean {
    return !this.lost && !this.disabled && this.progs !== null;
  }

  /** True after the auto ladder ran out of rungs and switched itself off (the machine is slow). */
  get autoOff(): boolean {
    return this.disabled;
  }

  /**
   * One number for every cost knob the renderer owns: 4 = q3, 3 = q2, 2 = q1,
   * 1 = q0, 0 = q0 at renderScale 0.75 or auto-off. Feed it to grid quality and
   * shard level of detail so a single controller scales the whole frame.
   */
  get costTier(): number {
    if (this.disabled) return 0;
    return this.renderScale < 1 ? 0 : this.quality + 1;
  }

  get quality(): FxQuality {
    return this.settings.quality === 'auto' ? this.q : this.settings.quality;
  }

  /** Effective world render scale: min(settings.renderScale, auto ladder). */
  get renderScale(): number {
    const auto = this.settings.quality === 'auto' ? this.autoScale : 1;
    return Math.max(0.5, Math.min(1, this.settings.renderScale, auto));
  }

  stats(): PostFxStats {
    return {
      quality: this.quality,
      cpuMs: this.lastCpu,
      uploadMs: this.lastUpload,
      frameMs: this.frameEma,
      waves: this.waves.length,
      wavesDropped: this.dropped,
      halfFloat: this.halfFloat,
      renderScale: this.renderScale,
    };
  }

  /** Device-pixel size of the output (match the visible 2D canvas). */
  resize(w: number, h: number): void {
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.w = w;
    this.h = h;
  }

  /** Affine map from wave (world) units to SOURCE canvas px: px = ox + x * k. */
  setView(k: number, ox: number, oy: number): void {
    this.view.k = k;
    this.view.ox = ox;
    this.view.oy = oy;
  }

  /** Returns false when a minor wave was dropped by the budget (or the pool is full of stronger waves). */
  shockwave(x: number, y: number, o: ShockwaveOpts): boolean {
    if (!o.major) {
      if (this.waveTokens < 1) {
        this.dropped++;
        return false;
      }
      this.waveTokens -= 1;
    }
    const wave: Wave = {
      x,
      y,
      t: 0,
      dur: o.duration ?? 0.6,
      radius: o.radius,
      strength: o.strength ?? 18,
      thick: o.thickness ?? Math.max(18, o.radius * 0.12),
      glow: o.glow ?? 0.12,
    };
    if (this.waves.length >= MAX_WAVES) {
      // Replace the weakest remaining wave so big events always land.
      let wi = 0;
      let ws = Infinity;
      for (let i = 0; i < this.waves.length; i++) {
        const v = this.waves[i]!;
        const s = v.strength * (1 - v.t / v.dur);
        if (s < ws) {
          ws = s;
          wi = i;
        }
      }
      if (ws > wave.strength) {
        this.dropped++;
        return false;
      }
      this.waves[wi] = wave;
    } else {
      this.waves.push(wave);
    }
    return true;
  }

  /** Brief chromatic-aberration spike (0..1, keep small: hurt 0.25, boss death 0.5). Ignored with reduced flashing. */
  kickAberration(a: number): void {
    this.ca = Math.max(this.ca, a);
  }

  /** Brief bloom surge (0..1); also the only thing that shows lens streaks. Ignored with reduced flashing. */
  kickBloom(a: number): void {
    this.bloomKick = Math.max(this.bloomKick, a);
  }

  /** Full-screen flash: tint colour hex and alpha 0..1 (capped at FLASH_MAX, additive on lit pixels). */
  setFlash(color: string, a: number): void {
    const n = parseInt(color.slice(1), 16);
    this.flashRGBA[0] = ((n >> 16) & 255) / 255;
    this.flashRGBA[1] = ((n >> 8) & 255) / 255;
    this.flashRGBA[2] = (n & 255) / 255;
    this.flashRGBA[3] = Math.min(FLASH_MAX, Math.max(0, a));
  }

  clearEffects(): void {
    this.waves.length = 0;
    this.waveTokens = WAVE_BURST;
    this.ca = 0;
    this.bloomKick = 0;
    this.flashRGBA[3] = 0;
  }

  /**
   * Feed real frame time (ms) every rAF. With quality 'auto', sustained slow
   * frames step down: q3 → q2 → q1 → q0 → q0 + renderScale 0.75 → off.
   * Sustained fast frames step back up, at most 3 times after any downgrade,
   * so it cannot oscillate forever.
   */
  reportFrameTime(ms: number): void {
    if (!(ms > 0) || ms > 250) return;
    this.frameEma += (ms - this.frameEma) * 0.05;
    if (this.settings.quality !== 'auto' || !this.active) return;
    const dt = ms / 1000;
    if (this.frameEma > 19.5) {
      this.slowFor += dt;
      this.fastFor = 0;
    } else if (this.frameEma < 13.5) {
      this.fastFor += dt;
      this.slowFor = 0;
    } else {
      this.slowFor = Math.max(0, this.slowFor - dt);
      this.fastFor = 0;
    }
    if (this.slowFor > 2) {
      this.slowFor = 0;
      this.frameEma = 16.7;
      this.downgrades++;
      if (this.q > 0) {
        this.q = (this.q - 1) as FxQuality;
        this.onQualityChange?.(this.q, this.renderScale);
      } else if (this.autoScale > LOW_RENDER_SCALE) {
        this.autoScale = LOW_RENDER_SCALE;
        this.onQualityChange?.(this.q, this.renderScale);
      } else {
        this.disabled = true;
        this.onActiveChange?.(false);
      }
    } else if (this.fastFor > 8 && this.downgrades < 3 && (this.q < 3 || this.autoScale < 1)) {
      this.fastFor = 0;
      if (this.autoScale < 1) this.autoScale = 1;
      else this.q = (this.q + 1) as FxQuality;
      this.onQualityChange?.(this.q, this.renderScale);
    }
  }

  /** Re-enable after an auto-off (e.g. when the user toggles the setting). */
  reenable(q: FxQuality = 1): void {
    if (!this.disabled) return;
    this.disabled = false;
    this.downgrades = 0;
    this.q = q;
    this.autoScale = 1;
    this.onActiveChange?.(this.active);
    this.onQualityChange?.(this.q, this.renderScale);
  }

  /**
   * Uploads `source` and presents the processed frame. Returns false when the
   * caller must show the plain 2D canvas instead. `source` may be smaller than
   * the output (renderScale); it is upsampled.
   */
  render(source: TexImageSource & { width: number; height: number }, dt: number): boolean {
    if (!this.active) return false;
    const t0 = performance.now();
    const gl = this.gl;
    const S = this.settings;
    const q = this.quality;
    if (gl.isContextLost()) return false;

    this.time += dt;
    this.ca = Math.max(0, this.ca - dt * 3);
    this.bloomKick = Math.max(0, this.bloomKick - dt * 2.2);
    this.waveTokens = Math.min(WAVE_BURST, this.waveTokens + dt * WAVE_RATE);
    for (const w of this.waves) w.t += dt;
    this.waves = this.waves.filter((w) => w.t < w.dur);

    if (this.w === 0 || this.h === 0) this.resize(source.width, source.height);
    const W = this.w;
    const H = this.h;
    const SW = Math.max(1, source.width);
    const SH = Math.max(1, source.height);
    this.ensureTargets(SW, SH, q);
    const P = this.progs!;

    // Upload the 2D frame.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    if (this.srcW !== SW || this.srcH !== SH) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, SW, SH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      this.srcW = SW;
      this.srcH = SH;
    }
    const tu = performance.now();
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    this.lastUpload = performance.now() - tu;

    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);
    const QL = QUALITY[q];
    const fl = S.flashes;
    const surge = fl ? this.bloomKick : 0;
    const bloomOn = S.bloom > 0 && this.levels.length > 0;
    // Streaks are event-only: computed only while a surge is live.
    const streakAmt = S.streaks * STREAK_GAIN * surge * surge;
    const streakOn = bloomOn && QL.streaks && streakAmt > 0.004 && this.streakA !== null && this.streakB !== null && this.levels.length > 2;
    if (bloomOn) {
      // Prefilter.
      const L0 = this.levels[0]!;
      this.bindTarget(L0);
      gl.useProgram(P.pre.p);
      gl.uniform1i(P.pre.u.uSrc!, 0);
      // Tap offset of one source texel in each direction = 4x4 box at /2; at /4 widen to 2 texels.
      const tap = QL.div === 2 ? 1 : 2;
      gl.uniform2f(P.pre.u.uSrcTexel!, tap / SW, tap / SH);
      gl.uniform1f(P.pre.u.uThreshold!, S.threshold);
      gl.uniform1f(P.pre.u.uKnee!, Math.max(0.01, S.knee));
      gl.uniform1f(P.pre.u.uGain!, this.halfFloat ? 1 : 0.5);
      gl.uniform1f(P.pre.u.uWhite!, this.tune.white);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // Down chain.
      gl.useProgram(P.down.p);
      gl.uniform1i(P.down.u.uTex!, 0);
      for (let i = 1; i < this.levels.length; i++) {
        const from = this.levels[i - 1]!;
        this.bindTarget(this.levels[i]!);
        gl.bindTexture(gl.TEXTURE_2D, from.tex);
        gl.uniform2f(P.down.u.uTexel!, 1 / from.w, 1 / from.h);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }

      // Streaks read L1 before the up chain modifies it.
      if (streakOn) {
        gl.useProgram(P.streak.p);
        gl.uniform1i(P.streak.u.uTex!, 0);
        const sw = this.streakA!.w;
        const passes: [Target, WebGLTexture, number][] = [
          [this.streakA!, this.levels[1]!.tex, 1.5 / sw],
          [this.streakB!, this.streakA!.tex, 5 / sw],
          [this.streakA!, this.streakB!.tex, 16 / sw],
        ];
        for (const [dst, srcT, step] of passes) {
          this.bindTarget(dst);
          gl.bindTexture(gl.TEXTURE_2D, srcT);
          gl.uniform1f(P.streak.u.uStep!, step);
          gl.uniform1f(P.streak.u.uGain!, 1);
          gl.drawArrays(gl.TRIANGLES, 0, 3);
        }
      }

      // Up chain, additive.
      gl.useProgram(P.up.p);
      gl.uniform1i(P.up.u.uTex!, 0);
      // dst' = up(src) + keep * dst: keeping less of the tight L0 blur keeps small
      // shapes (gems, bullets) crisp while the wide levels carry the halo.
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.CONSTANT_ALPHA);
      for (let i = this.levels.length - 1; i > 0; i--) {
        const from = this.levels[i]!;
        const to = this.levels[i - 1]!;
        this.bindTarget(to);
        gl.blendColor(0, 0, 0, i === 1 ? this.tune.l0Keep : LN_KEEP);
        gl.bindTexture(gl.TEXTURE_2D, from.tex);
        gl.uniform2f(P.up.u.uTexel!, 0.5 / from.w, 0.5 / from.h);
        // Damp the widest levels: they turn big bright areas into a grey veil.
        gl.uniform1f(P.up.u.uWeight!, upWeight(i));
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.disable(gl.BLEND);
    }

    // Composite.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, W, H);
    const C = P.comp;
    gl.useProgram(C.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.srcTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, bloomOn ? this.levels[0]!.tex : this.black);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, streakOn ? this.streakA!.tex : this.black);
    gl.uniform1i(C.u.uSrc!, 0);
    gl.uniform1i(C.u.uBloom!, 1);
    gl.uniform1i(C.u.uStreak!, 2);
    gl.uniform2f(C.u.uRes!, W, H);
    const bloomScale = this.halfFloat ? 1 : 2;
    const norm = bloomOn ? 1 / chainEnergy(this.levels.length, this.tune.l0Keep) : 0;
    const T = this.tune;
    gl.uniform1f(C.u.uBloomAmt!, S.bloom * bloomScale * norm * T.gain * (1 + surge * SURGE_GAIN));
    gl.uniform1f(C.u.uStreakAmt!, streakOn ? streakAmt * bloomScale : 0);
    // Aberration: event spikes only (no low-HP term: the screen must stay readable when hurt).
    gl.uniform1f(C.u.uCA!, fl ? Math.min(1, this.ca) * CA_SCALE : 0);
    gl.uniform1f(C.u.uDamage!, Math.min(1, this.damage));
    gl.uniform4f(C.u.uFlash!, this.flashRGBA[0], this.flashRGBA[1], this.flashRGBA[2], this.flashRGBA[3]);
    gl.uniform1f(C.u.uVignette!, S.vignette);
    gl.uniform1f(C.u.uGrain!, QL.grain ? S.grain * T.grain : 0);
    gl.uniform1f(C.u.uTime!, this.time);

    // Waves → output frag px (y up). setView maps to source px; rescale to output.
    const v = this.view;
    const sx = W / SW;
    const sy = H / SH;
    const vk = v.k * sx;
    const strengthK = (fl ? 1 : 0.45) * Math.max(0, Math.min(1, S.shake));
    let n = 0;
    if (strengthK > 0) {
      for (const w of this.waves) {
        const k = w.t / w.dur;
        const ease = 1 - (1 - k) * (1 - k) * (1 - k); // fast start, slow end
        const r = Math.max(1, w.radius * ease * vk);
        const life = (1 - k) * (1 - k);
        const cx = (v.ox + w.x * v.k) * sx;
        const cy = H - (v.oy + w.y * v.k) * sy;
        const th = Math.max(6, w.thick * vk * (0.6 + 0.6 * k));
        // Cull waves whose ring does not touch the screen.
        if (cx + r + th < 0 || cx - r - th > W || cy + r + th < 0 || cy - r - th > H) continue;
        // Cull waves fully containing the screen (ring outside on all corners).
        const far = Math.max(Math.hypot(cx, cy), Math.hypot(cx - W, cy), Math.hypot(cx, cy - H), Math.hypot(cx - W, cy - H));
        if (r - th > far) continue;
        this.waveBuf[n * 4] = cx;
        this.waveBuf[n * 4 + 1] = cy;
        this.waveBuf[n * 4 + 2] = r;
        this.waveBuf[n * 4 + 3] = th;
        this.waveParBuf[n * 4] = w.strength * (H / 1080) * life * strengthK;
        this.waveParBuf[n * 4 + 1] = fl ? w.glow * life : 0;
        n++;
      }
    }
    gl.uniform1i(C.u.uWaveCount!, n);
    if (n > 0) {
      gl.uniform4fv(C.u['uWave[0]']!, this.waveBuf);
      gl.uniform4fv(C.u['uWaveP[0]']!, this.waveParBuf);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE0);

    this.lastCpu = performance.now() - t0;
    return true;
  }

  /** Blocks until the GPU is done (benchmarking only). */
  finish(): void {
    this.gl.finish();
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.onLost, false);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored, false);
    this.freeTargets();
    const gl = this.gl;
    if (this.progs) for (const p of Object.values(this.progs)) gl.deleteProgram(p.p);
    this.progs = null;
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  // ──────────────────────────────────────────────────────────── internals ──

  private onLost = (e: Event): void => {
    e.preventDefault(); // allow restoration
    this.lost = true;
    this.progs = null;
    this.levels = [];
    this.streakA = this.streakB = null;
    this.srcTex = this.black = null;
    this.vao = null;
    this.builtFor = '';
    this.srcW = this.srcH = 0;
    this.onActiveChange?.(false);
  };

  private onRestored = (): void => {
    try {
      this.init();
      this.lost = false;
      this.onActiveChange?.(this.active);
    } catch (err) {
      console.warn('PostFx restore failed:', err);
    }
  };

  private init(): void {
    const gl = this.gl;
    this.halfFloat = !!(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'));
    this.progs = {
      pre: this.program(FS_PREFILTER, ['uSrc', 'uSrcTexel', 'uThreshold', 'uKnee', 'uGain', 'uWhite']),
      down: this.program(FS_DOWN, ['uTex', 'uTexel']),
      up: this.program(FS_UP, ['uTex', 'uTexel', 'uWeight']),
      streak: this.program(FS_STREAK, ['uTex', 'uStep', 'uGain']),
      comp: this.program(FS_COMPOSITE, [
        'uSrc', 'uBloom', 'uStreak', 'uRes', 'uBloomAmt', 'uStreakAmt', 'uCA', 'uDamage', 'uFlash',
        'uVignette', 'uGrain', 'uTime', 'uWaveCount', 'uWave[0]', 'uWaveP[0]',
      ]),
    };
    this.vao = gl.createVertexArray();
    this.srcTex = this.texture();
    this.black = this.texture();
    gl.bindTexture(gl.TEXTURE_2D, this.black);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.builtFor = '';
    this.srcW = this.srcH = 0;
  }

  private program(fs: string, uniforms: string[]): Prog {
    const gl = this.gl;
    const compile = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
        throw new Error('PostFx shader: ' + gl.getShaderInfoLog(s));
      }
      return s;
    };
    const p = gl.createProgram()!;
    const vs = compile(gl.VERTEX_SHADER, VS);
    const f = compile(gl.FRAGMENT_SHADER, fs);
    gl.attachShader(p, vs);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error('PostFx link: ' + gl.getProgramInfoLog(p));
    }
    gl.deleteShader(vs);
    gl.deleteShader(f);
    const u: Record<string, WebGLUniformLocation | null> = {};
    for (const name of uniforms) u[name] = gl.getUniformLocation(p, name);
    return { p, u };
  }

  private texture(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private target(w: number, h: number): Target {
    const gl = this.gl;
    const tex = this.texture();
    if (this.halfFloat) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    if (this.halfFloat && gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      // Some drivers advertise the extension but refuse RGBA16F attachments.
      this.halfFloat = false;
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fb, w, h };
  }

  private freeTargets(): void {
    const gl = this.gl;
    for (const t of [...this.levels, this.streakA, this.streakB]) {
      if (!t) continue;
      gl.deleteTexture(t.tex);
      gl.deleteFramebuffer(t.fb);
    }
    this.levels = [];
    this.streakA = this.streakB = null;
  }

  /** Bloom chain sized from the SOURCE (cheaper at renderScale < 1; it is blurred anyway). */
  private ensureTargets(W: number, H: number, q: FxQuality): void {
    const key = `${W}x${H}q${q}`;
    if (key === this.builtFor) return;
    this.freeTargets();
    const QL = QUALITY[q];
    let w = Math.max(1, Math.round(W / QL.div));
    let h = Math.max(1, Math.round(H / QL.div));
    for (let i = 0; i < QL.levels && w >= 4 && h >= 4; i++) {
      this.levels.push(this.target(w, h));
      w = Math.max(1, w >> 1);
      h = Math.max(1, h >> 1);
    }
    if (QL.streaks && this.levels.length > 2) {
      // Streaks: half the width of L2, height of L2 — cheap and very wide.
      const L2 = this.levels[2]!;
      this.streakA = this.target(Math.max(4, L2.w >> 1), L2.h);
      this.streakB = this.target(Math.max(4, L2.w >> 1), L2.h);
    }
    this.builtFor = key;
  }

  private bindTarget(t: Target): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.viewport(0, 0, t.w, t.h);
  }
}
