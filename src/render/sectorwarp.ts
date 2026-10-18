import { BOSS_SCHEDULE, VICTORY_TIME } from '../game/content/enemies';

/** Presentation lead; longer than the 2.2 s warp, with no simulation changes. */
export const WARP_LEAD = 2.6;

export function anticipatedSector(sector: number, time: number, lead = WARP_LEAD): number | null {
  if (sector < 0 || sector >= BOSS_SCHEDULE.length) return null;
  const forcedAt = BOSS_SCHEDULE[sector + 1]?.at ?? VICTORY_TIME;
  return time >= forcedAt - lead ? sector + 1 : null;
}
