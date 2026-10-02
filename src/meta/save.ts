import { SHIPS } from '../game/content/ships';
import type { ShipId } from '../game/types';

export type TrailId = 'default' | 'ember' | 'aurora' | 'prism';

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
