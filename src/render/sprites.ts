import { TAU } from '../core/math';
import type { Shape } from '../game/types';

export type SpriteShape = Shape | 'player' | 'gem' | 'core' | 'heart' | 'magnet' | 'bomb' | 'cache' | 'blade' | 'mine';
export type Variant = 'normal' | 'flash' | 'elite';

export interface Sprite {
  canvas: HTMLCanvasElement;
  /** Size in world units (square). */
  size: number;
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

function poly(ctx: CanvasRenderingContext2D, n: number, r: number, rot = 0): void {
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * TAU;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function star(ctx: CanvasRenderingContext2D, n: number, r1: number, r2: number, rot = 0): void {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i / (n * 2)) * TAU;
    const r = i % 2 === 0 ? r1 : r2;
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Traces the outline path for a shape of radius r, centred at the origin, facing +x. */
function tracePath(ctx: CanvasRenderingContext2D, shape: SpriteShape, r: number): void {
  switch (shape) {
    case 'tri':
      ctx.beginPath();
      ctx.moveTo(r, 0);
      ctx.lineTo(-r * 0.75, r * 0.82);
      ctx.lineTo(-r * 0.45, 0);
      ctx.lineTo(-r * 0.75, -r * 0.82);
      ctx.closePath();
      break;
    case 'dart':
      ctx.beginPath();
      ctx.moveTo(r * 1.1, 0);
      ctx.lineTo(-r * 0.9, r * 0.6);
      ctx.lineTo(-r * 0.5, 0);
      ctx.lineTo(-r * 0.9, -r * 0.6);
      ctx.closePath();
      break;
    case 'diamond':
      ctx.beginPath();
      ctx.moveTo(r * 1.15, 0);
      ctx.lineTo(0, r * 0.7);
      ctx.lineTo(-r * 0.9, 0);
      ctx.lineTo(0, -r * 0.7);
      ctx.closePath();
      break;
    case 'circle':
    case 'mine':
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      break;
    case 'hex':
    case 'boss_hex':
    case 'core':
      poly(ctx, 6, r, Math.PI / 6);
      break;
    case 'square':
      ctx.beginPath();
      ctx.roundRect(-r * 0.85, -r * 0.85, r * 1.7, r * 1.7, r * 0.22);
      break;
    case 'boss_star':
      star(ctx, 6, r, r * 0.55);
      break;
    case 'boss_core':
      star(ctx, 12, r, r * 0.78);
      break;
    case 'player':
      ctx.beginPath();
      ctx.moveTo(r * 1.35, 0);
      ctx.lineTo(-r * 0.9, r * 0.95);
      ctx.lineTo(-r * 0.4, 0);
      ctx.lineTo(-r * 0.9, -r * 0.95);
      ctx.closePath();
      break;
    case 'gem':
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.25);
      ctx.lineTo(r * 0.8, 0);
      ctx.lineTo(0, r * 1.25);
      ctx.lineTo(-r * 0.8, 0);
      ctx.closePath();
      break;
    case 'heart': {
      ctx.beginPath();
      const w = r * 0.42;
      ctx.rect(-w, -r, w * 2, r * 2);
      ctx.rect(-r, -w, r * 2, w * 2);
      break;
    }
    case 'magnet':
      ctx.beginPath();
      ctx.arc(0, 0, r, Math.PI, 0, true);
      ctx.lineTo(r, -r * 0.8);
      ctx.lineTo(r * 0.45, -r * 0.8);
      ctx.lineTo(r * 0.45, 0);
      ctx.arc(0, 0, r * 0.45, 0, Math.PI, false);
      ctx.lineTo(-r * 0.45, -r * 0.8);
      ctx.lineTo(-r, -r * 0.8);
      ctx.closePath();
      break;
    case 'bomb':
      star(ctx, 8, r, r * 0.55, -Math.PI / 2);
      break;
    case 'cache':
      ctx.beginPath();
      ctx.roundRect(-r, -r * 0.8, r * 2, r * 1.6, r * 0.25);
      break;
    case 'blade':
      ctx.beginPath();
      ctx.moveTo(r * 1.2, 0);
      ctx.quadraticCurveTo(0, r * 0.5, -r * 1.2, 0);
      ctx.quadraticCurveTo(0, -r * 0.5, r * 1.2, 0);
      ctx.closePath();
      break;
  }
}

function hexA(color: string, alpha: number): string {
  const n = parseInt(color.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * Pre-renders glowing neon shapes once and reuses them every frame;
 * shadowBlur is far too slow to use per entity per frame.
 */
export class SpriteCache {
  private cache = new Map<string, Sprite>();
  /** Pixels per world unit for sprite rasterisation. */
  private res = 2;

  setResolution(pxPerUnit: number): void {
    const r = Math.min(4, Math.max(1, Math.round(pxPerUnit * 2) / 2));
    if (r !== this.res) {
      this.res = r;
      this.cache.clear();
    }
  }

  get(shape: SpriteShape, color: string, radius: number, variant: Variant = 'normal'): Sprite {
    const key = `${shape}|${color}|${radius.toFixed(1)}|${variant}`;
    let s = this.cache.get(key);
    if (!s) {
      s = this.render(shape, color, radius, variant);
      this.cache.set(key, s);
    }
    return s;
  }

  private render(shape: SpriteShape, color: string, radius: number, variant: Variant): Sprite {
    const glow = Math.max(6, radius * 0.9);
    const size = (radius * 1.45 + glow) * 2 + 4;
    const res = this.res;
    const c = makeCanvas(size * res, size * res);
    const ctx = c.getContext('2d')!;
    ctx.translate(c.width / 2, c.height / 2);
    ctx.scale(res, res);
    ctx.lineJoin = 'round';

    const flash = variant === 'flash';
    const line = Math.max(1.6, radius * 0.16);

    // Outer glow pass.
    ctx.shadowColor = flash ? '#ffffff' : color;
    ctx.shadowBlur = glow * res;
    tracePath(ctx, shape, radius);
    ctx.fillStyle = flash ? 'rgba(255,255,255,0.95)' : hexA(color, shape === 'gem' || shape === 'core' ? 0.55 : 0.22);
    ctx.fill();
    ctx.lineWidth = line;
    ctx.strokeStyle = flash ? '#ffffff' : color;
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Inner detail.
    if (!flash) {
      ctx.lineWidth = Math.max(1, line * 0.5);
      ctx.strokeStyle = hexA('#ffffff', 0.55);
      switch (shape) {
        case 'hex':
        case 'boss_hex':
          poly(ctx, 6, radius * 0.5, Math.PI / 6);
          ctx.stroke();
          break;
        case 'circle':
          ctx.beginPath();
          ctx.arc(0, 0, radius * 0.45, 0, TAU);
          ctx.stroke();
          break;
        case 'square':
          ctx.beginPath();
          ctx.roundRect(-radius * 0.4, -radius * 0.4, radius * 0.8, radius * 0.8, radius * 0.1);
          ctx.stroke();
          break;
        case 'boss_star':
          star(ctx, 6, radius * 0.5, radius * 0.28);
          ctx.stroke();
          break;
        case 'boss_core':
          ctx.beginPath();
          ctx.arc(0, 0, radius * 0.45, 0, TAU);
          ctx.fillStyle = hexA('#ffffff', 0.85);
          ctx.shadowColor = color;
          ctx.shadowBlur = radius * 0.6 * res;
          ctx.fill();
          ctx.shadowBlur = 0;
          break;
        case 'player':
          ctx.beginPath();
          ctx.moveTo(radius * 0.7, 0);
          ctx.lineTo(-radius * 0.15, radius * 0.35);
          ctx.lineTo(-radius * 0.15, -radius * 0.35);
          ctx.closePath();
          ctx.fillStyle = '#ffffff';
          ctx.fill();
          break;
        case 'gem':
        case 'core':
          ctx.beginPath();
          ctx.moveTo(-radius * 0.3, -radius * 0.45);
          ctx.lineTo(radius * 0.15, -radius * 0.7);
          ctx.strokeStyle = 'rgba(255,255,255,0.9)';
          ctx.stroke();
          break;
        default:
          break;
      }
    }

    if (variant === 'elite') {
      ctx.shadowColor = '#ffc93c';
      ctx.shadowBlur = glow * 1.4 * res;
      ctx.lineWidth = Math.max(1.5, radius * 0.1);
      ctx.strokeStyle = '#ffc93c';
      ctx.beginPath();
      ctx.arc(0, 0, radius * 1.32, 0, TAU);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    return { canvas: c, size };
  }
}

/** Soft round glow dot used for bullets and particles. */
export function makeGlowDot(color: string, coreColor: string, px: number): HTMLCanvasElement {
  const c = makeCanvas(px, px);
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(px / 2, px / 2, 0, px / 2, px / 2, px / 2);
  g.addColorStop(0, coreColor);
  g.addColorStop(0.25, coreColor);
  g.addColorStop(0.4, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, px, px);
  return c;
}
