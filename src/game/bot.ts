import type { Rng } from '../core/rng';
import { REVIVE_RADIUS } from './content/coop';
import type { ControlInput } from './types';
import { generateOffers, type Offer } from './upgrades';
import type { World } from './world';

export interface BotOptions {
  /** 0 = clumsy, 1 = sharp. Scales threat awareness and dash usage. */
  skill: number;
}

/**
 * A simple steering bot used for the title-screen attract mode and the
 * headless balance simulation. It flees weighted threats, drifts toward
 * shards when safe, and dashes when something is about to touch it.
 * It can drive any pilot (`pid`); in co-op it also goes to revive downed
 * teammates and keeps close to the team.
 */
export function botInput(world: World, rng: Rng, opts: BotOptions = { skill: 0.6 }, pid = 0): ControlInput {
  const p = world.players[pid]!;
  if (p.downed) {
    // Ghost: float toward the nearest teammate who can revive us (no rng draw).
    const q = world.nearestUpPlayer(p.x, p.y);
    if (!q) return { mx: 0, my: 0, dash: false };
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d < REVIVE_RADIUS * 0.5) return { mx: 0, my: 0, dash: false };
    return { mx: dx / d, my: dy / d, dash: false };
  }
  let fx = 0;
  let fy = 0;
  let threat = 0;
  const sense = 170 + 120 * opts.skill;

  for (const e of world.enemies) {
    if (e.dead) continue;
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d > sense + e.r) continue;
    const w = ((e.boss ? 4 : e.elite ? 2 : 1) * 9000) / (d * d);
    fx += (dx / d) * w;
    fy += (dy / d) * w;
    if (d < e.r + p.r + 26) threat++;
  }
  for (const b of world.bullets) {
    const dx = p.x - b.x;
    const dy = p.y - b.y;
    const d = Math.hypot(dx, dy) || 1;
    if (d > 140) continue;
    // Only care about bullets heading toward us.
    const closing = -(dx * b.vx + dy * b.vy) / d;
    if (closing <= 0) continue;
    const w = (6000 * opts.skill) / (d * d);
    // Sidestep perpendicular to the bullet.
    fx += (-b.vy / (Math.hypot(b.vx, b.vy) || 1)) * w;
    fy += (b.vx / (Math.hypot(b.vx, b.vy) || 1)) * w;
    if (d < 34) threat++;
  }

  const pressure = Math.hypot(fx, fy);
  let reviving = false;
  if (world.coop) {
    // (a) Revive duty: go to the nearest downed teammate when it's not too hot.
    if (pressure < 2.5) {
      let best: { x: number; y: number } | null = null;
      let bestD = 900;
      for (const q of world.players) {
        if (q === p || !q.alive || !q.downed) continue;
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bestD) {
          bestD = d;
          best = q;
        }
      }
      if (best) {
        reviving = true;
        const d = bestD || 1;
        // Ease off inside the revive circle so we hold position instead of orbiting.
        const pull = d > REVIVE_RADIUS * 0.5 ? 2 : (2 * d) / (REVIVE_RADIUS * 0.5);
        fx += ((best.x - p.x) / d) * pull;
        fy += ((best.y - p.y) / d) * pull;
      }
    }
    // (b) Cohesion: don't stray toward the leash.
    const c = world.teamCenter();
    const dc = Math.hypot(c.x - p.x, c.y - p.y);
    if (dc > 0.35 * world.maxSpan().x) {
      fx += ((c.x - p.x) / dc) * 0.8;
      fy += ((c.y - p.y) / dc) * 0.8;
    }
  }
  if (pressure < 1.2 && !reviving) {
    // Safe: go collect shards.
    let best = Infinity;
    let gx = 0;
    let gy = 0;
    for (const pk of world.pickups) {
      if (pk.dead) continue;
      const d = Math.hypot(pk.x - p.x, pk.y - p.y);
      const weight = pk.kind === 'xp' ? d : d * 0.5;
      if (weight < best && d < 420) {
        best = weight;
        gx = (pk.x - p.x) / (d || 1);
        gy = (pk.y - p.y) / (d || 1);
      }
    }
    fx += gx * 1.2;
    fy += gy * 1.2;
    // Gentle wander so the bot does not stand still.
    const t = world.time * 0.4;
    fx += Math.cos(t * 1.3) * 0.25;
    fy += Math.sin(t * 0.9) * 0.25;
  }

  const m = Math.hypot(fx, fy);
  const mx = m > 0.05 ? fx / m : 0;
  const my = m > 0.05 ? fy / m : 0;
  const dash = threat > 0 && rng.chance(0.25 + 0.6 * opts.skill);
  return { mx, my, dash };
}

/** Picks an offer: prefers evolutions, then upgrades to owned weapons, otherwise random. */
export function botPick(world: World, offers: Offer[], rng: Rng, pid = 0): Offer {
  const evo = offers.find((o) => o.kind === 'evolve');
  if (evo) return evo;
  const owned = offers.find((o) => o.kind === 'weapon' && !o.isNew);
  if (owned && rng.chance(0.65)) return owned;
  const fresh = offers.find((o) => o.kind === 'weapon' && o.isNew);
  if (fresh && world.players[pid]!.build.weapons.length < 3 && rng.chance(0.6)) return fresh;
  return rng.pick(offers);
}

/**
 * Resolves all pending picks (caches, then level rounds) with bot picks, for
 * every pilot in world order. `applyFn` receives the picking pid.
 */
export function botResolvePending(world: World, rng: Rng, applyFn: (o: Offer, pid: number) => void): void {
  let guard = 0;
  while (guard++ < 50 * world.players.length && world.hasPendingPicks()) {
    const r = world.beginPick();
    if (!r) break;
    const offers = generateOffers(world, 3, r.cache, r.pid);
    applyFn(botPick(world, offers, rng, r.pid), r.pid);
  }
}
