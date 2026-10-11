import type { PassiveId, WeaponId } from '../types';

export interface WeaponStats {
  damage: number;
  cooldown: number;
  count: number;
  pierce: number;
  speed: number;
  area: number;
  duration: number;
  /** Weapon-specific extra (chain range, orbit radius, beam width, etc.). */
  extra: number;
}

export interface WeaponDef {
  id: WeaponId;
  name: string;
  evolvedName: string;
  color: string;
  icon: string;
  blurb: string;
  evolvedBlurb: string;
  evolvesWith: PassiveId;
  /** Player rank required for the weapon to appear in offers. */
  unlockRank: number;
  /** Index 0 = level 1. */
  levels: WeaponStats[];
  /** What each level-up adds (index 0 describes reaching level 2). */
  levelText: string[];
  evolved: WeaponStats;
}

export const MAX_WEAPON_LEVEL = 5;
export const MAX_WEAPONS = 4;

const s = (
  damage: number,
  cooldown: number,
  count: number,
  pierce: number,
  speed: number,
  area: number,
  duration: number,
  extra = 0,
): WeaponStats => ({ damage, cooldown, count, pierce, speed, area, duration, extra });

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  pulse: {
    id: 'pulse', name: 'Pulse Blaster', evolvedName: 'Photon Storm', color: '#7ff9ff', icon: '◆',
    blurb: 'Fires bolts at the nearest enemy.',
    evolvedBlurb: 'A torrent of piercing photon bolts.',
    evolvesWith: 'overclock', unlockRank: 0,
    levels: [
      s(12, 0.7, 1, 0, 540, 1, 1.1),
      s(12, 0.7, 2, 0, 540, 1, 1.1),
      s(17, 0.7, 2, 1, 560, 1, 1.1),
      s(17, 0.55, 2, 1, 580, 1, 1.1),
      s(22, 0.55, 3, 1, 600, 1, 1.1),
    ],
    levelText: ['+1 bolt', '+5 damage, bolts pierce 1 enemy', '−20% cooldown', '+1 bolt, +5 damage'],
    evolved: s(26, 0.16, 2, 3, 760, 1.2, 1.0),
  },
  orbit: {
    id: 'orbit', name: 'Orbit Blades', evolvedName: 'Halo Saw', color: '#a6ffef', icon: '✦',
    blurb: 'Blades circle your ship, slicing anything close.',
    evolvedBlurb: 'A roaring ring of eight saw blades.',
    evolvesWith: 'amp', unlockRank: 0,
    // speed = angular speed (rad/s), extra = orbit radius, area = blade size multiplier
    levels: [
      s(9, 0.5, 2, 0, 3.2, 1, 0, 72),
      s(9, 0.5, 3, 0, 3.2, 1, 0, 72),
      s(13, 0.5, 3, 0, 3.4, 1.1, 0, 84),
      s(13, 0.45, 4, 0, 3.8, 1.1, 0, 84),
      s(17, 0.45, 5, 0, 3.9, 1.2, 0, 90),
    ],
    levelText: ['+1 blade', '+4 damage, wider orbit', '+1 blade, spins faster', '+1 blade, +4 damage'],
    evolved: s(28, 0.35, 8, 0, 4.6, 1.5, 0, 112),
  },
  nova: {
    id: 'nova', name: 'Nova', evolvedName: 'Supernova', color: '#6fd2ff', icon: '◎',
    blurb: 'Periodically releases a shockwave that knocks enemies back.',
    evolvedBlurb: 'Twin shockwaves of enormous size.',
    evolvesWith: 'power', unlockRank: 0,
    // area = radius, duration = expansion time, extra = knockback
    levels: [
      s(22, 3.0, 1, 0, 0, 140, 0.35, 260),
      s(30, 3.0, 1, 0, 0, 140, 0.35, 260),
      s(30, 3.0, 1, 0, 0, 170, 0.38, 280),
      s(30, 2.4, 1, 0, 0, 170, 0.38, 280),
      s(42, 2.4, 1, 0, 0, 200, 0.4, 300),
    ],
    levelText: ['+8 damage', '+20% radius', '−20% cooldown', '+12 damage, +18% radius'],
    evolved: s(70, 1.8, 2, 0, 0, 280, 0.45, 360),
  },
  arc: {
    id: 'arc', name: 'Arc Lightning', evolvedName: 'Tempest Arc', color: '#c9b8ff', icon: 'ϟ',
    blurb: 'Lightning jumps between nearby enemies.',
    evolvedBlurb: 'Storms of lightning that chain through crowds.',
    evolvesWith: 'crit', unlockRank: 0,
    // pierce = number of chain jumps, extra = jump range
    levels: [
      s(16, 1.4, 1, 3, 0, 1, 0, 170),
      s(16, 1.4, 1, 4, 0, 1, 0, 170),
      s(24, 1.4, 1, 4, 0, 1, 0, 180),
      s(24, 1.1, 1, 5, 0, 1, 0, 190),
      s(32, 1.1, 2, 5, 0, 1, 0, 200),
    ],
    levelText: ['+1 jump', '+8 damage', '−20% cooldown, +1 jump', '+1 arc, +8 damage'],
    evolved: s(40, 0.6, 2, 8, 0, 1, 0, 230),
  },
  seeker: {
    id: 'seeker', name: 'Seeker Swarm', evolvedName: 'Hive', color: '#ffb3f0', icon: '➤',
    blurb: 'Homing missiles that explode on impact.',
    evolvedBlurb: 'A hive of fast missiles with huge blasts.',
    evolvesWith: 'velocity', unlockRank: 2,
    // area = splash radius, duration = missile lifetime
    levels: [
      s(18, 1.8, 2, 0, 340, 50, 2.5),
      s(18, 1.8, 3, 0, 340, 50, 2.5),
      s(26, 1.8, 3, 0, 360, 65, 2.5),
      s(26, 1.4, 3, 0, 380, 65, 2.5),
      s(32, 1.4, 5, 0, 380, 70, 2.5),
    ],
    levelText: ['+1 missile', '+8 damage, bigger blasts', '−22% cooldown', '+2 missiles, +6 damage'],
    evolved: s(40, 0.9, 6, 0, 440, 90, 2.8),
  },
  mines: {
    id: 'mines', name: 'Gravity Mines', evolvedName: 'Singularity', color: '#b4ff6a', icon: '✷',
    blurb: 'Drops mines that detonate when enemies come close.',
    evolvedBlurb: 'Mines become black holes that drag enemies in.',
    evolvesWith: 'magnet', unlockRank: 4,
    // area = blast radius, duration = mine lifetime
    levels: [
      s(45, 1.6, 1, 0, 0, 90, 6),
      s(60, 1.6, 1, 0, 0, 90, 6),
      s(60, 1.6, 2, 0, 0, 110, 6),
      s(60, 1.2, 2, 0, 0, 110, 6),
      s(85, 1.2, 3, 0, 0, 120, 6),
    ],
    levelText: ['+15 damage', '+1 mine, bigger blasts', '−25% cooldown', '+1 mine, +25 damage'],
    evolved: s(140, 1.1, 3, 0, 0, 150, 6, 190),
  },
  lance: {
    id: 'lance', name: 'Prism Lance', evolvedName: 'Comet Lance', color: '#fff4a8', icon: '⟋',
    blurb: 'A piercing beam fired in the direction you move.',
    evolvedBlurb: 'Four rotating beams of solid light.',
    evolvesWith: 'thrusters', unlockRank: 5,
    // area = beam length, extra = beam width
    levels: [
      s(30, 2.2, 1, 0, 0, 420, 0.25, 14),
      s(42, 2.2, 1, 0, 0, 420, 0.25, 14),
      s(42, 2.2, 1, 0, 0, 520, 0.28, 22),
      s(42, 1.7, 1, 0, 0, 520, 0.28, 22),
      s(58, 1.7, 2, 0, 0, 560, 0.3, 24),
    ],
    levelText: ['+12 damage', 'Longer, wider beam', '−23% cooldown', 'Fires front and back, +16 damage'],
    evolved: s(90, 1.2, 4, 0, 0, 650, 0.45, 30),
  },
};

export const WEAPON_IDS = Object.keys(WEAPONS) as WeaponId[];

export function weaponStats(id: WeaponId, level: number, evolved: boolean): WeaponStats {
  const def = WEAPONS[id];
  if (evolved) return def.evolved;
  return def.levels[Math.max(0, Math.min(def.levels.length - 1, level - 1))]!;
}
