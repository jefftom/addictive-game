'use strict';
/**
 * Atomic JSON save file for Steam Auto-Cloud.
 *
 * Layout (dir = <userData>/save):
 *   shardstorm-save.json      current save (the file Auto-Cloud syncs)
 *   shardstorm-save.json.bak  previous good save
 *
 * write: tmp file -> fsync -> current copied to .bak -> rename(tmp, current)
 * read:  current, else .bak, else null (a corrupt file never crashes the game)
 *
 * No Electron imports, so the unit tests can exercise it in plain Node.
 */
const fs = require('node:fs');
const path = require('node:path');

const SAVE_FILE = 'shardstorm-save.json';

/** @param {string} dir */
function savePaths(dir) {
  const file = path.join(dir, SAVE_FILE);
  return { dir, file, bak: `${file}.bak`, tmp: `${file}.${process.pid}.tmp` };
}

/** @param {string} p */
function readJsonText(p) {
  try {
    const text = fs.readFileSync(p, 'utf8');
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? text : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} dir
 * @returns {string | null}
 */
function readSave(dir) {
  const p = savePaths(dir);
  return readJsonText(p.file) ?? readJsonText(p.bak);
}

/**
 * Writes `text` atomically. The caller validates it first (validate.cjs#validSavePayload).
 * @param {string} dir
 * @param {string} text
 * @returns {boolean}
 */
function writeSave(dir, text) {
  const p = savePaths(dir);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const fd = fs.openSync(p.tmp, 'w');
    try {
      fs.writeFileSync(fd, text, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    // Keep the last good save as a backup. A corrupt current file is not worth keeping.
    if (readJsonText(p.file) !== null) fs.copyFileSync(p.file, p.bak);
    fs.renameSync(p.tmp, p.file);
    return true;
  } catch {
    try {
      fs.rmSync(p.tmp, { force: true });
    } catch {
      /* ignore */
    }
    return false;
  }
}

module.exports = { SAVE_FILE, savePaths, readSave, writeSave };
