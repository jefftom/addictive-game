import type { RunResult } from './result';
import type { SaveData } from './save';

export const SIGNAL_LETTERS = 'OCABEN';
export const SIGNAL_ANSWER = 'BEACON';
export const SIGNAL_MESSAGE = 'Relay Seven to the Allied Beacon Fleet: the lights are still on. We have room for every ship you bring home. Follow the beacon. We will keep it burning.';

export interface TransmissionState {
  unlocked: boolean;
  letters: string;
  hinted: boolean;
  solved: boolean;
  revealed: boolean;
}

export const defaultTransmission = (): TransmissionState => ({ unlocked: false, letters: '', hinted: false, solved: false, revealed: false });

export function normalizeTransmission(raw: unknown): TransmissionState {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<TransmissionState>;
  const s = defaultTransmission();
  if (r.unlocked !== true) return s;
  s.unlocked = true; s.hinted = r.hinted === true;
  s.solved = r.solved === true; s.revealed = !s.solved && r.revealed === true;
  s.letters = s.solved || s.revealed ? SIGNAL_ANSWER
    : [...new Set(typeof r.letters === 'string' ? r.letters.toUpperCase().split('') : [])].filter(c => SIGNAL_LETTERS.includes(c)).join('');
  return s;
}

/** A finished normal solo run earns the one fragment. Retreat, Daily and co-op do not. */
export function earnTransmission(save: SaveData, result: RunResult, finished: boolean): boolean {
  if (!finished || result.daily || (result.players ?? 1) > 1) return false;
  const s = save.transmission ??= defaultTransmission();
  if (s.unlocked) return false;
  s.unlocked = true;
  return true;
}

/** Returns feedback; only the isolated story-puzzle block can change. */
export function decodeTransmission(s: TransmissionState, reveal = false): 'locked' | 'incomplete' | 'incorrect' | 'solved' | 'revealed' {
  if (!s.unlocked) return 'locked';
  if (s.solved) return 'solved';
  if (s.revealed) return 'revealed';
  if (reveal) { s.revealed = true; s.letters = SIGNAL_ANSWER; return 'revealed'; }
  if (s.letters.length !== SIGNAL_ANSWER.length) return 'incomplete';
  if (s.letters !== SIGNAL_ANSWER) return 'incorrect';
  s.solved = true;
  return 'solved';
}
