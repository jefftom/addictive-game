import { TAU } from '../core/math';

const CAP = 2600;

/** Structure-of-arrays particle pool, drawn additively. */
export class Particles {
  private x = new Float32Array(CAP);
  private y = new Float32Array(CAP);
  private vx = new Float32Array(CAP);
  private vy = new Float32Array(CAP);
  private life = new Float32Array(CAP);
  private maxLife = new Float32Array(CAP);
  private size = new Float32Array(CAP);
  private drag = new Float32Array(CAP);
  private kind = new Uint8Array(CAP); // 0 = dot, 1 = streak, 2 = shard (rotating square)
  private color: string[] = new Array<string>(CAP).fill('#fff');
  count = 0;
  /** 0..1 scales spawn counts (performance / reduced effects). */
  density = 1;

  private spawn(x: number, y: number, vx: number, vy: number, life: number, size: number, drag: number, kind: number, color: string): void {
    let i: number;
    if (this.count < CAP) i = this.count++;
    else i = (Math.random() * CAP) | 0; // overwrite a random one when full
    this.x[i] = x;
    this.y[i] = y;
    this.vx[i] = vx;
    this.vy[i] = vy;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.size[i] = size;
    this.drag[i] = drag;
    this.kind[i] = kind;
    this.color[i] = color;
  }

  burst(x: number, y: number, color: string, n: number, speed: number, life = 0.5, size = 2.5): void {
    const count = Math.max(1, Math.round(n * this.density));
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const s = speed * (0.25 + Math.random() * 0.9);
      const kind = Math.random() < 0.55 ? 1 : Math.random() < 0.5 ? 2 : 0;
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, life * (0.5 + Math.random() * 0.8), size * (0.6 + Math.random() * 0.8), 3.2, kind, color);
    }
  }

  /** Directional spray (e.g. hit sparks). */
  spray(x: number, y: number, dirX: number, dirY: number, color: string, n: number, speed: number, spread = 0.7): void {
    const base = Math.atan2(dirY, dirX);
    const count = Math.max(1, Math.round(n * this.density));
    for (let i = 0; i < count; i++) {
      const a = base + (Math.random() - 0.5) * spread * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, 0.18 + Math.random() * 0.2, 1.5 + Math.random() * 1.5, 6, 1, color);
    }
  }

  ring(x: number, y: number, radius: number, color: string, n: number): void {
    const count = Math.max(1, Math.round(n * this.density));
    for (let i = 0; i < count; i++) {
      const a = (i / count) * TAU;
      this.spawn(x + Math.cos(a) * radius, y + Math.sin(a) * radius, Math.cos(a) * 120, Math.sin(a) * 120, 0.45, 2.5, 2, 0, color);
    }
  }

  /** A single lingering trail mote. */
  mote(x: number, y: number, color: string, size: number, life: number): void {
    this.spawn(x, y, (Math.random() - 0.5) * 20, (Math.random() - 0.5) * 20, life, size, 1, 0, color);
  }

  confetti(x: number, y: number, colors: readonly string[], n: number): void {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const s = 300 + Math.random() * 500;
      this.spawn(x, y, Math.cos(a) * s, Math.sin(a) * s, 1.2 + Math.random(), 3 + Math.random() * 3, 1.2, 2, colors[i % colors.length]!);
    }
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.count) {
      this.life[i]! -= dt;
      if (this.life[i]! <= 0) {
        const last = --this.count;
        this.x[i] = this.x[last]!;
        this.y[i] = this.y[last]!;
        this.vx[i] = this.vx[last]!;
        this.vy[i] = this.vy[last]!;
        this.life[i] = this.life[last]!;
        this.maxLife[i] = this.maxLife[last]!;
        this.size[i] = this.size[last]!;
        this.drag[i] = this.drag[last]!;
        this.kind[i] = this.kind[last]!;
        this.color[i] = this.color[last]!;
        continue;
      }
      const k = Math.exp(-this.drag[i]! * dt);
      this.vx[i]! *= k;
      this.vy[i]! *= k;
      this.x[i]! += this.vx[i]! * dt;
      this.y[i]! += this.vy[i]! * dt;
      i++;
    }
  }

  /** Draws in world space; caller sets the world transform and 'lighter' compositing. */
  draw(ctx: CanvasRenderingContext2D, minX: number, minY: number, maxX: number, maxY: number): void {
    let lastColor = '';
    for (let i = 0; i < this.count; i++) {
      const x = this.x[i]!;
      const y = this.y[i]!;
      if (x < minX || x > maxX || y < minY || y > maxY) continue;
      const t = this.life[i]! / this.maxLife[i]!;
      const c = this.color[i]!;
      if (c !== lastColor) {
        ctx.fillStyle = c;
        ctx.strokeStyle = c;
        lastColor = c;
      }
      ctx.globalAlpha = Math.min(1, t * 1.6);
      const s = this.size[i]! * (0.4 + t * 0.6);
      const kind = this.kind[i]!;
      if (kind === 1) {
        const vx = this.vx[i]!;
        const vy = this.vy[i]!;
        ctx.lineWidth = s * 0.7;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - vx * 0.035, y - vy * 0.035);
        ctx.stroke();
      } else if (kind === 2) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(t * 9 + i);
        ctx.fillRect(-s, -s * 0.5, s * 2, s);
        ctx.restore();
      } else {
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
      }
    }
    ctx.globalAlpha = 1;
  }

  clear(): void {
    this.count = 0;
  }
}
