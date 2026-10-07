import type { ShipId, Stats, WeaponId } from '../types';

export interface ShipDef {
  id: ShipId;
  name: string;
  color: string;
  weapon: WeaponId;
  trait: string;
  unlockText: string;
  /** Achievement id that unlocks this ship (null = always unlocked). */
  unlockAchievement: string | null;
  apply: (s: Stats) => void;
  /** Bastion: dash end releases a shockwave. */
  dashNova?: boolean;
}

export const SHIPS: Record<ShipId, ShipDef> = {
  spark: {
    id: 'spark', name: 'Glimmer of Hope', color: '#7ff9ff', weapon: 'pulse',
    trait: 'Balanced all-rounder.',
    unlockText: 'Unlocked',
    unlockAchievement: null,
    apply: () => {},
  },
  vanguard: {
    id: 'vanguard', name: 'Immovable Object', color: '#a6ffef', weapon: 'orbit',
    trait: '+40 HP, +2 armor, −8% speed.',
    unlockText: 'Survive 3:00 in a run',
    unlockAchievement: 'survive3',
    apply: (s) => { s.maxHp += 40; s.armor += 2; s.speed *= 0.92; },
  },
  tempest: {
    id: 'tempest', name: 'Already Gone', color: '#c9b8ff', weapon: 'arc',
    trait: '+15% speed, +10% crit, −20 HP.',
    unlockText: 'Reach a 150 combo',
    unlockAchievement: 'combo150',
    apply: (s) => { s.speed *= 1.15; s.crit += 0.1; s.maxHp -= 20; },
  },
  bastion: {
    id: 'bastion', name: 'Big Warm Hug', color: '#6fd2ff', weapon: 'nova',
    trait: 'Dashing ends in a shockwave. +20 HP.',
    unlockText: 'Defeat the Warden',
    unlockAchievement: 'warden',
    apply: (s) => { s.maxHp += 20; },
    dashNova: true,
  },
  phantom: {
    id: 'phantom', name: 'Definitely Not Here', color: '#ffb3f0', weapon: 'seeker',
    trait: '2 dash charges, −30% dash cooldown, −30 HP.',
    unlockText: '10 perfect dashes in one run',
    unlockAchievement: 'perfect10',
    apply: (s) => { s.dashCharges += 1; s.dashCooldown *= 0.7; s.maxHp -= 30; },
  },
};

export const SHIP_IDS = Object.keys(SHIPS) as ShipId[];
