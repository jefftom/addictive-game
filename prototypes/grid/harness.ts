// Standalone WarpGrid harness: galaxy backdrop (other workstream, drawn first)
// + legacy star layers + WarpGrid + game sprites/particles, driven by scripted
// scenarios through the exact gridfx mapping the renderer will use.
import { GRID_TINTS, WarpGrid } from './combo/src/render/warpgrid';
import { gridEvent, gridFrame } from './combo/src/render/gridfx';
import { SpriteCache, makeGlowDot, type SpriteShape } from './combo/src/render/sprites';
import { Particles } from './combo/src/render/particles';
import { hash32 } from './combo/src/core/rng';
import type { EnemyKind, GameEvent } from './combo/src/game/types';
import { GalaxyBackdrop } from './combo/src/render/galaxy';

interface GridBlast { x: number; y: number; r: number; life: number; max: number }

const canvas = document.getElementById('c') as HTMLCanvasElement;
const strip = document.getElementById('strip') as HTMLCanvasElement;
let ctx = canvas.getContext('2d', { alpha: false })!;
let W = 1280;
let H = 720;
let K = 1;
const sprites = new SpriteCache();
const particles = new Particles();
const grid = new WarpGrid();
let backdrop: GalaxyBackdrop | null = null;
let useGalaxy = true;
const bulletDot = makeGlowDot('rgba(255,79,122,0.9)', '#fff0f4', 64);

const TINTS = GRID_TINTS;
const prevPos = new Float32Array(8);
const view = () => ({ players: [S.player], enemies: S.enemies, mines: S.mines, rings: S.rings });

interface FakeEnemy {
  x: number; y: number; r: number; kind: EnemyKind; boss: boolean; dead: boolean; spawnT: number; hp: number; maxHp: number;
  shape: SpriteShape; color: string; angle: number; vx: number; vy: number; elite: boolean;
}
interface Blast extends GridBlast { color: string }
interface Mine { x: number; y: number; radius: number; triggered: boolean; pull: boolean; pullT: number }
interface Ring { x: number; y: number; radius: number; t: number; duration: number; max: number; color: string }

const DEF: Record<string, [SpriteShape, string, number]> = {
  drifter: ['tri', '#ff3d6e', 13], swarmling: ['dart', '#ff8c42', 8], dasher: ['diamond', '#ffd23f', 12],
  splitter: ['circle', '#b15cff', 16], shooter: ['hex', '#ff4fd2', 15], brute: ['square', '#ff5233', 26],
  warden: ['boss_hex', '#ff2d55', 52], hydra: ['boss_star', '#ff7a1a', 44], voidheart: ['boss_core', '#9d4dff', 60],
};

const S = {
  time: 0, camX: 0, camY: 0, beat: 0, sector: 0, flash: 0, flashColor: '#ffffff', flashes: true,
  player: { x: 0, y: 0, dashT: 0, alive: true, dx: 1, dy: 0, px: 0, py: 0 },
  enemies: [] as FakeEnemy[], mines: [] as Mine[], rings: [] as Ring[], blasts: [] as Blast[],
  script: [] as { at: number; fn: () => void; done?: boolean }[],
  bulletsN: 0,
  follow: true,
};

function rngf(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function addEnemy(kind: EnemyKind, x: number, y: number, elite = false): FakeEnemy {
  const [shape, color, r] = DEF[kind]!;
  const boss = kind === 'warden' || kind === 'hydra' || kind === 'voidheart';
  const e: FakeEnemy = { x, y, r: elite ? r * 1.5 : r, kind, boss, dead: false, spawnT: 0, hp: 100, maxHp: 100, shape, color, angle: 0, vx: 0, vy: 0, elite };
  S.enemies.push(e);
  return e;
}

function populate(n: number, seed: number, minD = 150): void {
  const rnd = rngf(seed);
  const kinds: EnemyKind[] = ['drifter', 'drifter', 'drifter', 'swarmling', 'swarmling', 'dasher', 'splitter', 'shooter', 'brute'];
  const hw = W / 2 / K;
  const hh = H / 2 / K;
  for (let i = 0; i < n; i++) {
    const kd = kinds[Math.floor(rnd() * kinds.length)]!;
    let x = 0;
    let y = 0;
    do {
      x = S.camX + (rnd() * 2 - 1) * hw * 1.05;
      y = S.camY + (rnd() * 2 - 1) * hh * 1.05;
    } while (Math.hypot(x - S.player.x, y - S.player.y) < minD);
    addEnemy(kd, x, y);
  }
}

function emit(ev: GameEvent): void {
  gridEvent(grid, ev, view());
  // Mirror the renderer's existing visual feedback so frames read like the game.
  switch (ev.t) {
    case 'kill': {
      const n = ev.boss ? 120 : ev.elite ? 45 : 7 + ev.r * 0.4;
      particles.burst(ev.x, ev.y, ev.color, n, 200 + ev.r * 5, ev.boss ? 1.2 : 0.55, ev.boss ? 5 : 2.6);
      if (ev.elite || ev.boss) {
        particles.burst(ev.x, ev.y, '#ffffff', n * 0.5, 320, 0.6, 3);
        particles.burst(ev.x, ev.y, '#ffc93c', n * 0.4, 260, 0.9, 3);
        S.blasts.push({ x: ev.x, y: ev.y, r: ev.r * 4, life: 0.5, max: 0.5, color: ev.color });
      }
      break;
    }
    case 'explode':
      particles.burst(ev.x, ev.y, ev.color, 10 + ev.r * 0.12, 160 + ev.r * 2, 0.45, 2.5);
      S.blasts.push({ x: ev.x, y: ev.y, r: ev.r, life: 0.28, max: 0.28, color: ev.color });
      break;
    case 'bossdead':
      S.blasts.push({ x: ev.x, y: ev.y, r: 520, life: 0.9, max: 0.9, color: '#ffffff' });
      flash('#ffffff', 0.6);
      break;
    case 'bomb':
      S.blasts.push({ x: ev.x, y: ev.y, r: 900, life: 0.5, max: 0.5, color: '#ffffff' });
      flash('#ffffff', 0.7);
      break;
    case 'dash':
      particles.spray(ev.x, ev.y, -ev.dx, -ev.dy, '#c9b8ff', 14, 380, 0.45);
      break;
    case 'ring':
      particles.ring(ev.x, ev.y, ev.r * 0.3, ev.color, 10);
      break;
    default:
      break;
  }
}

function flash(color: string, a: number): void {
  if (!S.flashes) a *= 0.25;
  if (a > S.flash) {
    S.flash = a;
    S.flashColor = color;
  }
}

function kill(e: FakeEnemy): void {
  e.dead = true;
  emit({ t: 'kill', x: e.x, y: e.y, color: e.color, r: e.r, elite: e.elite, boss: e.boss, score: 10, dash: false, pid: 0, kind: e.kind, angle: e.angle, kx: 0, ky: 0 });
}

// ────────────────────────────────────────────────────────────── scenarios ──

function reset(sector = 0): void {
  S.time = 0;
  S.camX = 0;
  S.camY = 0;
  S.flash = 0;
  S.sector = sector;
  S.player = { x: 0, y: 0, dashT: 0, alive: true, dx: 1, dy: 0, px: 0, py: 0 };
  S.enemies = [];
  S.mines = [];
  S.rings = [];
  S.blasts = [];
  S.script = [];
  S.bulletsN = 0;
  S.follow = true;
  particles.clear();
  grid.resize(W / K + 40, H / K + 40);
  grid.reset();
  grid.update(0, 0, 0);
  prevPos.fill(0);
  if (backdrop) backdrop.setSector(sector, { sync: true });
}

const scenarios: Record<string, () => void> = {
  kill() {
    populate(26, 7, 220);
    const a = addEnemy('drifter', 230, -70);
    const b = addEnemy('swarmling', 290, -20);
    const c = addEnemy('splitter', 200, 10);
    const el = addEnemy('shooter', -280, 140, true);
    S.script.push({ at: 0.1, fn: () => kill(a) }, { at: 0.17, fn: () => kill(b) }, { at: 0.24, fn: () => kill(c) }, { at: 0.5, fn: () => kill(el) });
  },
  boss() {
    populate(18, 11, 260);
    const w = addEnemy('warden', 300, -40);
    w.vx = -40;
    S.script.push({ at: 0.8, fn: () => { kill(w); emit({ t: 'bossdead', x: w.x, y: w.y, name: 'warden' }); } });
  },
  blackhole() {
    populate(30, 21, 120);
    const m: Mine = { x: -200, y: 40, radius: 120, triggered: false, pull: true, pullT: 0 };
    S.mines.push(m);
    S.script.push({ at: 0.05, fn: () => { m.triggered = true; m.pullT = 0.9; } });
  },
  voidheart() {
    populate(14, 31, 260);
    const v = addEnemy('voidheart', 230, -20);
    v.vx = -18;
  },
  dash() {
    populate(22, 41, 180);
    S.player.x = -300;
    S.player.y = 60;
    S.camX = -300;
    S.camY = 60;
    grid.update(0, S.camX, S.camY);
    prevPos[0] = S.player.x;
    prevPos[1] = S.player.y;
    S.script.push({ at: 0.15, fn: () => startDash(0.96, -0.28) }, { at: 0.75, fn: () => startDash(0.2, 0.98) });
  },
  brute() {
    S.enemies = [];
    for (let i = 0; i < 4; i++) {
      const e = addEnemy('brute', -420 + i * 60, -160 + i * 110);
      e.vx = 52;
      e.vy = 6;
    }
    const hy = addEnemy('hydra', -350, 230);
    hy.vx = 74;
  },
  nova() {
    populate(30, 51, 120);
    S.script.push({ at: 0.1, fn: () => nova(0, 0, 260) }, { at: 0.55, fn: () => nova(0, 0, 260) });
  },
  chaos() {
    populate(300, 61, 120);
    S.mines.push({ x: -260, y: -120, radius: 120, triggered: true, pull: true, pullT: 999 });
    addEnemy('voidheart', 330, 120);
    S.bulletsN = 80;
  },
};

function nova(x: number, y: number, max: number): void {
  S.rings.push({ x, y, radius: 0, t: 0, duration: 0.45, max, color: '#7ff9ff' });
  emit({ t: 'ring', x, y, r: max, color: '#7ff9ff' });
}

function startDash(dx: number, dy: number): void {
  const l = Math.hypot(dx, dy);
  S.player.dx = dx / l;
  S.player.dy = dy / l;
  S.player.dashT = 0.17;
  emit({ t: 'dash', x: S.player.x, y: S.player.y, dx: S.player.dx, dy: S.player.dy, pid: 0 });
}

let chaosClock = 0;
const chaosRnd = rngf(99);

function step(dt: number): void {
  S.time += dt;
  for (const s of S.script) {
    if (!s.done && S.time >= s.at) {
      s.done = true;
      s.fn();
    }
  }
  const p = S.player;
  p.px = p.x;
  p.py = p.y;
  if (p.dashT > 0) {
    p.x += p.dx * 1150 * dt;
    p.y += p.dy * 1150 * dt;
    p.dashT -= dt;
  }
  for (const e of S.enemies) {
    if (e.dead) continue;
    if (e.vx || e.vy) {
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      e.angle = Math.atan2(e.vy, e.vx);
    } else {
      // Drift toward the player (or the black hole, if one is pulling).
      let tx = p.x - e.x;
      let ty = p.y - e.y;
      for (const m of S.mines) {
        if (!m.triggered || !m.pull) continue;
        const mx = m.x - e.x;
        const my = m.y - e.y;
        const d = Math.hypot(mx, my);
        if (d < m.radius * 1.3 && !e.boss) {
          const f = Math.min(420 * dt, d - 4) / (d || 1);
          e.x += mx * f;
          e.y += my * f;
        }
      }
      const d = Math.hypot(tx, ty) || 1;
      tx /= d;
      ty /= d;
      if (d > 60) {
        e.x += tx * 40 * dt;
        e.y += ty * 40 * dt;
      }
      e.angle = e.kind === 'drifter' || e.kind === 'swarmling' ? Math.atan2(ty, tx) : e.angle + dt;
    }
    if (e.kind === 'voidheart') e.angle += dt * 0.6;
  }
  for (const m of S.mines) {
    if (!m.triggered) continue;
    m.pullT -= dt;
    if (m.pullT <= 0) {
      emit({ t: 'explode', x: m.x, y: m.y, r: m.radius, color: '#b4ff6a' });
      for (const e of S.enemies) if (!e.dead && Math.hypot(e.x - m.x, e.y - m.y) < m.radius) kill(e);
      m.triggered = false;
      m.pull = false;
    }
  }
  for (const r of S.rings) {
    r.t += dt;
    r.radius = r.max * Math.min(1, r.t / r.duration);
  }
  S.rings = S.rings.filter((r) => r.t < r.duration + 0.25);

  if (scenarioName === 'chaos') {
    // ~25 kills/s, an explosion every 0.4 s, a nova every 1.2 s, dash every 1.5 s.
    chaosClock += dt;
    const hw = W / 2 / K;
    const hh = H / 2 / K;
    for (let i = 0; i < 25 * dt * 2; i++) {
      if (chaosRnd() < 0.5) continue;
      const alive = S.enemies.filter((e) => !e.dead && !e.boss);
      if (alive.length < 200) populate(40, (S.time * 1000) | 0, 160);
      const e = alive[Math.floor(chaosRnd() * alive.length)];
      if (e) kill(e);
    }
    if (Math.floor(chaosClock / 0.4) !== Math.floor((chaosClock - dt) / 0.4)) {
      emit({ t: 'explode', x: S.camX + (chaosRnd() * 2 - 1) * hw * 0.8, y: S.camY + (chaosRnd() * 2 - 1) * hh * 0.8, r: 90, color: '#ffb3f0' });
    }
    if (Math.floor(chaosClock / 1.2) !== Math.floor((chaosClock - dt) / 1.2)) nova(p.x, p.y, 240);
    if (Math.floor(chaosClock / 1.5) !== Math.floor((chaosClock - dt) / 1.5)) startDash(Math.cos(S.time), Math.sin(S.time));
    S.enemies = S.enemies.filter((e) => !e.dead);
  }

  for (const b of S.blasts) b.life -= dt;
  S.blasts = S.blasts.filter((b) => b.life > 0);
  if (S.follow) {
    const cd = 1 - Math.exp(-7 * dt);
    S.camX += (p.x - S.camX) * cd;
    S.camY += (p.y - S.camY) * cd;
  }
  // Fake music beat at 128 bpm.
  const ph = (S.time / (60 / 128)) % 1;
  S.beat = Math.pow(1 - ph, 4);
  S.flash = Math.max(0, S.flash - dt * 2.2);
  particles.update(dt);
}

/** Grid work for one frame: continuous forces + integration. Timed separately. */
function gridTick(dt: number): void {
  // Same intensity -> brightness mapping as the renderer integration.
  const alive = S.enemies.length;
  grid.brightness = 1 - Math.min(1, alive / 220 + (S.enemies.some((e) => e.boss) ? 0.3 : 0)) * 0.25;
  gridFrame(grid, view(), prevPos, dt);
  grid.update(dt, S.camX, S.camY);
}

// ──────────────────────────────────────────────────────────────── drawing ──

function frac(n: number): number {
  return (n % 1000003) / 1000003;
}

function stars(camX: number, camY: number, time: number): void {
  const k = K;
  const halfW = W / 2 / k;
  const halfH = H / 2 / k;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = '#cfe4ff';
  for (const L of [{ p: 0.2, cell: 160, size: 1, alpha: 0.45 }, { p: 0.4, cell: 220, size: 1.5, alpha: 0.6 }, { p: 0.65, cell: 320, size: 2, alpha: 0.8 }]) {
    const cx = camX * L.p;
    const cy = camY * L.p;
    for (let gx = Math.floor((cx - halfW) / L.cell); gx <= Math.floor((cx + halfW) / L.cell); gx++) {
      for (let gy = Math.floor((cy - halfH) / L.cell); gy <= Math.floor((cy + halfH) / L.cell); gy++) {
        const hsh = hash32((gx * 92837111) ^ (gy * 689287499) ^ (L.cell * 31));
        const wx = (gx + frac(hsh)) * L.cell;
        const wy = (gy + frac(hash32(hsh ^ 0x5bd1e995))) * L.cell;
        ctx.globalAlpha = L.alpha * (0.6 + 0.4 * Math.sin(time * (1 + (hsh % 5)) + (hsh % 100)));
        const s = L.size * Math.max(1, k * 0.8);
        ctx.fillRect((wx - cx) * k + W / 2 - s / 2, (wy - cy) * k + H / 2 - s / 2, s, s);
      }
    }
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
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

function sprite(shape: SpriteShape, color: string, r: number, x: number, y: number, a: number, variant: 'normal' | 'elite' | 'flash' = 'normal'): void {
  const s = sprites.get(shape, color, r, variant);
  const ox = W / 2 - S.camX * K;
  const oy = H / 2 - S.camY * K;
  const c = Math.cos(a) * K;
  const sn = Math.sin(a) * K;
  ctx.setTransform(c, sn, -sn, c, ox + x * K, oy + y * K);
  ctx.drawImage(s.canvas, -s.size / 2, -s.size / 2, s.size, s.size);
}

let showGrid = true;
let showGame = true;

function render(): void {
  const k = K;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  if (backdrop && useGalaxy) backdrop.draw(ctx, S.camX, S.camY, k, W, H, S.time);
  else {
    ctx.fillStyle = '#05040f';
    ctx.fillRect(0, 0, W, H);
  }
  stars(S.camX, S.camY, S.time);
  if (showGrid) grid.draw(ctx, S.camX, S.camY, k, W, H, TINTS[S.sector]!, S.beat);
  if (!showGame) {
    vignette();
    return;
  }
  const ox = W / 2 - S.camX * k;
  const oy = H / 2 - S.camY * k;
  const world = () => ctx.setTransform(k, 0, 0, k, ox, oy);
  // Rings.
  world();
  for (const r of S.rings) {
    const kk = Math.min(1, r.t / r.duration);
    const fade = r.t > r.duration ? 1 - (r.t - r.duration) / 0.25 : 1;
    ctx.globalAlpha = (1 - kk * 0.7) * fade;
    ctx.strokeStyle = r.color;
    ctx.lineWidth = 3 + (1 - kk) * 12;
    ctx.beginPath();
    ctx.arc(r.x, r.y, Math.max(1, r.radius), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  for (const m of S.mines) {
    if (m.triggered && m.pull) {
      world();
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = '#b4ff6a';
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.arc(m.x, m.y, m.radius * (1.3 - ((S.time * 1.5 + i / 3) % 1)), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      sprite('mine', '#b4ff6a', 7, m.x, m.y, 0, 'flash');
    }
  }
  for (const e of S.enemies) {
    if (e.dead) continue;
    sprite(e.shape, e.color, e.r, e.x, e.y, e.angle, e.elite ? 'elite' : 'normal');
  }
  ctx.globalCompositeOperation = 'lighter';
  world();
  const rnd = rngf(5);
  for (let i = 0; i < S.bulletsN; i++) {
    const x = S.camX + (rnd() * 2 - 1) * (W / 2 / k) + Math.sin(S.time + i) * 30;
    const y = S.camY + (rnd() * 2 - 1) * (H / 2 / k);
    ctx.drawImage(bulletDot, x - 10, y - 10, 20, 20);
  }
  particles.draw(ctx, S.camX - W / k, S.camY - H / k, S.camX + W / k, S.camY + H / k);
  for (const b of S.blasts) {
    const kk = 1 - b.life / b.max;
    ctx.globalAlpha = (1 - kk) * 0.8;
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 6 * (1 - kk) + 1;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r * (0.3 + 0.7 * kk), 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = (1 - kk) * 0.18;
    ctx.fillStyle = b.color;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  const p = S.player;
  sprite('player', p.dashT > 0 ? '#c9b8ff' : '#7ff9ff', 13, p.x, p.y, Math.atan2(p.dy, p.dx));
  vignette();
  if (S.flash > 0.01) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = S.flash;
    ctx.fillStyle = S.flashColor;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
}

// ───────────────────────────────────────────────────────────────────── api ──

let scenarioName = '';

function setup(w: number, h: number, opts: { galaxy?: boolean; dpr?: number } = {}): void {
  W = w;
  H = h;
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = w / (opts.dpr ?? 1) + 'px';
  canvas.style.height = h / (opts.dpr ?? 1) + 'px';
  ctx = canvas.getContext('2d', { alpha: false })!;
  const dpr = opts.dpr ?? 1;
  const cw = w / dpr;
  const ch = h / dpr;
  const short = Math.min(cw, ch);
  const t = Math.min(1, Math.max(0, (short - 420) / (900 - 420)));
  const area = 470 * 980 + (1366 * 768 - 470 * 980) * t;
  K = Math.sqrt((cw * ch) / area) * dpr;
  sprites.setResolution(K);
  useGalaxy = opts.galaxy !== false;
  if (useGalaxy && !backdrop) backdrop = new GalaxyBackdrop({ quality: h / 1080 });
}

function scenario(name: string, sector = 0): void {
  scenarioName = name;
  reset(sector);
  scenarios[name]!();
}

/** Advance sim + grid by `seconds` at a fixed 60 Hz frame rate (grid has its own fixed step). */
function advance(seconds: number): void {
  const n = Math.round(seconds * 60);
  for (let i = 0; i < n; i++) {
    step(1 / 60);
    gridTick(1 / 60);
  }
}

/** Render a frame sequence of the current scenario at the given times, into a contact strip. */
function sequence(times: number[], cols: number, thumbW: number): { frames: string[]; strip: string; heat: number[] } {
  const thumbH = Math.round((thumbW * H) / W);
  const rows = Math.ceil(times.length / cols);
  strip.width = cols * thumbW + (cols - 1) * 4;
  strip.height = rows * thumbH + (rows - 1) * 4 + 0;
  const sc = strip.getContext('2d')!;
  sc.fillStyle = '#000';
  sc.fillRect(0, 0, strip.width, strip.height);
  const frames: string[] = [];
  const heat: number[] = [];
  for (let i = 0; i < times.length; i++) {
    advance(times[i]! - S.time);
    render();
    heat.push(+grid.maxHeat.toFixed(2));
    frames.push(canvas.toDataURL('image/png'));
    const cx = (i % cols) * (thumbW + 4);
    const cy = Math.floor(i / cols) * (thumbH + 4);
    sc.drawImage(canvas, cx, cy, thumbW, thumbH);
    sc.fillStyle = 'rgba(0,0,0,0.6)';
    sc.fillRect(cx, cy, 92, 22);
    sc.fillStyle = '#fff';
    sc.font = '14px monospace';
    sc.fillText(`t=${times[i]!.toFixed(2)}s`, cx + 6, cy + 16);
  }
  return { frames, strip: strip.toDataURL('image/png'), heat };
}

function pct(a: number[], p: number): number {
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
}

/** Chaos benchmark. Returns ms stats for grid JS update, grid draw (JS), and raster-included grid cost. */
function legacyGrid(camX: number, camY: number, beat: number): void {
  const k = K, w = W, h = H;
  const halfW = w / 2 / k, halfH = h / 2 / k;
  const spacing = 80;
  const pulse = 1 + beat * 0.9;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.lineWidth = Math.max(1, k * 0.9);
  for (let major = 0; major < 2; major++) {
    ctx.strokeStyle = major ? `rgba(120,150,255,${0.1 * pulse})` : `rgba(96,120,255,${0.05 * pulse})`;
    ctx.beginPath();
    for (let gx = Math.floor((camX - halfW) / spacing) * spacing; gx <= camX + halfW; gx += spacing) {
      if ((Math.round(gx / spacing) % 5 === 0) !== (major === 1)) continue;
      const sx = Math.round((gx - camX) * k + w / 2) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, h);
    }
    for (let gy = Math.floor((camY - halfH) / spacing) * spacing; gy <= camY + halfH; gy += spacing) {
      if ((Math.round(gy / spacing) % 5 === 0) !== (major === 1)) continue;
      const sy = Math.round((gy - camY) * k + h / 2) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(w, sy);
    }
    ctx.stroke();
  }
}

function bench(frames: number, mode = 'grid'): Record<string, unknown> {
  scenario('chaos', 1);
  advance(1);
  const up: number[] = [];
  const dr: number[] = [];
  const drFlush: number[] = [];
  const base: number[] = [];
  const flushPx = () => ctx.getImageData(0, 0, 1, 1);
  for (let f = 0; f < frames; f++) {
    step(1 / 60);
    let t0 = performance.now();
    gridTick(1 / 60);
    up.push(performance.now() - t0);
    // Background only (baseline), flushed.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05040f';
    ctx.fillRect(0, 0, W, H);
    flushPx();
    t0 = performance.now();
    ctx.fillRect(0, 0, W, H);
    flushPx();
    base.push(performance.now() - t0);
    t0 = performance.now();
    if (mode === 'legacy') legacyGrid(S.camX, S.camY, S.beat);
    else if (mode === 'none') ctx.getImageData(0, 0, 1, 1);
    else grid.draw(ctx, S.camX, S.camY, K, W, H, TINTS[1]!, S.beat);
    const t1 = performance.now();
    flushPx();
    const t2 = performance.now();
    dr.push(t1 - t0);
    drFlush.push(t2 - t0);
  }
  const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  return {
    mode, W, H, K: +K.toFixed(3), points: grid.pointCount, frames,
    updateMs: { mean: +mean(up).toFixed(3), p95: +pct(up, 0.95).toFixed(3), max: +Math.max(...up).toFixed(3) },
    drawJsMs: { mean: +mean(dr).toFixed(3), p95: +pct(dr, 0.95).toFixed(3) },
    drawRasterMs: { mean: +(mean(drFlush) - mean(base)).toFixed(3), p95: +pct(drFlush, 0.95).toFixed(3), fillFlushBaseline: +mean(base).toFixed(3) },
  };
}

/**
 * Brightness budget probe: for each time, render ONLY the grid over pure black and report
 * the max RGB channel (0..1) of grid pixels: max, p99.9, p99 and the share above the
 * 0.45 bloom threshold.
 */
function measure(times: number[]): Record<string, number>[] {
  const out: Record<string, number>[] = [];
  for (const t of times) {
    advance(t - S.time);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    grid.draw(ctx, S.camX, S.camY, K, W, H, TINTS[S.sector]!, S.beat);
    const d = ctx.getImageData(0, 0, W, H).data;
    const hist = new Uint32Array(256);
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) {
      const m = Math.max(d[i]!, d[i + 1]!, d[i + 2]!);
      if (m > 2) {
        hist[m]!++;
        lit++;
      }
    }
    const q = (p: number) => {
      let acc = 0;
      for (let v = 255; v >= 0; v--) {
        acc += hist[v]!;
        if (acc >= lit * (1 - p)) return +(v / 255).toFixed(3);
      }
      return 0;
    };
    let max = 0;
    for (let v = 255; v >= 0; v--) if (hist[v]) { max = v; break; }
    let over = 0;
    for (let v = 115; v < 256; v++) over += hist[v]!;
    out.push({ t: +t.toFixed(2), max: +(max / 255).toFixed(3), p999: q(0.999), p99: q(0.99), over045: +(over / Math.max(1, lit)).toFixed(4), heat: +grid.maxHeat.toFixed(2), flare: +grid.flare.toFixed(2), beat: +S.beat.toFixed(2) });
  }
  return out;
}

(window as unknown as Record<string, unknown>).api = {
  setup, scenario, advance, render, sequence, bench, measure,
  set: (o: { grid?: boolean; game?: boolean; flashes?: boolean; maxLevel?: number; galaxy?: boolean }) => {
    if (o.grid !== undefined) showGrid = o.grid;
    if (o.game !== undefined) showGame = o.game;
    if (o.galaxy !== undefined) useGalaxy = o.galaxy;
    if (o.flashes !== undefined) {
      S.flashes = o.flashes;
      grid.maxLevel = o.flashes ? 5 : 3;
      grid.flareAllowed = o.flashes;
      grid.beatPulse = o.flashes ? 0.5 : 0;
    }
  },
  tune: (o: Record<string, number>) => Object.assign(grid, o),
  time: () => S.time,
  heat: () => grid.maxHeat,
};
(window as unknown as Record<string, unknown>).ready = true;
