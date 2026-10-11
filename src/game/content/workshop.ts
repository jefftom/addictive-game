import { pow } from '../../core/dmath';
import type { DailyModifierId, Stats } from '../types';

export interface WorkshopDef {
  id: string;
  name: string;
  icon: string;
  text: string;
  maxLevel: number;
  baseCost: number;
  growth: number;
  apply: (s: Stats, level: number) => void;
}

export const WORKSHOP: WorkshopDef[] = [
  {
    id: 'hull', name: 'Reinforced Hull', icon: '▣', text: '+10 max HP', maxLevel: 5, baseCost: 35, growth: 1.6,
    apply: (s, l) => { s.maxHp += 10 * l; },
  },
  {
    id: 'might', name: 'Might', icon: '▲', text: '+5% damage', maxLevel: 5, baseCost: 50, growth: 1.6,
    apply: (s, l) => { s.damage *= 1 + 0.05 * l; },
  },
  {
    id: 'reach', name: 'Reach', icon: '∪', text: '+12% pickup radius', maxLevel: 5, baseCost: 30, growth: 1.55,
    apply: (s, l) => { s.magnet *= 1 + 0.12 * l; },
  },
  {
    id: 'haste', name: 'Haste', icon: '»', text: '+4% move speed', maxLevel: 5, baseCost: 40, growth: 1.6,
    apply: (s, l) => { s.speed *= 1 + 0.04 * l; },
  },
  {
    id: 'growth', name: 'Growth', icon: '✧', text: '+6% XP', maxLevel: 5, baseCost: 50, growth: 1.6,
    apply: (s, l) => { s.xpGain *= 1 + 0.06 * l; },
  },
  {
    id: 'greed', name: 'Greed', icon: '$', text: '+10% cores from score and pickups', maxLevel: 5, baseCost: 55, growth: 1.65,
    apply: (s, l) => { s.coreGain *= 1 + 0.1 * l; },
  },
  {
    id: 'reflex', name: 'Reflex', icon: '⚡', text: '−6% dash cooldown', maxLevel: 3, baseCost: 70, growth: 1.8,
    apply: (s, l) => { s.dashCooldown *= pow(0.94, l); },
  },
  {
    id: 'recovery', name: 'Recovery', icon: '✚', text: '+0.15 HP regenerated per second', maxLevel: 3, baseCost: 85, growth: 1.8,
    apply: (s, l) => { s.regen += 0.15 * l; },
  },
  {
    id: 'armor', name: 'Armor', icon: '⬡', text: '+1 armor', maxLevel: 3, baseCost: 100, growth: 1.9,
    apply: (s, l) => { s.armor += l; },
  },
  {
    id: 'reroll', name: 'Reroll', icon: '⟳', text: '+1 reroll per run', maxLevel: 3, baseCost: 70, growth: 2,
    apply: (s, l) => { s.rerolls += l; },
  },
  {
    id: 'revival', name: 'Revival', icon: '❤', text: '+1 revive per run', maxLevel: 1, baseCost: 600, growth: 1,
    apply: (s, l) => { s.revives += l; },
  },
];

export function workshopCost(def: WorkshopDef, level: number): number {
  return Math.round(def.baseCost * pow(def.growth, level));
}

export interface DailyModifierDef {
  id: DailyModifierId;
  name: string;
  text: string;
}

export const DAILY_MODIFIERS: DailyModifierDef[] = [
  { id: 'swarm', name: 'Swarm Day', text: '+60% enemies, +30% XP' },
  { id: 'glass', name: 'Glass World', text: 'You and every enemy have half HP' },
  { id: 'hyper', name: 'Hyperdrive', text: 'Everything moves 20% faster' },
  { id: 'bounty', name: 'Bounty Hunt', text: 'Elites every 25 s' },
  { id: 'rich', name: 'Gold Rush', text: 'Shards worth double, enemies +30% HP' },
  { id: 'blitz', name: 'Blitz', text: 'Dash recharges 60% faster' },
  { id: 'giants', name: 'Land of Giants', text: 'Half as many enemies, but bigger and tougher' },
];
