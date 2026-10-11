import { clamp, TAU } from '../core/math';
import { MAX_PLAYERS, PLAYER_COLORS, REVIVE_RADIUS } from '../game/content/coop';
import type { Player } from '../game/types';
import type { World } from '../game/world';
import type { View } from './camera';
import { FONT_DISPLAY, FONT_MONO, PAL } from './palette';

export const EDGE_LEFT = 1, EDGE_RIGHT = 2, EDGE_TOP = 4, EDGE_BOTTOM = 8;

/** Shapes stay identifiable when colours or font glyphs cannot be distinguished. */
export function drawPilotMark(ctx: CanvasRenderingContext2D, pid: number, x: number, y: number, r: number, color: string): void {
  ctx.beginPath();
  switch (pid % 4) {
    case 0: ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r); ctx.lineTo(x - r, y + r); ctx.closePath(); break;
    case 1: ctx.arc(x, y, r, 0, TAU); break;
    case 2: ctx.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7); break;
    case 3: ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); break;
  }
  ctx.strokeStyle = 'rgba(5,4,15,0.85)'; ctx.lineWidth = r * 0.45; ctx.stroke();
  ctx.fillStyle = color; ctx.fill();
}

/** The sim's leash interval, read without allocating a filtered squad. */
export function leashEdges(world: World, pilot: Player): number {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of world.players) if (p !== pilot && p.alive) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  if (minX === Infinity) return 0;
  const span = world.maxSpan(), sx = span.x, sy = span.y;
  let sides = 0;
  if (Math.abs(pilot.x - (maxX - sx)) <= 0.5) sides |= EDGE_LEFT;
  if (Math.abs(pilot.x - (minX + sx)) <= 0.5) sides |= EDGE_RIGHT;
  if (Math.abs(pilot.y - (maxY - sy)) <= 0.5) sides |= EDGE_TOP;
  if (Math.abs(pilot.y - (minY + sy)) <= 0.5) sides |= EDGE_BOTTOM;
  return sides;
}

export function edgeIndicator(sx: number, sy: number, w: number, h: number, inset: number): { x: number; y: number; angle: number } | null {
  if (sx >= inset && sx <= w - inset && sy >= inset && sy <= h - inset) return null;
  const x = clamp(sx, inset, w - inset), y = clamp(sy, inset, h - inset);
  return { x, y, angle: Math.atan2(sy - y, sx - x) };
}

function outlined(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, ui: number): void {
  ctx.lineWidth = 3 * ui; ctx.strokeStyle = 'rgba(5,4,15,0.85)'; ctx.strokeText(text, x, y);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}

/** Crisp screen-space tags and revive feedback, after world post-processing. */
export class PilotOverlay {
  private readonly reviveLast = new Float64Array(MAX_PLAYERS);
  reset(): void { this.reviveLast.fill(0); }

  draw(ctx: CanvasRenderingContext2D, world: World, view: View, w: number, h: number,
    ui: number, ps: number, time: number, flashes: boolean): void {
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalCompositeOperation = 'source-over';
    const { k, ox, oy } = view;
    let up = 0, ghosts = 0;
    for (const p of world.players) { if (world.isUp(p)) up++; else if (p.alive && p.downed) ghosts++; }
    for (const p of world.players) {
      if (!p.alive) continue;
      const color = PLAYER_COLORS[p.pid % 4]!;
      const sx = ox + p.x * k, sy = oy + p.y * k;
      const sides = leashEdges(world, p);
      if (sides) {
        ctx.globalAlpha = flashes ? 0.24 + 0.06 * Math.sin(time * 4) : 0.22;
        const width = 24 * ui;
        for (const side of [EDGE_LEFT, EDGE_RIGHT, EDGE_TOP, EDGE_BOTTOM]) if (sides & side) {
          const x0 = side === EDGE_RIGHT ? w : 0, y0 = side === EDGE_BOTTOM ? h : 0;
          const x1 = side === EDGE_LEFT ? width : side === EDGE_RIGHT ? w - width : 0;
          const y1 = side === EDGE_TOP ? width : side === EDGE_BOTTOM ? h - width : 0;
          const g = ctx.createLinearGradient(x0, y0, x1, y1);
          g.addColorStop(0, color); g.addColorStop(1, color + '00'); ctx.fillStyle = g;
          ctx.fillRect(side === EDGE_RIGHT ? w - width : 0, side === EDGE_BOTTOM ? h - width : 0,
            side & (EDGE_LEFT | EDGE_RIGHT) ? width : w, side & (EDGE_TOP | EDGE_BOTTOM) ? width : h);
        }
      }
      ctx.globalAlpha = p.downed ? 0.6 : 1;
      const tagY = sy - (p.r + 16) * ps * k;
      drawPilotMark(ctx, p.pid, sx - 10 * ui, tagY, 4.5 * ui, color);
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.font = `800 ${10 * ui}px ${FONT_DISPLAY}`;
      outlined(ctx, `P${p.pid + 1}`, sx - 2 * ui, tagY, color, ui);
      if (world.isUp(p) && p.hp < p.stats.maxHp) {
        const start = Math.PI / 6, angle = Math.PI * 2 / 3, radius = (p.r + 7) * ps * k;
        ctx.lineWidth = 2.5 * ui; ctx.strokeStyle = p.hp / p.stats.maxHp < 0.3 ? PAL.danger : PAL.hp;
        ctx.globalAlpha = 0.15; ctx.beginPath(); ctx.arc(sx, sy, radius, start, start + angle); ctx.stroke();
        ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(sx, sy, radius, start, start + angle * clamp(p.hp / p.stats.maxHp, 0, 1)); ctx.stroke();
      }
      if (p.downed) {
        const radius = REVIVE_RADIUS * k, progress = clamp(p.reviveT / world.reviveNeed(p), 0, 1);
        ctx.globalAlpha = 0.4; ctx.strokeStyle = color; ctx.lineWidth = 1.5 * ui;
        ctx.setLineDash([6 * ui, 5 * ui]); ctx.lineDashOffset = flashes ? -time * 20 * ui : 0;
        ctx.beginPath(); ctx.arc(sx, sy, radius, 0, TAU); ctx.stroke();
        ctx.setLineDash([]); ctx.lineDashOffset = 0; ctx.globalAlpha = 0.9; ctx.lineWidth = 3 * ui;
        ctx.beginPath(); ctx.arc(sx, sy, radius, -Math.PI / 2, -Math.PI / 2 + TAU * progress); ctx.stroke();
        ctx.font = `700 ${11 * ui}px ${FONT_MONO}`; ctx.textAlign = 'center';
        const text = p.reviveT > this.reviveLast[p.pid]! ? `REVIVING ${Math.round(progress * 100)}%` : 'FLY HERE TO REVIVE';
        outlined(ctx, text, sx, sy + radius + 12 * ui, color, ui);
      } else if (up === 1 && ghosts > 0) {
        ctx.globalAlpha = flashes ? 0.35 + 0.25 * Math.sin(time * 5) : 0.45;
        ctx.strokeStyle = '#ff6b8a'; ctx.lineWidth = 2 * ui;
        ctx.beginPath(); ctx.arc(sx, sy, (p.r + 18) * ps * k, 0, TAU); ctx.stroke();
      }
      this.reviveLast[p.pid] = p.reviveT;
      const edge = edgeIndicator(sx, sy, w, h, 10 * ui);
      if (edge) {
        ctx.globalAlpha = p.downed ? 0.6 : 1;
        ctx.save(); ctx.translate(edge.x, edge.y); ctx.rotate(edge.angle);
        ctx.strokeStyle = color; ctx.lineWidth = 2 * ui; ctx.beginPath();
        ctx.moveTo(-6 * ui, -6 * ui); ctx.lineTo(6 * ui, 0); ctx.lineTo(-6 * ui, 6 * ui); ctx.stroke();
        ctx.restore();
        drawPilotMark(ctx, p.pid, edge.x - Math.cos(edge.angle) * 15 * ui, edge.y - Math.sin(edge.angle) * 15 * ui, 4.5 * ui, color);
      }
    }
    ctx.restore();
  }
}
