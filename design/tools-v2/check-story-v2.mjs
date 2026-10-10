// Length / schema / banned-term checker for a SHARDSTORM story script.
// Usage: node check-story-v2.mjs <story.ts> [path/to/typescript.js]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const file = process.argv[2];
const tsPath = process.argv[3] || '/home/user/addictive-game/node_modules/typescript/lib/typescript.js';
if (!file) { console.error('usage: node check-story-v2.mjs <story.ts>'); process.exit(2); }
const require = createRequire(import.meta.url);
const ts = require(tsPath);
const src = fs.readFileSync(file, 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const tmp = path.join(path.dirname(new URL(import.meta.url).pathname), '.tmp-story.mjs');
fs.writeFileSync(tmp, js);
const { STORY: S } = await import(tmp + '?t=' + Date.now());
fs.unlinkSync(tmp);

const errs = [];
const warns = [];
const len = (s) => [...s].length;
const err = (m) => errs.push(m);
const chk = (where, text, max) => { if (len(text) > max) err(`${where}: ${len(text)} > ${max}: "${text}"`); };
const count = (where, arr, min, max) => { if (!Array.isArray(arr) || arr.length < min || arr.length > max) err(`${where}: count ${arr?.length} not in [${min},${max}]`); };

const SHIPS = ['spark', 'vanguard', 'tempest', 'bastion', 'phantom'];
const TRIGGERS = ['run_start', 'daily_start', 'first_kill', 'levelup', 'evolve', 'relic', 'cache', 'combo_x2', 'combo_x5', 'combo_x10', 'milestone', 'overdrive', 'perfect', 'low_hp', 'heal', 'shield_break', 'elite', 'surge', 'boss_half', 'new_best', 'revive', 'idle', 'overtime', 'coop_start', 'coop_down', 'coop_revive'];
const ids = new Set(S.characters.map((c) => c.id));
const speakerOk = (sp) => sp === '@pilot' || sp === '@ai' || sp === '@villain' || ids.has(sp);
const allLines = [];
const lines = (where, arr, max) => arr.forEach((l, i) => {
  if (!speakerOk(l.speaker)) err(`${where}[${i}]: unknown speaker ${l.speaker}`);
  chk(`${where}[${i}]`, l.text, max);
  allLines.push(l.text);
});

// characters
if (S.characters.length < 12) err(`characters: ${S.characters.length} < 12`);
if (ids.size !== S.characters.length) err('characters: duplicate ids');
for (const c of S.characters) {
  if (!/^#[0-9a-f]{6}$/i.test(c.color)) err(`character ${c.id}: bad color ${c.color}`);
  const g = len(c.glyph); if (g < 1 || g > 2) err(`character ${c.id}: glyph length ${g}`);
  for (const k of ['name', 'role', 'voice']) if (!c[k]) err(`character ${c.id}: missing ${k}`);
  allLines.push(c.name, c.role, c.voice);
}
for (const id of ['warden', 'hydra', 'voidheart', S.aiId, S.villainId]) if (!ids.has(id)) err(`missing character ${id}`);
for (const s of SHIPS) {
  if (!ids.has(S.pilots[s])) err(`pilot for ${s} missing`);
  const v = S.vessels[s]; if (!v) { err(`vessel ${s} missing`); continue; }
  chk(`vessel ${s}.blurb`, v.blurb, 80); allLines.push(v.className, v.shipName, v.blurb);
}
allLines.push(S.fleetName, S.enemyName);

// intro / victory
count('intro.paragraphs', S.intro.paragraphs, 4, 6);
S.intro.paragraphs.forEach((p, i) => { chk(`intro[${i}]`, p, 220); allLines.push(p); });
allLines.push(S.intro.title);
count('victory.paragraphs', S.victory.paragraphs, 3, 5);
S.victory.paragraphs.forEach((p, i) => { chk(`victory[${i}]`, p, 220); allLines.push(p); });
allLines.push(S.victory.title);

// sectors
count('sectors', S.sectors, 4, 4);
S.sectors.forEach((s, i) => { allLines.push(s.name, s.subtitle); count(`sector ${i} arrival`, s.arrival, 1, 6); lines(`sector ${i} arrival`, s.arrival, 90); });

// bosses
for (const b of ['warden', 'hydra', 'voidheart']) for (const k of ['intro', 'half', 'defeat', 'victoryTaunt']) {
  const arr = S.bosses[b]?.[k]; if (!arr) { err(`boss ${b}.${k} missing`); continue; }
  count(`boss ${b}.${k}`, arr, 2, 3); lines(`boss ${b}.${k}`, arr, 90);
}

// barks
for (const t of TRIGGERS) {
  const arr = S.barks[t]; if (!arr) { err(`bark ${t} missing`); continue; }
  count(`bark ${t}`, arr, 3, 6); lines(`bark ${t}`, arr, 72);
}
for (const k of Object.keys(S.barks)) if (!TRIGGERS.includes(k)) err(`unknown bark trigger ${k}`);

// pilot barks
for (const s of SHIPS) {
  const pid = S.pilots[s]; const pb = S.pilotBarks[pid];
  if (!pb) { err(`pilotBarks for ${pid} missing`); continue; }
  for (const t of ['run_start', 'perfect', 'low_hp', 'new_best']) if (!pb[t] || pb[t].length < 2) err(`pilotBarks ${pid}.${t} < 2`);
  for (const [t, arr] of Object.entries(pb)) { if (!TRIGGERS.includes(t)) err(`pilotBarks ${pid}: unknown trigger ${t}`); lines(`pilotBarks ${pid}.${t}`, arr, 72); }
}

// game over / overtime
if (S.gameOver.length < 10) err(`gameOver: ${S.gameOver.length} < 10`);
lines('gameOver', S.gameOver, 90);
if (S.overtime.length < 3) err(`overtime: ${S.overtime.length} < 3`);
lines('overtime', S.overtime, 90);

// logbook
count('logbook', S.logbook, 10, 14);
const kinds = ['runs', 'boss', 'rank', 'victory', 'combo', 'time', 'ship', 'coop'];
const logIds = new Set();
for (const e of S.logbook) {
  if (logIds.has(e.id)) err(`logbook dup id ${e.id}`); logIds.add(e.id);
  if (!kinds.includes(e.unlock.kind)) err(`logbook ${e.id}: bad kind`);
  const w = e.text.trim().split(/\s+/).length;
  if (w < 60 || w > 120) err(`logbook ${e.id}: ${w} words`);
  allLines.push(e.title, e.text);
}

// banned franchise terms (word-ish, case-insensitive)
const BANNED = ['stardate', 'enterprise', 'starfleet', 'federation', 'beam me', 'make it so', 'engag', 'phaser', 'torpedo', 'klingon', 'borg', 'resistance is futile', 'live long', 'warp core', 'warp factor', "captain's log", 'supplemental', 'impulse', 'transporter', 'replicator', 'holodeck', 'away team', 'redshirt', 'red shirt', 'prime directive', 'cloak', 'romulan', 'vulcan', 'energize', 'number one', 'final frontier', 'boldly', 'fascinating', 'illogical', 'the force', 'jedi', 'sith', "it's a trap", 'death star', 'tell me the odds', 'never surrender', 'infinity and beyond', 'exterminate', 'good news, everyone', "don't panic", 'frak', 'so say we all', 'shiny', 'ludicrous', 'wookie', 'droid', 'up to eleven', 'danger, will', 'pod bay', 'dalek', 'tardis', 'geronimo', 'allons', 'autobot', 'morphin', 'voltron', 'groot', 'battlestar', 'serenity', 'galaxy quest', 'grabthar', 'hyperspace'];
const blob = allLines.join('\n').toLowerCase();
for (const b of BANNED) {
  const re = new RegExp(`(^|[^a-z])${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
  if (re.test(blob)) err(`banned term: "${b}"`);
}
if (/\p{Extended_Pictographic}/u.test(blob.replace(/[☼☾✦✶◈◉◎▣⬢⚙ϟω]/g, ''))) warns.push('emoji-like character found');

console.log(`characters=${S.characters.length} barks=${TRIGGERS.reduce((n, t) => n + (S.barks[t]?.length || 0), 0)} gameOver=${S.gameOver.length} logbook=${S.logbook.length}`);
for (const w of warns) console.log('WARN', w);
if (errs.length) { for (const e of errs) console.log('FAIL', e); process.exit(1); }
console.log('OK: all checks passed');
