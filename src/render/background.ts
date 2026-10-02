import { hash32 } from '../core/rng';

const NEBULA_COLORS = ['#3b1d8f', '#0f5e7a', '#6a1b6b', '#1b2f8f', '#4a1360'];

function frac(n: number): number {
  return (n % 1000003) / 1000003;
}

/**
 * Parallax void: nebula clouds, three star layers and a world grid that
 * pulses with the music.
 */
export class Background {
  private vignette: HTMLCanvasElement | null = null;
  private vw = 0;
  private vh = 0;

  private ensureVignette(w: number, h: number): HTMLCanvasElement {
    if (this.vignette && this.vw === w && this.vh === h) return this.vignette;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d')!;
    const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.6);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(2,1,8,0.78)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    this.vignette = c;
    this.vw = w;
    this.vh = h;
    return c;
  }

  draw(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    k: number,
    w: number,
    h: number,
    time: number,
    beat: number,
    tint: number,
  ): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#05040f';
    ctx.fillRect(0, 0, w, h);

    // Nebula clouds (parallax 0.12).
    ctx.globalCompositeOperation = 'lighter';
    const np = 0.12;
    const cell = 1500;
    const ncx = camX * np;
    const ncy = camY * np;
    const halfW = w / 2 / k;
    const halfH = h / 2 / k;
    const reach = 1200;
    const x0 = Math.floor((ncx - halfW - reach) / cell);
    const x1 = Math.floor((ncx + halfW + reach) / cell);
    const y0 = Math.floor((ncy - halfH - reach) / cell);
    const y1 = Math.floor((ncy + halfH + reach) / cell);
    for (let gx = x0; gx <= x1; gx++) {
      for (let gy = y0; gy <= y1; gy++) {
        const hsh = hash32(gx * 73856093 ^ gy * 19349663);
        const wx = (gx + frac(hsh)) * cell;
        const wy = (gy + frac(hash32(hsh))) * cell;
        const r = 600 + frac(hash32(hsh + 7)) * 600;
        const sx = (wx - ncx) * k + w / 2;
        const sy = (wy - ncy) * k + h / 2;
        const sr = r * k;
        if (sx + sr < 0 || sx - sr > w || sy + sr < 0 || sy - sr > h) continue;
        const color = NEBULA_COLORS[hsh % NEBULA_COLORS.length]!;
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, sr);
        g.addColorStop(0, hexAlpha(color, 0.2 + tint * 0.1));
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
      }
    }

    // Stars.
    const layers = [
      { p: 0.2, cell: 160, size: 1, alpha: 0.45 },
      { p: 0.4, cell: 220, size: 1.5, alpha: 0.6 },
      { p: 0.65, cell: 320, size: 2, alpha: 0.8 },
    ];
    ctx.fillStyle = '#cfe4ff';
    for (const L of layers) {
      const cx = camX * L.p;
      const cy = camY * L.p;
      const sx0 = Math.floor((cx - halfW) / L.cell);
      const sx1 = Math.floor((cx + halfW) / L.cell);
      const sy0 = Math.floor((cy - halfH) / L.cell);
      const sy1 = Math.floor((cy + halfH) / L.cell);
      for (let gx = sx0; gx <= sx1; gx++) {
        for (let gy = sy0; gy <= sy1; gy++) {
          const hsh = hash32((gx * 92837111) ^ (gy * 689287499) ^ (L.cell * 31));
          const wx = (gx + frac(hsh)) * L.cell;
          const wy = (gy + frac(hash32(hsh ^ 0x5bd1e995))) * L.cell;
          const tw = 0.6 + 0.4 * Math.sin(time * (1 + (hsh % 5)) + (hsh % 100));
          ctx.globalAlpha = L.alpha * tw;
          const s = L.size * Math.max(1, k * 0.8);
          ctx.fillRect((wx - cx) * k + w / 2 - s / 2, (wy - cy) * k + h / 2 - s / 2, s, s);
        }
      }
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // Grid (world space, pulses on the beat).
    const spacing = 80;
    const left = camX - halfW;
    const top = camY - halfH;
    const pulse = 1 + beat * 0.9;
    ctx.lineWidth = Math.max(1, k * 0.9);
    for (let major = 0; major < 2; major++) {
      ctx.strokeStyle = major ? `rgba(120,150,255,${0.1 * pulse})` : `rgba(96,120,255,${0.05 * pulse})`;
      ctx.beginPath();
      for (let gx = Math.floor(left / spacing) * spacing; gx <= camX + halfW; gx += spacing) {
        const isMajor = Math.round(gx / spacing) % 5 === 0;
        if (isMajor !== (major === 1)) continue;
        const sx = Math.round((gx - camX) * k + w / 2) + 0.5;
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, h);
      }
      for (let gy = Math.floor(top / spacing) * spacing; gy <= camY + halfH; gy += spacing) {
        const isMajor = Math.round(gy / spacing) % 5 === 0;
        if (isMajor !== (major === 1)) continue;
        const sy = Math.round((gy - camY) * k + h / 2) + 0.5;
        ctx.moveTo(0, sy);
        ctx.lineTo(w, sy);
      }
      ctx.stroke();
    }
  }

  drawVignette(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(this.ensureVignette(w, h), 0, 0);
  }
}

export function hexAlpha(color: string, alpha: number): string {
  const n = parseInt(color.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
