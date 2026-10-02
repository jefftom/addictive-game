import { TAU, clamp, damp, formatNumber, lerp } from '../core/math';
import { COMBO_TIERS } from '../game/combo';
import { ENEMIES } from '../game/content/enemies';
import { WEAPONS } from '../game/content/weapons';
import type { GameEvent } from '../game/types';
import type { World } from '../game/world';
import { Background, hexAlpha } from './background';
import { Arcs, Callouts, FloatTexts, Shake } from './effects';
import { drawHud, type HudState } from './hud';
import { PAL, gemTier } from './palette';
import { Particles } from './particles';
import { SpriteCache, makeGlowDot, type SpriteShape } from './sprites';

export interface RenderSettings {
  shake: number;
  flashes: boolean;
  damageNumbers: boolean;
  showFps: boolean;
  trail: string;
}

interface Blast {
  x: number;
  y: number;
  r: number;
  life: number;
  max: number;
  color: string;
}

const TARGET_AREA_DESKTOP = 1366 * 768;
const TARGET_AREA_MOBILE = 470 * 980;

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  dpr = 1;
  /** CSS px size. */
  cssW = 0;
  cssH = 0;
  /** Device px size. */
  w = 0;
  h = 0;
  /** CSS px per world unit. */
  scale = 1;
  /** UI scale in device px. */
  ui = 1;
  camX = 0;
  camY = 0;

  readonly sprites = new SpriteCache();
  readonly particles = new Particles();
  readonly texts = new FloatTexts();
  readonly callouts = new Callouts();
  readonly arcs = new Arcs();
  readonly shake = new Shake();
  private readonly bg = new Background();
  private blasts: Blast[] = [];
  private flash = { color: '#ffffff', a: 0 };
  private trail: { x: number; y: number }[] = [];
  private bulletDot: HTMLCanvasElement;
  private boltDot: HTMLCanvasElement;
  private time = 0;
  beat = 0;
  intensity = 0;
  hud: HudState;
  settings: RenderSettings = { shake: 1, flashes: true, damageNumbers: true, showFps: false, trail: '#7ff9ff' };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;
    this.bulletDot = makeGlowDot('rgba(255,79,122,0.9)', '#fff0f4', 64);
    this.boltDot = makeGlowDot('rgba(127,249,255,0.9)', '#ffffff', 64);
    this.hud = {
      bestScore: 0,
      touch: false,
      fps: 60,
      showFps: false,
      xpFlash: 0,
      hpFlash: 0,
      comboBreak: null,
      dashButton: { x: 0, y: 0, r: 0 },
      stick: { active: false, ox: 0, oy: 0, x: 0, y: 0 },
      pauseInset: 0,
    };
    this.resize();
  }

  /** Recomputes sizes; returns the visible half extents in world units. */
  resize(): { halfW: number; halfH: number } {
    const cssW = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const cssH = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.cssW = cssW;
    this.cssH = cssH;
    this.w = Math.round(cssW * this.dpr);
    this.h = Math.round(cssH * this.dpr);
    if (this.canvas.width !== this.w || this.canvas.height !== this.h) {
      this.canvas.width = this.w;
      this.canvas.height = this.h;
    }
    const short = Math.min(cssW, cssH);
    const t = clamp((short - 420) / (900 - 420), 0, 1);
    const targetArea = lerp(TARGET_AREA_MOBILE, TARGET_AREA_DESKTOP, t);
    this.scale = Math.sqrt((cssW * cssH) / targetArea);
    this.ui = clamp(short / 760, 0.72, 1.35) * this.dpr;
    this.sprites.setResolution(this.scale * this.dpr);
    const ui = this.ui;
    this.hud.dashButton = { x: this.w - 74 * ui, y: this.h - 96 * ui, r: 44 * ui };
    // The DOM pause button is 40px + 10px margin (CSS px).
    this.hud.pauseInset = 50 * this.dpr;
    return { halfW: cssW / 2 / this.scale, halfH: cssH / 2 / this.scale };
  }

  reset(world: World): void {
    this.particles.clear();
    this.texts.clear();
    this.callouts.clear();
    this.arcs.clear();
    this.blasts = [];
    this.trail = [];
    this.flash.a = 0;
    this.shake.trauma = 0;
    this.camX = world.player.x;
    this.camY = world.player.y;
    this.hud.comboBreak = null;
  }

  private addFlash(color: string, a: number): void {
    if (!this.settings.flashes) a *= 0.25;
    if (a > this.flash.a) {
      this.flash.color = color;
      this.flash.a = a;
    }
  }

  /** Turns simulation events into visual feedback. */
  consume(events: readonly GameEvent[], world: World): void {
    const P = this.particles;
    for (const ev of events) {
      switch (ev.t) {
        case 'hit':
          P.spray(ev.x, ev.y, 0, -1, ev.crit ? '#ffd23f' : '#ffffff', ev.crit ? 4 : 1, 260, Math.PI);
          if (this.settings.damageNumbers) {
            this.texts.add(ev.x, ev.y, String(Math.round(ev.dmg)), ev.crit ? '#ffd23f' : '#eaf2ff', ev.crit ? 15 : 10.5, ev.crit ? 0.75 : 0.5);
          }
          break;
        case 'kill': {
          const n = ev.boss ? 120 : ev.elite ? 45 : 7 + ev.r * 0.4;
          P.burst(ev.x, ev.y, ev.color, n, 200 + ev.r * 5, ev.boss ? 1.2 : 0.55, ev.boss ? 5 : 2.6);
          if (ev.elite || ev.boss) {
            P.burst(ev.x, ev.y, '#ffffff', n * 0.5, 320, 0.6, 3);
            P.burst(ev.x, ev.y, PAL.gold, n * 0.4, 260, 0.9, 3);
            this.blasts.push({ x: ev.x, y: ev.y, r: ev.r * 4, life: 0.5, max: 0.5, color: ev.color });
            this.texts.add(ev.x, ev.y - ev.r, `+${formatNumber(ev.score)}`, PAL.gold, 18, 1.1, true);
          } else if (ev.score >= 100) {
            this.texts.add(ev.x, ev.y, `+${ev.score}`, '#fff4a8', 11, 0.6);
          }
          this.shake.add(ev.boss ? 1 : ev.elite ? 0.3 : 0.03);
          break;
        }
        case 'pickup':
          if (ev.kind === 'xp') this.hud.xpFlash = Math.min(1, this.hud.xpFlash + 0.12);
          else if (ev.kind === 'heart') {
            P.burst(world.player.x, world.player.y, '#6dff8a', 16, 160);
          } else if (ev.kind === 'core') {
            this.texts.add(world.player.x, world.player.y - 20, `+${ev.value} ◈`, PAL.gold, 14, 0.9, true);
          } else if (ev.kind === 'cache') {
            P.burst(world.player.x, world.player.y, PAL.gold, 40, 300, 0.8, 3);
            this.callouts.add('CACHE', PAL.gold, 0.8, 'Bonus upgrade');
          }
          break;
        case 'levelup':
          P.ring(world.player.x, world.player.y, 30, PAL.xp, 36);
          this.hud.xpFlash = 1;
          break;
        case 'dash':
          P.spray(ev.x, ev.y, -ev.dx, -ev.dy, '#c9b8ff', 14, 380, 0.45);
          break;
        case 'dashready':
          P.ring(world.player.x, world.player.y, 18, '#c9b8ff', 12);
          break;
        case 'perfect':
          this.callouts.add('PERFECT', '#7ff9ff', 0.85, '+3 combo · dash refund', 0.8);
          P.ring(ev.x, ev.y, 26, '#7ff9ff', 28);
          this.blasts.push({ x: ev.x, y: ev.y, r: 90, life: 0.3, max: 0.3, color: '#7ff9ff' });
          this.shake.add(0.12);
          break;
        case 'hurt':
          this.shake.add(0.45);
          this.addFlash('#ff2d55', 0.35);
          this.hud.hpFlash = 1;
          P.burst(ev.x, ev.y, '#ff4d6d', 14, 240, 0.4);
          break;
        case 'shieldbreak':
          this.callouts.add('SHIELD', '#7ff9ff', 0.7, 'Blocked a hit', 0.8);
          P.ring(ev.x, ev.y, 24, '#7ff9ff', 30);
          this.shake.add(0.25);
          break;
        case 'heal':
          if (ev.amount >= 3) this.texts.add(world.player.x, world.player.y - 18, `+${Math.round(ev.amount)}`, '#6dff8a', 13, 0.8, true);
          break;
        case 'combo':
          this.callouts.add(`×${ev.mult}`, PAL.combo[ev.tier] ?? '#fff', 1.15, `${COMBO_TIERS[ev.tier]} COMBO`, 1);
          break;
        case 'combobreak':
          if (ev.combo >= 10) this.hud.comboBreak = { value: ev.combo, t: 1 };
          break;
        case 'milestone':
          this.callouts.add(ev.name, PAL.gold, 0.9, `${ev.combo} COMBO`, 1.3);
          P.ring(world.player.x, world.player.y, 40, PAL.gold, 40);
          this.shake.add(0.2);
          break;
        case 'boss':
          this.callouts.add('WARNING', '#ff2d55', 1.3, `${ev.name.toUpperCase()} · ${ev.title}`, 2.6);
          this.addFlash('#ff2d55', 0.25);
          this.shake.add(0.3);
          break;
        case 'bossdead':
          this.callouts.add('BOSS DESTROYED', PAL.gold, 1, ev.name.toUpperCase(), 2);
          this.addFlash('#ffffff', 0.6);
          this.blasts.push({ x: ev.x, y: ev.y, r: 520, life: 0.9, max: 0.9, color: '#ffffff' });
          break;
        case 'death':
          P.burst(ev.x, ev.y, '#7ff9ff', 90, 420, 1.4, 4);
          P.burst(ev.x, ev.y, '#ffffff', 50, 260, 1.2, 3);
          this.shake.add(0.8);
          this.addFlash('#ff2d55', 0.4);
          break;
        case 'revive':
          this.callouts.add('SECOND WIND', '#ffffff', 1, 'Revived', 1.5);
          this.addFlash('#ffffff', 0.5);
          break;
        case 'ring':
          P.ring(ev.x, ev.y, ev.r * 0.3, ev.color, 10);
          break;
        case 'arc':
          this.arcs.add(ev.points, ev.evolved);
          break;
        case 'explode':
          P.burst(ev.x, ev.y, ev.color, 10 + ev.r * 0.12, 160 + ev.r * 2, 0.45, 2.5);
          this.blasts.push({ x: ev.x, y: ev.y, r: ev.r, life: 0.28, max: 0.28, color: ev.color });
          this.shake.add(0.05);
          break;
        case 'elite':
          this.callouts.add('ELITE', PAL.gold, 0.6, 'Drops a cache', 0.9);
          break;
        case 'surge':
          this.callouts.add('SURGE', '#ff6b8a', 0.75, 'They are closing in', 1);
          break;
        case 'bomb':
          this.addFlash('#ffffff', 0.7);
          this.shake.add(0.6);
          this.blasts.push({ x: ev.x, y: ev.y, r: 900, life: 0.5, max: 0.5, color: '#ffffff' });
          this.callouts.add('BOMB', '#ffffff', 0.8, '', 0.8);
          break;
        case 'magnet':
          this.callouts.add('MAGNET', PAL.xp, 0.7, '', 0.8);
          P.ring(world.player.x, world.player.y, 40, PAL.xp, 30);
          break;
        case 'newbest':
          this.callouts.add('NEW BEST!', PAL.gold, 1.1, 'Keep going', 1.6);
          P.confetti(world.player.x, world.player.y - 40, PAL.combo, 70);
          break;
        case 'victory':
          this.callouts.add('10:00 SURVIVED', PAL.gold, 1.1, 'VICTORY', 2.5);
          P.confetti(world.player.x, world.player.y - 40, PAL.combo, 120);
          break;
        case 'shoot':
        case 'enemyshoot':
          break;
      }
    }
  }

  private drawSprite(shape: SpriteShape, color: string, radius: number, variant: 'normal' | 'flash' | 'elite', x: number, y: number, angle: number, k: number, ox: number, oy: number, mul = 1): void {
    const s = this.sprites.get(shape, color, radius, variant);
    const kk = k * mul;
    const c = Math.cos(angle) * kk;
    const sn = Math.sin(angle) * kk;
    this.ctx.setTransform(c, sn, -sn, c, ox + x * k, oy + y * k);
    this.ctx.drawImage(s.canvas, -s.size / 2, -s.size / 2, s.size, s.size);
  }

  draw(world: World, dt: number, opts: { attract: boolean; realDt: number }): void {
    const ctx = this.ctx;
    const rdt = opts.realDt;
    this.time += rdt;
    this.particles.update(dt);
    this.texts.update(dt);
    this.callouts.update(rdt);
    this.arcs.update(dt);
    this.shake.update(rdt, this.settings.shake);
    this.flash.a = Math.max(0, this.flash.a - rdt * 2.2);
    this.hud.xpFlash = Math.max(0, this.hud.xpFlash - rdt * 3);
    this.hud.hpFlash = Math.max(0, this.hud.hpFlash - rdt * 4);
    if (this.hud.comboBreak) this.hud.comboBreak.t -= rdt * 0.8;
    for (const b of this.blasts) b.life -= dt;
    this.blasts = this.blasts.filter((b) => b.life > 0);

    const p = world.player;
    // Camera with slight look-ahead.
    const tx = p.x + p.vx * 0.12;
    const ty = p.y + p.vy * 0.12;
    const cd = damp(7, rdt);
    this.camX += (tx - this.camX) * cd;
    this.camY += (ty - this.camY) * cd;

    const k = this.scale * this.dpr;
    const w = this.w;
    const h = this.h;
    const ox = w / 2 - this.camX * k + this.shake.x * this.dpr;
    const oy = h / 2 - this.camY * k + this.shake.y * this.dpr;
    const halfW = w / 2 / k + 80;
    const halfH = h / 2 / k + 80;
    const minX = this.camX - halfW;
    const maxX = this.camX + halfW;
    const minY = this.camY - halfH;
    const maxY = this.camY + halfH;
    const visible = (x: number, y: number, r: number) => x + r > minX && x - r < maxX && y + r > minY && y - r < maxY;

    this.bg.draw(ctx, this.camX - this.shake.x / this.scale, this.camY - this.shake.y / this.scale, k, w, h, this.time, this.beat, this.intensity);

    const world2 = () => ctx.setTransform(k, 0, 0, k, ox, oy);
    world2();

    // ── Rings (under everything) ──
    for (const r of world.rings) {
      if (r.t < 0) continue;
      const kk = Math.min(1, r.t / r.duration);
      const fade = r.t > r.duration ? 1 - (r.t - r.duration) / 0.25 : 1;
      ctx.globalAlpha = (1 - kk * 0.7) * fade;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 3 + (1 - kk) * 12;
      ctx.beginPath();
      ctx.arc(r.x, r.y, Math.max(1, r.radius), 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 0.08 * (1 - kk) * fade;
      ctx.fillStyle = r.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // ── Mines ──
    for (const m of world.mines) {
      if (!visible(m.x, m.y, m.radius)) continue;
      const pulse = 1 + Math.sin(this.time * 10) * 0.15;
      if (m.triggered && m.pull) {
        world2();
        ctx.globalAlpha = 0.5;
        ctx.strokeStyle = '#b4ff6a';
        ctx.lineWidth = 2;
        for (let i = 0; i < 3; i++) {
          ctx.beginPath();
          ctx.arc(m.x, m.y, m.radius * (1.3 - ((this.time * 1.5 + i / 3) % 1)), 0, TAU);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      this.drawSprite('mine', '#b4ff6a', 7, m.armT > 0 ? 'normal' : m.triggered ? 'flash' : 'normal', m.x, m.y, 0, k, ox, oy, pulse);
    }
    world2();

    // ── Pickups ──
    for (const pk of world.pickups) {
      if (!visible(pk.x, pk.y, 20)) continue;
      const bob = Math.sin(this.time * 4 + pk.x * 0.05) * 1.5;
      switch (pk.kind) {
        case 'xp': {
          const tier = gemTier(pk.value);
          this.drawSprite('gem', tier.color, tier.size, 'normal', pk.x, pk.y + bob, 0, k, ox, oy);
          break;
        }
        case 'core':
          this.drawSprite('core', PAL.gold, 8, 'normal', pk.x, pk.y + bob, this.time * 2, k, ox, oy);
          break;
        case 'heart':
          this.drawSprite('heart', '#6dff8a', 9, 'normal', pk.x, pk.y + bob, 0, k, ox, oy);
          break;
        case 'magnet':
          this.drawSprite('magnet', PAL.xp, 10, 'normal', pk.x, pk.y + bob, 0, k, ox, oy);
          break;
        case 'bomb':
          this.drawSprite('bomb', '#ffffff', 10, 'normal', pk.x, pk.y + bob, this.time, k, ox, oy);
          break;
        case 'cache':
          this.drawSprite('cache', PAL.gold, 14, 'elite', pk.x, pk.y + bob, Math.sin(this.time * 3) * 0.2, k, ox, oy);
          break;
      }
    }
    world2();

    // ── Telegraphs ──
    for (const e of world.enemies) {
      if ((e.kind === 'dasher' || e.kind === 'hydra') && e.state === 1) {
        const len = e.kind === 'hydra' ? 640 : 300;
        const flick = 0.35 + 0.35 * Math.sin(this.time * 40);
        ctx.globalAlpha = flick;
        ctx.strokeStyle = ENEMIES[e.kind].color;
        ctx.lineWidth = e.kind === 'hydra' ? e.r * 1.4 : 3;
        ctx.setLineDash(e.kind === 'hydra' ? [] : [10, 8]);
        ctx.beginPath();
        ctx.moveTo(e.x, e.y);
        ctx.lineTo(e.x + e.aimX * len, e.y + e.aimY * len);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.globalAlpha = 1;

    // ── Enemies ──
    for (const e of world.enemies) {
      if (!visible(e.x, e.y, e.r * 2)) continue;
      const def = ENEMIES[e.kind];
      const spawnK = e.spawnT > 0 ? 1 - e.spawnT / (e.boss ? 0.8 : 0.35) : 1;
      const mul = 0.4 + 0.6 * spawnK;
      ctx.globalAlpha = Math.min(1, 0.2 + spawnK);
      const variant = e.flash > 0 ? 'flash' : e.elite ? 'elite' : 'normal';
      this.drawSprite(def.shape, def.color, e.r, variant, e.x, e.y, e.angle, k, ox, oy, mul);
    }
    ctx.globalAlpha = 1;
    world2();
    // Elite HP rings.
    for (const e of world.enemies) {
      if (!e.elite || e.dead || e.hp >= e.maxHp || !visible(e.x, e.y, e.r * 2)) continue;
      ctx.strokeStyle = PAL.gold;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r * 1.6, -Math.PI / 2, -Math.PI / 2 + TAU * (e.hp / e.maxHp));
      ctx.stroke();
    }

    // ── Additive layer: beams, projectiles, bullets, blades, particles ──
    ctx.globalCompositeOperation = 'lighter';
    for (const b of world.beams) {
      const kk = b.t / b.duration;
      const fade = kk > 1 ? Math.max(0, 1 - (b.t - b.duration) / 0.2) : 1;
      const widthK = kk < 0.15 ? kk / 0.15 : 1;
      const ex = b.x + Math.cos(b.angle) * b.length;
      const ey = b.y + Math.sin(b.angle) * b.length;
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.35 * fade;
      ctx.strokeStyle = WEAPONS.lance.color;
      ctx.lineWidth = b.width * 1.8 * widthK;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      ctx.globalAlpha = fade;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = b.width * 0.45 * widthK;
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
    ctx.globalAlpha = 1;

    for (const pr of world.projectiles) {
      if (!visible(pr.x, pr.y, 20)) continue;
      if (pr.kind === 'bolt') {
        const sp = Math.hypot(pr.vx, pr.vy) || 1;
        const tail = pr.evolved ? 0.05 : 0.035;
        ctx.strokeStyle = pr.evolved ? '#ffffff' : PAL.bolt;
        ctx.lineWidth = pr.r * 1.3;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(pr.x, pr.y);
        ctx.lineTo(pr.x - pr.vx * tail, pr.y - pr.vy * tail);
        ctx.stroke();
        ctx.lineCap = 'butt';
        const d = pr.r * 4.5;
        ctx.drawImage(this.boltDot, pr.x - d / 2, pr.y - d / 2, d, d);
        void sp;
      } else {
        this.particles.mote(pr.x, pr.y, '#ffb3f0', 2.2, 0.3);
        this.drawSprite('dart', '#ffb3f0', 7, 'normal', pr.x, pr.y, Math.atan2(pr.vy, pr.vx), k, ox, oy);
        world2();
      }
    }
    for (const b of world.bullets) {
      if (!visible(b.x, b.y, 20)) continue;
      const d = b.r * 4.2;
      ctx.drawImage(this.bulletDot, b.x - d / 2, b.y - d / 2, d, d);
    }
    for (const bl of world.blades) {
      this.drawSprite('blade', '#a6ffef', bl.r, 'normal', bl.x, bl.y, this.time * 14, k, ox, oy);
    }
    world2();
    this.particles.draw(ctx, minX, minY, maxX, maxY);
    this.arcs.draw(ctx);
    for (const b of this.blasts) {
      const kk = 1 - b.life / b.max;
      ctx.globalAlpha = (1 - kk) * 0.8;
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 6 * (1 - kk) + 1;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * (0.3 + 0.7 * kk), 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = (1 - kk) * 0.18;
      ctx.fillStyle = b.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // ── Player ──
    if (p.alive) {
      this.trail.push({ x: p.x, y: p.y });
      if (this.trail.length > 14) this.trail.shift();
      ctx.globalCompositeOperation = 'lighter';
      ctx.lineCap = 'round';
      for (let i = 1; i < this.trail.length; i++) {
        const a = this.trail[i - 1]!;
        const b = this.trail[i]!;
        const kk = i / this.trail.length;
        ctx.globalAlpha = kk * 0.5;
        ctx.strokeStyle = this.settings.trail;
        ctx.lineWidth = 7 * kk;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.lineCap = 'butt';
      ctx.globalAlpha = 1;
      const angle = Math.atan2(p.facingY, p.facingX);
      if (p.dashT > 0) {
        for (let i = 0; i < this.trail.length; i += 3) {
          const t = this.trail[i]!;
          ctx.globalAlpha = (i / this.trail.length) * 0.5;
          this.drawSprite('player', '#c9b8ff', 13, 'normal', t.x, t.y, angle, k, ox, oy);
        }
        ctx.globalAlpha = 1;
      }
      ctx.globalCompositeOperation = 'source-over';
      const blink = p.invuln > 0 && p.dashT <= 0 && Math.floor(this.time * 20) % 2 === 0;
      if (!blink) {
        this.drawSprite('player', p.hurtT > 0 ? '#ff4d6d' : this.settings.trail, 13, p.hurtT > 0.2 ? 'flash' : 'normal', p.x, p.y, angle, k, ox, oy);
      }
      world2();
      if (p.shieldReady) {
        ctx.globalAlpha = 0.45 + Math.sin(this.time * 5) * 0.15;
        ctx.strokeStyle = '#7ff9ff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = this.time * 0.8 + (i / 6) * TAU;
          const x = p.x + Math.cos(a) * 24;
          const y = p.y + Math.sin(a) * 24;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // Magnet radius hint (very faint).
      if (!opts.attract) {
        ctx.globalAlpha = 0.04;
        ctx.strokeStyle = PAL.xp;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, world.stats.magnet, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    // ── World-space text ──
    world2();
    this.texts.draw(ctx, 1);

    // ── Screen-space post ──
    this.bg.drawVignette(ctx, w, h);
    const hpK = p.hp / world.stats.maxHp;
    if (p.alive && hpK < 0.3 && !opts.attract) {
      const pulse = (Math.sin(this.time * 6) * 0.5 + 0.5) * (0.3 - hpK) * 1.6;
      const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.hypot(w, h) * 0.6);
      g.addColorStop(0, 'rgba(255,45,85,0)');
      g.addColorStop(1, hexAlpha('#ff2d55', Math.min(0.5, pulse)));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    if (this.flash.a > 0.01) {
      ctx.globalAlpha = this.flash.a;
      ctx.fillStyle = this.flash.color;
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
    }

    if (!opts.attract) {
      this.hud.showFps = this.settings.showFps;
      drawHud(ctx, world, w, h, this.ui, this.hud);
      this.callouts.draw(ctx, w, h, this.ui);
    }
  }
}
