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
}

export const SAVE_KEY = 'shardstorm.save';
export const SAVE_VERSION = 1;

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
  };
}

/** Fills in missing fields from defaults (forward-compatible loads) and migrates old versions. */
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
