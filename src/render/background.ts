import { hash32 } from '../core/rng';
import { GalaxyBackdrop, SECTORS, backdropRef, type GalaxyEvent } from './galaxy';
import GalaxyWorker from './galaxy.worker?worker&inline';

function frac(n: number): number {
  return (n % 1000003) / 1000003;
}

/**
 * Off-thread sector generation. The worker is inlined into the bundle (a Blob
 * URL), so the single-file build and file:// / Electron keep it; if it cannot
 * start, the backdrop falls back to chunked generation on the main thread.
 */
function makeGalaxyWorker(): Worker {
  return new GalaxyWorker();
}

/**
 * Parallax void: the procedural galaxy sector backdrop (galaxy.ts), three
 * star layers and a world grid that pulses with the music. During a sector
 * warp the stars stretch into streaks and the grid fades.
 */
export class Background {
  readonly galaxy: GalaxyBackdrop;
  private vignette: HTMLCanvasElement | null = null;
  private vw = 0;
  private vh = 0;

  constructor(onEvent?: (e: GalaxyEvent) => void) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const quality = backdropRef(window.innerWidth * dpr, window.innerHeight * dpr) / 1080;
    this.galaxy = new GalaxyBackdrop({ quality, worker: makeGalaxyWorker, onEvent });
  }

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

  /** `k` is the zoom-aware world -> device px scale; camX/camY the shared camera. */
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
    // Galaxy sector backdrop (opaque: replaces the base fill).
    this.galaxy.draw(ctx, camX, camY, k, w, h, time, { intensity: tint, beat });
    const fx = this.galaxy.warpFx;
    const halfW = w / 2 / k;
    const halfH = h / 2 / k;

    // Stars. While warping they stretch radially into streaks: one batched path per layer.
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
      const f = st * (0.35 + L.p) * 0.6;
      if (st > 0.02) {
        ctx.globalAlpha = Math.min(1, L.alpha * (1 + st));
        ctx.lineWidth = s;
        ctx.beginPath();
      }
      const sx0 = Math.floor((cx - halfW) / L.cell);
      const sx1 = Math.floor((cx + halfW) / L.cell);
      const sy0 = Math.floor((cy - halfH) / L.cell);
      const sy1 = Math.floor((cy + halfH) / L.cell);
      for (let gx = sx0; gx <= sx1; gx++) {
        for (let gy = sy0; gy <= sy1; gy++) {
          const hsh = hash32((gx * 92837111) ^ (gy * 689287499) ^ (L.cell * 31));
          const wx = (gx + frac(hsh)) * L.cell;
          const wy = (gy + frac(hash32(hsh ^ 0x5bd1e995))) * L.cell;
          const px = (wx - cx) * k + w / 2;
          const py = (wy - cy) * k + h / 2;
          if (st > 0.02) {
            ctx.moveTo(px, py);
            ctx.lineTo(px + (px - w / 2) * f, py + (py - h / 2) * f);
          } else {
            const tw = 0.6 + 0.4 * Math.sin(time * (1 + (hsh % 5)) + (hsh % 100));
            ctx.globalAlpha = L.alpha * tw;
            ctx.fillRect(px - s / 2, py - s / 2, s, s);
          }
        }
      }
      if (st > 0.02) ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    // Grid (world space, pulses on the beat, fades through a warp). A desaturated
    // PAL.grid in every sector, so it never takes on the sector's own hue.
    const [gr, gg, gb] = SECTORS[Math.max(0, this.galaxy.sector)]!.gridRGB;
    const spacing = 80;
    const left = camX - halfW;
    const top = camY - halfH;
    const pulse = (1 + beat * 0.9) * fx.gridAlpha;
    ctx.lineWidth = Math.max(1, k * 0.9);
    for (let major = 0; major < 2; major++) {
      ctx.strokeStyle = `rgba(${gr},${gg},${gb},${(major ? 0.1 : 0.05) * pulse})`;
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
