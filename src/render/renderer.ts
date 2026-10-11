import { TAU, clamp, damp, formatNumber, lerp } from '../core/math';
import { COMBO_TIERS } from '../game/combo';
import { WEAPONS } from '../game/content/weapons';
import type { GameEvent } from '../game/types';
import type { World } from '../game/world';
import { Background, hexAlpha } from './background';
import { Arcs, Callouts, FloatTexts, SectorCard, Shake } from './effects';
import { EntityFx } from './entityfx';
import { SECTORS, type GalaxyEvent } from './galaxy';
import { anticipatedSector } from './sectorwarp';
import { drawHud, type HudState } from './hud';
import { PAL, gemTier } from './palette';
import { Particles } from './particles';
import { PostFx, flashBudget, type FxQuality } from './postfx';
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

const FX_GLOW = 0.15;
const FX_PUNCH = 0.6;

const TARGET_AREA_DESKTOP = 1366 * 768;
const TARGET_AREA_MOBILE = 470 * 980;

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  readonly hudCtx: CanvasRenderingContext2D;
  readonly worldCanvas: HTMLCanvasElement;
  private readonly worldCtx: CanvasRenderingContext2D;
  readonly postfx: PostFx | null;
  private fxWanted = true;
  private fxOn = false;
  private worldScale = 1;
  costTier = 4;
  private hurtCaT = 0;
  private camZoom = 1;
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
  readonly sectorCard = new SectorCard();
  /** Starships, crystal enemies, shatter, explosions and trails. */
  readonly fx = new EntityFx();
  /** Galaxy events (warp phases, sector ready), forwarded for audio and the sector card. */
  onGalaxy: ((e: GalaxyEvent) => void) | null = null;
  readonly bg = new Background((e) => this.onGalaxyEvent(e));
  private blasts: Blast[] = [];
  private flash = { color: '#ffffff', a: 0 };
  private bulletDot: HTMLCanvasElement;
  private time = 0;
  beat = 0;
  intensity = 0;
  hud: HudState;
  settings: RenderSettings = { shake: 1, flashes: true, damageNumbers: true, showFps: false, trail: '#7ff9ff' };

  constructor(canvas: HTMLCanvasElement, fxCanvas: HTMLCanvasElement | null = null) {
    this.canvas = canvas;
    this.postfx = fxCanvas ? PostFx.create(fxCanvas) : null;
    const ctx = canvas.getContext('2d', { alpha: this.postfx !== null });
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = this.hudCtx = ctx;
    this.worldCanvas = document.createElement('canvas');
    const worldCtx = this.worldCanvas.getContext('2d', { alpha: false });
    if (!worldCtx) throw new Error('Canvas 2D not supported');
    this.worldCtx = worldCtx;
    if (this.postfx) {
      this.postfx.onActiveChange = () => this.applyFxMode();
      this.postfx.onQualityChange = (q, rs) => this.onFxQuality(q, rs);
    }
    this.bulletDot = makeGlowDot('rgba(255,79,122,0.9)', '#fff0f4', 64);
    this.hud = {
      bestScore: 0,
      touch: false,
      fps: 60,
      showFps: false,
      fxLabel: '2D',
      xpFlash: 0,
      hpFlash: 0,
      comboBreak: null,
      dashButton: { x: 0, y: 0, r: 0 },
      stick: { active: false, ox: 0, oy: 0, x: 0, y: 0 },
      pauseInset: 0,
    };
    this.resize();
    this.applyFxMode();
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
    this.postfx?.resize(this.w, this.h);
    this.sizeWorldCanvas();
    const short = Math.min(cssW, cssH);
    const t = clamp((short - 420) / (900 - 420), 0, 1);
    const targetArea = lerp(TARGET_AREA_MOBILE, TARGET_AREA_DESKTOP, t);
    this.scale = Math.sqrt((cssW * cssH) / targetArea);
    this.ui = clamp(short / 760, 0.72, 1.35) * this.dpr;
    this.sprites.setResolution(this.scale * this.dpr * this.worldScale);
    this.fx.setResolution(this.scale * this.dpr * this.worldScale);
    const ui = this.ui;
    this.hud.dashButton = { x: this.w - 74 * ui, y: this.h - 96 * ui, r: 44 * ui };
    // The DOM pause button is 40px + 10px margin (CSS px).
    this.hud.pauseInset = 50 * this.dpr;
    return { halfW: cssW / 2 / this.scale, halfH: cssH / 2 / this.scale };
  }

  private sizeWorldCanvas(): void {
    const w = this.fxOn ? Math.max(1, Math.round(this.w * this.worldScale)) : 1;
    const h = this.fxOn ? Math.max(1, Math.round(this.h * this.worldScale)) : 1;
    if (this.worldCanvas.width !== w || this.worldCanvas.height !== h) {
      this.worldCanvas.width = w;
      this.worldCanvas.height = h;
    }
  }

  private view(tw: number, th: number, s: number): { k: number; ox: number; oy: number } {
    const k = this.scale * this.dpr * s / this.camZoom;
    return { k, ox: tw / 2 - this.camX * k + this.shake.x * this.dpr * s,
      oy: th / 2 - this.camY * k + this.shake.y * this.dpr * s };
  }

  setPostFx(on: boolean): void {
    if (on && !this.fxWanted) this.postfx?.reenable();
    this.fxWanted = on;
    this.applyFxMode();
  }

  get postFxActive(): boolean { return this.fxOn; }

  private applyFxMode(): void {
    const on = this.fxWanted && !!this.postfx && this.postfx.active;
    this.fxOn = on;
    this.ctx = on ? this.worldCtx : this.hudCtx;
    const g = on ? FX_GLOW : 1;
    this.sprites.setGlowScale(g);
    this.fx.setGlowScale(g);
    this.fx.postFx = on;
    this.bg.galaxy.punchScale = on ? FX_PUNCH : 1;
    this.onFxQuality(on ? this.postfx!.quality : 0, on ? this.postfx!.renderScale : 1);
    this.sizeWorldCanvas();
    document.body.classList.toggle('fx-on', on);
  }

  private onFxQuality(_q: FxQuality, renderScale: number): void {
    const px = this.postfx;
    this.costTier = this.fxOn && px ? px.costTier : px?.autoOff ? 0 : 4;
    this.fx.setCostTier(this.costTier);
    // WarpGrid quality follows this tier in task 3d.
    const ws = this.fxOn ? renderScale : 1;
    if (ws !== this.worldScale) {
      this.worldScale = ws;
      this.resize();
    }
  }

  private wave(x: number, y: number, radius: number, strength: number, duration: number, glow: number, thickness: number, major = false): void {
    if (!this.fxOn) return;
    this.postfx?.shockwave(x, y, { radius, strength: strength / this.camZoom, duration, glow, thickness, major });
  }

  private hurtAberration(): void {
    if (this.hurtCaT > 0) return;
    this.postfx?.kickAberration(0.25);
    this.hurtCaT = 0.4;
  }

  reset(world: World): void {
    this.postfx?.clearEffects();
    this.hurtCaT = 0;
    this.particles.clear();
    this.texts.clear();
    this.callouts.clear();
    this.arcs.clear();
    this.fx.reset();
    this.fx.warmPilots(world, this.settings.trail);
    this.blasts = [];
    this.flash.a = 0;
    this.shake.trauma = 0;
    this.camX = world.player.x;
    this.camY = world.player.y;
    this.hud.comboBreak = null;
    this.sectorCard.clear();
    // A new world (run start, a ?warp fast-forward, the attract mode) shows its sector without a warp.
    this.bg.galaxy.setSector(world.sector);
  }

  private onGalaxyEvent(e: GalaxyEvent): void {
    // The punch is drawn under the sprites by the backdrop; only a little shake here (scaled by the setting).
    if (e.t === 'warp-punch') this.shake.add(0.25);
    this.onGalaxy?.(e);
  }

  /** Sector title card (the app supplies the story's name and subtitle). */
  showSectorCard(index: number, title: string, subtitle: string): void {
    this.sectorCard.show(title, subtitle, SECTORS[index]?.warpTint ?? PAL.text);
  }

  /** Starts the warp a little before a forced sector change (render-side only; reads the clock). */
  private anticipateSector(world: World): void {
    if (world.gameOver) return;
    const next = anticipatedSector(world.sector, world.time);
    if (next !== null) this.bg.galaxy.setSector(next, { warp: true });
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
      this.fx.onEvent(ev, world, P);
      switch (ev.t) {
        case 'sector':
          this.bg.galaxy.setSector(ev.index, { warp: true });
          break;
        case 'hit':
          P.spray(ev.x, ev.y, 0, -1, ev.crit ? '#ffd23f' : '#ffffff', ev.crit ? 4 : 1, 260, Math.PI);
          if (this.settings.damageNumbers) {
            this.texts.add(ev.x, ev.y, String(Math.round(ev.dmg)), ev.crit ? '#ffd23f' : '#eaf2ff', ev.crit ? 15 : 10.5, ev.crit ? 0.75 : 0.5);
          }
          break;
        case 'kill': {
          // Shards (EntityFx) carry the death; particles add sparks only.
          const n = ev.boss ? 80 : ev.elite ? 30 : 3 + ev.r * 0.2;
          P.burst(ev.x, ev.y, ev.color, n, 220 + ev.r * 5, ev.boss ? 1.2 : 0.45, ev.boss ? 4 : 2.2);
          if (ev.elite || ev.boss) {
            this.wave(ev.x, ev.y, ev.r * 6, ev.boss ? 40 : 16, ev.boss ? 1 : 0.55, 0.2, Math.max(18, ev.r * 0.7), ev.boss);
            P.burst(ev.x, ev.y, PAL.gold, n * 0.4, 260, 0.9, 3);
            this.texts.add(ev.x, ev.y - ev.r, `+${formatNumber(ev.score)}`, PAL.gold, 18, 1.1, true);
          } else if (ev.score >= 100 && world.enemies.length < 150) {
            // Per-kill score floats only while the field is readable; elites always get theirs.
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
          this.wave(ev.x, ev.y, 170, 16, 0.45, 0.25, 22);
          this.postfx?.kickBloom(0.35);
          this.callouts.add('PERFECT', '#7ff9ff', 0.85, '+3 combo · dash refund', 0.8);
          P.ring(ev.x, ev.y, 26, '#7ff9ff', 28);
          // The perfect-dash ring is drawn by EntityFx (thin, no filled disc over the ship).
          this.shake.add(0.12);
          break;
        case 'downed':
          this.wave(ev.x, ev.y, 420, 27, 0.9, 0.2, 50);
          this.hurtAberration();
          break;
        case 'hurt':
          this.hurtAberration();
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
          this.wave(ev.x, ev.y, 1100, 50, 1.6, 0.3, 90, true);
          this.wave(ev.x, ev.y, 520, 26, 0.9, 0.2, 50, true);
          this.postfx?.kickAberration(0.5);
          this.postfx?.kickBloom(0.8);
          this.callouts.add('BOSS DESTROYED', PAL.gold, 1, ev.name.toUpperCase(), 2);
          this.addFlash('#ffffff', 0.6);
          this.blasts.push({ x: ev.x, y: ev.y, r: 520, life: 0.9, max: 0.9, color: '#ffffff' });
          break;
        case 'death':
          this.wave(ev.x, ev.y, 700, 45, 1.2, 0.25, 70, true);
          this.postfx?.kickAberration(0.5);
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
          this.wave(ev.x, ev.y, ev.r * 1.05, 12, 0.6, 0.1, Math.max(20, ev.r * 0.1));
          P.ring(ev.x, ev.y, ev.r * 0.3, ev.color, 10);
          break;
        case 'arc':
          this.arcs.add(ev.points, ev.evolved);
          break;
        case 'explode':
          if (ev.r >= 60) this.wave(ev.x, ev.y, ev.r * 1.8, 9, 0.4, 0.08, Math.max(18, ev.r * 0.2));
          // Layered explosion (flash + rings + sparks + embers) is drawn by EntityFx.
          P.burst(ev.x, ev.y, ev.color, 6 + ev.r * 0.08, 160 + ev.r * 2, 0.45, 2.5);
          this.shake.add(0.05);
          break;
        case 'elite':
          this.callouts.add('ELITE', PAL.gold, 0.6, 'Drops a cache', 0.9);
          break;
        case 'surge':
          this.callouts.add('SURGE', '#ff6b8a', 0.75, 'They are closing in', 1);
          break;
        case 'bomb':
          this.wave(ev.x, ev.y, 1300, 60, 1.1, 0.3, 80, true);
          this.postfx?.kickBloom(0.8);
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

  draw(world: World, dt: number, opts: { attract: boolean; realDt: number; modal?: boolean }): void {
    const ctx = this.ctx;
    const rdt = opts.realDt;
    this.hurtCaT = Math.max(0, this.hurtCaT - rdt);
    // Reduced flashing also calms the backdrop (static, softer warp punch).
    this.bg.galaxy.animate = this.bg.galaxy.flashes = this.settings.flashes;
    if (!opts.attract && !opts.modal) this.anticipateSector(world);
    // Real time, so the warp and the resize debounce run through hitstop and slow-mo.
    this.bg.galaxy.update(opts.modal ? 0 : rdt);
    this.time += rdt;
    this.particles.update(dt);
    this.texts.update(dt);
    this.callouts.update(rdt);
    this.sectorCard.update(opts.modal ? 0 : rdt);
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

    const fxMode = this.fxOn && this.postfx !== null;
    const w = fxMode ? this.worldCanvas.width : this.w;
    const h = fxMode ? this.worldCanvas.height : this.h;
    const { k, ox, oy } = this.view(w, h, fxMode ? this.worldScale : 1);
    const halfW = w / 2 / k + 80;
    const halfH = h / 2 / k + 80;
    const minX = this.camX - halfW;
    const maxX = this.camX + halfW;
    const minY = this.camY - halfH;
    const maxY = this.camY + halfH;
    const visible = (x: number, y: number, r: number) => x + r > minX && x - r < maxX && y + r > minY && y - r < maxY;
    const fx = this.fx;
    fx.flashes = this.settings.flashes;
    fx.begin({ k, ox, oy, minX, minY, maxX, maxY }, dt, rdt);

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

    // ── Telegraphs (ground layer) ──
    fx.drawTelegraphs(ctx, world);

    // ── Cooled shard debris: dim outlines, normal blending, BELOW the enemies ──
    fx.drawDebris(ctx);

    // ── Enemies (crystal armada + capital ships) ──
    fx.drawEnemies(ctx, world);
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

    fx.drawProjectiles(ctx, world, PAL.bolt);
    for (const bl of world.blades) {
      this.drawSprite('blade', '#a6ffef', bl.r, 'normal', bl.x, bl.y, this.time * 14, k, ox, oy);
    }
    world2();
    this.particles.draw(ctx, minX, minY, maxX, maxY);
    fx.drawShards(ctx);
    fx.drawLightning(ctx, this.arcs.items);
    // Reduced flashing: the big white discs (boss death, bomb) are capped at alpha 0.15.
    const discCap = this.settings.flashes ? 1 : 0.15;
    for (const b of this.blasts) {
      const kk = 1 - b.life / b.max;
      ctx.globalAlpha = Math.min((1 - kk) * 0.8, b.r > 300 ? discCap : 1);
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 6 * (1 - kk) + 1;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * (0.3 + 0.7 * kk), 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = Math.min((1 - kk) * (fxMode ? 0.10 : 0.18), discCap);
      ctx.fillStyle = b.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // ── Player starships ──
    fx.drawPlayers(ctx, world, dt, rdt, this.settings.trail);
    world2();
    if (p.alive) {
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

    // ── Enemy plasma LAST in the world: threats are never hidden by anything ──
    fx.drawBullets(ctx, world, this.bulletDot);

    // Native-resolution overlay: world text and HUD never enter the bloom pipeline.
    const hud = this.hudCtx;
    const HW = this.w, HH = this.h;
    if (fxMode) {
      hud.setTransform(1, 0, 0, 1, 0, 0);
      hud.globalAlpha = 1;
      hud.globalCompositeOperation = 'source-over';
      hud.clearRect(0, 0, HW, HH);
    }
    const v = this.view(HW, HH, 1);
    hud.setTransform(v.k, 0, 0, v.k, v.ox, v.oy);
    this.texts.draw(hud, 1);
    hud.setTransform(1, 0, 0, 1, 0, 0);
    hud.globalAlpha = 1;

    let lowHp = 0;
    if (!opts.attract) for (const pilot of world.players) {
      const hpK = pilot.hp / pilot.stats.maxHp;
      if (world.isUp(pilot) && hpK < 0.3) lowHp = Math.max(lowHp, (Math.sin(this.time * 6) * 0.5 + 0.5) * (0.3 - hpK) * 1.6);
    }
    const galaxy = this.bg.galaxy;
    const punchA = galaxy.warpFx.punch * (this.settings.flashes ? 0.35 : 0.09) * galaxy.punchScale;
    const flashA = Math.min(this.flash.a, flashBudget(punchA, this.settings.flashes, fxMode));
    const post = fxMode ? this.postfx : null;
    if (post) {
      post.settings.flashes = this.settings.flashes;
      post.settings.shake = this.settings.shake;
      post.damage = lowHp * 2;
      post.setFlash(this.flash.color, flashA > 0.01 ? flashA : 0);
      post.setView(k, ox, oy);
      if (!post.render(this.worldCanvas, rdt)) {
        // Preserve this frame before mode switching frees the offscreen canvas.
        hud.globalCompositeOperation = 'destination-over';
        hud.drawImage(this.worldCanvas, 0, 0, HW, HH);
        hud.globalCompositeOperation = 'source-over';
        this.applyFxMode();
      }
    } else {
      this.bg.drawVignette(hud, HW, HH);
      if (lowHp > 0) {
        const g = hud.createRadialGradient(HW / 2, HH / 2, Math.min(HW, HH) * 0.3, HW / 2, HH / 2, Math.hypot(HW, HH) * 0.6);
        g.addColorStop(0, 'rgba(255,45,85,0)');
        g.addColorStop(1, hexAlpha('#ff2d55', Math.min(0.5, lowHp)));
        hud.fillStyle = g;
        hud.fillRect(0, 0, HW, HH);
      }
      if (flashA > 0.01) {
        hud.globalAlpha = flashA;
        hud.fillStyle = this.flash.color;
        hud.fillRect(0, 0, HW, HH);
        hud.globalAlpha = 1;
      }
    }

    if (!opts.attract) {
      this.hud.showFps = this.settings.showFps;
      this.hud.fxLabel = this.fxOn && this.postfx ? `FX q${this.postfx.quality}${this.worldScale < 1 ? ' ×' + this.worldScale : ''}` : this.postfx?.autoOff ? '2D (auto)' : '2D';
      drawHud(hud, world, HW, HH, this.ui, this.hud);
      this.callouts.draw(hud, HW, HH, this.ui, this.sectorCard.calloutTop(HW, HH, this.ui));
      this.sectorCard.draw(hud, HW, HH, this.ui);
    }
  }
}
