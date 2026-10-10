// Usage: node --experimental-strip-types tools/check-story-3.mjs <path-to-story.ts>
// Validates counts, length limits, speakers and word counts for a StoryScript draft (draft #3 rules).
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const file = process.argv[2];
if (!file) { console.error('usage: check-story-3.mjs <story.ts>'); process.exit(2); }
const { STORY } = await import(pathToFileURL(path.resolve(file)).href);

const errors = [];
const warns = [];
const err = (m) => errors.push(m);
const TRIGGERS = ['run_start','daily_start','first_kill','levelup','evolve','relic','cache','combo_x2','combo_x5','combo_x10','milestone','overdrive','perfect','low_hp','heal','shield_break','elite','surge','boss_half','new_best','revive','idle','overtime','coop_start','coop_down','coop_revive'];
const SHIPS = ['spark','vanguard','tempest','bastion','phantom'];
const BOSSES = ['warden','hydra','voidheart'];
const charIds = new Set(STORY.characters.map((c) => c.id));
const speakers = new Set(['@pilot','@ai','@villain', ...charIds]);
const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;
const seen = new Map();
let lineCount = 0;

function checkLine(where, l, max) {
  if (!l || typeof l.text !== 'string') return err(`${where}: bad line`);
  lineCount++;
  if (!speakers.has(l.speaker)) err(`${where}: unknown speaker ${l.speaker}`);
  if (l.text.length > max) err(`${where}: ${l.text.length} > ${max}: "${l.text}"`);
  if (l.text.includes('"')) warns.push(`${where}: contains double quote`);
  if (seen.has(l.text)) warns.push(`${where}: duplicate of ${seen.get(l.text)}`);
  seen.set(l.text, where);
}
function count(where, arr, min, max) {
  if (!Array.isArray(arr)) return err(`${where}: missing`);
  if (arr.length < min || arr.length > max) err(`${where}: count ${arr.length} not in [${min},${max}]`);
}

// characters
if (STORY.characters.length < 10) err(`characters: ${STORY.characters.length} < 10`);
for (const c of STORY.characters) {
  if (!/^#[0-9a-f]{6}$/i.test(c.color)) err(`character ${c.id}: bad color ${c.color}`);
  const g = [...c.glyph].length;
  if (g < 1 || g > 2) err(`character ${c.id}: glyph length ${g}`);
  for (const k of ['id','name','role','voice']) if (!c[k]) err(`character ${c.id}: missing ${k}`);
}
for (const b of BOSSES) if (!charIds.has(b)) err(`boss character ${b} missing`);
if (!charIds.has(STORY.aiId)) err('aiId not a character');
if (!charIds.has(STORY.villainId)) err('villainId not a character');
for (const s of SHIPS) if (!charIds.has(STORY.pilots[s])) err(`pilot for ${s} missing`);

// intro / victory
count('intro.paragraphs', STORY.intro.paragraphs, 4, 6);
STORY.intro.paragraphs.forEach((p, i) => { if (p.length > 220) err(`intro[${i}] ${p.length} > 220`); });
count('victory.paragraphs', STORY.victory.paragraphs, 3, 5);
STORY.victory.paragraphs.forEach((p, i) => { if (p.length > 220) err(`victory[${i}] ${p.length} > 220`); });

// sectors
count('sectors', STORY.sectors, 4, 4);
STORY.sectors.forEach((s, i) => {
  if (!s.name || !s.subtitle) err(`sector ${i}: missing name/subtitle`);
  count(`sector ${i}.arrival`, s.arrival, 2, 5);
  s.arrival.forEach((l, j) => checkLine(`sector${i}.arrival[${j}]`, l, 72));
});

// bosses
for (const b of BOSSES) {
  const B = STORY.bosses[b];
  if (!B) { err(`boss ${b} missing`); continue; }
  for (const k of ['intro','half','defeat','victoryTaunt']) {
    count(`${b}.${k}`, B[k], 2, 3);
    (B[k] || []).forEach((l, j) => checkLine(`${b}.${k}[${j}]`, l, 90));
  }
}

// barks
for (const t of TRIGGERS) {
  count(`barks.${t}`, STORY.barks[t], 3, 6);
  (STORY.barks[t] || []).forEach((l, j) => checkLine(`barks.${t}[${j}]`, l, 72));
}
for (const k of Object.keys(STORY.barks)) if (!TRIGGERS.includes(k)) err(`barks: unknown trigger ${k}`);

// pilot barks
for (const s of SHIPS) {
  const pid = STORY.pilots[s];
  const pb = STORY.pilotBarks[pid];
  if (!pb) { err(`pilotBarks.${pid} missing`); continue; }
  for (const t of ['run_start','perfect','low_hp','new_best']) count(`pilotBarks.${pid}.${t}`, pb[t], 2, 6);
  for (const [t, arr] of Object.entries(pb)) {
    if (!TRIGGERS.includes(t)) err(`pilotBarks.${pid}: unknown trigger ${t}`);
    arr.forEach((l, j) => checkLine(`pilotBarks.${pid}.${t}[${j}]`, l, 72));
  }
}

// game over / overtime
count('gameOver', STORY.gameOver, 8, 40);
STORY.gameOver.forEach((l, j) => checkLine(`gameOver[${j}]`, l, 90));
count('overtime', STORY.overtime, 3, 10);
STORY.overtime.forEach((l, j) => checkLine(`overtime[${j}]`, l, 72));

// logbook
count('logbook', STORY.logbook, 10, 14);
const kinds = ['runs','boss','rank','victory','combo','time','ship','coop'];
const ids = new Set();
for (const e of STORY.logbook) {
  if (ids.has(e.id)) err(`logbook dup id ${e.id}`);
  ids.add(e.id);
  if (!kinds.includes(e.unlock.kind)) err(`logbook ${e.id}: bad kind`);
  if (e.unlock.kind === 'boss' && !BOSSES.includes(e.unlock.value)) err(`logbook ${e.id}: bad boss`);
  if (e.unlock.kind === 'ship' && !SHIPS.includes(e.unlock.value)) err(`logbook ${e.id}: bad ship`);
  const w = words(e.text);
  if (w < 60 || w > 120) err(`logbook ${e.id}: ${w} words`);
  console.log(`  logbook ${e.id} ${String(w).padStart(3)}w  ${e.unlock.kind}=${e.unlock.value}  ${e.title}`);
}

// banned words (quick family-friendly scan)
const banned = /\b(damn|hell|crap|stupid|kill yourself|god)\b/i;
const dump = JSON.stringify(STORY);
const m = dump.match(banned);
if (m) warns.push(`banned word: ${m[0]}`);

console.log(`lines checked: ${lineCount}`);
for (const w of warns) console.log('WARN', w);
for (const e of errors) console.log('ERR ', e);
console.log(errors.length ? `FAIL (${errors.length} errors)` : 'OK');
process.exit(errors.length ? 1 : 0);
