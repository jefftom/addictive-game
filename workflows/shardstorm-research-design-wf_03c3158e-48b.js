export const meta = {
  name: 'shardstorm-research-design',
  description: 'Research Steam/Electron, map co-op refactor, write+judge cheesy story, prototype galaxy backdrops',
  phases: [
    { title: 'Research', detail: 'Steam/Electron API spec and co-op refactor map' },
    { title: 'Story', detail: 'three writers with different comedic angles, then a judge merges' },
    { title: 'Galaxy', detail: 'prototype -> visual critique -> revision' },
  ],
}

const ROOT = '/home/user/addictive-game'
const PLAN = '/tmp/claude-0/-home-user-addictive-game/1abae5b2-c201-57a9-8979-0317e8f22528/scratchpad/plan'

const BRIEF = `PROJECT: SHARDSTORM, a finished, playable neon arena-survival roguelite (Vampire-Survivors-like) in ${ROOT}.
TypeScript + Vite, no runtime deps. Key layout:
- src/game/: deterministic fixed-step (60 Hz) simulation, no DOM. world.ts (World: single \`player\`, \`stats\`, \`build\`, enemies, projectiles, bullets, pickups, rings, mines, beams, \`events\` queue), weapons.ts, enemyai.ts (incl. 3 bosses), director.ts (spawning, surges, elites, bosses at 180/360/540 s, victory at 600 s then Overtime), upgrades.ts (level-up offers), stats.ts, combo.ts, bot.ts (steering bot used for attract mode + headless balance sim), runconfig.ts, content/*.ts data tables (enemies, weapons, passives+relics, ships, workshop+daily modifiers), types.ts.
- src/render/: renderer.ts (camera, draws World), background.ts (base fill + radial-gradient nebula + 3 star layers + beat-pulsing grid + vignette), hud.ts, sprites.ts (pre-rendered glow sprites), particles.ts, effects.ts, palette.ts.
- src/audio/: procedural WebAudio SFX (audio.ts) and music sequencer (music.ts).
- src/meta/: save.ts (versioned localStorage save), progression.ts, missions.ts, achievements.ts (21), rank.ts, daily.ts, result.ts.
- src/ui/: ui.ts (DOM screens: title, hangar, workshop, records, settings, levelup, pause, victory, results), dom.ts, style.css.
- src/app.ts: state machine + fixed-step loop with hitstop/slow-mo; src/core/: input.ts (keyboard/mouse/touch/gamepad), rng.ts, grid.ts, math.ts.
- tests/*.test.ts (vitest, \`npx vitest run\`), tests/balance.sim.ts (\`npm run sim\`), e2e/ (Playwright; run with PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers), docs/GAME_DESIGN.md (read it for intent).
Ships: Spark (Pulse Blaster), Vanguard (Orbit Blades, tanky), Tempest (Arc Lightning, fast), Bastion (Nova, dash shockwave), Phantom (Seeker Swarm, 2 dashes).
The owner asked for: multiplayer, Steam, a cheesy story, and galaxy backdrops. Decided scope: local co-op for 1-4 players (shared screen; on Steam, Remote Play Together makes it online), a Steam-ready Electron desktop build, a cheesy narrative layer, and procedural galaxy sector backdrops (one sector per boss phase, warp transition between them).
RULES: Do NOT modify anything under ${ROOT} in this phase (read-only research/design). Write deliverables only under ${PLAN}/ as instructed. Network: npm registry and github.com release downloads work; most other hosts are blocked.`

const STORY_SCHEMA_TS = `// Target module shape (src/story/script.ts) -- keep EXACTLY these names/types.
export type Speaker = '@pilot' | '@ai' | '@villain' | string; // '@pilot' = current ship's pilot; '@ai' = sidekick; '@villain' = main villain; otherwise a CharacterDef.id (e.g. boss ids 'warden' | 'hydra' | 'voidheart')
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
  characters: CharacterDef[];                 // sidekick AI, villain, 5 pilots, 3 bosses (10+)
  pilots: Record<ShipId, string>;             // ship id -> pilot character id
  aiId: string;
  villainId: string;
  intro: { title: string; paragraphs: string[] };          // opening crawl, 4-6 paragraphs, each <= 220 chars
  sectors: { name: string; subtitle: string; arrival: Line[] }[]; // EXACTLY 4: 0:00-3:00, after Warden, after Hydra, after Void Heart/Overtime
  bosses: Record<'warden' | 'hydra' | 'voidheart', { intro: Line[]; half: Line[]; defeat: Line[]; victoryTaunt: Line[] }>; // 2-3 lines each list; boss lines <= 90 chars
  barks: Record<BarkTrigger, Line[]>;        // 3-6 variants per trigger, each text <= 72 chars
  pilotBarks: Record<string, Partial<Record<BarkTrigger, Line[]>>>; // keyed by pilot character id: 2+ signature lines for run_start, perfect, low_hp, new_best
  gameOver: Line[];                           // 8+ quips shown on the results screen, <= 90 chars
  victory: { title: string; paragraphs: string[] };        // ending, 3-5 paragraphs <= 220 chars
  overtime: Line[];                           // 3+ "post-credits" style lines
  logbook: LogbookEntry[];                    // 10-14 chapters, 60-120 words each, unlocking across a long play arc
}
export declare const STORY: StoryScript;`

const STORY_FACTS = `GAME FACTS the story must fit: you fly a tiny ship of pure light ("a spark") through endless swarms of dark geometry: Drifters (triangles), Swarmlings (darts, packs), Dashers (diamonds that charge), Splitters (circles that split in two), Shooters (hexagons that fire), Brutes (big squares). Gold-rimmed Elites drop Caches (bonus upgrades). You collect SHARDS (XP) and CORES (currency spent in the Workshop between runs). Kills chain a COMBO multiplier (x2..x10; milestones at 50/100/200: Magnet Pulse, Nova Burst, Overdrive). Dashing through an attack is a PERFECT DASH (slow-mo). Weapons can EVOLVE; rare RELICS exist. Bosses: The Warden at 3:00 (huge hexagon, "Keeper of the First Gate", radial bullet bursts, summons swarmlings), The Hydra at 6:00 (star-shaped, "It Hunts in Spirals", charges and spiral volleys), The Void Heart at 9:00 (spiked core, "The Storm Has a Heart", rotating bullet spirals, summons dashers). Surviving 10:00 is VICTORY; you can then continue into OVERTIME. Runs end in death most of the time; the player retries a lot (so game-over quips must stay fresh and funny). There is a Daily Run and local co-op (1-4 ships). The run passes through 4 SECTORS (galaxy backdrops change after each boss). Five ships, each needs a pilot: Spark (balanced all-rounder), Vanguard (armored, slow, orbit blades), Tempest (fast, fragile, lightning), Bastion (dash ends in a shockwave), Phantom (two dashes, homing missiles).
TONE: CHEESY on purpose: groan-worthy light/dark puns, 80s-action bravado, melodramatic monologuing villains, a sidekick AI with terrible jokes, affectionate and self-aware. Family-friendly, no profanity, no real-world brands/people/franchise references, all names original. Lines must be SHORT because they appear as in-game comms while players are dodging bullets.`

const writer = (angle, n) => agent(`${BRIEF}

You are story writer #${n}. Write a complete cheesy narrative script for SHARDSTORM from this comedic angle: ${angle}

${STORY_FACTS}

Deliver the FULL content for this TypeScript schema (all fields, all ${'barks'} triggers filled):
${STORY_SCHEMA_TS}

Write it as a TypeScript module to ${PLAN}/story-draft-${n}.ts (export const STORY: StoryScript = {...}; include the type declarations above in the file so it type-checks standalone). Then run a quick length check with node (write the checker script under ${PLAN}/tools/, not next to the draft) and fix any line over its limit. Your final answer: a 150-word pitch of your take (main characters, running gags, best 5 lines verbatim) followed by the file path.`, { label: `writer:${n}`, phase: 'Story' })

const storyChain = async () => {
  const angles = [
    '80s action-movie bravado: a square-jawed hero voice, one-liners after every kill streak, a villain who monologues in all-caps drama, a sidekick AI that is a failed stand-up comedian.',
    'Saturday-morning cartoon: catchphrases, a bumbling villain with incompetent minions (the bosses as a dysfunctional office team), wholesome team spirit, very punny.',
    'Self-aware space-opera parody: an overwrought narrator, a villain who keeps rewriting his evil speeches, pilots who know they are in a video game and comment on respawns, meta jokes about combos and "one more run".',
  ]
  const drafts = await parallel(angles.map((a, i) => () => writer(a, i + 1)))
  const ok = drafts.filter(Boolean)
  log(`story drafts: ${ok.length}/3`)
  return agent(`${BRIEF}

You are the story editor-in-chief. Three writers drafted cheesy scripts for SHARDSTORM: ${PLAN}/story-draft-1.ts, story-draft-2.ts, story-draft-3.ts (some may be missing; use what exists). Their pitches:
${ok.map((d, i) => `--- pitch ${i + 1} ---\n${d}`).join('\n')}

${STORY_FACTS}

Do this:
1. Score each draft 1-10 on: (a) laugh-out-loud cheesiness, (b) consistency and memorable characters, (c) brevity/readability mid-combat, (d) variety (game-over quips must survive 50+ deaths without feeling repetitive), (e) fit with the game facts.
2. Pick the strongest draft as the base and graft the best characters, gags and lines from the others. Keep ONE coherent cast and world.
3. Write the merged final module to ${PLAN}/story-script.ts with exactly this schema (type declarations included at top so it compiles standalone):
${STORY_SCHEMA_TS}
4. Validate: write a node checker under ${PLAN}/tools/ that imports nothing from the draft dir; verify all 26 bark triggers have 3-6 variants, length limits (barks <= 72 chars, boss lines/gameOver <= 90, crawl paragraphs <= 220), exactly 4 sectors, 10-14 logbook entries of 60-120 words, every speaker id resolves to '@pilot'/'@ai'/'@villain' or a character id, every pilot in pilots has pilotBarks. Also type-check it: cd ${ROOT} && npx tsc --noEmit --strict --target es2022 --module esnext --moduleResolution bundler ${PLAN}/story-script.ts. Fix until clean.
5. Also write ${PLAN}/story-bible.md: cast (one paragraph each), running gags, tone rules, and where each content type appears in-game.
Final answer: the scores table, what you took from each draft, 8 favourite lines verbatim, and both file paths.`, { label: 'story:editor', phase: 'Story', effort: 'high' })
}

const galaxyChain = async () => {
  const spike = await agent(`${BRIEF}

TASK: prototype procedural GALAXY SECTOR BACKDROPS for SHARDSTORM (no external images; everything generated in code; seeded and deterministic).
Read ${ROOT}/src/render/background.ts, renderer.ts, palette.ts and sprites.ts first: the new backdrop replaces the base fill + radial-gradient nebula (which is also the most expensive per-frame part today); the star layers, grid and vignette stay.
Requirements:
- 4 sectors, each a distinct, gorgeous space scene that still reads as a DARK backdrop for warm-neon enemies (#ff3d6e, #ff8c42, #ffd23f, #b15cff, #ff4fd2, #ff5233), cyan shards (#45e8ff) and a cyan player: low-mid luminance, desaturated enough, no hard high-contrast detail in the play field. Suggested themes (refine freely): 1 teal/cyan spiral galaxy; 2 crimson/orange nebula with a ringed gas giant; 3 violet abyss with a black hole accretion disk; 4 the storm's heart: dark gold/obsidian vortex.
- Layers with parallax: a tileable (seamless, wraps infinitely) nebula/dust layer from periodic fBm noise at low resolution upscaled smoothly; a large centerpiece (spiral galaxy built from thousands of stars on logarithmic arms + core glow + dust lanes, or black hole etc.) at very low parallax; 1-3 planets/moons with lighting, atmosphere rim and optional rings at medium parallax.
- PERFORMANCE: everything pre-rendered ONCE per sector into offscreen canvases (generation should be chunkable/async-friendly; report timings); per-frame cost must be a handful of drawImage calls. Measure generation time and per-frame draw time in headless Chromium at 1280x720 and 1920x1080.
- A warp transition effect for switching sectors (e.g. stars stretching into streaks + crossfade), driven by a 0..1 progress value.
- Proposed API (refine if needed): export const SECTORS: SectorDef[]; export class GalaxyBackdrop { prepare(i: number): void (sync or chunked); setSector(i: number, opts?: { warp?: boolean }): void; update(dt: number): void; draw(ctx: CanvasRenderingContext2D, camX: number, camY: number, k: number /* device px per world unit */, w: number, h: number, time: number): void; }
Build it as a standalone browser module at ${PLAN}/galaxy/galaxy.ts plus a harness ${PLAN}/galaxy/harness.html (+ any tiny bundling you need: you may use ${ROOT}/node_modules/.bin/esbuild or vite if present, else write plain JS) and a Playwright script under ${PLAN}/galaxy/tools/ (import playwright from ${ROOT}/node_modules/playwright/index.mjs; run with PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers) that renders each sector at 1280x720 into ${PLAN}/galaxy/shots/sector-N.png, a variant with sample neon enemy/shard sprites drawn on top (readability check) at shots/sector-N-overlay.png, and 3 frames of the warp transition. LOOK at your screenshots with the Read tool and iterate until they are genuinely beautiful and readable.
Final answer: API summary, perf numbers (gen ms per sector, draw ms per frame), screenshot paths, and known weaknesses.`, { label: 'galaxy:prototype', phase: 'Galaxy', effort: 'high' })

  const critique = await agent(`${BRIEF}

You are an art director reviewing a procedural galaxy-backdrop prototype for SHARDSTORM. The prototype author reported:
${spike}

Open every PNG in ${PLAN}/galaxy/shots/ with the Read tool and read ${PLAN}/galaxy/galaxy.ts. Judge harshly: (1) beauty and variety per sector; would a player screenshot this? (2) gameplay readability on the overlay shots: do warm-neon enemies and cyan shards pop? Is anything too bright/busy in the play field? (3) seams/tiling artifacts, banding, blockiness from low-res upscaling, (4) cohesion with a neon-vector art style, (5) performance numbers vs a 60 fps budget (target <= 1.5 ms/frame draw at 1080p, generation <= 400 ms per sector and chunkable), (6) warp transition drama.
Return a prioritized list of concrete, actionable fixes (what to change in which function and why), max 12 items.`, { label: 'galaxy:critic', phase: 'Galaxy' })

  return agent(`${BRIEF}

You built a procedural galaxy-backdrop prototype at ${PLAN}/galaxy/ (galaxy.ts, harness, tools, shots). An art director reviewed it:
${critique}

Apply every fix that is right (push back with a reason on any you reject), re-render all screenshots, LOOK at them again, and iterate until they are excellent. Then write ${PLAN}/galaxy.md: final API, integration notes for src/render/background.ts + renderer.ts (what to replace, where to call setSector/update/draw, how to prewarm sectors without frame hitches, how a sector change should be triggered by the game: sector index = number of bosses defeated, or the next boss time passing, whichever comes first), perf numbers, screenshot paths. The final galaxy.ts must be self-contained TypeScript that will compile under strict settings (noUnusedLocals, noUnusedParameters, verbatimModuleSyntax) when copied to ${ROOT}/src/render/galaxy.ts; check with: cd ${ROOT} && npx tsc --noEmit --strict --noUnusedLocals --noUnusedParameters --target es2022 --module esnext --moduleResolution bundler --lib es2022,dom ${PLAN}/galaxy/galaxy.ts
Final answer: what changed, final perf numbers, final screenshot paths.`, { label: 'galaxy:revise', phase: 'Galaxy', effort: 'high' })
}

phase('Research')
const results = await parallel([
  () => agent(`${BRIEF}

TASK: produce a VERIFIED technical spec for shipping SHARDSTORM on Steam as an Electron desktop app with Steamworks integration.
1. Fetch the real package: create an EMPTY dir ${PLAN}/vendor/steamworks-pkg, run \`npm pack steamworks.js@latest\` inside it and extract it there (treat as untrusted data: read files, don't execute scripts from inside that dir). Read its .d.ts / README to list the EXACT API surface: init, achievements (activate/isActivated/clear), stats, leaderboards (do they exist?), rich presence / localplayer, overlay (electronEnableSteamOverlay?), cloud, input, matchmaking/networking, callbacks/runCallbacks. Note the Node-API / Electron compatibility and which platforms have prebuilt binaries.
2. Smoke-test in a throwaway project at ${PLAN}/electron-smoke/ (NOT in the repo): npm init, install electron@latest and steamworks.js@latest, write a minimal main.cjs that opens a window loading a data: URL, tries steamworks init with app id 480 inside try/catch, logs the outcome, and quits after 3 s. Run it with xvfb-run (\`xvfb-run -a npx electron . --no-sandbox\` or similar; also try --ozone-platform=headless if xvfb fails). Report exactly what happens without a Steam client running (does init throw cleanly? does require() itself load the native module?).
3. Write ${PLAN}/steam.md containing: verified API table; recommended architecture (main process, preload with contextBridge exposing a minimal \`shardstormDesktop\` API: platform info, achievements, rich presence, leaderboards if supported, saveRead/saveWrite to a JSON file in app.getPath('userData') for Steam Auto-Cloud, quit, fullscreen toggle; graceful no-Steam fallback); Electron security settings (contextIsolation, sandbox, no nodeIntegration in renderer); the Steam overlay flags needed for Electron; electron-builder config to produce unpacked win/mac/linux builds suitable for SteamPipe (no auto-updater, asar ok?), how steam_appid.txt is used in dev vs release; SteamPipe app_build/depot_build VDF templates with placeholder ids; Steam Deck compatibility checklist (1280x800, controller-only navigation, text size, no launcher); Remote Play Together requirements (local multiplayer + controller/keyboard input; what the Steamworks settings must declare); store asset list with exact current pixel sizes (capsules, library hero/logo, screenshots); a CI approach (GitHub Actions matrix build; optional upload with game-ci/steam-deploy using secrets); the list of steps only the owner can do (Steamworks partner account, app fee, store page, configuring achievements in the Steamworks UI, ratings, release review).
Final answer: a concise summary of findings (especially anything surprising, like missing leaderboard support or overlay quirks) + file path.`, { label: 'steam:research', phase: 'Research', effort: 'high' }),

  () => agent(`${BRIEF}

TASK: design the LOCAL CO-OP (1-4 players) refactor in full detail. Read ALL of src/ and tests/ first.
Decided rules (refine with reasons if something is clearly better): XP and level are shared (team level); on each level-up EVERY living player picks from offers generated from THEIR OWN build (sequential picks); each player has their own ship, stats, build (weapons/passives/relics), rerolls, dash, HP, revives; combo and score are shared team values (a hit on anyone halves the combo); a Cache goes to the player who collects it; enemies target the nearest living (not downed) player; pickups magnetize to the nearest player whose magnet radius reaches them (hearts heal the collector; cores/xp are team-wide); a player at 0 HP with no revives is DOWNED (ghost) instead of ending the run, and a teammate standing within ~70 units for ~2.5 s revives them at 40% HP; the run ends when all are downed; camera follows the centroid of living players and zooms out to fit them up to a cap, and players are leashed so they cannot leave that max view; difficulty scales with player count (spawn rate, enemy HP, boss HP); single-player behaviour and determinism must stay EXACTLY as today (existing tests must keep passing unchanged except for mechanical API renames); the bot must be able to drive any player; the balance sim gains a 2-player profile.
Produce ${PLAN}/coop.md with: (1) the data model (types) for per-player state vs team state; (2) an exhaustive change list per file with the functions/lines involved (grep for every use of world.player, world.stats, world.build, world.rerolls, pendingLevelUps/pendingCaches, viewHalfW/H, nearestEnemy origins, spawnPoint, etc.); (3) the API the app/renderer/HUD/UI will consume (e.g. world.players[i], world.alivePlayers(), per-player pending picks queue); (4) camera/zoom/leash math; (5) input-device assignment design (solo: all devices merge into P1 exactly as today; co-op: 'kbA' = WASD+Space/Shift, 'kbB' = arrows+Enter/RightCtrl/Numpad0, gamepads 0-3; touch is solo-only) and a co-op lobby UX ("press to join", ship select per player, ready-up); (6) HUD layout for 2-4 players; (7) level-up UX for sequential per-player picks; (8) meta/save implications (co-op best score, achievements/missions counting, Daily Run solo-only); (9) risks and a test plan (unit tests for revive/downed, targeting, shared XP, determinism with 2 players; e2e for co-op lobby with two keyboard players). Be concrete enough that an engineer can implement it without re-deriving decisions.
Final answer: a 200-word summary + file path.`, { label: 'coop:map', phase: 'Research', effort: 'high' }),

  () => storyChain(),
  () => galaxyChain(),
])
return { steam: results[0], coop: results[1], story: results[2], galaxy: results[3] }
