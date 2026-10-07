import { TAU } from '../core/math';
import { TARGET_HYSTERESIS } from './content/coop';
import type { Enemy, Player } from './types';
import type { World } from './world';

const KNOCK_DECAY = 9;
const HYST2 = TARGET_HYSTERESIS * TARGET_HYSTERESIS;

/**
 * The pilot this enemy chases: the nearest active one, with hysteresis so an
 * enemy between two pilots doesn't jitter. Updates `e.tgt`.
 */
export function targetOf(world: World, e: Enemy): Player {
  const ps = world.players;
  if (ps.length === 1) return ps[0]!;
  let best: Player | null = null;
  let bestD2 = Infinity;
  for (const p of ps) {
    if (!world.isUp(p)) continue;
    const dx = p.x - e.x;
    const dy = p.y - e.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = p;
    }
  }
  const cur = ps[e.tgt] ?? ps[0]!;
  if (!best) return cur; // Only after a team wipe (gameOver).
  if (cur !== best && world.isUp(cur)) {
    const dx = cur.x - e.x;
    const dy = cur.y - e.y;
    if (bestD2 > (dx * dx + dy * dy) * HYST2) return cur;
  }
  e.tgt = best.pid;
  return best;
}

export function updateEnemies(world: World, dt: number): void {
  // Chrono Field is team-wide (does not stack).
  const slow = world.teamHasRelic('chrono') ? 0.88 : 1;
  const farLimit = Math.max(world.effHalfW(), world.effHalfH()) * 1.5 + 350;
  const decay = Math.exp(-KNOCK_DECAY * dt);
  const coop = world.coop;
  const center = world.teamCenter();
  const cx = center.x;
  const cy = center.y;

  for (const e of world.enemies) {
    if (e.dead) continue;
    if (e.spawnT > 0) e.spawnT -= dt;
    if (e.flash > 0) e.flash -= dt;

    let p = targetOf(world, e);
    let dx = p.x - e.x;
    let dy = p.y - e.y;
    let d = Math.hypot(dx, dy) || 1;

    // Enemies left far behind the team view are recycled ahead of the team.
    const far = coop ? Math.hypot(e.x - cx, e.y - cy) : d;
    if (!e.boss && far > farLimit) {
      const sp = world.spawnPoint(60);
      e.x = sp.x;
      e.y = sp.y;
      e.kx = 0;
      e.ky = 0;
      if (coop) p = targetOf(world, e);
      dx = p.x - e.x;
      dy = p.y - e.y;
      d = Math.hypot(dx, dy) || 1;
    }

    const ux = dx / d;
    const uy = dy / d;
    const speed = e.speed * slow * (e.spawnT > 0 ? 0.3 : 1);

    switch (e.kind) {
      case 'swarmling': {
        const wob = Math.sin(world.time * 6 + e.id) * 0.45;
        const mx = ux - uy * wob;
        const my = uy + ux * wob;
        const m = Math.hypot(mx, my) || 1;
        e.x += (mx / m) * speed * dt;
        e.y += (my / m) * speed * dt;
        e.angle = Math.atan2(my, mx);
        break;
      }
      case 'dasher':
        updateDasher(e, ux, uy, d, speed, dt);
        break;
      case 'shooter':
        updateShooter(world, e, ux, uy, d, speed, dt);
        break;
      case 'warden':
        updateWarden(world, e, ux, uy, speed, dt);
        break;
      case 'hydra':
        updateHydra(world, e, ux, uy, speed, dt);
        break;
      case 'voidheart':
        updateVoidHeart(world, e, ux, uy, speed, dt);
        break;
      default:
        e.x += ux * speed * dt;
        e.y += uy * speed * dt;
        if (e.kind === 'drifter') e.angle = Math.atan2(uy, ux);
        else e.angle += e.spin * dt;
        break;
    }

    e.x += e.kx * dt;
    e.y += e.ky * dt;
    e.kx *= decay;
    e.ky *= decay;
  }
}

/** Soft separation so crowds read as a swarm instead of a single blob. */
export function separateEnemies(world: World): void {
  const buf = world.queryBuf;
  const list = world.enemies;
  for (let i = 0; i < list.length; i++) {
    const e = list[i]!;
    if (e.dead) continue;
    const n = world.grid.query(e.x, e.y, e.r + 30, buf);
    let px = 0;
    let py = 0;
    for (let k = 0; k < n; k++) {
      const j = buf[k]!;
      if (j === i) continue;
      const o = list[j]!;
      if (o.dead) continue;
      const dx = e.x - o.x;
      const dy = e.y - o.y;
      const min = e.r + o.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min) continue;
      if (d2 < 0.0001) {
        px += (i % 2 === 0 ? 1 : -1) * 0.5;
        continue;
      }
      const d = Math.sqrt(d2);
      const overlap = min - d;
      const share = o.mass / (e.mass + o.mass);
      px += (dx / d) * overlap * share;
      py += (dy / d) * overlap * share;
    }
    e.x += px * 0.5;
    e.y += py * 0.5;
  }
}

function updateDasher(e: Enemy, ux: number, uy: number, d: number, speed: number, dt: number): void {
  e.stateT -= dt;
  switch (e.state) {
    case 0: // approach
      e.x += ux * speed * dt;
      e.y += uy * speed * dt;
      e.angle = Math.atan2(uy, ux);
      if (d < 270 && e.stateT <= 0 && e.spawnT <= 0) {
        e.state = 1;
        e.stateT = 0.6;
        e.aimX = ux;
        e.aimY = uy;
      }
      break;
    case 1: // telegraph: track the player, then lock in
      if (e.stateT > 0.2) {
        e.aimX = ux;
        e.aimY = uy;
      }
      e.angle = Math.atan2(e.aimY, e.aimX);
      if (e.stateT <= 0) {
        e.state = 2;
        e.stateT = 0.42;
      }
      break;
    case 2: // charge
      e.x += e.aimX * speed * 4.6 * dt;
      e.y += e.aimY * speed * 4.6 * dt;
      if (e.stateT <= 0) {
        e.state = 3;
        e.stateT = 0.7;
      }
      break;
    default: // recover
      e.x += ux * speed * 0.3 * dt;
      e.y += uy * speed * 0.3 * dt;
      if (e.stateT <= 0) {
        e.state = 0;
        e.stateT = 1.2;
      }
      break;
  }
}

function updateShooter(world: World, e: Enemy, ux: number, uy: number, d: number, speed: number, dt: number): void {
  let mv = 0;
  if (d > 340) mv = 1;
  else if (d < 240) mv = -0.8;
  // Strafe sideways while holding range.
  const side = e.id % 2 === 0 ? 1 : -1;
  e.x += (ux * mv - uy * side * 0.5) * speed * dt;
  e.y += (uy * mv + ux * side * 0.5) * speed * dt;
  e.angle += dt * 1.5;
  e.fireT -= dt;
  if (e.fireT <= 0 && d < 560 && e.spawnT <= 0) {
    e.fireT = e.elite ? 1.4 : 2.4;
    const a = Math.atan2(uy, ux);
    if (e.elite) {
      for (let i = -1; i <= 1; i++) world.fireBullet(e.x, e.y, a + i * 0.22, 220, 10);
    } else {
      world.fireBullet(e.x, e.y, a, 210, 10);
    }
    world.events.push({ t: 'enemyshoot', x: e.x, y: e.y });
  }
}

function burst(world: World, e: Enemy, n: number, speed: number, offset: number, damage: number): void {
  for (let i = 0; i < n; i++) world.fireBullet(e.x, e.y, offset + (i / n) * TAU, speed, damage, 7);
  world.events.push({ t: 'enemyshoot', x: e.x, y: e.y });
}

function summonRing(world: World, e: Enemy, kind: 'swarmling' | 'dasher' | 'drifter', n: number, radius: number): void {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    world.spawnEnemy(kind, e.x + Math.cos(a) * radius, e.y + Math.sin(a) * radius);
  }
}

function updateWarden(world: World, e: Enemy, ux: number, uy: number, speed: number, dt: number): void {
  const enraged = e.hp < e.maxHp * 0.5;
  e.x += ux * speed * dt;
  e.y += uy * speed * dt;
  e.angle += dt * (enraged ? 0.9 : 0.5);
  if (e.spawnT > 0) return;
  e.fireT -= dt;
  if (e.fireT <= 0) {
    e.fireT = enraged ? 2.2 : 3.4;
    e.state = (e.state + 1) % 2;
    burst(world, e, enraged ? 22 : 16, 150, e.state * 0.2 + e.angle, 9);
  }
  e.summonT -= dt;
  if (e.summonT <= 0) {
    e.summonT = 9;
    summonRing(world, e, 'swarmling', 10, 210);
  }
}

function updateHydra(world: World, e: Enemy, ux: number, uy: number, speed: number, dt: number): void {
  const enraged = e.hp < e.maxHp * 0.5;
  e.stateT -= dt;
  e.angle += dt * 2;
  switch (e.state) {
    case 0: // chase
      e.x += ux * speed * dt;
      e.y += uy * speed * dt;
      if (e.stateT <= 0 && e.spawnT <= 0) {
        e.state = 1;
        e.stateT = enraged ? 0.6 : 0.85;
      }
      break;
    case 1: // telegraph
      e.aimX = ux;
      e.aimY = uy;
      if (e.stateT <= 0) {
        e.state = 2;
        e.stateT = 0.65;
      }
      break;
    case 2: // charge
      e.x += e.aimX * 640 * dt;
      e.y += e.aimY * 640 * dt;
      if (e.stateT <= 0) {
        e.state = 3;
        e.stateT = 1.4;
        e.fireT = 0;
      }
      break;
    default: {
      // spiral volley
      e.fireT -= dt;
      if (e.fireT <= 0) {
        e.fireT = 0.1;
        const arms = enraged ? 5 : 3;
        const base = e.stateT * 4;
        for (let i = 0; i < arms; i++) world.fireBullet(e.x, e.y, base + (i / arms) * TAU, 160, 11, 7);
      }
      if (e.stateT <= 0) {
        e.state = 0;
        e.stateT = 2.2;
      }
      break;
    }
  }
}

function updateVoidHeart(world: World, e: Enemy, ux: number, uy: number, speed: number, dt: number): void {
  const enraged = e.hp < e.maxHp * 0.5;
  e.x += ux * speed * dt;
  e.y += uy * speed * dt;
  e.angle += dt * 0.6;
  if (e.spawnT > 0) return;
  e.fireT -= dt;
  if (e.fireT <= 0) {
    e.fireT = 0.15;
    e.aimX += 0.27;
    for (let i = 0; i < 3; i++) world.fireBullet(e.x, e.y, e.aimX + (i / 3) * TAU, 150, 12, 7);
    if (enraged) for (let i = 0; i < 2; i++) world.fireBullet(e.x, e.y, -e.aimX * 1.3 + (i / 2) * TAU, 130, 12, 7);
  }
  e.summonT -= dt;
  if (e.summonT <= 0) {
    e.summonT = 7;
    summonRing(world, e, 'dasher', enraged ? 8 : 5, 260);
  }
}
