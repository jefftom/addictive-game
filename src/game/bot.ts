import type { Rng } from '../core/rng';
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
 */
export function botInput(world: World, rng: Rng, opts: BotOptions = { skill: 0.6 }): ControlInput {
  const p = world.player;
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
  if (pressure < 1.2) {
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
export function botPick(world: World, offers: Offer[], rng: Rng): Offer {
  const evo = offers.find((o) => o.kind === 'evolve');
  if (evo) return evo;
  const owned = offers.find((o) => o.kind === 'weapon' && !o.isNew);
  if (owned && rng.chance(0.65)) return owned;
  const fresh = offers.find((o) => o.kind === 'weapon' && o.isNew);
  if (fresh && world.build.weapons.length < 3 && rng.chance(0.6)) return fresh;
  return rng.pick(offers);
}

/** Resolves all pending level-ups and caches with bot picks. */
export function botResolvePending(world: World, rng: Rng, applyFn: (o: Offer) => void): void {
  let guard = 0;
  while ((world.pendingLevelUps > 0 || world.pendingCaches > 0) && guard++ < 50) {
    const cache = world.pendingCaches > 0;
    if (cache) world.pendingCaches--;
    else world.pendingLevelUps--;
    const offers = generateOffers(world, 3, cache);
    applyFn(botPick(world, offers, rng));
  }
}
