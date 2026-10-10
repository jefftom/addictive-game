// Length/shape checker for a STORY draft. Usage:
//   node --experimental-strip-types check-story-2.mjs <path-to-draft.ts>
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const file = process.argv[2];
if (!file) { console.error('usage: check-story-2.mjs <draft.ts>'); process.exit(2); }
const { STORY } = await import(pathToFileURL(path.resolve(file)).href);

const errors = [];
const warn = [];
const len = (s) => [...s].length;
const words = (s) => s.trim().split(/\s+/).length;

const ids = new Set(STORY.characters.map((c) => c.id));
const validSpeaker = (s) => s === '@pilot' || s === '@ai' || s === '@villain' || ids.has(s);

function checkLines(where, lines, max, minN = 0, maxN = Infinity) {
  if (!Array.isArray(lines)) { errors.push(`${where}: missing`); return; }
  if (lines.length < minN || lines.length > maxN) errors.push(`${where}: ${lines.length} lines (want ${minN}..${maxN})`);
  lines.forEach((l, i) => {
    if (!validSpeaker(l.speaker)) errors.push(`${where}[${i}]: unknown speaker ${l.speaker}`);
    if (len(l.text) > max) errors.push(`${where}[${i}]: ${len(l.text)} > ${max}: ${l.text}`);
  });
}

// characters
if (STORY.characters.length < 10) errors.push('characters < 10');
for (const c of STORY.characters) {
  if (!/^#[0-9a-f]{6}$/i.test(c.color)) errors.push(`char ${c.id}: bad color ${c.color}`);
  const g = len(c.glyph);
  if (g < 1 || g > 2) errors.push(`char ${c.id}: glyph length ${g}`);
  for (const k of ['id', 'name', 'role', 'voice']) if (!c[k]) errors.push(`char ${c.id}: missing ${k}`);
}
if (!ids.has(STORY.aiId)) errors.push('aiId not a character');
if (!ids.has(STORY.villainId)) errors.push('villainId not a character');
for (const ship of ['spark', 'vanguard', 'tempest', 'bastion', 'phantom']) {
  if (!ids.has(STORY.pilots[ship])) errors.push(`pilot for ${ship} missing`);
}
for (const b of ['warden', 'hydra', 'voidheart']) if (!ids.has(b)) errors.push(`boss char ${b} missing`);

// intro
const ip = STORY.intro.paragraphs;
if (ip.length < 4 || ip.length > 6) errors.push(`intro paragraphs ${ip.length}`);
ip.forEach((p, i) => { if (len(p) > 220) errors.push(`intro[${i}] ${len(p)} > 220`); });

// sectors
if (STORY.sectors.length !== 4) errors.push(`sectors ${STORY.sectors.length} != 4`);
STORY.sectors.forEach((s, i) => {
  if (!s.name || !s.subtitle) errors.push(`sector ${i} missing name/subtitle`);
  checkLines(`sector${i}.arrival`, s.arrival, 72, 1, 4);
});

// bosses
for (const b of ['warden', 'hydra', 'voidheart']) {
  const B = STORY.bosses[b];
  for (const k of ['intro', 'half', 'defeat', 'victoryTaunt']) checkLines(`boss.${b}.${k}`, B?.[k], 90, 2, 3);
}

// barks
const TRIGGERS = ['run_start', 'daily_start', 'first_kill', 'levelup', 'evolve', 'relic', 'cache',
  'combo_x2', 'combo_x5', 'combo_x10', 'milestone', 'overdrive', 'perfect',
  'low_hp', 'heal', 'shield_break', 'elite', 'surge', 'boss_half', 'new_best', 'revive',
  'idle', 'overtime', 'coop_start', 'coop_down', 'coop_revive'];
for (const t of TRIGGERS) checkLines(`barks.${t}`, STORY.barks[t], 72, 3, 6);
for (const k of Object.keys(STORY.barks)) if (!TRIGGERS.includes(k)) errors.push(`unknown bark trigger ${k}`);

// pilot barks
for (const pid of Object.values(STORY.pilots)) {
  const pb = STORY.pilotBarks[pid];
  if (!pb) { errors.push(`pilotBarks.${pid} missing`); continue; }
  for (const t of ['run_start', 'perfect', 'low_hp', 'new_best']) checkLines(`pilotBarks.${pid}.${t}`, pb[t], 72, 2, 6);
  for (const t of Object.keys(pb)) if (!TRIGGERS.includes(t)) errors.push(`pilotBarks.${pid}: bad trigger ${t}`);
}

// game over / victory / overtime
checkLines('gameOver', STORY.gameOver, 90, 8);
const vp = STORY.victory.paragraphs;
if (vp.length < 3 || vp.length > 5) errors.push(`victory paragraphs ${vp.length}`);
vp.forEach((p, i) => { if (len(p) > 220) errors.push(`victory[${i}] ${len(p)} > 220`); });
checkLines('overtime', STORY.overtime, 90, 3);

// logbook
const lb = STORY.logbook;
if (lb.length < 10 || lb.length > 14) errors.push(`logbook entries ${lb.length}`);
const seen = new Set();
const KINDS = ['runs', 'boss', 'rank', 'victory', 'combo', 'time', 'ship', 'coop'];
for (const e of lb) {
  if (seen.has(e.id)) errors.push(`logbook dup id ${e.id}`);
  seen.add(e.id);
  const w = words(e.text);
  if (w < 60 || w > 120) errors.push(`logbook ${e.id}: ${w} words`);
  if (!KINDS.includes(e.unlock.kind)) errors.push(`logbook ${e.id}: bad kind`);
}

// stats + longest lines
const all = [];
const push = (where, l) => all.push([len(l.text), where, l.text]);
STORY.sectors.forEach((s, i) => s.arrival.forEach((l) => push(`sector${i}`, l)));
for (const t of TRIGGERS) STORY.barks[t].forEach((l) => push(`bark.${t}`, l));
all.sort((a, b) => b[0] - a[0]);
console.log('Longest bark/arrival lines:');
for (const [n, w, t] of all.slice(0, 5)) console.log(`  ${n}  ${w}: ${t}`);
console.log('Logbook word counts:', lb.map((e) => `${e.id}=${words(e.text)}`).join(', '));
console.log(`characters=${STORY.characters.length} barks=${TRIGGERS.reduce((a, t) => a + STORY.barks[t].length, 0)} gameOver=${STORY.gameOver.length} logbook=${lb.length}`);
if (warn.length) console.log('WARN:\n  ' + warn.join('\n  '));
if (errors.length) { console.log('ERRORS:\n  ' + errors.join('\n  ')); process.exit(1); }
console.log('OK: all limits satisfied');
