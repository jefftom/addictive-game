import type { PassiveId, Rarity, RelicId, Stats } from '../types';

export interface PassiveDef {
  id: PassiveId;
  name: string;
  icon: string;
  color: string;
  /** Description of one level. */
  text: string;
  apply: (s: Stats, level: number) => void;
}

export const MAX_PASSIVE_LEVEL = 5;
export const MAX_PASSIVES = 4;

export const PASSIVES: Record<PassiveId, PassiveDef> = {
  power: {
    id: 'power', name: 'Power Core', icon: '▲', color: '#ff7a7a',
    text: '+12% damage',
    apply: (s, l) => { s.damage *= 1 + 0.12 * l; },
  },
  overclock: {
    id: 'overclock', name: 'Overclock', icon: '⟳', color: '#7ff9ff',
    text: '−8% weapon cooldown',
    apply: (s, l) => { s.cooldown *= Math.pow(0.92, l); },
  },
  amp: {
    id: 'amp', name: 'Amplifier', icon: '◉', color: '#a6ffef',
    text: '+12% area',
    apply: (s, l) => { s.area *= 1 + 0.12 * l; },
  },
  thrusters: {
    id: 'thrusters', name: 'Thrusters', icon: '»', color: '#fff4a8',
    text: '+8% move speed',
    apply: (s, l) => { s.speed *= 1 + 0.08 * l; },
  },
  magnet: {
    id: 'magnet', name: 'Tractor Field', icon: '∪', color: '#b4ff6a',
    text: '+30% pickup radius',
    apply: (s, l) => { s.magnet *= 1 + 0.3 * l; },
  },
  plating: {
    id: 'plating', name: 'Hull Plating', icon: '▣', color: '#9fb4ff',
    text: '+20 max HP, +1 armor',
    apply: (s, l) => { s.maxHp += 20 * l; s.armor += l; },
  },
  nanites: {
    id: 'nanites', name: 'Nanites', icon: '✚', color: '#6dff8a',
    text: '+0.4 HP regenerated per second',
    apply: (s, l) => { s.regen += 0.4 * l; },
  },
  fortune: {
    id: 'fortune', name: 'Fortune Engine', icon: '✧', color: '#ffd23f',
    text: '+15% luck, +8% XP',
    apply: (s, l) => { s.luck *= 1 + 0.15 * l; s.xpGain *= 1 + 0.08 * l; },
  },
  velocity: {
    id: 'velocity', name: 'Velocity Coil', icon: '⇉', color: '#ffb3f0',
    text: '+15% projectile speed, +10% duration',
    apply: (s, l) => { s.projSpeed *= 1 + 0.15 * l; s.duration *= 1 + 0.1 * l; },
  },
  dashcoil: {
    id: 'dashcoil', name: 'Dash Coil', icon: '⚡', color: '#c9b8ff',
    text: '−12% dash cooldown, +25% dash damage',
    apply: (s, l) => { s.dashCooldown *= Math.pow(0.88, l); s.dashDamage *= 1 + 0.25 * l; },
  },
  crit: {
    id: 'crit', name: 'Targeting Matrix', icon: '⌖', color: '#ff9f6b',
    text: '+6% critical chance, +10% critical damage',
    apply: (s, l) => { s.crit += 0.06 * l; s.critMult += 0.1 * l; },
  },
};

export const PASSIVE_IDS = Object.keys(PASSIVES) as PassiveId[];

export interface RelicDef {
  id: RelicId;
  name: string;
  icon: string;
  rarity: Rarity;
  text: string;
  apply?: (s: Stats) => void;
}

export const RELICS: Record<RelicId, RelicDef> = {
  glass: {
    id: 'glass', name: 'Glass Cannon', icon: '◇', rarity: 'epic',
    text: '+40% damage, −25% max HP',
    apply: (s) => { s.damage *= 1.4; s.maxHp *= 0.75; },
  },
  secondwind: {
    id: 'secondwind', name: 'Second Wind', icon: '❤', rarity: 'legendary',
    text: 'Revive once at 50% HP',
    apply: (s) => { s.revives += 1; },
  },
  vamp: {
    id: 'vamp', name: 'Vampiric Core', icon: '♥', rarity: 'rare',
    text: 'Kills have an 8% chance to heal 2 HP',
  },
  chrono: {
    id: 'chrono', name: 'Chrono Field', icon: '⧗', rarity: 'epic',
    text: 'Enemies move 12% slower, their shots 20% slower',
  },
  comboeng: {
    id: 'comboeng', name: 'Combo Engine', icon: '∞', rarity: 'rare',
    text: 'Combo timer lasts 1.2 s longer',
    apply: (s) => { s.comboWindow += 1.2; },
  },
  shield: {
    id: 'shield', name: 'Prism Shield', icon: '⬡', rarity: 'rare',
    text: 'Blocks one hit; recharges after 20 s',
  },
  exec: {
    id: 'exec', name: 'Executioner', icon: '✕', rarity: 'epic',
    text: 'Non-boss enemies below 12% HP shatter instantly',
  },
  fever: {
    id: 'fever', name: 'Fever', icon: '☄', rarity: 'legendary',
    text: 'At 40+ combo: +35% attack speed, +15% move speed',
  },
  twindash: {
    id: 'twindash', name: 'Twin Dash', icon: '⇶', rarity: 'epic',
    text: '+1 dash charge',
    apply: (s) => { s.dashCharges += 1; },
  },
  bounty: {
    id: 'bounty', name: 'Bounty Hunter', icon: '$', rarity: 'rare',
    text: '+25% cores; elites drop double cores',
    apply: (s) => { s.coreGain *= 1.25; },
  },
};

export const RELIC_IDS = Object.keys(RELICS) as RelicId[];

export const RARITY_WEIGHT: Record<Rarity, number> = {
  common: 10,
  rare: 3.2,
  epic: 1.6,
  legendary: 0.7,
};

export const RARITY_COLOR: Record<Rarity, string> = {
  common: '#9fdcff',
  rare: '#5aa8ff',
  epic: '#c46bff',
  legendary: '#ffc93c',
};
