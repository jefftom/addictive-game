import type { EnemyKind, Shape } from '../types';

export interface EnemyDef {
  kind: EnemyKind;
  name: string;
  shape: Shape;
  color: string;
  r: number;
  hp: number;
  speed: number;
  damage: number;
  xp: number;
  score: number;
  /** Knockback resistance; higher is heavier. */
  mass: number;
  /** Director "threat points" per spawn. */
  cost: number;
  /** Run time (s) at which the director starts spawning this kind. */
  unlockAt: number;
  /** Relative spawn weight once unlocked. */
  weight: number;
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  drifter: {
    kind: 'drifter', name: 'Drifter', shape: 'tri', color: '#ff3d6e',
    r: 13, hp: 10, speed: 74, damage: 8, xp: 1, score: 10, mass: 1, cost: 1, unlockAt: 0, weight: 10,
  },
  swarmling: {
    kind: 'swarmling', name: 'Swarmling', shape: 'dart', color: '#ff8c42',
    r: 8, hp: 5, speed: 132, damage: 5, xp: 1, score: 5, mass: 0.6, cost: 0.45, unlockAt: 30, weight: 6,
  },
  dasher: {
    kind: 'dasher', name: 'Dasher', shape: 'diamond', color: '#ffd23f',
    r: 12, hp: 20, speed: 82, damage: 12, xp: 2, score: 20, mass: 1, cost: 2.2, unlockAt: 60, weight: 4,
  },
  splitter: {
    kind: 'splitter', name: 'Splitter', shape: 'circle', color: '#b15cff',
    r: 16, hp: 30, speed: 66, damage: 10, xp: 2, score: 20, mass: 1.5, cost: 2.5, unlockAt: 90, weight: 3,
  },
  splitling: {
    kind: 'splitling', name: 'Splitling', shape: 'circle', color: '#d79bff',
    r: 9, hp: 8, speed: 112, damage: 6, xp: 1, score: 5, mass: 0.7, cost: 0.5, unlockAt: 9999, weight: 0,
  },
  shooter: {
    kind: 'shooter', name: 'Shooter', shape: 'hex', color: '#ff4fd2',
    r: 15, hp: 28, speed: 72, damage: 8, xp: 3, score: 25, mass: 1.2, cost: 3, unlockAt: 120, weight: 3,
  },
  brute: {
    kind: 'brute', name: 'Brute', shape: 'square', color: '#ff5233',
    r: 26, hp: 110, speed: 52, damage: 18, xp: 6, score: 40, mass: 4, cost: 6, unlockAt: 150, weight: 2,
  },
  warden: {
    kind: 'warden', name: 'The Warden', shape: 'boss_hex', color: '#ff2d55',
    r: 52, hp: 3500, speed: 46, damage: 25, xp: 150, score: 5000, mass: 40, cost: 0, unlockAt: 9999, weight: 0,
  },
  hydra: {
    kind: 'hydra', name: 'The Hydra', shape: 'boss_star', color: '#ff7a1a',
    r: 44, hp: 10000, speed: 74, damage: 28, xp: 300, score: 10000, mass: 40, cost: 0, unlockAt: 9999, weight: 0,
  },
  voidheart: {
    kind: 'voidheart', name: 'Void Heart', shape: 'boss_core', color: '#9d4dff',
    r: 60, hp: 22000, speed: 34, damage: 30, xp: 600, score: 20000, mass: 60, cost: 0, unlockAt: 9999, weight: 0,
  },
};

export const BOSS_KINDS: ReadonlySet<EnemyKind> = new Set<EnemyKind>(['warden', 'hydra', 'voidheart']);

export const SPAWNABLE: EnemyKind[] = ['drifter', 'swarmling', 'dasher', 'splitter', 'shooter', 'brute'];

export const BOSS_SCHEDULE: { at: number; kind: EnemyKind; title: string }[] = [
  { at: 180, kind: 'warden', title: 'Keeper of the First Gate' },
  { at: 360, kind: 'hydra', title: 'It Hunts in Spirals' },
  { at: 540, kind: 'voidheart', title: 'The Storm Has a Heart' },
];

export const VICTORY_TIME = 600;
