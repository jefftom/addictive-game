export type WeaponId = 'pulse' | 'orbit' | 'nova' | 'arc' | 'seeker' | 'mines' | 'lance';
export type PassiveId =
  | 'power'
  | 'overclock'
  | 'amp'
  | 'thrusters'
  | 'magnet'
  | 'plating'
  | 'nanites'
  | 'fortune'
  | 'velocity'
  | 'dashcoil'
  | 'crit';
export type RelicId =
  | 'glass'
  | 'secondwind'
  | 'vamp'
  | 'chrono'
  | 'comboeng'
  | 'shield'
  | 'exec'
  | 'fever'
  | 'twindash'
  | 'bounty';
export type ShipId = 'spark' | 'vanguard' | 'tempest' | 'bastion' | 'phantom';
export type EnemyKind =
  | 'drifter'
  | 'swarmling'
  | 'dasher'
  | 'splitter'
  | 'splitling'
  | 'shooter'
  | 'brute'
  | 'warden'
  | 'hydra'
  | 'voidheart';
export type Shape = 'tri' | 'dart' | 'diamond' | 'circle' | 'hex' | 'square' | 'boss_hex' | 'boss_star' | 'boss_core';
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';

export interface Stats {
  maxHp: number;
  regen: number;
  armor: number;
  speed: number;
  damage: number;
  cooldown: number;
  area: number;
  projSpeed: number;
  duration: number;
  amount: number;
  magnet: number;
  luck: number;
  xpGain: number;
  crit: number;
  critMult: number;
  dashCooldown: number;
  dashCharges: number;
  dashDamage: number;
  comboWindow: number;
  revives: number;
  coreGain: number;
  rerolls: number;
}

export interface WeaponInstance {
  id: WeaponId;
  level: number;
  evolved: boolean;
  timer: number;
  /** Generic per-weapon scratch value (e.g. orbit angle). */
  phase: number;
}

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  /** Knockback velocity, decays quickly. */
  kx: number;
  ky: number;
  r: number;
  hp: number;
  maxHp: number;
  speed: number;
  damage: number;
  xp: number;
  score: number;
  mass: number;
  elite: boolean;
  boss: boolean;
  flash: number;
  angle: number;
  spin: number;
  state: number;
  stateT: number;
  aimX: number;
  aimY: number;
  fireT: number;
  summonT: number;
  orbitHitT: number;
  dashHitId: number;
  spawnT: number;
  dead: boolean;
}

export interface Projectile {
  kind: 'bolt' | 'missile';
  weapon: WeaponId;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  damage: number;
  pierce: number;
  life: number;
  speed: number;
  turn: number;
  splash: number;
  targetId: number;
  hits: number[];
  evolved: boolean;
  dead: boolean;
}

export interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  damage: number;
  life: number;
  grazed: boolean;
  dead: boolean;
}

export type PickupKind = 'xp' | 'heart' | 'magnet' | 'bomb' | 'core' | 'cache';

export interface Pickup {
  kind: PickupKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  value: number;
  magnetized: boolean;
  age: number;
  dead: boolean;
}

export interface Ring {
  id: number;
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  t: number;
  duration: number;
  damage: number;
  knock: number;
  follow: boolean;
  hit: Set<number>;
  color: string;
  hurtsPlayer: boolean;
}

export interface Mine {
  x: number;
  y: number;
  armT: number;
  life: number;
  radius: number;
  damage: number;
  pull: boolean;
  pullT: number;
  triggered: boolean;
  dead: boolean;
}

export interface Beam {
  id: number;
  x: number;
  y: number;
  angle: number;
  length: number;
  width: number;
  t: number;
  duration: number;
  damage: number;
  evolved: boolean;
  /** Enemies this beam has already hit. */
  hit: Set<number>;
}

export interface Player {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  hp: number;
  facingX: number;
  facingY: number;
  invuln: number;
  hurtT: number;
  dashT: number;
  dashDirX: number;
  dashDirY: number;
  dashCharges: number;
  dashRecharge: number;
  dashId: number;
  dashBuffer: number;
  perfectThisDash: boolean;
  shieldT: number;
  shieldReady: boolean;
  alive: boolean;
  revivesUsed: number;
}

export interface ControlInput {
  /** Desired movement, each axis in [-1, 1]; magnitude <= 1. */
  mx: number;
  my: number;
  /** True for one tick when the dash button was pressed. */
  dash: boolean;
}

export type DailyModifierId = 'swarm' | 'glass' | 'hyper' | 'bounty' | 'rich' | 'blitz' | 'giants';

export interface RunConfig {
  seed: number;
  ship: ShipId;
  workshop: Record<string, number>;
  rank: number;
  daily: DailyModifierId | null;
  /** Unlocked content pools; computed from rank. */
  weaponPool: WeaponId[];
  relicsEnabled: boolean;
  hardMode: boolean;
}

export type GameEvent =
  | { t: 'hit'; x: number; y: number; dmg: number; crit: boolean }
  | { t: 'kill'; x: number; y: number; color: string; r: number; elite: boolean; boss: boolean; score: number; dash: boolean }
  | { t: 'shoot'; weapon: WeaponId }
  | { t: 'pickup'; kind: PickupKind; value: number }
  | { t: 'levelup'; level: number }
  | { t: 'dash'; x: number; y: number; dx: number; dy: number }
  | { t: 'dashready' }
  | { t: 'perfect'; x: number; y: number }
  | { t: 'hurt'; dmg: number; x: number; y: number }
  | { t: 'shieldbreak'; x: number; y: number }
  | { t: 'heal'; amount: number }
  | { t: 'combo'; tier: number; mult: number }
  | { t: 'combobreak'; combo: number }
  | { t: 'milestone'; name: string; combo: number }
  | { t: 'boss'; name: string; title: string }
  | { t: 'bossdead'; x: number; y: number; name: string }
  | { t: 'death'; x: number; y: number }
  | { t: 'revive'; x: number; y: number }
  | { t: 'ring'; x: number; y: number; r: number; color: string }
  | { t: 'arc'; points: number[]; evolved: boolean }
  | { t: 'explode'; x: number; y: number; r: number; color: string }
  | { t: 'elite'; x: number; y: number }
  | { t: 'surge' }
  | { t: 'victory' }
  | { t: 'bomb'; x: number; y: number }
  | { t: 'magnet' }
  | { t: 'newbest' }
  | { t: 'enemyshoot'; x: number; y: number };
