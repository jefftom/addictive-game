import { ease } from '../core/math';
import { FONT_DISPLAY, FONT_MONO } from './palette';

interface FloatText {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  size: number;
  life: number;
  maxLife: number;
}

/** World-space floating numbers (damage, score). */
export class FloatTexts {
  items: FloatText[] = [];
  private budget = 0;

  add(x: number, y: number, text: string, color: string, size: number, life = 0.7, force = false): void {
    if (!force) {
      if (this.budget <= 0) return;
      this.budget--;
    }
    if (this.items.length > 90) this.items.shift();
    this.items.push({ x: x + (Math.random() - 0.5) * 10, y, vy: -60 - Math.random() * 30, text, color, size, life, maxLife: life });
  }

  update(dt: number): void {
    this.budget = Math.min(12, this.budget + dt * 60);
    for (const t of this.items) {
      t.life -= dt;
      t.y += t.vy * dt;
      t.vy *= Math.exp(-3 * dt);
    }
    this.items = this.items.filter((t) => t.life > 0);
  }

  draw(ctx: CanvasRenderingContext2D, scale: number): void {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const t of this.items) {
      const k = t.life / t.maxLife;
      const pop = k > 0.8 ? ease.outBack((1 - k) / 0.2) : 1;
      ctx.globalAlpha = Math.min(1, k * 2.5);
      const px = Math.max(9, t.size * scale * pop);
      ctx.font = `700 ${px}px ${FONT_MONO}`;
      ctx.lineWidth = Math.max(2, px * 0.18);
      ctx.strokeStyle = 'rgba(5,4,15,0.85)';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;
  }

  clear(): void {
    this.items = [];
  }
}

interface Callout {
  text: string;
  sub: string;
  color: string;
  size: number;
  life: number;
  maxLife: number;
  slot: number;
}

/** Big screen-space announcements: combo tiers, PERFECT, LEVEL UP, warnings. */
export class Callouts {
  items: Callout[] = [];

  add(text: string, color: string, size = 1, sub = '', life = 1.1): void {
    // Replace an identical callout instead of stacking duplicates.
    const existing = this.items.find((c) => c.text === text);
    if (existing) {
      existing.life = existing.maxLife = life;
      existing.sub = sub;
      return;
    }
    const used = new Set(this.items.map((c) => c.slot));
    let slot = 0;
    while (used.has(slot)) slot++;
    this.items.push({ text, sub, color, size, life, maxLife: life, slot });
  }

  update(dt: number): void {
    for (const c of this.items) c.life -= dt;
    this.items = this.items.filter((c) => c.life > 0);
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, ui: number): void {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const c of this.items) {
      const age = c.maxLife - c.life;
      const inK = Math.min(1, age / 0.22);
      const outK = Math.min(1, c.life / 0.3);
      const s = ease.outBack(inK) * (1 + (1 - outK) * 0.15);
      const y = h * 0.3 + c.slot * 56 * ui;
      const px = 40 * c.size * ui;
      ctx.save();
      ctx.globalAlpha = outK;
      ctx.translate(w / 2, y);
      ctx.scale(s, s);
      ctx.font = `900 ${px}px ${FONT_DISPLAY}`;
      ctx.shadowColor = c.color;
      ctx.shadowBlur = 24 * ui;
      ctx.fillStyle = c.color;
      ctx.fillText(c.text, 0, 0);
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1.2 * ui;
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.strokeText(c.text, 0, 0);
      if (c.sub) {
        ctx.font = `600 ${15 * ui}px ${FONT_MONO}`;
        ctx.fillStyle = 'rgba(234,242,255,0.85)';
        ctx.fillText(c.sub, 0, px * 0.72);
      }
      ctx.restore();
    }
  }

  clear(): void {
    this.items = [];
  }
}

interface Arc {
  points: number[];
  life: number;
  evolved: boolean;
  seed: number;
}

export class Arcs {
  items: Arc[] = [];

  add(points: number[], evolved: boolean): void {
    this.items.push({ points, life: 0.16, evolved, seed: Math.random() * 1000 });
  }

  update(dt: number): void {
    for (const a of this.items) a.life -= dt;
    this.items = this.items.filter((a) => a.life > 0);
  }

  draw(ctx: CanvasRenderingContext2D): void {
    for (const a of this.items) {
      const k = a.life / 0.16;
      for (let pass = 0; pass < 2; pass++) {
        ctx.globalAlpha = pass === 0 ? 0.35 * k : k;
        ctx.strokeStyle = pass === 0 ? (a.evolved ? '#ffffff' : '#a08cff') : '#f2eeff';
        ctx.lineWidth = pass === 0 ? 7 : 2;
        ctx.beginPath();
        const pts = a.points;
        ctx.moveTo(pts[0]!, pts[1]!);
        for (let i = 2; i < pts.length; i += 2) {
          const x0 = pts[i - 2]!;
          const y0 = pts[i - 1]!;
          const x1 = pts[i]!;
          const y1 = pts[i + 1]!;
          const segs = 4;
          for (let s = 1; s <= segs; s++) {
            const t = s / segs;
            const jitter = s === segs ? 0 : Math.sin(a.seed + i * 3.1 + s * 7.7 + a.life * 90) * 14;
            const nx = -(y1 - y0);
            const ny = x1 - x0;
            const nl = Math.hypot(nx, ny) || 1;
            ctx.lineTo(x0 + (x1 - x0) * t + (nx / nl) * jitter, y0 + (y1 - y0) * t + (ny / nl) * jitter);
          }
        }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  clear(): void {
    this.items = [];
  }
}

/** Trauma-based screen shake (amount = trauma²). */
export class Shake {
  trauma = 0;
  x = 0;
  y = 0;
  private t = 0;

  add(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount);
  }

  update(dt: number, intensity: number): void {
    this.t += dt;
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const k = this.trauma * this.trauma * 22 * intensity;
    this.x = k * (Math.sin(this.t * 71.3) * 0.6 + Math.sin(this.t * 37.1 + 1.3) * 0.4);
    this.y = k * (Math.sin(this.t * 63.7 + 2.1) * 0.6 + Math.sin(this.t * 29.3 + 0.4) * 0.4);
  }
}
