export const meta = {
  name: 'shardstorm-wave1-build',
  description: 'Build co-op sim core (with review+fix), story engine, and Steam desktop shell in parallel',
  phases: [
    { title: 'Build', detail: 'co-op core in main tree; story engine and Steam shell in worktrees' },
    { title: 'Review', detail: 'three independent lenses on the co-op core' },
    { title: 'Fix', detail: 'apply confirmed co-op findings' },
  ],
}

const ROOT = '/home/user/addictive-game'
const PLAN = '/tmp/claude-0/-home-user-addictive-game/1abae5b2-c201-57a9-8979-0317e8f22528/scratchpad/plan'
const TRAILER = `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ufw2FXiEUyE3RQq4NbkUr6`

const COMMON = `PROJECT: SHARDSTORM (TypeScript + Vite neon arena-survival roguelite). Main repo: ${ROOT}, branch claude/dazzling-faraday-2kxdhl. Read docs/GAME_DESIGN.md for intent. Strict tsconfig (noUnusedLocals/Parameters, verbatimModuleSyntax). Checks: \`npx tsc --noEmit\` and \`npx vitest run\` (52 tests today, all green). Do not run the long balance sim unless asked. The game is being re-themed to starships (an allied fleet's starship vessels vs a crystalline alien armada, "the Shardstorm") with a cheesy story; ids in code (ship ids spark/vanguard/tempest/bastion/phantom, enemy kinds, boss ids warden/hydra/voidheart) stay unchanged.
Commit messages must end with these two lines exactly:
${TRAILER}`

const coopCore = async () => {
  const impl = await agent(`${COMMON}

YOU OWN: the LOCAL CO-OP SIMULATION CORE, working directly in ${ROOT} on the current branch. The full, approved design is ${PLAN}/coop.md (read ALL of it; it is precise, with line references to commit 18b7adc which is HEAD). Implement its section 12 slices 1-3 plus the bot and sim parts:
1. Golden master FIRST (coop.md section 11.1 + Appendix A values): add the solo golden-master test, verify it passes on the unmodified code, commit it alone.
2. Model refactor with solo-only behaviour: types, runconfig, stats, new content/coop.ts (COOP_SCALING table etc.), world.ts players array + P1 aliases + damage owners, weapons, enemyai, director, upgrades, bot (botInput(world, rng, opts, pid = 0) + co-op behaviours: revive teammates, stay with team). Add the no-p1-alias grep guard test. Golden master + all existing tests must stay green with NO edits to existing test expectations.
3. Co-op sim rules: targeting with hysteresis, downed/ghost/revive/team-wipe, leash, zoom (sim-side), pickup ownership, level rounds with per-player pick queue (PickRequest), caches per collector, difficulty scaling, spawn clearance. tests/coop.test.ts per coop.md 11.2 (target players[1] etc.). Balance sim: add the co-op profiles from 11.4 to tests/balance.sim.ts and tests/helpers.ts (simulateRun gains a players option) but only run a quick 2-player sanity run (e.g. SIM_RUNS=4) and report numbers; tune COOP_SCALING if the 2-player bot results are wildly off the design targets.
SCOPE LIMITS: Do NOT build the lobby, HUD, renderer camera/zoom presentation, input bindings or UI (later wave). Touch src/app.ts / src/render/* / src/ui/* / src/core/input.ts ONLY if strictly needed to keep them compiling and keep solo behaviour identical (the P1 aliases should make that unnecessary). Do not touch package.json, src/story/, desktop/, src/platform/ (other teams are working there in parallel worktrees).
Commit in logical slices (golden master; model refactor; co-op rules; bot+sim). Final answer: what you built, deviations from coop.md with reasons, test counts, the 2-player sanity sim numbers, and the public API the presentation layer will consume (exact names/signatures).`, { label: 'coop:implement', phase: 'Build', effort: 'high' })

  const lenses = [
    ['solo-determinism', `Verify solo play is bit-for-bit unchanged: run the golden-master test; diff \`git diff 18b7adc -- src/game\` and hunt for any change in RNG draw order, float operation order, tick ordering, or event order on the N=1 path (e.g. extra rng draws in spawnPoint/posRng, reordered loops, changed constants, new per-tick work that consumes rng). Also check the Daily-run spawn-sequence regression test still exists and passes, and that existing tests were not weakened.`],
    ['coop-rules', `Verify the co-op rules against ${PLAN}/coop.md sections 0, 2 and 5 by reading the code AND writing small throwaway vitest repros under ${ROOT}/tests/__review__/ (delete them before finishing): targeting hysteresis, downed/ghost (no collection/attacks, 55% drift, leash), revive radius/time/decay/escalation, self-revives first, team wipe ends run exactly once, level rounds (every player incl. downed picks once per team level, caches first, offers from each player's own build), cache to collector, boss drops per player, pickup ownership and retargeting when owner goes down, combo window = max, any-hit halves combo, scaling table applied once (not compounded), damage ownership (kills credited, orbit hit cooldowns per player), dash ids world-wide, view/zoom/leash math.`],
    ['perf-and-quality', `Review the co-op core diff for per-tick allocations, accidental O(players*enemies*enemies) work, hot-path closures, P1-alias misuse inside co-op paths (anything using world.player/stats/build where a pid-specific value is required), dead code, and missing tests for important branches. Measure: a 4-player headless run (bots) for 120 s of game time and report average ms per World.update vs solo at similar enemy counts.`],
  ]
  const reviews = await parallel(lenses.map(([name, focus]) => () => agent(`${COMMON}

You are an independent reviewer (lens: ${name}) of the local co-op simulation core just implemented in ${ROOT} (design: ${PLAN}/coop.md). The implementer reported:
${impl}

${focus}
Rules: do NOT edit tracked source files (throwaway repro tests under tests/__review__/ are allowed but must be deleted before you finish). Verify each suspected issue concretely (exact code path, ideally a failing repro) before reporting. Return a numbered list of CONFIRMED issues ranked by severity, each with file:line, failure scenario and minimal fix, then a short "checked and fine" list. Return "NO ISSUES" if none.`, { label: `review:${name}`, phase: 'Review', effort: 'high' })))

  const fix = await agent(`${COMMON}

You implemented (or are taking over) the co-op simulation core in ${ROOT} (design ${PLAN}/coop.md). Implementation report:
${impl}

Three independent reviewers reported:
${lenses.map(([n], i) => `=== ${n} ===\n${reviews[i] ?? '(reviewer failed)'}`).join('\n\n')}

For each finding: re-verify it; fix it if real (add a regression test where sensible) or explain why it is not an issue. Make sure tests/__review__/ does not exist. Keep golden master + all tests green, tsc clean. Commit the fixes. Final answer: per-finding outcome table (fixed / not an issue + reason), final test counts, and the final public co-op API for the presentation layer.`, { label: 'coop:fix', phase: 'Fix', effort: 'high' })
  return { impl, reviews, fix }
}

const story = () => agent(`${COMMON}

YOU OWN: the STORY ENGINE (no UI yet). You are in an isolated git worktree of the repo (your current directory). First: \`git checkout -b wave1/story\`; then make node_modules available with \`ln -s ${ROOT}/node_modules node_modules\` (do not commit it; it is gitignored).
Inputs: the final, approved script ${PLAN}/story-script-v2.ts and its bible ${PLAN}/story-bible-v2.md (read both fully; the bible's "Where each content type appears" table is the spec).
Build:
1. src/story/script.ts: the script module (types + STORY data) copied from story-script-v2.ts, compiling under the repo's strict tsconfig.
2. src/story/director.ts: a PURE, deterministic-given-an-rng StoryDirector that the app will feed with simulation events (src/game/types.ts GameEvent union: kill, levelup, combo, milestone, perfect, hurt, heal, shieldbreak, elite, surge, boss, bossdead, newbest, revive, victory, pickup, ...) plus app-level signals (run start incl. daily/co-op, evolve/relic/cache picks, low HP threshold crossing, boss half HP crossing, idle time without kills, sector change index 0-3, overtime start, co-op down/revive). It outputs comms messages {id, speaker: CharacterDef, text, priority, duration} through a queue with: priority (boss/sector > rare events > common barks), throttling (at most one common bark every 4-6 s; never interrupt a higher priority line), no-repeat shuffle bags per trigger, pilot-bark mixing (~50% when the active captain has an entry), '@pilot'/'@ai'/'@villain' speaker resolution for the active ship (and per-player captains in co-op, e.g. the downed player's captain), boss intro/half/defeat sequences, sector arrival sequences, a gameOver quip picker that avoids the last N shown (persistable history), victory/overtime text accessors. Time is passed in (update(dt)); no Date.now/Math.random inside (inject an Rng from src/core/rng.ts).
3. src/story/logbook.ts: chapter unlock evaluation from SaveData (src/meta/save.ts; use existing stats/achievements/rank/daily/history; for unlock kinds that need data the save lacks today (e.g. 'coop', 'ship' unlock, survive-time), add the minimal new optional fields to SaveData + migrate defaults in a way that will merge cleanly with a parallel co-op save change: put story-specific state in ONE new optional field \`story?: { introSeen: boolean; logUnlocked: string[]; logSeen: string[]; quipHistory: string[] }\`), returning newly unlocked entries.
4. Unit tests tests/story.test.ts: every trigger produces valid lines, speaker resolution for all 5 ships, throttling/priority/no-repeat behaviour, boss and sector sequences, quip history, logbook unlocks for each unlock kind, script integrity (all ids resolve, length limits).
Do NOT touch src/app.ts, src/ui/*, src/render/*, src/game/* (except reading), package.json. tsc + all vitest tests green in your worktree. Commit on wave1/story. Final answer: API summary (exact exported names/signatures and how the app should call them), test counts, branch name and worktree path.`, { label: 'story:engine', phase: 'Build', isolation: 'worktree', effort: 'high' })

const steam = () => agent(`${COMMON}

YOU OWN: the STEAM-READY DESKTOP SHELL. You are in an isolated git worktree of the repo (your current directory). First: \`git checkout -b wave1/steam\`, then \`npm ci\` (or npm install) in the worktree.
Inputs: the verified spec ${PLAN}/steam.md (read it fully) and the working smoke project ${PLAN}/electron-smoke/.
Build:
1. desktop/main.cjs (Electron main: secure BrowserWindow with contextIsolation + sandbox, loads the built dist/index.html via a custom protocol or file URL that works with Vite's relative base, fullscreen by default with a windowed option, Steam overlay flags per spec, steamworks.js init with app id from steam_appid.txt / env with graceful no-Steam fallback, runCallbacks loop, single-instance lock, sane menu-less window, quit handling), desktop/preload.cjs (contextBridge exposing a minimal, validated \`shardstormDesktop\` API: platform info, isSteam, achievements activate/isActivated, rich presence set/clear, leaderboards ONLY if the verified API supports them, saveRead/saveWrite (JSON file in userData, atomic write) for Steam Auto-Cloud, quit, toggleFullscreen), desktop/steam.cjs wrapper.
2. src/platform/: platform.ts (interface + detection), web.ts (no-op / localStorage), desktop.ts (uses window.shardstormDesktop), achievements.ts (map our 21 achievement ids in src/meta/achievements.ts to Steam API names, e.g. ACH_FIRST_RUN, plus co-op ones 'squad' and 'medic' that a parallel co-op team will add), presence.ts helpers. PURE modules + unit tests (tests/platform.test.ts) with a fake bridge. Do NOT wire them into src/app.ts or src/meta/save.ts yet (integration wave) - but design the storage adapter so save.ts can adopt it with a one-line change.
3. package.json: add electron + electron-builder devDependencies, steamworks.js dependency (only the desktop main process requires it; make sure Vite's web bundle never imports it), scripts desktop:dev (build + electron), desktop:pack (unpacked dirs), desktop:dist; electron-builder config (electron-builder.yml) producing unpacked win/mac/linux outputs for SteamPipe, asar on, no auto-updater, steamworks native binaries unpacked from asar.
4. steam/: app_build.vdf + depot_build_{windows,macos,linux}.vdf templates with placeholder ids, steam_appid.txt (480 for development; documented), achievements.json (name, API name, display name, description, hidden flag) generated from our achievement table, a README section.
5. docs/STEAM.md: step-by-step release guide (what the owner must do: Steamworks account and app fee, app id, store page, capsule art sizes, configuring achievements in the Steamworks UI, Auto-Cloud path, Remote Play Together + controller support settings, Steam Deck checklist, building and uploading with SteamPipe / CI, release review).
6. .github/workflows/desktop.yml: matrix build (ubuntu, windows, macos) uploading unpacked builds as artifacts; an optional manual steam-deploy job (workflow_dispatch) using game-ci/steam-deploy with secrets, documented and disabled by default.
7. A smoke test you actually RUN here: build the web app, launch the Electron app under xvfb-run with Playwright's _electron API (or a node script) and verify the window loads the game title screen, starts a run, writes a save file through the bridge, and that the no-Steam fallback logs cleanly. Put it in scripts/desktop-smoke.mjs and add an npm script.
tsc + all vitest tests green in your worktree. Commit on wave1/steam. Final answer: what works (with evidence from the smoke run), what could not be verified without a real Steam client, file list, branch name and worktree path.`, { label: 'steam:shell', phase: 'Build', isolation: 'worktree', effort: 'high' })

phase('Build')
const [coop, storyRes, steamRes] = await parallel([coopCore, story, steam])
return { coop, story: storyRes, steam: steamRes }
