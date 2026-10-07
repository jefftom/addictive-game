'use strict';
/**
 * Pure validators for everything the renderer sends to the main process.
 * The renderer is treated as untrusted: every IPC payload goes through one of
 * these before it reaches the file system or Steamworks.
 *
 * No Electron imports here, so `tests/desktop.test.ts` can load this file in Node.
 */

const SHIP_IDS = Object.freeze(['spark', 'vanguard', 'tempest', 'bastion', 'phantom']);
const PRESENCE_MODES = Object.freeze(['menu', 'hangar', 'run', 'victory', 'overtime', 'results']);
/** Steam rich presence tokens per mode (see steam/rich_presence_english.vdf). */
const PRESENCE_TOKENS = Object.freeze({
  menu: '#Status_Menu',
  hangar: '#Status_Hangar',
  run: '#Status_Run',
  victory: '#Status_Victory',
  overtime: '#Status_Overtime',
  results: '#Status_Results',
});
/** Every key we ever set; clear() resets exactly these. */
const PRESENCE_KEYS = Object.freeze(['steam_display', 'sector', 'ship', 'players', 'time', 'steam_player_group_size']);

const MAX_SAVE_BYTES = 1024 * 1024;
const API_NAME_RE = /^ACH_[A-Z0-9_]{1,60}$/;
const TIME_RE = /^\d{1,3}:[0-5]\d$/;

/**
 * Builds the achievement allowlist from steam/achievements.json content.
 * @param {unknown} table
 * @returns {Set<string>}
 */
function achievementAllowlist(table) {
  const out = new Set();
  if (!table || typeof table !== 'object' || !Array.isArray(table.achievements)) return out;
  for (const a of table.achievements) {
    if (a && typeof a.apiName === 'string' && API_NAME_RE.test(a.apiName)) out.add(a.apiName);
  }
  return out;
}

/**
 * @param {unknown} name
 * @param {Set<string>} allow
 * @returns {string | null} the API name when it is allowlisted
 */
function validAchievement(name, allow) {
  return typeof name === 'string' && allow.has(name) ? name : null;
}

/**
 * @param {unknown} names
 * @param {Set<string>} allow
 * @returns {string[]} the allowlisted, de-duplicated names (unknown ones are dropped)
 */
function validAchievementList(names, allow) {
  if (!Array.isArray(names)) return [];
  const out = new Set();
  for (const n of names.slice(0, 256)) {
    const v = validAchievement(n, allow);
    if (v) out.add(v);
  }
  return [...out];
}

const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/**
 * Validates a renderer presence object and maps it to Steam rich presence key/values.
 * Unknown keys are ignored; invalid values are dropped; an invalid mode rejects the whole thing.
 * @param {unknown} p
 * @returns {Record<string, string> | null}
 */
function presenceToSteam(p) {
  if (!p || typeof p !== 'object') return null;
  const mode = p.mode;
  if (typeof mode !== 'string' || !PRESENCE_MODES.includes(mode)) return null;
  const out = { steam_display: PRESENCE_TOKENS[mode] };
  if (isInt(p.sector, 1, 4)) out.sector = String(p.sector);
  if (typeof p.ship === 'string' && SHIP_IDS.includes(p.ship)) out.ship = p.ship;
  if (isInt(p.players, 1, 4)) {
    out.players = String(p.players);
    // Lets the Steam friends list group co-op players together.
    if (p.players > 1) out.steam_player_group_size = String(p.players);
  }
  if (typeof p.time === 'string' && TIME_RE.test(p.time)) out.time = p.time;
  return out;
}

/**
 * @param {unknown} json
 * @returns {string | null} the text when it is a JSON object/array within the size limit
 */
function validSavePayload(json) {
  if (typeof json !== 'string') return null;
  if (Buffer.byteLength(json, 'utf8') > MAX_SAVE_BYTES) return null;
  try {
    const v = JSON.parse(json);
    if (!v || typeof v !== 'object') return null;
  } catch {
    return null;
  }
  return json;
}

/**
 * Only our own origin may call the bridge. `senderFrame` can be null after navigation.
 * @param {{ senderFrame?: { url?: string } | null } | undefined} event
 */
function trustedSender(event) {
  const url = event && event.senderFrame && event.senderFrame.url;
  return typeof url === 'string' && url.startsWith('app://game/');
}

/**
 * Parses a Steam AppID from env/text. Returns 0 when absent or invalid.
 * @param {unknown} v
 */
function parseAppId(v) {
  if (typeof v === 'number') return Number.isInteger(v) && v > 0 && v < 2 ** 32 ? v : 0;
  if (typeof v !== 'string') return 0;
  const t = v.trim();
  if (!/^\d{1,10}$/.test(t)) return 0;
  const n = Number(t);
  return n > 0 && n < 2 ** 32 ? n : 0;
}

module.exports = {
  SHIP_IDS,
  PRESENCE_MODES,
  PRESENCE_TOKENS,
  PRESENCE_KEYS,
  MAX_SAVE_BYTES,
  achievementAllowlist,
  validAchievement,
  validAchievementList,
  presenceToSteam,
  validSavePayload,
  trustedSender,
  parseAppId,
};
