import type { EnemyKind, GameEvent } from '../game/types';
import type { WarpGrid } from './warpgrid';

/**
 * Gameplay -> WarpGrid force mapping. Kept separate from the renderer so the
 * tuning lives in one place (and the prototype harness drives the exact same code).
 * Strengths are world units / s (kicks) or world units / s² (continuous).
 *
 * The last argument of impulse/shock/ring/wake is the heat PERMIT: the highest
 * heat level the force may light up (2 ordinary kill, 3 big explosion / nova /
 * dash, 4 elite / perfect / player death, 5 capital ship / bomb).
 */

/** Structural view of World: only what the grid reads (co-op aware: every pilot). */
export interface GridWorldView {
  readonly players: readonly { x: number; y: number; dashT: number; alive: boolean }[];
  readonly enemies: readonly { x: number; y: number; kind: EnemyKind; dead: boolean; spawnT: number; hp: number; maxHp: number }[];
  readonly mines: readonly { x: number; y: number; radius: number; triggered: boolean; pull: boolean }[];
  readonly rings: readonly { x: number; y: number; radius: number; t: number; duration: number }[];
}

/** One-shot forces for a sim event. */
export function gridEvent(g: WarpGrid, ev: GameEvent, world: GridWorldView): void {
  switch (ev.t) {
    case 'kill':
      // Capital ships: a central kick only; 'bossdead' sends the travelling front.
      if (ev.boss) g.impulse(ev.x, ev.y, 240, 800, 5);
      else if (ev.elite) {
        g.impulse(ev.x, ev.y, 100 + ev.r * 4, 420, 4);
        g.shock(ev.x, ev.y, 150 + ev.r * 6, 2600, 750, 4);
      } else g.impulse(ev.x, ev.y, 80 + ev.r * 4, 220 + ev.r * 12, 2);
      break;
    case 'explode':
      if (ev.r >= 60) {
        g.impulse(ev.x, ev.y, 50 + ev.r * 1.2, 300 + ev.r * 2, 3);
        g.shock(ev.x, ev.y, ev.r * 1.7, 2000, 650, 3);
      } else g.impulse(ev.x, ev.y, 50 + ev.r * 1.5, 260 + ev.r * 3, 2);
      break;
    case 'bossdead':
      // Capital-ship death: a screen-crossing front (only the front glows), flare allowed.
      g.impulse(ev.x, ev.y, 260, 900, 5);
      g.shock(ev.x, ev.y, 1500, 5200, 1000, 5, 1, 80);
      break;
    case 'bomb':
      g.impulse(ev.x, ev.y, 220, 700, 5);
      g.shock(ev.x, ev.y, 1800, 5200, 1400, 5, 1, 80);
      break;
    case 'death':
      g.impulse(ev.x, ev.y, 180, 700, 4);
      g.shock(ev.x, ev.y, 1000, 4200, 800, 4, 0.4);
      break;
    case 'revive':
      g.shock(ev.x, ev.y, 800, 3600, 900, 4);
      break;
    case 'dash':
      // Initial kick behind the hull; the continuous wake follows in gridFrame().
      g.wake(ev.x - ev.dx * 50, ev.y - ev.dy * 50, ev.x, ev.y, 420, 80, 3);
      break;
    case 'perfect':
      g.impulse(ev.x, ev.y, 150, 450, 4);
      g.shock(ev.x, ev.y, 280, 3000, 900, 4);
      break;
    case 'hurt':
      g.impulse(ev.x, ev.y, 110, 260, 2);
      break;
    case 'shieldbreak':
      g.impulse(ev.x, ev.y, 150, 420, 3);
      break;
    case 'levelup':
      for (const p of world.players) if (p.alive) g.impulse(p.x, p.y, 240, 380, 3);
      break;
    default:
      break;
  }
}

/**
 * Continuous forces, once per rendered frame (dt = sim dt, so pause / slow-mo freeze it).
 * prev: last frame's pilot positions [x0, y0, x1, y1, ...] (for the dash wake); updated here.
 */
export function gridFrame(g: WarpGrid, world: GridWorldView, prev: Float32Array, dt: number): void {
  const ps = world.players;
  if (dt > 0) {
    for (let i = 0; i < ps.length && i * 2 + 1 < prev.length; i++) {
      const p = ps[i]!;
      // Frame-rate independent: 420 per 60 Hz frame.
      if (p.alive && p.dashT > 0) g.wake(prev[i * 2]!, prev[i * 2 + 1]!, p.x, p.y, 420 * dt * 60, 84, 3);
    }
    for (const e of world.enemies) {
      if (e.dead || e.spawnT > 0 || e.kind !== 'voidheart') continue;
      // Hive mothership: permanent swirling gravity well, harder when enraged.
      const rage = e.hp < e.maxHp * 0.5 ? 1.4 : 1;
      g.implode(e.x, e.y, 320, 3000 * rage, dt, 0.6);
    }
    for (const m of world.mines) {
      if (m.triggered && m.pull) g.implode(m.x, m.y, m.radius * 2.2, 6500, dt, 0.8);
    }
    for (const r of world.rings) {
      // Bastion nova: the visible ring front shoves the grid (no extra spawn kick).
      if (r.t >= 0 && r.t < r.duration) g.ring(r.x, r.y, r.radius, 44, 2400, dt, 3);
    }
  }
  for (let i = 0; i < ps.length && i * 2 + 1 < prev.length; i++) {
    prev[i * 2] = ps[i]!.x;
    prev[i * 2 + 1] = ps[i]!.y;
  }
}
