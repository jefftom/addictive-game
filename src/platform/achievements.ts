/**
 * Game achievement ids (src/meta/achievements.ts) <-> Steam achievement API names.
 *
 * Rule: API name = "ACH_" + id in upper case (first_run -> ACH_FIRST_RUN).
 * The Steamworks UI must use exactly these names; steam/achievements.json is generated
 * from this table (`npm run steam:achievements`) and checked by tests/platform.test.ts.
 *
 * Co-op achievements ('squad', 'medic') are being added by the co-op workstream. Until
 * they land in ACHIEVEMENTS, their Steam entries come from COOP_ACHIEVEMENTS below so the
 * Steamworks configuration can be done once.
 */
import { ACHIEVEMENTS } from '../meta/achievements';

export interface SteamAchievement {
  /** Game id in src/meta/achievements.ts. */
  id: string;
  /** Steamworks API name. */
  apiName: string;
  displayName: string;
  description: string;
  /** Hidden achievements show "Hidden achievement" in Steam until earned. */
  hidden: boolean;
}

/** Placeholders for the co-op achievements (names from the co-op design). */
export const COOP_ACHIEVEMENTS: ReadonlyArray<{ id: string; name: string; text: string }> = [
  { id: 'squad', name: 'Squad Goals', text: 'Win a co-op run' },
  { id: 'medic', name: 'No Pilot Left Behind', text: 'Revive teammates 10 times' },
];

/** Spoilers stay hidden on the Steam store page and profile. */
export const HIDDEN_ACHIEVEMENTS: ReadonlySet<string> = new Set(['voidheart']);

const ID_RE = /^[a-z0-9_]{1,56}$/;

/** first_run -> ACH_FIRST_RUN. Throws on ids that cannot be a Steam API name. */
export function steamApiName(id: string): string {
  if (!ID_RE.test(id)) throw new Error(`achievement id not Steam-safe: ${id}`);
  return `ACH_${id.toUpperCase()}`;
}

/** ACH_FIRST_RUN -> first_run, or null for names that are not ours. */
export function gameIdFromApiName(apiName: string): string | null {
  const m = /^ACH_([A-Z0-9_]{1,56})$/.exec(apiName);
  return m ? m[1]!.toLowerCase() : null;
}

/** Strips progression hints such as "(unlocks Vanguard)" from Steam descriptions. */
export function steamDescription(text: string): string {
  return text.replace(/\s*\([^)]*unlocks[^)]*\)\s*$/i, '').trim();
}

/** The full Steam table: every game achievement plus any co-op placeholder not yet in the game. */
export function buildSteamAchievements(
  defs: ReadonlyArray<{ id: string; name: string; text: string }> = ACHIEVEMENTS,
  coop: ReadonlyArray<{ id: string; name: string; text: string }> = COOP_ACHIEVEMENTS,
): SteamAchievement[] {
  const seen = new Set<string>();
  const out: SteamAchievement[] = [];
  for (const d of [...defs, ...coop]) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    out.push({
      id: d.id,
      apiName: steamApiName(d.id),
      displayName: d.name,
      description: steamDescription(d.text),
      hidden: HIDDEN_ACHIEVEMENTS.has(d.id),
    });
  }
  return out;
}

export const STEAM_ACHIEVEMENTS: readonly SteamAchievement[] = buildSteamAchievements();

const BY_ID = new Map(STEAM_ACHIEVEMENTS.map((a) => [a.id, a.apiName]));

/** Steam API names for known game ids; unknown ids are dropped. */
export function toSteamNames(ids: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const n = BY_ID.get(id);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/** The file written to steam/achievements.json. */
export function steamAchievementsFile(list: readonly SteamAchievement[] = STEAM_ACHIEVEMENTS): {
  note: string;
  achievements: readonly SteamAchievement[];
} {
  return {
    note: 'Generated from src/meta/achievements.ts by `npm run steam:achievements`. Do not edit by hand. Enter these in Steamworks > Stats & Achievements.',
    achievements: list,
  };
}
