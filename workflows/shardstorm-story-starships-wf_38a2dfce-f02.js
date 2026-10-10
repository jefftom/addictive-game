export const meta = {
  name: 'shardstorm-story-starships',
  description: 'Write a cheesy original starship-vs-alien-armada story: 3 writers, then an editor merges and validates',
  phases: [
    { title: 'Draft', detail: 'three writers, different comedic angles' },
    { title: 'Edit', detail: 'score, merge, validate, IP check' },
  ],
}

const ROOT = '/home/user/addictive-game'
const PLAN = '/tmp/claude-0/-home-user-addictive-game/1abae5b2-c201-57a9-8979-0317e8f22528/scratchpad/plan'

const SCHEMA = `// Target module shape (src/story/script.ts) -- keep EXACTLY these names/types.
export type Speaker = '@pilot' | '@ai' | '@villain' | string; // '@pilot' = the current vessel's captain; '@ai' = the wisecracking sidekick (ship's computer or first officer, your call); '@villain' = the alien overlord; otherwise a CharacterDef.id (e.g. boss ids 'warden' | 'hydra' | 'voidheart', or other crew ids)
export interface Line { speaker: Speaker; text: string }
export interface CharacterDef { id: string; name: string; role: string; color: string /* neon #rrggbb */; glyph: string /* 1-2 chars used as a portrait */; voice: string /* one-line voice note */ }
export type BarkTrigger =
  | 'run_start' | 'daily_start' | 'first_kill' | 'levelup' | 'evolve' | 'relic' | 'cache'
  | 'combo_x2' | 'combo_x5' | 'combo_x10' | 'milestone' | 'overdrive' | 'perfect'
  | 'low_hp' | 'heal' | 'shield_break' | 'elite' | 'surge' | 'boss_half' | 'new_best' | 'revive'
  | 'idle' | 'overtime' | 'coop_start' | 'coop_down' | 'coop_revive';
export type ShipId = 'spark' | 'vanguard' | 'tempest' | 'bastion' | 'phantom';
export interface LogbookEntry { id: string; title: string; unlock: { kind: 'runs' | 'boss' | 'rank' | 'victory' | 'combo' | 'time' | 'ship' | 'coop'; value: number | string }; text: string }
export interface StoryScript {
  fleetName: string;                          // the player's allied fleet (original name)
  enemyName: string;                          // the alien armada's formal name (the "Shardstorm" is what humans call it)
  vessels: Record<ShipId, { className: string; shipName: string; blurb: string }>; // e.g. spark -> "Lumen-class frigate", "the ___", one-line blurb <= 80 chars
  characters: CharacterDef[];                 // sidekick, villain, 5 captains, 3 boss commanders, + optional extra bridge crew (12+ total)
  pilots: Record<ShipId, string>;             // ship id -> captain character id
  aiId: string;
  villainId: string;
  intro: { title: string; paragraphs: string[] };          // opening crawl, 4-6 paragraphs, each <= 220 chars
  sectors: { name: string; subtitle: string; arrival: Line[] }[]; // EXACTLY 4: 0:00-3:00, after Warden, after Hydra, after Void Heart/Overtime
  bosses: Record<'warden' | 'hydra' | 'voidheart', { intro: Line[]; half: Line[]; defeat: Line[]; victoryTaunt: Line[] }>; // 2-3 lines each; <= 90 chars
  barks: Record<BarkTrigger, Line[]>;        // 3-6 variants per trigger, each text <= 72 chars
  pilotBarks: Record<string, Partial<Record<BarkTrigger, Line[]>>>; // keyed by captain id: 2+ signature lines for run_start, perfect, low_hp, new_best
  gameOver: Line[];                           // 10+ quips shown on the results screen, <= 90 chars (players die A LOT: must stay fresh)
  victory: { title: string; paragraphs: string[] };        // ending, 3-5 paragraphs <= 220 chars
  overtime: Line[];                           // 3+ "post-credits" style lines
  logbook: LogbookEntry[];                    // 10-14 "ship's log" chapters, 60-120 words each, unlocking across a long play arc
}
export declare const STORY: StoryScript;`

const FACTS = `PREMISE (from the game's owner): starship vessels, in the spirit of classic TV starship adventures (bridge crews, captains' logs, "shields at 20%!", melodramatic aliens), versus an alien force. It must be 100% ORIGINAL: no names, catchphrases, species, ranks-as-brands or ship designs from any franchise (no "stardate", "Enterprise", "Starfleet", "Federation", "beam me up", "make it so", "engage", "phasers", "photon torpedoes", "Klingon", "Borg", "resistance is futile", "live long", "warp core", etc.). Generic sci-fi vocabulary is fine (shields, hull, red alert, hailing frequencies, warp, sensors, ship's log, captain, helm).
GAME FACTS the story must fit (SHARDSTORM, a neon arena-survival roguelite): you captain ONE small starship of an allied fleet; your weapons fire automatically; you steer and DASH (a short evasive burn; dashing through an attack is a PERFECT DASH with slow-mo). The enemy is a CRYSTALLINE ALIEN ARMADA nicknamed "the Shardstorm": drones (triangles), dart swarms, lancers that telegraph and charge (diamonds), budding cell-ships that split in two (circles), gunships that fire bolts (hexagons), bulwark haulers (big squares). Gold-rimmed elites drop Caches (bonus upgrades). Destroyed aliens leave crystal SHARDS (XP: your ship levels up and installs upgrades mid-battle) and CORES (currency spent at the shipyard between runs: "the Workshop"). Kills chain a COMBO multiplier (x2..x10; milestones at 50/100/200: Magnet Pulse, Nova Burst, Overdrive). Weapons can EVOLVE; rare RELICS exist. Boss capital ships: The Warden at 3:00 (gate fortress, "Keeper of the First Gate"), The Hydra at 6:00 (multi-headed hunter-cruiser, "It Hunts in Spirals"), The Void Heart at 9:00 (hive mothership, "The Storm Has a Heart"). Surviving 10:00 = VICTORY, then optional OVERTIME. Most runs end in the ship's destruction and an instant retry. There is a Daily Run and local co-op (1-4 ships fly together). The run passes through 4 SECTORS (the galaxy backdrop changes after each boss: teal spiral galaxy, crimson nebula with a ringed gas giant, violet abyss with a black hole, the storm's gold/obsidian heart).
Five vessels, each with a captain with a strong personality: spark = light frigate/scout (balanced), vanguard = armoured heavy cruiser (tanky, slow, orbit blades), tempest = fast interceptor (fragile, arc lightning), bastion = shield dreadnought (dashes end in a shockwave, nova), phantom = stealth raider (two dashes, homing seeker missiles).
TONE: CHEESY on purpose: groan-worthy puns (crystal/shard/light puns welcome), over-dramatic bridge-crew chatter, a villain who monologues, a sidekick with terrible jokes, affectionate and self-aware. Family-friendly. Lines must be SHORT: they appear as in-game comms while players dodge bullets.`

const writer = (angle, n) => agent(`You are story writer #${n} for SHARDSTORM (repo ${ROOT}; read docs/GAME_DESIGN.md and src/game/content/*.ts for flavour; do NOT modify the repo). Write a complete cheesy narrative script from this comedic angle: ${angle}

${FACTS}

Deliver the FULL content for this schema (every field, every bark trigger):
${SCHEMA}

Write it as a TypeScript module to ${PLAN}/story-v2-draft-${n}.ts (export const STORY: StoryScript = {...}; include the type declarations so it type-checks standalone). Write a node length-checker under ${PLAN}/tools-v2/ and fix any line over its limit. Final answer: a 150-word pitch (cast, running gags, the 5 best lines verbatim) + the file path.`, { label: `writer:${n}`, phase: 'Draft' })

phase('Draft')
const angles = [
  `Classic bridge-crew drama turned to eleven: a captain who delivers every order like a closing speech, a by-the-book science officer who reads out absurd sensor readings, an engineer who insists the engines cannot take much more, and an alien overlord who monologues in ALL-CAPS crystal poetry.`,
  `Saturday-morning space cartoon: catchphrases per captain, the three boss commanders as a dysfunctional alien middle-management team who blame each other, a relentlessly upbeat pun-obsessed ship computer sidekick, wholesome found-family fleet.`,
  `Self-aware space-opera parody: a pompous narrator doing the ship log, captains who know they are in a roguelite (respawns, one more run, combo meters), an alien villain who keeps rewriting his evil speeches and asking for feedback, meta jokes about Workshop prices.`,
]
const drafts = await parallel(angles.map((a, i) => () => writer(a, i + 1)))
const ok = drafts.filter(Boolean)
log(`drafts: ${ok.length}/3`)

phase('Edit')
return agent(`You are the story editor-in-chief for SHARDSTORM (repo ${ROOT}, read-only). Three writers drafted cheesy starship scripts: ${PLAN}/story-v2-draft-1.ts, -2.ts, -3.ts (some may be missing). An older, superseded "pilot of light" draft set may also exist at ${PLAN}/story-draft-*.ts and ${PLAN}/story-script.ts: you may mine them for jokes that fit the new starship premise, nothing else.
Pitches:
${ok.map((d, i) => `--- pitch ${i + 1} ---\n${d}`).join('\n')}

${FACTS}

1. Score each draft 1-10 on: laugh-out-loud cheesiness; memorable, consistent cast; brevity/readability mid-combat; variety (game-over quips must survive 50+ deaths); fit with the game facts; originality (zero franchise names/catchphrases/lookalikes).
2. Build ONE coherent final script: strongest draft as the base, graft the best cast, gags and lines from the others.
3. IP sweep: search the final text for franchise terms (stardate, Enterprise, Starfleet, Federation, Klingon, Vulcan, Romulan, Borg, phaser, photon torpedo, transporter, beam me up, make it so, engage, warp core, live long, prosper, resistance is futile, final frontier, boldly go, red shirt, Jedi, Sith, lightsaber, the Force, Death Star, Galactica, Cylon, etc.) and rewrite anything close.
4. Write the final module to ${PLAN}/story-script-v2.ts with exactly this schema (type declarations at the top so it compiles standalone):
${SCHEMA}
5. Validate with a node checker under ${PLAN}/tools-v2/: all 26 bark triggers have 3-6 variants; length limits (barks <= 72, boss lines and gameOver <= 90, crawl/victory paragraphs <= 220, vessel blurbs <= 80); exactly 4 sectors; 10-14 logbook entries of 60-120 words; every speaker resolves; every captain has pilotBarks; all 5 vessels present. Type-check: cd ${ROOT} && npx tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler ${PLAN}/story-script-v2.ts. Fix until clean.
6. Write ${PLAN}/story-bible-v2.md: the fleet and the alien armada, cast (one paragraph each), vessel classes, running gags, tone rules, and where each content type appears in-game.
Final answer: scores table, what you took from each draft, 10 favourite lines verbatim, and both file paths.`, { label: 'editor', phase: 'Edit', effort: 'high' })
