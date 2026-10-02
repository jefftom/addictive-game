import { WEAPONS, WEAPON_IDS } from './content/weapons';
import type { DailyModifierId, RunConfig, ShipId, WeaponId } from './types';

export interface RunConfigInput {
  seed: number;
  ship?: ShipId;
  workshop?: Record<string, number>;
  rank?: number;
  daily?: DailyModifierId | null;
  hardMode?: boolean;
}

export function weaponPoolForRank(rank: number): WeaponId[] {
  return WEAPON_IDS.filter((id) => WEAPONS[id].unlockRank <= rank);
}

export function makeRunConfig(input: RunConfigInput): RunConfig {
  const rank = input.rank ?? 1;
  return {
    seed: input.seed >>> 0,
    ship: input.ship ?? 'spark',
    workshop: input.workshop ?? {},
    rank,
    daily: input.daily ?? null,
    weaponPool: weaponPoolForRank(rank),
    relicsEnabled: rank >= 3,
    hardMode: input.hardMode ?? false,
  };
}
