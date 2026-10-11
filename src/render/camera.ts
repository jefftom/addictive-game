import { clamp, damp } from '../core/math';
import type { World } from '../game/world';

export interface View { k: number; ox: number; oy: number }
export const CAM_INSET = 30;
export const SOLO_LOOK_AHEAD = 0.12;
export const COOP_LOOK_AHEAD = 0.08;
export const SOLO_DAMPING = 7;
export const COOP_DAMPING = 10;

/** Device-pixel transform; s scales the world target, shake is in CSS pixels. */
export function viewOf(camX: number, camY: number, zoom: number, scale: number, dpr: number,
  tw: number, th: number, s: number, shakeX: number, shakeY: number): View {
  const k = scale * dpr * s / zoom;
  return { k, ox: tw / 2 - camX * k + shakeX * dpr * s, oy: th / 2 - camY * k + shakeY * dpr * s };
}

/** Follow without allocating player lists or retaining the world's scratch objects. */
export function followCamera(cam: { camX: number; camY: number }, world: World, rdt: number,
  halfW: number, halfH: number, bottomPad: number): void {
  if (!world.coop) {
    const p = world.players[0]!;
    const tx = p.x + p.vx * SOLO_LOOK_AHEAD;
    const ty = p.y + p.vy * SOLO_LOOK_AHEAD;
    const cd = damp(SOLO_DAMPING, rdt);
    cam.camX += (tx - cam.camX) * cd;
    cam.camY += (ty - cam.camY) * cd;
    return;
  }
  const c = world.teamCenter(), cx = c.x, cy = c.y;
  const v = world.teamVelocity(), vx = v.x, vy = v.y;
  const cd = damp(COOP_DAMPING, rdt);
  cam.camX += (cx + vx * COOP_LOOK_AHEAD - cam.camX) * cd;
  cam.camY += (cy + vy * COOP_LOOK_AHEAD - cam.camY) * cd;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of world.players) if (p.alive) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  if (minX === Infinity) return;
  const xLo = maxX - (halfW - CAM_INSET), xHi = minX + halfW - CAM_INSET;
  cam.camX = xLo <= xHi ? clamp(cam.camX, xLo, xHi) : (minX + maxX) / 2;
  const yHi = minY + halfH - CAM_INSET;
  let yLo = maxY - (halfH - CAM_INSET - bottomPad);
  if (yLo > yHi) yLo = maxY - (halfH - CAM_INSET);
  cam.camY = yLo <= yHi ? clamp(cam.camY, yLo, yHi) : (minY + maxY) / 2;
}
