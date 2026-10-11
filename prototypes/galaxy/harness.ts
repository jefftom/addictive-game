import { GalaxyBackdrop, SECTORS, Rng, type WarpFx } from './galaxy';
import { SpriteCache, makeGlowDot } from '/home/user/addictive-game/src/render/sprites';
import { hash32 } from '/home/user/addictive-game/src/core/rng';

const canvas = document.getElementById('c') as HTMLCanvasElement;
let ctx = canvas.getContext('2d', { alpha: false })!;
let W = 1280;
let H = 720;
let K = 1;
const mkWorker = () => new Worker('dist/worker.js', { type: 'module' });
let backdrop = new GalaxyBackdrop({ quality: 720 / 1080 });
const sprites = new SpriteCache();

function frac(n: number): number {
  return (n % 1000003) / 1000003;
}

function setup(w: number, h: number, worker = false): void {
  W = w;
  H = h;
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  ctx = canvas.getContext('2d', { alpha: false })!;
  // Same camera scale formula as Renderer.resize (dpr 1).
  const short = Math.min(w, h);
  const t = Math.min(1, Math.max(0, (short - 420) / (900 - 420)));
  const area = 470 * 980 + (1366 * 768 - 470 * 980) * t;
  K = Math.sqrt((w * h) / area);
  sprites.setResolution(K);
  backdrop.dispose();
  backdrop = new GalaxyBackdrop({ quality: h / 1080, worker: worker ? mkWorker : null });
}

const NO_WARP: WarpFx = { active: false, phase: null, progress: -1, holding: false, stretch: 0, gridAlpha: 1, tint: '#fff' };

/** The game's current star layers + grid (what stays on top), with the warp hooks the integration adds. */
function legacyTop(camX: number, camY: number, time: number, beat: number, grid: [number, number, number], fx: WarpFx = NO_WARP): void {
  const k = K;
  const w = W;
  const h = H;
  const halfW = w / 2 / k;
  const halfH = h / 2 / k;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  const layers = [
    { p: 0.2, cell: 160, size: 1, alpha: 0.45 },
    { p: 0.4, cell: 220, size: 1.5, alpha: 0.6 },
    { p: 0.65, cell: 320, size: 2, alpha: 0.8 },
  ];
  const st = fx.stretch;
  ctx.fillStyle = '#cfe4ff';
  ctx.strokeStyle = fx.active ? fx.tint : '#cfe4ff';
  for (const L of layers) {
    const cx = camX * L.p;
    const cy = camY * L.p;
    const s = L.size * Math.max(1, k * 0.8);
    if (st > 0.02) {
      // Warp: stars stretch radially into streaks, one batched path per layer.
      ctx.globalAlpha = Math.min(1, L.alpha * (1 + st));
      ctx.lineWidth = s;
      ctx.beginPath();
    }
    for (let gx = Math.floor((cx - halfW) / L.cell); gx <= Math.floor((cx + halfW) / L.cell); gx++) {
      for (let gy = Math.floor((cy - halfH) / L.cell); gy <= Math.floor((cy + halfH) / L.cell); gy++) {
        const hsh = hash32((gx * 92837111) ^ (gy * 689287499) ^ (L.cell * 31));
        const wx = (gx + frac(hsh)) * L.cell;
        const wy = (gy + frac(hash32(hsh ^ 0x5bd1e995))) * L.cell;
        const sx = (wx - cx) * k + w / 2;
        const sy = (wy - cy) * k + h / 2;
        if (st > 0.02) {
          const f = st * (0.35 + L.p) * 0.6;
          ctx.moveTo(sx, sy);
          ctx.lineTo(sx + (sx - w / 2) * f, sy + (sy - h / 2) * f);
        } else {
          const tw = 0.6 + 0.4 * Math.sin(time * (1 + (hsh % 5)) + (hsh % 100));
          ctx.globalAlpha = L.alpha * tw;
          ctx.fillRect(sx - s / 2, sy - s / 2, s, s);
        }
      }
    }
    if (st > 0.02) ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  const spacing = 80;
  const left = camX - halfW;
  const top = camY - halfH;
  const pulse = (1 + beat * 0.9) * fx.gridAlpha;
  ctx.lineWidth = Math.max(1, k * 0.9);
  const [r, g, b] = grid;
  for (let major = 0; major < 2; major++) {
    ctx.strokeStyle = major ? `rgba(${r},${g},${b},${0.1 * pulse})` : `rgba(${r},${g},${b},${0.05 * pulse})`;
    ctx.beginPath();
    for (let gx = Math.floor(left / spacing) * spacing; gx <= camX + halfW; gx += spacing) {
      if ((Math.round(gx / spacing) % 5 === 0) !== (major === 1)) continue;
      const sx = Math.round((gx - camX) * k + w / 2) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
    }
    for (let gy = Math.floor(top / spacing) * spacing; gy <= camY + halfH; gy += spacing) {
      if ((Math.round(gy / spacing) % 5 === 0) !== (major === 1)) continue;
      const sy = Math.round((gy - camY) * k + h / 2) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(w, sy);
    }
    ctx.stroke();
  }
}

let vig: HTMLCanvasElement | null = null;
function vignette(): void {
  if (!vig || vig.width !== W || vig.height !== H) {
    vig = document.createElement('canvas');
    vig.width = W;
    vig.height = H;
    const c = vig.getContext('2d')!;
    const g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(2,1,8,0.78)');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(vig, 0, 0);
}

/** Old base fill + radial-gradient nebula (the part the backdrop replaces), for perf + readability comparison. */
const NEB = ['#3b1d8f', '#0f5e7a', '#6a1b6b', '#1b2f8f', '#4a1360'];
function legacyNebula(camX: number, camY: number, tint: number): void {
  const k = K;
  const w = W;
  const h = H;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#05040f';
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';
  const np = 0.12;
  const cell = 1500;
  const ncx = camX * np;
  const ncy = camY * np;
  const halfW = w / 2 / k;
  const halfH = h / 2 / k;
  const reach = 1200;
  for (let gx = Math.floor((ncx - halfW - reach) / cell); gx <= Math.floor((ncx + halfW + reach) / cell); gx++) {
    for (let gy = Math.floor((ncy - halfH - reach) / cell); gy <= Math.floor((ncy + halfH + reach) / cell); gy++) {
      const hsh = hash32((gx * 73856093) ^ (gy * 19349663));
      const wx = (gx + frac(hsh)) * cell;
      const wy = (gy + frac(hash32(hsh))) * cell;
      const r = 600 + frac(hash32(hsh + 7)) * 600;
      const sx = (wx - ncx) * k + w / 2;
      const sy = (wy - ncy) * k + h / 2;
      const sr = r * k;
      if (sx + sr < 0 || sx - sr > w || sy + sr < 0 || sy - sr > h) continue;
      const color = NEB[hsh % NEB.length]!;
      const n = parseInt(color.slice(1), 16);
      const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
      g.addColorStop(0, `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${0.2 + tint * 0.1})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
    }
  }
  ctx.globalCompositeOperation = 'source-over';
}

/** Sample gameplay: warm neon enemies, cyan shards, enemy bullets, the player, for readability checks. */
const bulletDot = makeGlowDot('#ff4f7a', '#fff0f4', 32);
function overlay(camX: number, camY: number): void {
  const k = K;
  const ox = W / 2 - camX * k;
  const oy = H / 2 - camY * k;
  const rng = new Rng(1234);
  const kinds: [string, string, number][] = [
    ['tri', '#ff3d6e', 11],
    ['dart', '#ff8c42', 8],
    ['diamond', '#ffd23f', 10],
    ['circle', '#b15cff', 15],
    ['circle', '#d79bff', 8],
    ['hex', '#ff4fd2', 13],
    ['square', '#ff5233', 20],
  ];
  const halfW = W / 2 / k;
  const halfH = H / 2 / k;
  const put = (s: { canvas: HTMLCanvasElement; size: number }, x: number, y: number, a: number) => {
    const c = Math.cos(a) * k;
    const sn = Math.sin(a) * k;
    ctx.setTransform(c, sn, -sn, c, ox + x * k, oy + y * k);
    ctx.drawImage(s.canvas, -s.size / 2, -s.size / 2, s.size, s.size);
  };
  for (let i = 0; i < 46; i++) {
    const x = camX + rng.range(-halfW, halfW) * 0.95;
    const y = camY + rng.range(-halfH, halfH) * 0.95;
    const tier = rng.next() < 0.8 ? ['#45e8ff', 5] : rng.next() < 0.6 ? ['#6dff8a', 6.5] : ['#8f7bff', 8];
    put(sprites.get('gem', tier[0] as string, tier[1] as number), x, y, 0);
  }
  for (let i = 0; i < 70; i++) {
    const kd = kinds[Math.floor(rng.next() * kinds.length)]!;
    const ang = rng.next() * Math.PI * 2;
    const dist = 120 + rng.next() * Math.max(halfW, halfH) * 0.95;
    const x = camX + Math.cos(ang) * dist;
    const y = camY + Math.sin(ang) * dist * 0.75;
    put(sprites.get(kd[0] as never, kd[1], kd[2], rng.next() < 0.06 ? 'elite' : 'normal'), x, y, ang + Math.PI);
  }
  put(sprites.get('boss_star', '#ff7a1a', 46), camX + halfW * 0.55, camY - halfH * 0.45, 0.3);
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 24; i++) {
    const x = camX + rng.range(-halfW, halfW) * 0.8;
    const y = camY + rng.range(-halfH, halfH) * 0.8;
    ctx.setTransform(k, 0, 0, k, ox + x * k, oy + y * k);
    ctx.drawImage(bulletDot, -8, -8, 16, 16);
  }
  ctx.globalCompositeOperation = 'source-over';
  put(sprites.get('player', '#3ff3ff', 14), camX, camY, -0.4);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

interface RenderOpts {
  camX?: number;
  camY?: number;
  time?: number;
  overlay?: boolean;
  top?: boolean;
  beat?: number;
  intensity?: number;
  legacy?: boolean;
}
function render(i: number, o: RenderOpts = {}): void {
  const camX = o.camX ?? 0;
  const camY = o.camY ?? 0;
  backdrop.clearWarp();
  if (o.legacy) legacyNebula(camX, camY, 0.3);
  else {
    backdrop.prepare(i);
    backdrop.setSector(i);
    backdrop.draw(ctx, camX, camY, K, W, H, o.time ?? 0, { beat: o.beat ?? 0, intensity: o.intensity ?? 0 });
  }
  if (o.top !== false) legacyTop(camX, camY, o.time ?? 0, o.beat ?? 0.2, SECTORS[i]!.gridRGB);
  if (o.overlay) overlay(camX, camY);
  if (o.top !== false) vignette();
}

function renderWarp(from: number, to: number, p: number, withOverlay = true): void {
  backdrop.setWarpPreview(from, to, p);
  backdrop.draw(ctx, 0, 0, K, W, H, 0);
  const fx = backdrop.warpFx;
  legacyTop(0, 0, 0, 0.2, SECTORS[to]!.gridRGB, fx);
  if (withOverlay) overlay(0, 0);
  vignette();
}

function flush(): void {
  ctx.getImageData(0, 0, 1, 1);
}

function bench(i: number, frames: number, mode: 'galaxy' | 'legacy' | 'full' | 'blank', mask = 31): number {
  backdrop.clearWarp();
  backdrop.layerMask = mask;
  if (mode !== 'legacy') {
    backdrop.prepare(i);
    backdrop.setSector(i);
  }
  for (let f = 0; f < 5; f++) {
    if (mode === 'legacy') legacyNebula(f * 13, f * 7, 0.3);
    else backdrop.draw(ctx, f * 13, f * 7, K, W, H, f / 60);
  }
  flush();
  const t0 = performance.now();
  for (let f = 0; f < frames; f++) {
    const cx = f * 9.5;
    const cy = Math.sin(f * 0.05) * 300;
    if (mode === 'blank') {
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
    } else if (mode === 'legacy') legacyNebula(cx, cy, 0.3);
    else {
      backdrop.draw(ctx, cx, cy, K, W, H, f / 60, { beat: (f % 30) / 30, intensity: 0.3 });
      if (mode === 'full') legacyTop(cx, cy, f / 60, 0.2, [120, 150, 255]);
    }
    flush();
  }
  backdrop.layerMask = 31;
  return (performance.now() - t0) / frames;
}

/** Average and worst frame over a full warp (p sweeps 0..1). */
function benchWarp(from: number, to: number, frames = 120): { avg: number; max: number; byPhase: Record<string, number> } {
  backdrop.prepare(from);
  backdrop.prepare(to);
  for (let f = 0; f < 5; f++) {
    backdrop.setWarpPreview(from, to, f / 5);
    backdrop.draw(ctx, 0, 0, K, W, H, 0);
  }
  flush();
  let tot = 0;
  let mx = 0;
  const ph: Record<string, [number, number]> = {};
  for (let f = 0; f < frames; f++) {
    const p = f / (frames - 1);
    backdrop.setWarpPreview(from, to, p, f / 60);
    const t0 = performance.now();
    backdrop.draw(ctx, f * 9.5, 0, K, W, H, f / 60);
    flush();
    const dt = performance.now() - t0;
    tot += dt;
    mx = Math.max(mx, dt);
    const name = backdrop.warpFx.phase ?? 'none';
    const e = (ph[name] ??= [0, 0]);
    e[0] += dt;
    e[1]++;
  }
  backdrop.clearWarp();
  return { avg: tot / frames, max: mx, byPhase: Object.fromEntries(Object.entries(ph).map(([k, v]) => [k, +(v[0] / v[1]).toFixed(2)])) };
}

/** Luminance stats of the current canvas (Rec.709 on sRGB values, 0..1). */
function luma(box = 1): { mean: number; p50: number; p95: number; p99: number; max: number; n05: number } {
  const bw = Math.round(W * box);
  const bh = Math.round(H * box);
  const d = ctx.getImageData(Math.round((W - bw) / 2), Math.round((H - bh) / 2), bw, bh).data;
  const v: number[] = [];
  let n05 = 0;
  for (let i = 0; i < d.length; i += 4) {
    const L = (0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!) / 255;
    if (L > 0.5) n05++;
    if ((i & 15) === 0) v.push(L);
  }
  v.sort((a, b) => a - b);
  const q = (p: number) => +v[Math.floor(p * (v.length - 1))]!.toFixed(4);
  return { mean: +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(4), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: q(1), n05 };
}

// ── OKLab colour-distance check ──
const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
function oklab(r8: number, g8: number, b8: number): [number, number, number] {
  const r = toLin(r8 / 255);
  const g = toLin(g8 / 255);
  const b = toLin(b8 / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787081 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
/** Gameplay colours from palette.ts / enemies.ts / weapons.ts (what must stay readable). */
const GAME_COLORS: Record<string, string> = {
  player: '#e9fbff', playerGlow: '#3ff3ff', bolt: '#7ff9ff', bullet: '#ff4f7a', bulletCore: '#fff0f4', gold: '#ffc93c',
  gemCyan: '#45e8ff', gemGreen: '#6dff8a', gemViolet: '#8f7bff', gemGold: '#fff1a8', danger: '#ff2d55', hp: '#ff4d6d',
  drifter: '#ff3d6e', swarmling: '#ff8c42', dasher: '#ffd23f', splitter: '#b15cff', splitling: '#d79bff', shooter: '#ff4fd2',
  brute: '#ff5233', warden: '#ff2d55', hydra: '#ff7a1a', voidheart: '#9d4dff',
  orbit: '#a6ffef', nova: '#6fd2ff', arc: '#c9b8ff', seeker: '#ffb3f0', mines: '#b4ff6a', lance: '#fff4a8',
};
/**
 * Readability check on the current canvas (render the backdrop only first).
 * For every gameplay colour C: its dim glow G = 0.3 * C (what a sprite's halo
 * looks like), and camo(C) = share of central-box pixels within OKLab dE < 0.05
 * of G, i.e. backdrop features that look like that sprite's glow. Fails when
 * any camo > 0.5%. Also reports the hue concentration the art review measured.
 */
function colourCheck(box = 0.4, thr = 0.05): { worst: [string, number]; camo: Record<string, number>; pass: boolean; hueBand: number; hueMean: number; chromaP95: number } {
  const bw = Math.round(W * box);
  const bh = Math.round(H * box);
  const d = ctx.getImageData(Math.round((W - bw) / 2), Math.round((H - bh) / 2), bw, bh).data;
  const px: [number, number, number][] = [];
  for (let i = 0; i < d.length; i += 8) px.push(oklab(d[i]!, d[i + 1]!, d[i + 2]!));
  const camo: Record<string, number> = {};
  let worst: [string, number] = ['', 0];
  for (const [name, hex] of Object.entries(GAME_COLORS)) {
    const n = parseInt(hex.slice(1), 16);
    const G = oklab(((n >> 16) & 255) * 0.3, ((n >> 8) & 255) * 0.3, (n & 255) * 0.3);
    let c = 0;
    for (const p of px) if (Math.hypot(p[0] - G[0], p[1] - G[1], p[2] - G[2]) < thr) c++;
    camo[name] = +((c / px.length) * 100).toFixed(3);
    if (camo[name]! > worst[1]) worst = [name, camo[name]!];
  }
  // Hue concentration among coloured pixels (OKLCh chroma > 0.012).
  const bins = new Array(12).fill(0) as number[];
  let nc = 0;
  let sx = 0;
  let sy = 0;
  const chroma: number[] = [];
  for (const p of px) {
    const C = Math.hypot(p[1], p[2]);
    chroma.push(C);
    if (C < 0.012) continue;
    nc++;
    const hdeg = ((Math.atan2(p[2], p[1]) * 180) / Math.PI + 360) % 360;
    bins[Math.floor(hdeg / 30) % 12]!++;
    sx += p[1];
    sy += p[2];
  }
  chroma.sort((a, b) => a - b);
  return {
    worst, camo, pass: worst[1] < 0.5,
    hueBand: nc ? +((Math.max(...bins) / nc) * 100).toFixed(1) : 0,
    hueMean: Math.round(((Math.atan2(sy, sx) * 180) / Math.PI + 360) % 360),
    chromaP95: +chroma[Math.floor(0.95 * (chroma.length - 1))]!.toFixed(4),
  };
}


/** Debug: paint central-box pixels within dE < thr of colour C's dim glow in magenta. */
function camoMap(hex: string, box = 0.4, thr = 0.05): void {
  const bw = Math.round(W * box);
  const bh = Math.round(H * box);
  const x0 = Math.round((W - bw) / 2);
  const y0 = Math.round((H - bh) / 2);
  const id = ctx.getImageData(x0, y0, bw, bh);
  const d = id.data;
  const n = parseInt(hex.slice(1), 16);
  const G = oklab(((n >> 16) & 255) * 0.3, ((n >> 8) & 255) * 0.3, (n & 255) * 0.3);
  for (let i = 0; i < d.length; i += 4) {
    const p = oklab(d[i]!, d[i + 1]!, d[i + 2]!);
    if (Math.hypot(p[0] - G[0], p[1] - G[1], p[2] - G[2]) < thr) {
      d[i] = 255;
      d[i + 1] = 0;
      d[i + 2] = 255;
    }
  }
  ctx.putImageData(id, x0, y0);
  ctx.strokeStyle = '#0f0';
  ctx.strokeRect(x0, y0, bw, bh);
}


/** Debug: list clusters of pixels brighter than thr (Rec.709 on sRGB). */
function hotSpots(thr = 0.55): { n: number; boxes: number[][] } {
  const d = ctx.getImageData(0, 0, W, H).data;
  const cells = new Map<number, number[]>();
  let n = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const L = (0.2126 * d[i]! + 0.7152 * d[i + 1]! + 0.0722 * d[i + 2]!) / 255;
    if (L <= thr) continue;
    n++;
    const key = Math.floor(y / 64) * 1000 + Math.floor(x / 64);
    const c = cells.get(key) ?? [x, y, 0, +L.toFixed(2)];
    c[2]!++;
    c[3] = Math.max(c[3]!, +L.toFixed(2));
    cells.set(key, c);
  }
  return { n, boxes: [...cells.values()].sort((a, b) => b[2]! - a[2]!).slice(0, 12) };
}

function genStats(): unknown {
  const out: unknown[] = [];
  for (let i = 0; i < SECTORS.length; i++) {
    const s = backdrop.stats.get(i);
    if (s) out.push({ i, busy: +s.busy.toFixed(1), maxSlice: +s.maxSlice.toFixed(1), wall: +s.wall.toFixed(1), worker: s.worker, parts: Object.fromEntries(Object.entries(s.parts).map(([k, v]) => [k, +v.toFixed(1)])) });
  }
  return out;
}

/** Generate sector i in the background (worker or chunked) while a rAF loop measures main-thread frame gaps. */
async function genBackground(i: number, worker: boolean): Promise<{ wallMs: number; worstFrameMs: number; frames: number }> {
  const b = new GalaxyBackdrop({ quality: H / 1080, worker: worker ? mkWorker : null, budgetMs: 6 });
  const t0 = performance.now();
  b.request(i);
  let last = performance.now();
  let worst = 0;
  let frames = 0;
  await new Promise<void>((res) => {
    const tick = () => {
      const now = performance.now();
      if (frames > 0) worst = Math.max(worst, now - last);
      last = now;
      frames++;
      b.update(1 / 60);
      if (b.isReady(i)) res();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const wallMs = performance.now() - t0;
  const s = b.stats.get(i);
  b.dispose();
  return { wallMs: +wallMs.toFixed(1), worstFrameMs: +worst.toFixed(1), frames, ...(s ? { parts: s.parts } : {}) };
}

/** A full live warp driven by update() with a not-yet-generated target: does the tunnel hold without hitches? */
async function liveWarp(from: number, to: number, worker: boolean): Promise<{ totalS: number; worstFrameMs: number; events: string[] }> {
  const b = new GalaxyBackdrop({ quality: H / 1080, worker: worker ? mkWorker : null });
  const events: string[] = [];
  b.prepare(from);
  b.setSector(from);
  const t0 = performance.now();
  b.onEvent = (e) => events.push(`${e.t}@${((performance.now() - t0) / 1000).toFixed(2)}`);
  b.setSector(to, { warp: true });
  let last = performance.now();
  let worst = 0;
  let n = 0;
  await new Promise<void>((res) => {
    const tick = () => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      if (n++ > 0) worst = Math.max(worst, now - last);
      last = now;
      b.update(Math.min(0.05, dt));
      b.draw(ctx, 0, 0, K, W, H, now / 1000);
      if (!b.warpFx.active) res();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  b.dispose();
  return { totalS: +((performance.now() - t0) / 1000).toFixed(2), worstFrameMs: +worst.toFixed(1), events };
}


/** Resize (e.g. fullscreen toggle 720p -> 1080p): drawing continues (scaled) while the new quality regenerates in the background. */
async function resizeTest(worker: boolean): Promise<{ swapS: number; worstFrameMs: number; rsBefore: number; rsAfter: number }> {
  const b = new GalaxyBackdrop({ quality: 720 / 1080, worker: worker ? mkWorker : null });
  b.prepare(0);
  b.setSector(0);
  const rsOf = () => (b as unknown as { assets: Map<number, { rs: number }> }).assets.get(0)?.rs ?? 0;
  const rsBefore = rsOf();
  const t0 = performance.now();
  let last = t0;
  let worst = 0;
  let n = 0;
  await new Promise<void>((res) => {
    const tick = () => {
      const now = performance.now();
      if (n++ > 0) worst = Math.max(worst, now - last);
      last = now;
      b.update(1 / 60);
      b.draw(ctx, n * 3, 0, K, 1920, 1080, now / 1000);
      if (Math.abs(rsOf() - 1) < 1e-3 || now - t0 > 20000) res();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const out = { swapS: +((performance.now() - t0) / 1000).toFixed(2), worstFrameMs: +worst.toFixed(1), rsBefore: +rsBefore.toFixed(3), rsAfter: +rsOf().toFixed(3) };
  b.dispose();
  return out;
}

(window as unknown as Record<string, unknown>).api = {
  setup, render, renderWarp, bench, benchWarp, luma, colourCheck, camoMap, hotSpots, genStats, genBackground, liveWarp, resizeTest,
  prepare: (i: number) => {
    const t0 = performance.now();
    backdrop.prepare(i);
    return performance.now() - t0;
  },
  mem: () => backdrop.memoryBytes(),
  pieces: () => {
    const a = (backdrop as unknown as { assets: Map<number, { center: { pieces: { img: { width: number; height: number } }[] }[]; planets: { pieces: unknown[] }[] }> }).assets;
    const out: Record<string, unknown> = {};
    for (const [i, s] of a) out[i] = { center: s.center.map((c) => ({ n: c.pieces.length, px: c.pieces.reduce((t, p) => t + p.img.width * p.img.height, 0) })) };
    return out;
  },
  sectors: SECTORS.map((s) => s.name),
};
(window as unknown as Record<string, unknown>).ready = true;
