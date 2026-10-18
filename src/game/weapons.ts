import { atan2, cos, hypot, sin } from '../core/dmath';
import { TAU } from '../core/math';
import { weaponStats, type WeaponStats } from './content/weapons';
import type { Enemy, WeaponInstance } from './types';
import type { PlayerState, World } from './world';

/** Fires every active pilot's weapons (pid order). Downed ghosts don't fire. */
export function updateWeapons(world: World, dt: number): void {
  world.blades.length = 0;
  for (const p of world.players) {
    if (!world.isUp(p)) continue;
    const cdMult = world.cooldownMult(p);
    for (const w of p.build.weapons) {
      const st = weaponStats(w.id, w.level, w.evolved);
      if (w.id === 'orbit') {
        updateOrbit(world, p, w, st, dt, cdMult);
        continue;
      }
      w.timer -= dt;
      if (w.timer > 0) continue;
      const fired = fireWeapon(world, p, w, st);
      w.timer = fired ? st.cooldown * cdMult : 0.1;
      if (fired) world.events.push({ t: 'shoot', weapon: w.id });
    }
  }
}

function fireWeapon(world: World, p: PlayerState, w: WeaponInstance, st: WeaponStats): boolean {
  switch (w.id) {
    case 'pulse':
      return firePulse(world, p, w, st);
    case 'nova':
      return fireNova(world, p, w, st);
    case 'arc':
      return fireArc(world, p, w, st);
    case 'seeker':
      return fireSeeker(world, p, w, st);
    case 'mines':
      return fireMines(world, p, w, st);
    case 'lance':
      return fireLance(world, p, w, st);
    case 'orbit':
      return false;
  }
}

function firePulse(world: World, p: PlayerState, w: WeaponInstance, st: WeaponStats): boolean {
  const s = p.stats;
  const target = world.nearestEnemy(p.x, p.y, 470);
  if (!target) return false;
  const base = atan2(target.y - p.y, target.x - p.x);
  const count = st.count + s.amount;
  const spread = w.evolved ? 0.06 : 0.14;
  if (w.evolved) w.phase = (w.phase + 1) % 2;
  const speed = st.speed * s.projSpeed;
  for (let i = 0; i < count; i++) {
    const off = (i - (count - 1) / 2) * spread + (w.evolved ? (w.phase - 0.5) * 0.05 : 0);
    const a = base + off;
    world.projectiles.push({
      kind: 'bolt',
      weapon: 'pulse',
      x: p.x + cos(a) * 14,
      y: p.y + sin(a) * 14,
      vx: cos(a) * speed,
      vy: sin(a) * speed,
      r: 5 * st.area * Math.sqrt(s.area),
      damage: st.damage,
      pierce: st.pierce,
      life: st.duration * s.duration,
      speed,
      turn: 0,
      splash: 0,
      targetId: -1,
      hits: [],
      evolved: w.evolved,
      dead: false,
      owner: p.pid,
    });
  }
  return true;
}

function updateOrbit(world: World, p: PlayerState, w: WeaponInstance, st: WeaponStats, dt: number, cdMult: number): void {
  const s = p.stats;
  const pid = p.pid;
  w.phase += st.speed * dt * Math.sqrt(1 / cdMult);
  const count = st.count + s.amount;
  const radius = st.extra * s.area * (w.evolved ? 1 + sin(world.time * 2.2) * 0.14 : 1);
  const bladeR = 10 * st.area * Math.sqrt(s.area);
  const hitCd = st.cooldown * cdMult;
  const buf = world.queryBuf;
  const victims: Enemy[] = [];
  for (let i = 0; i < count; i++) {
    const a = w.phase + (i / count) * TAU;
    const bx = p.x + cos(a) * radius;
    const by = p.y + sin(a) * radius;
    world.blades.push({ x: bx, y: by, r: bladeR, pid });
    const n = world.grid.query(bx, by, bladeR + 64, buf);
    for (let k = 0; k < n; k++) {
      const e = world.enemies[buf[k]!]!;
      if (e.dead || world.time - e.orbitHitT[pid]! < hitCd) continue;
      const dx = e.x - bx;
      const dy = e.y - by;
      const rr = e.r + bladeR;
      if (dx * dx + dy * dy <= rr * rr) {
        e.orbitHitT[pid] = world.time;
        victims.push(e);
      }
    }
  }
  for (const e of victims) {
    const d = hypot(e.x - p.x, e.y - p.y) || 1;
    const [dmg, crit] = world.rollDamage(st.damage, pid);
    world.damageEnemy(e, dmg, crit, (e.x - p.x) / d, (e.y - p.y) / d, 160, false, pid);
  }
}

function fireNova(world: World, p: PlayerState, w: WeaponInstance, st: WeaponStats): boolean {
  const s = p.stats;
  // Only fire when something is in range, so the rhythm reads as a response to danger.
  const radius = st.area * s.area;
  if (!world.nearestEnemy(p.x, p.y, radius + 40)) return false;
  for (let i = 0; i < st.count; i++) {
    world.addRing(p.x, p.y, radius, st.duration, st.damage, st.extra, true, w.evolved ? '#ffffff' : '#6fd2ff', i * 0.25, p.pid);
  }
  return true;
}

function fireArc(world: World, p: PlayerState, w: WeaponInstance, st: WeaponStats): boolean {
  const s = p.stats;
  const first = world.nearestEnemy(p.x, p.y, 420);
  if (!first) return false;
  const used = new Set<number>();
  const range = st.extra * Math.sqrt(s.area);
  const critBonus = w.evolved ? 0.2 : 0;
  for (let arc = 0; arc < st.count + s.amount; arc++) {
    let from: { x: number; y: number } = p;
    let target: Enemy | null = arc === 0 ? first : world.nearestEnemy(p.x, p.y, 420, used);
    if (!target) break;
    const points: number[] = [p.x, p.y];
    for (let jump = 0; jump <= st.pierce && target; jump++) {
      used.add(target.id);
      points.push(target.x, target.y);
      let [dmg, crit] = world.rollDamage(st.damage, p.pid);
      if (!crit && critBonus > 0 && world.rng.chance(critBonus)) {
        dmg *= s.critMult;
        crit = true;
      }
      const dx = target.x - from.x;
      const dy = target.y - from.y;
      const d = hypot(dx, dy) || 1;
      const hit = target;
      from = { x: hit.x, y: hit.y };
      world.damageEnemy(hit, dmg, crit, dx / d, dy / d, 60, false, p.pid);
      target = world.nearestEnemy(from.x, from.y, range, used);
    }
    world.events.push({ t: 'arc', points, evolved: w.evolved });
  }
  return true;
}

function fireSeeker(world: World, p: PlayerState, w: WeaponInstance, st: WeaponStats): boolean {
  const s = p.stats;
  const target = world.nearestEnemy(p.x, p.y, 600);
  if (!target) return false;
  const count = st.count + s.amount;
  const speed = st.speed * s.projSpeed;
  const base = atan2(p.facingY, p.facingX) + Math.PI;
  for (let i = 0; i < count; i++) {
    const a = base + (i - (count - 1) / 2) * 0.5 + world.rng.range(-0.15, 0.15);
    world.projectiles.push({
      kind: 'missile',
      weapon: 'seeker',
      x: p.x,
      y: p.y,
      vx: cos(a) * speed,
      vy: sin(a) * speed,
      r: 6,
      damage: st.damage,
      pierce: 0,
      life: st.duration * s.duration,
      speed,
      turn: w.evolved ? 7.5 : 5,
      splash: st.area * s.area,
      targetId: target.id,
      hits: [],
      evolved: w.evolved,
      dead: false,
      owner: p.pid,
    });
  }
  return true;
}

function fireMines(world: World, p: PlayerState, w: WeaponInstance, st: WeaponStats): boolean {
  const s = p.stats;
  for (let i = 0; i < st.count + s.amount; i++) {
    const a = world.rng.next() * TAU;
    const d = i === 0 ? 0 : world.rng.range(50, 110);
    world.mines.push({
      x: p.x + cos(a) * d,
      y: p.y + sin(a) * d,
      armT: 0.4,
      life: st.duration * s.duration,
      radius: st.area * s.area,
      damage: st.damage,
      pull: w.evolved,
      pullT: 0,
      triggered: false,
      dead: false,
      owner: p.pid,
    });
  }
  return true;
}

function fireLance(world: World, p: PlayerState, w: WeaponInstance, st: WeaponStats): boolean {
  const s = p.stats;
  let angle: number;
  const moving = hypot(p.vx, p.vy) > 30;
  if (moving) {
    angle = atan2(p.facingY, p.facingX);
  } else {
    const target = world.nearestEnemy(p.x, p.y, 600);
    if (!target) return false;
    angle = atan2(target.y - p.y, target.x - p.x);
  }
  const count = st.count;
  for (let i = 0; i < count; i++) {
    world.beams.push({
      id: world.newFxId(),
      x: p.x,
      y: p.y,
      angle: angle + (i / count) * TAU,
      length: st.area * s.area,
      width: st.extra * Math.sqrt(s.area),
      t: 0,
      duration: st.duration * s.duration,
      damage: st.damage,
      evolved: w.evolved,
      hit: new Set(),
      owner: p.pid,
    });
  }
  return true;
}
