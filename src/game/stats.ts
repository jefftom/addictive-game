import { pow } from '../core/dmath';
import { PASSIVES, RELICS } from './content/passives';
import { SHIPS } from './content/ships';
import { WORKSHOP } from './content/workshop';
import type { PassiveId, RelicId, RunConfig, ShipId, Stats } from './types';

export function baseStats(): Stats {
  return {
    maxHp: 100,
    regen: 0,
    armor: 0,
    speed: 210,
    damage: 1,
    cooldown: 1,
    area: 1,
    projSpeed: 1,
    duration: 1,
    amount: 0,
    magnet: 105,
    luck: 1,
    xpGain: 1,
    crit: 0.05,
    critMult: 2,
    dashCooldown: 2.4,
    dashCharges: 1,
    dashDamage: 1,
    comboWindow: 2.5,
    revives: 0,
    coreGain: 1,
    rerolls: 1,
  };
}

export function computeStats(
  cfg: RunConfig,
  passives: Partial<Record<PassiveId, number>>,
  relics: readonly RelicId[],
  ship: ShipId = cfg.ship,
): Stats {
  const s = baseStats();
  SHIPS[ship].apply(s);
  for (const def of WORKSHOP) {
    const lvl = cfg.workshop[def.id] ?? 0;
    if (lvl > 0) def.apply(s, lvl);
  }
  if (cfg.rank >= 6) s.rerolls += 1;
  for (const id of Object.keys(passives) as PassiveId[]) {
    const lvl = passives[id] ?? 0;
    if (lvl > 0) PASSIVES[id].apply(s, lvl);
  }
  for (const id of relics) RELICS[id].apply?.(s);

  switch (cfg.daily) {
    case 'glass':
      s.maxHp *= 0.5;
      break;
    case 'blitz':
      s.dashCooldown *= 0.4;
      break;
    case 'swarm':
      s.xpGain *= 1.3;
      break;
    default:
      break;
  }

  s.maxHp = Math.max(10, Math.round(s.maxHp));
  s.crit = Math.min(1, s.crit);
  s.dashCooldown = Math.max(0.4, s.dashCooldown);
  s.cooldown = Math.max(0.25, s.cooldown);
  return s;
}

/** XP required to go from `level` to `level + 1`. */
export function xpForLevel(level: number): number {
  const l = level - 1;
  return Math.round(4 + l * 6 + pow(l, 1.95) * 0.6);
}
