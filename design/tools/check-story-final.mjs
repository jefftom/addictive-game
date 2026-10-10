// Validator for the merged SHARDSTORM story script.
// Usage: node --experimental-strip-types --no-warnings tools/check-story-final.mjs <path/to/story-script.ts>
// Imports only the file given on the command line (never the draft files).
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const file = process.argv[2];
if (!file) { console.error('usage: check-story-final.mjs <story-script.ts>'); process.exit(2); }
if (/story-draft|story-v2/.test(path.basename(file))) { console.error('refusing to validate a draft file'); process.exit(2); }
const { STORY } = await import(pathToFileURL(path.resolve(file)).href);

const errors = [];
const warns = [];
const err = (m) => errors.push(m);
const warn = (m) => warns.push(m);

const TRIGGERS = ['run_start','daily_start','first_kill','levelup','evolve','relic','cache','combo_x2','combo_x5','combo_x10','milestone','overdrive','perfect','low_hp','heal','shield_break','elite','surge','boss_half','new_best','revive','idle','overtime','coop_start','coop_down','coop_revive'];
const SHIPS = ['spark','vanguard','tempest','bastion','phantom'];
const BOSSES = ['warden','hydra','voidheart'];
const BOSS_PARTS = ['intro','half','defeat','victoryTaunt'];
const UNLOCK_KINDS = new Set(['runs','boss','rank','victory','combo','time','ship','coop']);
const PILOT_REQUIRED = ['run_start','perfect','low_hp','new_best'];

const charIds = new Set(STORY.characters.map((c) => c.id));
const validSpeakers = new Set(['@pilot','@ai','@villain', ...charIds]);
const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;
const seen = new Map();
let lineCount = 0;

function checkLine(where, l, max) {
  if (!l || typeof l.text !== 'string' || typeof l.speaker !== 'string') return err(`${where}: malformed line`);
  lineCount++;
  if (!validSpeakers.has(l.speaker)) err(`${where}: unknown speaker '${l.speaker}'`);
  if (!l.text.trim()) err(`${where}: empty text`);
  if (l.text.length > max) err(`${where}: ${l.text.length} chars > ${max}: ${l.text}`);
  if (l.text.includes('"')) warn(`${where}: contains a double quote`);
  if (seen.has(l.text)) err(`${where}: duplicate of ${seen.get(l.text)}`);
  seen.set(l.text, where);
}
function count(where, arr, min, max) {
  if (!Array.isArray(arr)) { err(`${where}: missing array`); return false; }
  if (arr.length < min || arr.length > max) err(`${where}: count ${arr.length} not in [${min}, ${max}]`);
  return true;
}

// Characters and ids
if (STORY.characters.length < 10) err(`characters: ${STORY.characters.length} < 10`);
const idCounts = new Map();
for (const c of STORY.characters) {
  idCounts.set(c.id, (idCounts.get(c.id) ?? 0) + 1);
  if (!/^#[0-9a-f]{6}$/i.test(c.color)) err(`character ${c.id}: bad color ${c.color}`);
  const g = [...c.glyph].length;
  if (g < 1 || g > 2) err(`character ${c.id}: glyph must be 1-2 chars, got ${g}`);
  for (const k of ['id','name','role','voice']) if (!c[k]) err(`character ${c.id}: missing ${k}`);
  if (c.id.startsWith('@')) err(`character ${c.id}: id may not start with @`);
}
for (const [id, n] of idCounts) if (n > 1) err(`character id '${id}' declared ${n} times`);
for (const b of BOSSES) if (!charIds.has(b)) err(`boss character '${b}' missing`);
if (!charIds.has(STORY.aiId)) err(`aiId '${STORY.aiId}' is not a character`);
if (!charIds.has(STORY.villainId)) err(`villainId '${STORY.villainId}' is not a character`);
const pilotIds = new Set();
for (const s of SHIPS) {
  const pid = STORY.pilots[s];
  if (!charIds.has(pid)) err(`pilots.${s} = '${pid}' is not a character`);
  if (pilotIds.has(pid)) err(`pilot '${pid}' assigned to two ships`);
  pilotIds.add(pid);
}
if (Object.keys(STORY.pilots).length !== SHIPS.length) err('pilots must map exactly the 5 ships');

// Intro and victory crawls
if (!STORY.intro.title) err('intro.title missing');
count('intro.paragraphs', STORY.intro.paragraphs, 4, 6);
STORY.intro.paragraphs.forEach((p, i) => { if (p.length > 220) err(`intro.paragraphs[${i}]: ${p.length} > 220`); });
if (!STORY.victory.title) err('victory.title missing');
count('victory.paragraphs', STORY.victory.paragraphs, 3, 5);
STORY.victory.paragraphs.forEach((p, i) => { if (p.length > 220) err(`victory.paragraphs[${i}]: ${p.length} > 220`); });

// Sectors: exactly 4
count('sectors', STORY.sectors, 4, 4);
STORY.sectors.forEach((s, i) => {
  if (!s.name || !s.subtitle) err(`sectors[${i}]: missing name/subtitle`);
  if (count(`sectors[${i}].arrival`, s.arrival, 2, 5)) s.arrival.forEach((l, j) => checkLine(`sectors[${i}].arrival[${j}]`, l, 72));
});

// Bosses: 2-3 lines per list, <= 90 chars
for (const b of BOSSES) {
  const boss = STORY.bosses[b];
  if (!boss) { err(`bosses.${b} missing`); continue; }
  for (const part of BOSS_PARTS) {
    if (count(`bosses.${b}.${part}`, boss[part], 2, 3)) boss[part].forEach((l, j) => checkLine(`bosses.${b}.${part}[${j}]`, l, 90));
  }
  const all = BOSS_PARTS.flatMap((p) => boss[p] ?? []);
  if (!all.some((l) => l.speaker === b)) err(`bosses.${b}: boss never speaks`);
}

// Barks: all 26 triggers, 3-6 variants, <= 72 chars
const barkKeys = Object.keys(STORY.barks);
for (const k of barkKeys) if (!TRIGGERS.includes(k)) err(`barks: unknown trigger '${k}'`);
for (const t of TRIGGERS) {
  const arr = STORY.barks[t];
  if (count(`barks.${t}`, arr, 3, 6)) arr.forEach((l, j) => checkLine(`barks.${t}[${j}]`, l, 72));
}

// Pilot barks: every pilot has 2+ lines for the 4 required triggers, <= 72 chars
for (const pid of pilotIds) {
  const pb = STORY.pilotBarks[pid];
  if (!pb) { err(`pilotBarks.${pid} missing`); continue; }
  for (const t of PILOT_REQUIRED) {
    const arr = pb[t];
    if (!Array.isArray(arr) || arr.length < 2) err(`pilotBarks.${pid}.${t}: needs 2+ lines`);
  }
  for (const [t, arr] of Object.entries(pb)) {
    if (!TRIGGERS.includes(t)) err(`pilotBarks.${pid}: unknown trigger '${t}'`);
    arr.forEach((l, j) => {
      checkLine(`pilotBarks.${pid}.${t}[${j}]`, l, 72);
      if (l.speaker === '@pilot') warn(`pilotBarks.${pid}.${t}[${j}]: use the explicit pilot id`);
      if (pilotIds.has(l.speaker) && l.speaker !== pid) err(`pilotBarks.${pid}.${t}[${j}]: spoken by another pilot '${l.speaker}'`);
    });
  }
}
for (const k of Object.keys(STORY.pilotBarks)) if (!pilotIds.has(k)) err(`pilotBarks.${k}: not a pilot id`);

// Game over, overtime
if (count('gameOver', STORY.gameOver, 8, 999)) STORY.gameOver.forEach((l, j) => checkLine(`gameOver[${j}]`, l, 90));
if (STORY.gameOver.length < 20) warn(`gameOver: only ${STORY.gameOver.length} quips; 20+ recommended for 50+ deaths`);
if (count('overtime', STORY.overtime, 3, 999)) STORY.overtime.forEach((l, j) => checkLine(`overtime[${j}]`, l, 90));

// Logbook: 10-14 entries, 60-120 words, unique ids, valid unlocks
count('logbook', STORY.logbook, 10, 14);
const lbIds = new Set();
const unlockKeys = new Set();
STORY.logbook.forEach((e, i) => {
  if (!e.id || !e.title) err(`logbook[${i}]: missing id/title`);
  if (lbIds.has(e.id)) err(`logbook[${i}]: duplicate id ${e.id}`);
  lbIds.add(e.id);
  const w = words(e.text);
  if (w < 60 || w > 120) err(`logbook[${i}] ${e.id}: ${w} words not in [60, 120]`);
  if (!UNLOCK_KINDS.has(e.unlock.kind)) err(`logbook[${i}]: bad unlock kind ${e.unlock.kind}`);
  if (e.unlock.kind === 'boss' && !BOSSES.includes(e.unlock.value)) err(`logbook[${i}]: unknown boss ${e.unlock.value}`);
  if (e.unlock.kind === 'ship' && !SHIPS.includes(e.unlock.value)) err(`logbook[${i}]: unknown ship ${e.unlock.value}`);
  if (['runs','rank','victory','combo','time','coop'].includes(e.unlock.kind) && typeof e.unlock.value !== 'number') err(`logbook[${i}]: ${e.unlock.kind} needs a number`);
  const key = `${e.unlock.kind}:${e.unlock.value}`;
  if (unlockKeys.has(key)) err(`logbook[${i}]: duplicate unlock ${key}`);
  unlockKeys.add(key);
});

// Report
const speakerTally = {};
const tally = (l) => { speakerTally[l.speaker] = (speakerTally[l.speaker] ?? 0) + 1; };
Object.values(STORY.barks).flat().forEach(tally);
STORY.gameOver.forEach(tally);

console.log(`lines checked: ${lineCount}`);
console.log(`characters: ${STORY.characters.length}, triggers: ${TRIGGERS.length}, bark variants: ${Object.values(STORY.barks).flat().length}, gameOver: ${STORY.gameOver.length}, logbook: ${STORY.logbook.length}`);
console.log(`logbook words: ${STORY.logbook.map((e) => words(e.text)).join(', ')}`);
console.log(`bark+gameOver speakers: ${JSON.stringify(speakerTally)}`);
const longest = [...seen.keys()].sort((a, b) => b.length - a.length).slice(0, 3);
console.log(`longest lines: ${longest.map((s) => s.length).join(', ')}`);
for (const w of warns) console.log(`WARN  ${w}`);
for (const e of errors) console.log(`ERROR ${e}`);
console.log(errors.length ? `FAIL (${errors.length} errors)` : 'PASS');
process.exit(errors.length ? 1 : 0);
