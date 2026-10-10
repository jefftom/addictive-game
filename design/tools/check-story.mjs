// Usage: node --experimental-strip-types tools/check-story.mjs <path-to-story.ts>
// Validates counts, length limits, speakers and villain caps for a StoryScript draft.
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const file = process.argv[2];
if (!file) { console.error('usage: check-story.mjs <story.ts>'); process.exit(2); }
const { STORY } = await import(pathToFileURL(path.resolve(file)).href);

const errors = [];
const warns = [];
const err = (m) => errors.push(m);
const TRIGGERS = ['run_start','daily_start','first_kill','levelup','evolve','relic','cache','combo_x2','combo_x5','combo_x10','milestone','overdrive','perfect','low_hp','heal','shield_break','elite','surge','boss_half','new_best','revive','idle','overtime','coop_start','coop_down','coop_revive'];
const SHIPS = ['spark','vanguard','tempest','bastion','phantom'];
const charIds = new Set(STORY.characters.map((c) => c.id));
const speakers = new Set(['@pilot','@ai','@villain', ...charIds]);
const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;
const allText = [];

function checkLine(where, l, max) {
  if (!l || typeof l.text !== 'string') return err(`${where}: bad line`);
  if (!speakers.has(l.speaker)) err(`${where}: unknown speaker ${l.speaker}`);
  if (l.text.length > max) err(`${where}: ${l.text.length} > ${max}: "${l.text}"`);
  const isVillain = l.speaker === '@villain' || l.speaker === STORY.villainId;
  if (isVillain && l.text !== l.text.toUpperCase()) err(`${where}: villain line not ALL CAPS: "${l.text}"`);
  if (l.text.includes('"')) warns.push(`${where}: contains double quote`);
  allText.push(l.text);
}
function count(where, arr, min, max) {
  if (!Array.isArray(arr)) return err(`${where}: missing`);
  if (arr.length < min || arr.length > max) err(`${where}: count ${arr.length} not in [${min},${max}]`);
}

// characters
if (STORY.characters.length < 10) err(`characters: ${STORY.characters.length} < 10`);
for (const c of STORY.characters) {
  if (!/^#[0-9a-f]{6}$/i.test(c.color)) err(`character ${c.id}: bad color ${c.color}`);
  if ([...c.glyph].length < 1 || [...c.glyph].length > 2) err(`character ${c.id}: glyph length`);
  for (const k of ['id','name','role','voice']) if (!c[k]) err(`character ${c.id}: missing ${k}`);
}
for (const s of SHIPS) if (!charIds.has(STORY.pilots[s])) err(`pilots.${s}: unknown ${STORY.pilots[s]}`);
for (const b of ['warden','hydra','voidheart']) if (!charIds.has(b)) err(`boss character ${b} missing`);
if (!charIds.has(STORY.aiId)) err('aiId unknown');
if (!charIds.has(STORY.villainId)) err('villainId unknown');

// intro / victory
count('intro.paragraphs', STORY.intro.paragraphs, 4, 6);
STORY.intro.paragraphs.forEach((p, i) => { if (p.length > 220) err(`intro[${i}]: ${p.length} > 220`); });
count('victory.paragraphs', STORY.victory.paragraphs, 3, 5);
STORY.victory.paragraphs.forEach((p, i) => { if (p.length > 220) err(`victory[${i}]: ${p.length} > 220`); });

// sectors
count('sectors', STORY.sectors, 4, 4);
STORY.sectors.forEach((s, i) => {
  if (!s.name || !s.subtitle) err(`sector ${i}: missing name/subtitle`);
  count(`sector ${i}.arrival`, s.arrival, 1, 6);
  s.arrival.forEach((l, j) => checkLine(`sector ${i}.arrival[${j}]`, l, 90));
});

// bosses
for (const b of ['warden','hydra','voidheart']) {
  const B = STORY.bosses[b];
  if (!B) { err(`boss ${b} missing`); continue; }
  for (const k of ['intro','half','defeat','victoryTaunt']) {
    count(`bosses.${b}.${k}`, B[k], 2, 3);
    (B[k] || []).forEach((l, j) => checkLine(`bosses.${b}.${k}[${j}]`, l, 90));
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
  for (const t of ['run_start','perfect','low_hp','new_best']) {
    const own = (pb[t] || []).filter((l) => l.speaker === pid || l.speaker === '@pilot');
    if (own.length < 2) err(`pilotBarks.${pid}.${t}: ${own.length} own lines < 2`);
  }
  for (const [t, arr] of Object.entries(pb)) {
    if (!TRIGGERS.includes(t)) err(`pilotBarks.${pid}: unknown trigger ${t}`);
    arr.forEach((l, j) => checkLine(`pilotBarks.${pid}.${t}[${j}]`, l, 72));
  }
}

// game over / overtime
if (STORY.gameOver.length < 8) err(`gameOver: ${STORY.gameOver.length} < 8`);
STORY.gameOver.forEach((l, j) => checkLine(`gameOver[${j}]`, l, 90));
if (STORY.overtime.length < 3) err(`overtime: ${STORY.overtime.length} < 3`);
STORY.overtime.forEach((l, j) => checkLine(`overtime[${j}]`, l, 90));

// logbook
count('logbook', STORY.logbook, 10, 14);
const ids = new Set();
const KINDS = ['runs','boss','rank','victory','combo','time','ship','coop'];
for (const e of STORY.logbook) {
  if (ids.has(e.id)) err(`logbook dup id ${e.id}`);
  ids.add(e.id);
  if (!KINDS.includes(e.unlock.kind)) err(`logbook ${e.id}: bad kind`);
  const w = words(e.text);
  if (w < 60 || w > 120) err(`logbook ${e.id}: ${w} words not in [60,120]`);
  console.log(`  logbook ${e.id}: ${w} words (${e.unlock.kind}=${e.unlock.value})`);
}

// duplicates across all lines
const seen = new Map();
for (const t of allText) seen.set(t, (seen.get(t) || 0) + 1);
for (const [t, n] of seen) if (n > 1) warns.push(`duplicate line x${n}: "${t}"`);

// stats
const barkTotal = TRIGGERS.reduce((a, t) => a + (STORY.barks[t]?.length || 0), 0);
console.log(`characters=${STORY.characters.length} barks=${barkTotal} gameOver=${STORY.gameOver.length} logbook=${STORY.logbook.length} lines=${allText.length}`);
for (const w of warns) console.log('WARN', w);
if (errors.length) { for (const e of errors) console.log('ERROR', e); process.exit(1); }
console.log('OK: all limits satisfied');
