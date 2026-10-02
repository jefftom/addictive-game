import { TAU } from '../core/math';
import { weaponStats, type WeaponStats } from './content/weapons';
import type { Enemy, WeaponInstance } from './types';
import type { World } from './world';

export function updateWeapons(world: World, dt: number): void {
  world.blades.length = 0;
  if (!world.player.alive) return;
  const cdMult = world.cooldownMult();
  for (const w of world.build.weapons) {
    const st = weaponStats(w.id, w.level, w.evolved);
    if (w.id === 'orbit') {
      updateOrbit(world, w, st, dt, cdMult);
      continue;
    }
    w.timer -= dt;
    if (w.timer > 0) continue;
    const fired = fireWeapon(world, w, st);
    w.timer = fired ? st.cooldown * cdMult : 0.1;
    if (fired) world.events.push({ t: 'shoot', weapon: w.id });
  }
}

function fireWeapon(world: World, w: WeaponInstance, st: WeaponStats): boolean {
  switch (w.id) {
    case 'pulse':
      return firePulse(world, w, st);
    case 'nova':
      return fireNova(world, w, st);
    case 'arc':
      return fireArc(world, w, st);
    case 'seeker':
      return fireSeeker(world, w, st);
    case 'mines':
      return fireMines(world, w, st);
    case 'lance':
      return fireLance(world, w, st);
    case 'orbit':
      return false;
  }
}

function firePulse(world: World, w: WeaponInstance, st: WeaponStats): boolean {
  const p = world.player;
  const s = world.stats;
  const target = world.nearestEnemy(p.x, p.y, 470);
  if (!target) return false;
  const base = Math.atan2(target.y - p.y, target.x - p.x);
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
      x: p.x + Math.cos(a) * 14,
      y: p.y + Math.sin(a) * 14,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
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
    });
  }
  return true;
}

function updateOrbit(world: World, w: WeaponInstance, st: WeaponStats, dt: number, cdMult: number): void {
  const p = world.player;
  const s = world.stats;
  w.phase += st.speed * dt * Math.sqrt(1 / cdMult);
  const count = st.count + s.amount;
  const radius = st.extra * s.area * (w.evolved ? 1 + Math.sin(world.time * 2.2) * 0.14 : 1);
  const bladeR = 10 * st.area * Math.sqrt(s.area);
  const hitCd = st.cooldown * cdMult;
  const buf = world.queryBuf;
  const victims: Enemy[] = [];
  for (let i = 0; i < count; i++) {
    const a = w.phase + (i / count) * TAU;
    const bx = p.x + Math.cos(a) * radius;
    const by = p.y + Math.sin(a) * radius;
    world.blades.push({ x: bx, y: by, r: bladeR });
    const n = world.grid.query(bx, by, bladeR + 64, buf);
    for (let k = 0; k < n; k++) {
      const e = world.enemies[buf[k]!]!;
      if (e.dead || world.time - e.orbitHitT < hitCd) continue;
      const dx = e.x - bx;
      const dy = e.y - by;
      const rr = e.r + bladeR;
      if (dx * dx + dy * dy <= rr * rr) {
        e.orbitHitT = world.time;
        victims.push(e);
      }
    }
  }
  for (const e of victims) {
    const d = Math.hypot(e.x - p.x, e.y - p.y) || 1;
    const [dmg, crit] = world.rollDamage(st.damage);
    world.damageEnemy(e, dmg, crit, (e.x - p.x) / d, (e.y - p.y) / d, 160);
  }
}

function fireNova(world: World, w: WeaponInstance, st: WeaponStats): boolean {
  const p = world.player;
  const s = world.stats;
  // Only fire when something is in range, so the rhythm reads as a response to danger.
  const radius = st.area * s.area;
  if (!world.nearestEnemy(p.x, p.y, radius + 40)) return false;
  for (let i = 0; i < st.count; i++) {
    world.addRing(p.x, p.y, radius, st.duration, st.damage, st.extra, true, w.evolved ? '#ffffff' : '#6fd2ff', i * 0.25);
  }
  return true;
}

function fireArc(world: World, w: WeaponInstance, st: WeaponStats): boolean {
  const p = world.player;
  const s = world.stats;
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
      let [dmg, crit] = world.rollDamage(st.damage);
      if (!crit && critBonus > 0 && world.rng.chance(critBonus)) {
        dmg *= s.critMult;
        crit = true;
      }
      const dx = target.x - from.x;
      const dy = target.y - from.y;
      const d = Math.hypot(dx, dy) || 1;
      const hit = target;
      from = { x: hit.x, y: hit.y };
      world.damageEnemy(hit, dmg, crit, dx / d, dy / d, 60);
      target = world.nearestEnemy(from.x, from.y, range, used);
    }
    world.events.push({ t: 'arc', points, evolved: w.evolved });
  }
  return true;
}

function fireSeeker(world: World, w: WeaponInstance, st: WeaponStats): boolean {
  const p = world.player;
  const s = world.stats;
  const target = world.nearestEnemy(p.x, p.y, 600);
  if (!target) return false;
  const count = st.count + s.amount;
  const speed = st.speed * s.projSpeed;
  const base = Math.atan2(p.facingY, p.facingX) + Math.PI;
  for (let i = 0; i < count; i++) {
    const a = base + (i - (count - 1) / 2) * 0.5 + world.rng.range(-0.15, 0.15);
    world.projectiles.push({
      kind: 'missile',
      weapon: 'seeker',
      x: p.x,
      y: p.y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
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
    });
  }
  return true;
}

function fireMines(world: World, w: WeaponInstance, st: WeaponStats): boolean {
  const p = world.player;
  const s = world.stats;
  for (let i = 0; i < st.count + s.amount; i++) {
    const a = world.rng.next() * TAU;
    const d = i === 0 ? 0 : world.rng.range(50, 110);
    world.mines.push({
      x: p.x + Math.cos(a) * d,
      y: p.y + Math.sin(a) * d,
      armT: 0.4,
      life: st.duration * s.duration,
      radius: st.area * s.area,
      damage: st.damage,
      pull: w.evolved,
      pullT: 0,
      triggered: false,
      dead: false,
    });
  }
  return true;
}

function fireLance(world: World, w: WeaponInstance, st: WeaponStats): boolean {
  const p = world.player;
  const s = world.stats;
  let angle: number;
  const moving = Math.hypot(p.vx, p.vy) > 30;
  if (moving) {
    angle = Math.atan2(p.facingY, p.facingX);
  } else {
    const target = world.nearestEnemy(p.x, p.y, 600);
    if (!target) return false;
    angle = Math.atan2(target.y - p.y, target.x - p.x);
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
    });
  }
  return true;
}
