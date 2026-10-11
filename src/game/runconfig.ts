import { WEAPONS, WEAPON_IDS } from './content/weapons';
import { MAX_PLAYERS } from './content/coop';
import type { DailyModifierId, PlayerConfig, RunConfig, ShipId, WeaponId } from './types';

export interface RunConfigInput {
  seed: number;
  ship?: ShipId;
  workshop?: Record<string, number>;
  rank?: number;
  daily?: DailyModifierId | null;
  hardMode?: boolean;
  /** Co-op roster (1..4 pilots). Absent = solo with `ship`. */
  players?: PlayerConfig[];
}

export function weaponPoolForRank(rank: number): WeaponId[] {
  return WEAPON_IDS.filter((id) => WEAPONS[id].unlockRank <= rank);
}

export function makeRunConfig(input: RunConfigInput): RunConfig {
  const rank = input.rank ?? 1;
  const players: PlayerConfig[] = input.players?.length
    ? input.players.slice(0, MAX_PLAYERS).map((p) => ({ ship: p.ship }))
    : [{ ship: input.ship ?? 'spark' }];
  return {
    seed: input.seed >>> 0,
    ship: players[0]!.ship,
    players,
    workshop: input.workshop ?? {},
    rank,
    // The Daily Run is solo-only.
    daily: players.length > 1 ? null : (input.daily ?? null),
    weaponPool: weaponPoolForRank(rank),
    relicsEnabled: rank >= 3,
    hardMode: input.hardMode ?? false,
  };
}
