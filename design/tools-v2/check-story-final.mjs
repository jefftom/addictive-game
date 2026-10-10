// Length / schema / originality checker for the FINAL SHARDSTORM story script (story-script-v2.ts).
// Derived from check-draft-3.mjs; banned list extended with the editor-in-chief's IP sweep terms.
// Usage: node check-draft-3.mjs <story.ts> [--tsc]
//   --tsc  also runs `tsc --noEmit --strict` on the file (standalone type-check).
// Exits 1 on any FAIL. Prints headroom stats so near-limit lines are visible.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const REPO = '/home/user/addictive-game';
const file = process.argv[2];
const runTsc = process.argv.includes('--tsc');
if (!file) { console.error('usage: node check-draft-3.mjs <story.ts> [--tsc]'); process.exit(2); }

const require = createRequire(import.meta.url);
const ts = require(path.join(REPO, 'node_modules/typescript/lib/typescript.js'));
const src = fs.readFileSync(file, 'utf8');
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-chk-'));
const tmp = path.join(tmpDir, 'story.mjs');
fs.writeFileSync(tmp, js);
const { STORY: S } = await import(pathToFileURL(tmp).href);
fs.rmSync(tmpDir, { recursive: true, force: true });

const errs = [];
const warns = [];
const len = (s) => [...s].length;
const words = (s) => s.trim().split(/\s+/).length;
const fail = (m) => errs.push(m);
const near = []; // [where, len, max]
const chk = (where, text, max) => {
  const n = len(text);
  if (n > max) fail(`${where}: ${n} > ${max}: "${text}"`);
  else if (n > max - 3) near.push(`${where}: ${n}/${max}`);
};
const count = (where, arr, min, max) => {
  if (!Array.isArray(arr) || arr.length < min || arr.length > max) fail(`${where}: count ${arr?.length} not in [${min},${max}]`);
};

const SHIPS = ['spark', 'vanguard', 'tempest', 'bastion', 'phantom'];
const TRIGGERS = ['run_start', 'daily_start', 'first_kill', 'levelup', 'evolve', 'relic', 'cache', 'combo_x2', 'combo_x5', 'combo_x10', 'milestone', 'overdrive', 'perfect', 'low_hp', 'heal', 'shield_break', 'elite', 'surge', 'boss_half', 'new_best', 'revive', 'idle', 'overtime', 'coop_start', 'coop_down', 'coop_revive'];
const PILOT_REQUIRED = ['run_start', 'perfect', 'low_hp', 'new_best'];

const ids = new Set(S.characters.map((c) => c.id));
const speakerOk = (sp) => sp === '@pilot' || sp === '@ai' || sp === '@villain' || ids.has(sp);
const allText = [];
const lineTexts = new Map(); // text -> first location (duplicate detection)
const stats = {};
const lines = (where, arr, max, group) => arr.forEach((l, i) => {
  if (!l || typeof l.text !== 'string') { fail(`${where}[${i}]: not a Line`); return; }
  if (!speakerOk(l.speaker)) fail(`${where}[${i}]: unknown speaker ${l.speaker}`);
  chk(`${where}[${i}]`, l.text, max);
  if (!l.text.trim()) fail(`${where}[${i}]: empty text`);
  const key = l.text.toLowerCase();
  if (lineTexts.has(key)) fail(`${where}[${i}]: duplicate of ${lineTexts.get(key)}`);
  else lineTexts.set(key, `${where}[${i}]`);
  allText.push(l.text);
  stats[group] = Math.max(stats[group] ?? 0, len(l.text));
});

// --- top level ---
for (const k of ['fleetName', 'enemyName', 'aiId', 'villainId']) if (typeof S[k] !== 'string' || !S[k]) fail(`missing ${k}`);
allText.push(S.fleetName, S.enemyName);

// --- characters ---
if (S.characters.length < 12) fail(`characters: ${S.characters.length} < 12`);
if (ids.size !== S.characters.length) fail('characters: duplicate ids');
for (const c of S.characters) {
  if (!/^#[0-9a-f]{6}$/i.test(c.color)) fail(`character ${c.id}: bad color ${c.color}`);
  const g = len(c.glyph); if (g < 1 || g > 2) fail(`character ${c.id}: glyph length ${g}`);
  for (const k of ['name', 'role', 'voice']) if (!c[k]) fail(`character ${c.id}: missing ${k}`);
  allText.push(c.name, c.role, c.voice);
}
for (const id of ['warden', 'hydra', 'voidheart', S.aiId, S.villainId]) if (!ids.has(id)) fail(`missing character ${id}`);

// --- vessels / pilots ---
const pilotIds = new Set();
for (const s of SHIPS) {
  const pid = S.pilots[s];
  if (!ids.has(pid)) fail(`pilot for ${s} missing (${pid})`);
  if (pilotIds.has(pid)) fail(`pilot ${pid} used twice`); pilotIds.add(pid);
  const v = S.vessels[s]; if (!v) { fail(`vessel ${s} missing`); continue; }
  for (const k of ['className', 'shipName', 'blurb']) if (!v[k]) fail(`vessel ${s}: missing ${k}`);
  chk(`vessel ${s}.blurb`, v.blurb, 80); allText.push(v.className, v.shipName, v.blurb);
}

// --- intro / victory ---
count('intro.paragraphs', S.intro.paragraphs, 4, 6);
S.intro.paragraphs.forEach((p, i) => { chk(`intro[${i}]`, p, 220); allText.push(p); });
allText.push(S.intro.title);
count('victory.paragraphs', S.victory.paragraphs, 3, 5);
S.victory.paragraphs.forEach((p, i) => { chk(`victory[${i}]`, p, 220); allText.push(p); });
allText.push(S.victory.title);

// --- sectors ---
count('sectors', S.sectors, 4, 4);
S.sectors.forEach((s, i) => {
  if (!s.name || !s.subtitle) fail(`sector ${i}: missing name/subtitle`);
  allText.push(s.name, s.subtitle);
  count(`sector ${i} arrival`, s.arrival, 1, 6);
  lines(`sector ${i} arrival`, s.arrival, 90, 'sectors');
});

// --- bosses ---
for (const b of ['warden', 'hydra', 'voidheart']) for (const k of ['intro', 'half', 'defeat', 'victoryTaunt']) {
  const arr = S.bosses[b]?.[k]; if (!arr) { fail(`boss ${b}.${k} missing`); continue; }
  count(`boss ${b}.${k}`, arr, 2, 3); lines(`boss ${b}.${k}`, arr, 90, 'bosses');
}

// --- barks ---
for (const t of TRIGGERS) {
  const arr = S.barks[t]; if (!arr) { fail(`bark ${t} missing`); continue; }
  count(`bark ${t}`, arr, 3, 6); lines(`bark ${t}`, arr, 72, 'barks');
}
for (const k of Object.keys(S.barks)) if (!TRIGGERS.includes(k)) fail(`unknown bark trigger ${k}`);

// --- pilot barks ---
for (const s of SHIPS) {
  const pid = S.pilots[s]; const pb = S.pilotBarks[pid];
  if (!pb) { fail(`pilotBarks for ${pid} missing`); continue; }
  for (const t of PILOT_REQUIRED) if (!pb[t] || pb[t].length < 2) fail(`pilotBarks ${pid}.${t} < 2`);
  for (const [t, arr] of Object.entries(pb)) {
    if (!TRIGGERS.includes(t)) fail(`pilotBarks ${pid}: unknown trigger ${t}`);
    lines(`pilotBarks ${pid}.${t}`, arr, 72, 'pilotBarks');
  }
}
for (const k of Object.keys(S.pilotBarks)) if (!pilotIds.has(k)) fail(`pilotBarks key ${k} is not a captain`);

// --- game over / overtime ---
if (S.gameOver.length < 10) fail(`gameOver: ${S.gameOver.length} < 10`);
lines('gameOver', S.gameOver, 90, 'gameOver');
if (S.overtime.length < 3) fail(`overtime: ${S.overtime.length} < 3`);
lines('overtime', S.overtime, 90, 'overtime');

// --- logbook ---
count('logbook', S.logbook, 10, 14);
const KINDS = ['runs', 'boss', 'rank', 'victory', 'combo', 'time', 'ship', 'coop'];
const logIds = new Set();
const logWords = [];
for (const e of S.logbook) {
  if (logIds.has(e.id)) fail(`logbook dup id ${e.id}`); logIds.add(e.id);
  if (!KINDS.includes(e.unlock.kind)) fail(`logbook ${e.id}: bad kind ${e.unlock.kind}`);
  if (e.unlock.kind === 'boss' && !['warden', 'hydra', 'voidheart'].includes(e.unlock.value)) fail(`logbook ${e.id}: bad boss ${e.unlock.value}`);
  if (e.unlock.kind === 'ship' && !SHIPS.includes(e.unlock.value)) fail(`logbook ${e.id}: bad ship ${e.unlock.value}`);
  if (!['boss', 'ship'].includes(e.unlock.kind) && typeof e.unlock.value !== 'number') fail(`logbook ${e.id}: value should be a number`);
  const w = words(e.text);
  if (w < 60 || w > 120) fail(`logbook ${e.id}: ${w} words (60-120)`);
  logWords.push(`${e.id}=${w}`);
  allText.push(e.title, e.text);
}

// --- originality: franchise names / catchphrases / memes (word-start, case-insensitive) ---
const BANNED = [
  // the brief's list + close relatives
  'stardate', 'enterprise', 'starfleet', 'federation', 'beam me', 'make it so', 'engag', 'phaser', 'torpedo',
  'klingon', 'borg', 'resistance is futile', 'live long', 'warp core', 'warp factor', "captain's log",
  'supplemental', 'impulse', 'transporter', 'replicator', 'holodeck', 'away team', 'redshirt', 'red shirt',
  'prime directive', 'cloak', 'romulan', 'vulcan', 'energize', 'number one', 'final frontier', 'boldly',
  'fascinating', 'illogical', 'dilithium', 'tribble', 'neutral zone', 'ready room', 'assimilat', 'the collective',
  "he's dead", 'i\'m a doctor', 'shields up', 'dominion',
  // other franchises / memes
  'the force', 'jedi', 'sith', "it's a trap", 'death star', 'tell me the odds', 'bad feeling about',
  'that\'s no moon', 'never surrender', 'infinity and beyond', 'exterminate', 'good news, everyone', "don't panic",
  'frak', 'so say we all', 'shiny', 'ludicrous', 'wookie', 'wookiee', 'droid', 'up to eleven', 'danger, will',
  'pod bay', 'dalek', 'tardis', 'timey', 'geronimo', 'allons', 'autobot', 'morphin', 'voltron', 'groot',
  'battlestar', 'serenity', 'galaxy quest', 'grabthar', 'hyperspace', 'overmind', 'covenant', 'spartan',
  'reaper', 'all your base', 'set up us', 'cake is a lie', 'you died', 'praise the sun', 'i\'ll be back',
  'over 9000', 'over nine thousand', 'barrel roll', 'hail hydra', 'i am inevitable', 'kneel before',
  'hello there', 'i am your father', 'git gud', 'press f', 'leeroy', 'space invaders', 'halfway there',
  'episode one', 'episode i ', 'bigger boat', 'in space no one', 'punch it', 'fly casual',
  // editor-in-chief IP sweep additions
  'prosper', 'boldly go', 'lightsaber', 'light saber', 'galactica', 'cylon', 'red alert, red', 'trekk', 'trekker',
  'ensign ro', 'kirk', 'spock', 'picard', 'scotty', 'sulu', 'uhura', 'janeway', 'khan', 'tricorder', 'hailing frequencies are',
  'cannae', 'canna', 'she cannot take', 'giving her all', 'all she\'s got', 'he\'s dead, jim', 'damn it', 'turn it off and on',
  'off and on again', 'have you tried', 'brrr', 'yoda', 'vader', 'skywalker', 'han solo', 'chewie', 'millennium', 'x-wing', 'tie fighter',
  'rebel alliance', 'empire', 'mandalor', 'this is the way', 'stargate', 'mass effect', 'normandy', 'shepard', 'firefly', 'browncoat',
  'expanse', 'rocinante', 'red dwarf', 'smeg', 'hitchhiker', '42 ', 'towel', 'babylon', 'farscape', 'thunderbirds', 'zordon',
];
const blob = allText.join('\n').toLowerCase();
for (const b of BANNED) {
  const re = new RegExp(`(^|[^a-z])${b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
  const m = blob.match(re);
  if (m) {
    const at = blob.indexOf(m[0]);
    fail(`banned term "${b}" near: "${blob.slice(Math.max(0, at - 30), at + 40).replace(/\n/g, ' / ')}"`);
  }
}
if (/\p{Extended_Pictographic}/u.test(blob)) warns.push('emoji-like character found');

// --- standalone type-check ---
if (runTsc) {
  try {
    execFileSync(path.join(REPO, 'node_modules/.bin/tsc'),
      ['--noEmit', '--strict', '--target', 'es2022', '--module', 'esnext', '--skipLibCheck', file],
      { stdio: 'pipe' });
    console.log('tsc: OK');
  } catch (e) {
    fail(`tsc failed:\n${e.stdout?.toString() || e.message}`);
  }
}

// --- report ---
const barkTotal = TRIGGERS.reduce((n, t) => n + (S.barks[t]?.length || 0), 0);
console.log(`characters=${S.characters.length} barks=${barkTotal} gameOver=${S.gameOver.length} overtime=${S.overtime.length} logbook=${S.logbook.length} uniqueLines=${lineTexts.size}`);
console.log('max lengths:', Object.entries(stats).map(([k, v]) => `${k}=${v}`).join(' '),
  `intro=${Math.max(...S.intro.paragraphs.map(len))}/220 victory=${Math.max(...S.victory.paragraphs.map(len))}/220 blurbs=${Math.max(...SHIPS.map((s) => len(S.vessels[s].blurb)))}/80`);
console.log('logbook words:', logWords.join(' '));
if (near.length) console.log(`near limit (${near.length}):`, near.join(' | '));
for (const w of warns) console.log('WARN', w);
if (errs.length) { for (const e of errs) console.log('FAIL', e); process.exit(1); }
console.log('OK: all checks passed');
