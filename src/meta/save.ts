import { SHIPS } from '../game/content/ships';
import type { ShipId } from '../game/types';

export type TrailId = 'default' | 'ember' | 'aurora' | 'prism';
/** In-run comms: every line, only story/rare lines, or none. */
export type ChatterMode = 'all' | 'important' | 'off';
export const CHATTER_MODES: readonly ChatterMode[] = ['all', 'important', 'off'];

export interface Settings {
  master: number;
  music: number;
  sfx: number;
  shake: number;
  flashes: boolean;
  damageNumbers: boolean;
  showFps: boolean;
  breakReminder: boolean;
  trail: TrailId;
  hardMode: boolean;
  /** Crew chatter (story comms) filter. */
  chatter: ChatterMode;
}

export interface MissionState {
  def: string;
  tier: number;
  target: number;
  /** Best single-run value (run missions) or running total (total missions). */
  progress: number;
  done: boolean;
}

export interface LifetimeStats {
  runs: number;
  kills: number;
  timePlayed: number;
  bestScore: number;
  bestTime: number;
  bestCombo: number;
  bestLevel: number;
  bossKills: number;
  elites: number;
  dashKills: number;
  gems: number;
  perfects: number;
  evolutions: number;
  victories: number;
  coresEarned: number;
  upgradesBought: number;
}

export interface RunRecord {
  score: number;
  time: number;
  date: string;
  daily: boolean;
  /** Pilots in the run (absent = solo). */
  players?: number;
}

/** A remembered co-op lobby entry (device -> ship), restored when that device joins again. */
export interface CoopRosterRecord {
  device: string;
  ship: ShipId;
}

/**
 * Local co-op records (save v2). Co-op scores are kept apart from the solo
 * `stats.bestScore` / `stats.bestCombo` so the solo score chase stays comparable.
 */
export interface CoopStats {
  /** Co-op runs finished. */
  runs: number;
  /** Co-op runs that reached 10:00. */
  victories: number;
  /** Best team score per pilot count ('2' | '3' | '4'). */
  best: Record<string, number>;
  /** Teammate revives given, all pilots, all co-op runs. */
  revives: number;
  /** Last launched roster (ships remembered per device). */
  lastRoster: CoopRosterRecord[];
}

export function defaultCoopStats(): CoopStats {
  return { runs: 0, victories: 0, best: {}, revives: 0, lastRoster: [] };
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** Sanitises a stored co-op block; missing or malformed fields fall back to defaults. */
export function normalizeCoopStats(raw: unknown): CoopStats {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof CoopStats, unknown>>;
  const best: Record<string, number> = {};
  if (r.best && typeof r.best === 'object') {
    for (const [k, v] of Object.entries(r.best as Record<string, unknown>)) {
      if (['2', '3', '4'].includes(k) && count(v) > 0) best[k] = count(v);
    }
  }
  const lastRoster = Array.isArray(r.lastRoster)
    ? r.lastRoster
        .filter((e): e is CoopRosterRecord => !!e && typeof e === 'object' && typeof (e as CoopRosterRecord).device === 'string' && (e as CoopRosterRecord).ship in SHIPS)
        .slice(0, 4)
        .map((e) => ({ device: e.device, ship: e.ship }))
    : [];
  return { runs: count(r.runs), victories: count(r.victories), best, revives: count(r.revives), lastRoster };
}

/** Narrative progress (intro crawl, Ship's Log, game-over quip rotation). */
export interface StoryState {
  introSeen: boolean;
  /** Logbook entry ids unlocked so far (in unlock order). */
  logUnlocked: string[];
  /** Logbook entry ids the player has opened. */
  logSeen: string[];
  /** Keys of recently shown game-over quips (newest last). */
  quipHistory: string[];
}

export function defaultStoryState(): StoryState {
  return { introSeen: false, logUnlocked: [], logSeen: [], quipHistory: [] };
}

const strList = (v: unknown, max: number): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(-max) : [];

/** Sanitises a stored story block; missing or malformed fields fall back to defaults. */
export function normalizeStoryState(raw: unknown): StoryState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof StoryState, unknown>>;
  return {
    introSeen: r.introSeen === true,
    logUnlocked: [...new Set(strList(r.logUnlocked, 200))],
    logSeen: [...new Set(strList(r.logSeen, 200))],
    quipHistory: strList(r.quipHistory, 32),
  };
}

export interface SaveData {
  version: number;
  cores: number;
  workshop: Record<string, number>;
  ship: ShipId;
  achievements: Record<string, number>;
  missions: MissionState[];
  missionTiers: Record<string, number>;
  missionsCompleted: number;
  rank: number;
  rankXp: number;
  stats: LifetimeStats;
  daily: { last: string | null; streak: number; best: Record<string, number> };
  settings: Settings;
  tutorialDone: boolean;
  history: RunRecord[];
  /** Story/narrative state. Optional so older saves stay valid; migrate() always fills it. */
  story?: StoryState;
  /** Local co-op records (added in save v2). */
  coop: CoopStats;
}

export const SAVE_KEY = 'shardstorm.save';
/** v2: adds `coop` (co-op runs, victories, best per pilot count, revives, last roster). */
export const SAVE_VERSION = 2;

export function defaultSettings(): Settings {
  return {
    master: 0.8,
    music: 0.6,
    sfx: 0.8,
    shake: 1,
    flashes: true,
    damageNumbers: true,
    showFps: false,
    breakReminder: true,
    trail: 'default',
    hardMode: false,
    chatter: 'all',
  };
}

export function defaultSave(): SaveData {
  return {
    version: SAVE_VERSION,
    cores: 0,
    workshop: {},
    ship: 'spark',
    achievements: {},
    missions: [],
    missionTiers: {},
    missionsCompleted: 0,
    rank: 1,
    rankXp: 0,
    stats: {
      runs: 0,
      kills: 0,
      timePlayed: 0,
      bestScore: 0,
      bestTime: 0,
      bestCombo: 0,
      bestLevel: 0,
      bossKills: 0,
      elites: 0,
      dashKills: 0,
      gems: 0,
      perfects: 0,
      evolutions: 0,
      victories: 0,
      coresEarned: 0,
      upgradesBought: 0,
    },
    daily: { last: null, streak: 0, best: {} },
    settings: defaultSettings(),
    tutorialDone: false,
    history: [],
    coop: defaultCoopStats(),
  };
}

/**
 * Fills in missing fields from defaults (forward-compatible loads) and migrates old versions.
 * v1 -> v2 is additive: a v1 save keeps every field and gains an empty `coop` block.
 */
export function migrate(raw: unknown): SaveData {
  const base = defaultSave();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Partial<SaveData>;
  const out: SaveData = {
    ...base,
    ...r,
    stats: { ...base.stats, ...(r.stats ?? {}) },
    daily: { ...base.daily, ...(r.daily ?? {}) },
    settings: { ...base.settings, ...(r.settings ?? {}) },
    workshop: { ...(r.workshop ?? {}) },
    achievements: { ...(r.achievements ?? {}) },
    missionTiers: { ...(r.missionTiers ?? {}) },
    missions: Array.isArray(r.missions) ? r.missions : [],
    history: Array.isArray(r.history) ? r.history.slice(-30) : [],
    version: SAVE_VERSION,
  };
  if (!Number.isFinite(out.cores) || out.cores < 0) out.cores = 0;
  if (!Number.isFinite(out.rank) || out.rank < 1) out.rank = 1;
  if (!(out.ship in SHIPS)) out.ship = 'spark';
  if (!['default', 'ember', 'aurora', 'prism'].includes(out.settings.trail)) out.settings.trail = 'default';
  if (!CHATTER_MODES.includes(out.settings.chatter)) out.settings.chatter = 'all';
  out.story = normalizeStoryState(r.story);
  out.coop = normalizeCoopStats(r.coop);
  return out;
}

export interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function loadSave(store: Storage | null = storage()): SaveData {
  try {
    const text = store?.getItem(SAVE_KEY);
    if (!text) return defaultSave();
    return migrate(JSON.parse(text));
  } catch {
    return defaultSave();
  }
}

export function writeSave(save: SaveData, store: Storage | null = storage()): boolean {
  try {
    store?.setItem(SAVE_KEY, JSON.stringify(save));
    return true;
  } catch {
    return false;
  }
}

export function clearSave(store: Storage | null = storage()): void {
  try {
    store?.removeItem(SAVE_KEY);
  } catch {
    /* storage unavailable */
  }
}
