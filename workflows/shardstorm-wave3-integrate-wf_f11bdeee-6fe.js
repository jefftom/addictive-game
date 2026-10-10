export const meta = {
  name: 'shardstorm-wave3-integrate',
  description: 'Integrate galaxy, entity art, post-FX, warp grid, co-op rendering (sequential chain) and platform wiring (parallel) into worktree branches',
  phases: [
    { title: 'Graphics chain', detail: 'galaxy -> entities -> post-FX -> grid -> co-op render, one worktree, sequential commits' },
    { title: 'Platform', detail: 'initPlatform, storage, achievements, presence, desktop quit/fullscreen, bundled fonts' },
  ],
}

const ROOT = '/home/user/addictive-game'
const SP = '/tmp/claude-0/-home-user-addictive-game/1abae5b2-c201-57a9-8979-0317e8f22528/scratchpad'
const PLAN = SP + '/plan'
const OUT = SP + '/w3'
const GWT = ROOT + '/.claude/worktrees/w3-gfx'
const PWT = ROOT + '/.claude/worktrees/w3-platform'

const RESULT = {
  type: 'object',
  properties: {
    head_commit: { type: 'string', description: 'git rev-parse --short HEAD of your branch after your last commit' },
    summary: { type: 'string', description: 'What you integrated and how, for the next agent and the lead (concise but complete; include API names others must use)' },
    tsc: { type: 'boolean' },
    vitest: { type: 'string', description: 'e.g. "301/301 passed"' },
    e2e: { type: 'string', description: 'e.g. "30 passed, 8 skipped" or failures' },
    build_single: { type: 'boolean' },
    golden_unchanged: { type: 'boolean', description: 'tests/golden.solo.test.ts passes and was not modified' },
    deviations: { type: 'array', items: { type: 'string' }, description: 'Where you deviated from the brief/design and why' },
    followups: { type: 'array', items: { type: 'string' }, description: 'Known issues, risks, or work left for later agents' },
    shots: { type: 'array', items: { type: 'string' }, description: 'Absolute paths of the most informative screenshots' },
  },
  required: ['head_commit', 'summary', 'tsc', 'vitest', 'e2e', 'build_single', 'golden_unchanged', 'deviations', 'followups', 'shots'],
}

const brief = (wt, branch, port, shots) => `PROJECT: SHARDSTORM, a finished neon arena-survival roguelite (TypeScript + Vite, no runtime deps, Canvas 2D). Theme: the player captains an ORIGINAL starship of the Allied Beacon Fleet against an invading crystalline alien armada (the Shardstorm). 100% original: no names, logos, catchphrases or recognisable silhouettes from any franchise.

WHERE YOU WORK: the main checkout ${ROOT} (branch claude/dazzling-faraday-2kxdhl) is OFF LIMITS: do not edit files there, do not run git commands that change it (no checkout/commit/merge/reset/stash there). You work ONLY in the git worktree ${wt} (branch ${branch}); it exists, has node_modules symlinked to the main checkout's, and is on the right commit. cd there first and use absolute paths. First run git -C ${wt} status and git -C ${wt} log --oneline -5: if a previous agent left uncommitted changes, inspect them and either finish+commit them or discard what is broken. Do not push. Commit your work on ${branch} (one or more focused commits). Every commit message must end with exactly these two lines (after a blank line):
Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ufw2FXiEUyE3RQq4NbkUr6
Never put AI model names or identifiers in commit messages, code or comments.

CODEBASE MAP: src/game/ = deterministic fixed-step 60 Hz sim (World in world.ts; world.events is consumed each frame by the renderer, audio and story); src/render/ = renderer.ts (camera camX/camY, draw order, consume(events)), sprites.ts (SpriteCache, shadowBlur glow sprites), particles.ts, effects.ts, background.ts, hud.ts, palette.ts; src/app.ts = app state machine + loop; src/ui/ = DOM screens (ui.ts incl. showSettings, comms.ts, lobby.ts, crawl.ts, style.css); src/meta/ = save (Settings), progression, achievements; src/story/ = story director + runlink; src/platform/ = web/desktop platform layer; desktop/ = Electron shell; docs/GAME_DESIGN.md. Local co-op (1-4 players) exists: world.players[] (PlayerState), world.coop, world.zoom (sim-owned co-op zoom-out, 1 in solo), world.teamCenter(), view half extents; P1 aliases world.player/stats/build/rerolls/pendingCaches (tests/no-p1-alias.test.ts forbids new uses outside its PENDING_MIGRATION list, which currently holds renderer.ts and hud.ts). Content: src/game/content/coop.ts (PLAYER_COLORS, PLAYER_MARKS, COOP_SCALING), ships.ts, enemies.ts. Design docs in ${PLAN}: coop.md, galaxy.md, steam.md, story-bible-v2.md.

HARD RULES:
- The simulation must stay bit-identical. tests/golden.solo.test.ts (golden master) must pass UNCHANGED; never edit or regenerate it. Render-side code may read sim state but must not mutate it or draw from the sim RNG streams (rng, spawnRng, lootRng, posRng). Adding purely informational fields to events is OK only if the golden still passes.
- Strict TypeScript: npx tsc --noEmit must be clean (noUnusedLocals etc.).
- Before EVERY commit: npx tsc --noEmit and npx vitest run --maxWorkers=2 (all pass). Before your FINAL commit also: npm run build:single (must succeed; the single-file build inlines everything) and the e2e suite: E2E_PORT=${port} PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npx playwright test (desktop + mobile projects). Fix what you break. If an e2e/unit test asserts something your change legitimately alters, update the test to the new truth; never skip, disable or loosen a test to get green.
- Respect accessibility settings for anything new: reduced flashing (renderer.settings.flashes or the save Settings field it maps to) and screen shake (0 = none). Keep mobile (touch, small screens, e.g. Pixel 7) working.
- Debug URL params: ?autoplay (bot plays), ?warp=N (fast-forward N sim seconds), ?coop=N (N-pilot co-op with bots), ?bots. window.shardstorm is the App (app.world, app.renderer, ...). Screenshots: build with npx vite build --outDir ${shots}/dist, serve with npx vite preview --outDir ${shots}/dist --port ${port + 100} --strictPort (run it in the background), drive with Playwright: import { chromium } from '${ROOT}/node_modules/playwright/index.mjs', env PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers. Headless WebGL is software (SwiftShader): GPU/raster timings are pessimistic; report JS-side timings. LOOK at your screenshots with the Read tool and iterate until they genuinely look right. Save screenshots and notes under ${shots}/ (never in the repo).
- Shared machine: other agents run in parallel. Use only your ports (${port}, ${port + 100}); kill only processes you started, by exact pattern (e.g. pkill -f '[v]ite preview --outDir ${shots}'); vitest with --maxWorkers=2.
- Keep the code idiomatic to the repo (comment density, naming). Update docs/GAME_DESIGN.md briefly where your feature changes the design.

RETURN: the structured result. Be honest about anything that does not work.`

const gBrief = (port, shots) => brief(GWT, 'wave3/gfx', port, shots)

const GALAXY = (prev) => `${gBrief(4411, OUT + '/galaxy')}

YOUR TASK (step 1 of 5 in the graphics chain): integrate the procedural GALAXY SECTOR BACKDROPS.
Inputs: ${PLAN}/galaxy.md (final design v2; read it fully), ${PLAN}/galaxy/galaxy.ts (copy to src/render/galaxy.ts), ${PLAN}/galaxy/worker.ts and ${PLAN}/galaxy/integration/galaxy.worker.ts, ${PLAN}/galaxy/integration/*.patch (reference diffs against an OLDER base; they will not apply cleanly; port by hand), ${PLAN}/galaxy/game/ (a working patched copy of the game for reference), ${PLAN}/galaxy/tools/ (harness incl. colourCheck / camoMap, game.mjs readability capture), ${PLAN}/galaxy/shots/.
Owner decisions that OVERRIDE the design doc:
1. Sector timing: the sim already tracks world.sector (0-3) and emits { t: 'sector', index } (World.updateSector in src/game/world.ts). Use exactly that. Do NOT port the sim parts of world.patch / director.patch / types.patch (no spawn calm, no bullet clear, no new sim timing): the warp is purely visual and the golden master must pass unchanged. If you want the warp to anticipate a boss entrance, do it render-side from world.time and BOSS_SCHEDULE without touching sim state.
2. Colour: in review the nebula read too grey and washed out. Push each sector's colour identity noticeably (rich, distinct hues per sector, e.g. sector 1 deep teal/slate-blue, 2 ember/crimson, 3 indigo/violet, 4 bronze/gold; your call) while keeping (a) the OKLab camouflage check passing for all gameplay colours in the central play box and (b) the luminance budget: the backdrop stays darker than every gameplay sprite. Make before/after comparison shots.
3. Bundle the worker inline (Vite: import X from './galaxy.worker?worker&inline' or equivalent) so npm run build:single still yields one self-contained HTML that works from file://. Keep the chunked main-thread fallback (no Worker or worker error).
4. Wire galaxy warp events (warp-spool / warp-tunnel / warp-punch / warp-done): an audio riser + boom (src/audio; add small procedural synth sounds if none fit; respect the volume settings) and a brief sector title card in the renderer's callout style (sector names: use any defined in src/story/script.ts; otherwise invent short original ones). Check src/story/runlink.ts / director: if story comms already react to 'sector' events, don't duplicate them.
5. The title screen attract-mode background shows the sector-1 galaxy (generation starts at boot, off-thread).
6. If the design's animate flag (reduced motion) exists, tie it to an existing setting (reduced flashing) rather than adding UI.
7. Co-op zoom: in co-op the camera may zoom out (world.zoom up to ZOOM_MAX); the backdrop must still fill the screen with correct parallax at any zoom.
Verify visually: real gameplay in all four sectors (?autoplay&warp=N; you may force sectors via window.shardstorm for screenshots), a warp mid-transition (each phase), the title screen, a Pixel 7 viewport, a 300-enemy fight (readability), and ?coop=4 zoomed out. Measure backdrop JS cost per frame at 1080p vs the old background.
${prev}`

const ENTITIES = (prev) => `${gBrief(4412, OUT + '/entities')}

YOUR TASK (step 2 of 5): integrate the new STARSHIP and CRYSTALLINE-ALIEN ENTITY ART.
Inputs: ${PLAN}/gfx/entities/NOTES.md (the integration guide; section 4.6 lists the renderer changes), ${PLAN}/gfx/entities/src/{vessels,shardfx,entityfx}.ts (copy to src/render/), ${PLAN}/gfx/entities/integration.patch (made against commit ab1d37d; your base is newer: co-op flow, story UI and now the galaxy were added. That patch REVERTS some co-op world code: never revert co-op code; port by hand only what is needed), ${PLAN}/gfx/entities/shots/final2-*.png (the target look; Read a few).
Rules:
- The patch adds fields to sim events (kill etc.) for shatter direction/size: allowed only if purely informational and the golden passes unchanged.
- The runaway gunship/boss charge glow (timer below zero) must be clamped render-side; do not change sim timer semantics unless the golden still passes unchanged.
- Co-op: every pilot in world.players uses the new vessel art for their ship class; in co-op, the pilot's PLAYER_COLORS accent goes on canopy/stripe/engines (shared dark hull + white-cyan outline keeps the fleet look); solo looks exactly as designed. Structure the API so step 5 (co-op rendering: name tags, ghost ships for downed pilots, marks) can call it cleanly, e.g. drawVessel(ctx, shipId, x, y, angle, opts: { accent?, alpha?, ghost? }).
- Post-FX is step 3: expose the hooks NOTES.md lists (setGlowScale for vessel/shape sprites, a postFx flag that drops the lightning glow, setCostTier for shard detail) with defaults matching today's 2D look, so step 3 only needs to call them.
- Ship class mapping: spark light frigate/scout, vanguard heavy cruiser, tempest interceptor, bastion shield dreadnought, phantom stealth raider. Enemies: drifter drone, swarmling dart swarm, dasher lancer, splitter budding cell-ship, shooter gunship, brute bulwark; bosses warden gate fortress, hydra hunter-cruiser, voidheart hive mothership.
- Menus: wherever the UI shows a ship icon/preview (hangar, title, lobby slot cards, results; see src/ui/ui.ts and src/ui/lobby.ts, they may use SpriteCache), use the new vessel art so the menus match the game.
Verify: screenshots of all five player vessels in game, each enemy kind, all three bosses including telegraphs (Hydra charge lane, Warden volley), a kill storm with shatter deaths, reduced flashing, hangar + lobby screens, ?coop=4 with four tinted ships. Renderer JS time at ~400 enemies (target: at most ~+1 ms vs before your change).
${prev}`

const POSTFX = (prev) => `${gBrief(4413, OUT + '/postfx')}

YOUR TASK (step 3 of 5): integrate the WebGL2 POST-FX pipeline.
Inputs: ${PLAN}/gfx/postfx/NOTES.md (integration guide), ${PLAN}/gfx/postfx/postfx.ts (copy to src/render/postfx.ts), ${PLAN}/gfx/postfx/integration.patch (against 687bc97; port by hand: co-op, story UI, galaxy and entity art have landed since), ${PLAN}/gfx/postfx/combined.patch and combined/ (an all-four-layer reference on an older base), ${PLAN}/gfx/postfx/shots/*-compare.png (target look).
Design (from the reviewed, revised prototype; follow it):
- A WebGL canvas #fx sits UNDER #game. #game stays the visible top canvas and the input target (src/core/input.ts unchanged). The world (galaxy backdrop + entities + particles) is drawn to an offscreen world canvas, uploaded, post-processed, output to #fx. HUD, callouts and damage numbers are drawn on #game after post-FX (crisp, never bloomed or warped). All canvases share the device-pixel size. When post-FX is off/unavailable, everything draws to #game exactly as before (2D path must stay pixel-correct).
- Bloom keyed to near-white (blend of max and min channel, threshold ~0.6) so saturated crystal facets don't blob; lens streaks only during bloom surges; shockwave budget (boss death/kill, bomb, player death always; others max 3/s; explosions radius >= 60); chromatic aberration only as brief spikes (0 with reduced flashing); the low-HP edge tints only the dark background; no CRT mode.
- Sprite glow scale 0.15 for shape sprites AND vessel art (use the hooks step 2 exposed: setGlowScale, postFx flag, setCostTier) while post-FX is active; back to 1.0 whenever it is off (setting, context loss, auto-off).
- Auto-quality ladder q3 -> q0 -> q0 at 0.75 render scale -> off: steps down after sustained slow frames, back up with hysteresis and a cap on oscillation; exposes renderer.costTier (entity shard detail follows it; the grid in step 4 will too).
- Fallback: no WebGL2 -> never activates; webglcontextlost -> plain 2D; webglcontextrestored -> back on.
- Settings: add postfx (default true) to Settings in src/meta/save.ts with defaulting for old saves, plus an 'Enhanced graphics' toggle in the settings screen (src/ui/ui.ts). Keep the settings layout tidy on mobile.
- Shockwaves are world-anchored: use the renderer's camera transform INCLUDING co-op zoom (world.zoom) and shake.
- Title-screen attract mode renders through post-FX too.
- e2e: e2e/smoke.spec.ts's 'canvas draws' pixel-variety check must probe the world image (the renderer's world canvas or #fx) when post-FX is on; update it so it stays meaningful.
- Galaxy (step 1) draws into the world canvas; its warp punch flash and the post-FX flash must not stack into a white-out (cap combined).
Verify: before/after screenshots (title, early game, Warden fight, a boss death live, Bastion nova, low HP, 400-enemy kill storm, reduced flashing, a forced context loss via WEBGL_lose_context and its restore, ?coop=4 zoomed out), the 2D fallback (postfx off) still correct; post-FX JS cost per frame and the auto-quality ladder behaviour in headless (it will step down there; report it).
${prev}`

const GRID = (prev) => `${gBrief(4414, OUT + '/grid')}

YOUR TASK (step 4 of 5): integrate the WARPGRID spring-mesh background grid.
Inputs: ${PLAN}/gfx/grid/NOTES.md (integration guide: API, exact renderer.ts integration points, settings, fallbacks, review checklist), ${PLAN}/gfx/grid/grid.ts and gridfx.ts (copy to src/render/), ${PLAN}/gfx/grid/integration.patch (against 687bc97; port by hand), ${PLAN}/gfx/grid/combo-head/ (all four layers composed on 687bc97: reference for how the grid composes with galaxy, entities and post-FX), ${PLAN}/gfx/grid/shots/.
Design (follow NOTES.md): replaces background.ts's static beat-pulsing grid; event-to-force mapping in gridfx.ts (kills/explosions with a ripple budget, boss-death fronts that advance on real time during hitstop/slow-mo and freeze only on pause/level-up, singularity and void-heart wells, dash wake, nova ring fronts, brute/boss dents); readability dimming in busy fights; reduced flashing removes the two brightest levels and the beat pulse; new 'Grid motion' slider (0 = static grid) in Settings (save.ts with defaulting for old saves) and in the settings screen; hairlines only when post-FX is on; grid quality follows the post-FX auto-quality (renderer.costTier); the galaxy warp's gridAlpha fades the grid; grid colour stays cool and desaturated in every sector.
Co-op: the camera zooms out (world.zoom up to ZOOM_MAX; see ${PLAN}/coop.md sections 5.4 and 5.5 'Grid coverage'). The mesh must cover the visible world at any zoom without blowing the budget (cap the point count; coarser spacing when zoomed out is fine; avoid popping when zoom changes).
Sim untouched.
Verify: screenshots of a kill ripple, a boss-death front, the singularity funnel, the Void Heart well, a dash wake, nova rings, a 400-enemy storm, reduced flashing, grid motion 0, the postfx-off 2D path, and ?coop=4 zoomed out; grid JS per frame at 1080p (target about 1 ms or less).
${prev}`

const COOPR = (prev) => `${gBrief(4415, OUT + '/coop-render')}

YOUR TASK (step 5 of 5): CO-OP RENDERING pass + COMMS PANEL FADE.
Inputs: ${PLAN}/coop.md: section 3 entries 'src/render/renderer.ts', 'src/render/hud.ts', 'src/render/background.ts', 'src/app.ts' (coopToasts), section 4 'Consumer API', 5.4 'Renderer camera', 5.5 'Grid coverage'; src/game/content/coop.ts (PLAYER_COLORS, PLAYER_MARKS); tests/no-p1-alias.test.ts; the vessel art API from step 2 (src/render/vessels.ts etc.).
Do:
1. Camera: a zoom-aware camera that follows world.teamCenter() and applies world.zoom per coop.md 5.4 (smooth, no jitter); solo behaviour unchanged (zoom 1, follows the player). Expose renderer.worldToScreen(x, y) (CSS px) and use one transform consistently in every layer (galaxy parallax, grid, post-FX shockwave anchors, particles, float text, callouts, telegraphs, offscreen culling). Check each at zoom < 1.
2. Pilots: each pilot drawn with the vessel art in their PLAYER_COLORS accent and identified by PLAYER_MARKS (mark/shape, not only colour, for colour-blind players); a small P1..P4 + mark name tag; downed pilots as a ghost ship with a revive-progress ring and a clear 'fly here to revive' cue; edge indicators (arrow + mark) for pilots outside the view if that can happen; a last-stand cue for the final standing pilot.
3. HUD (src/render/hud.ts): co-op HUD per coop.md (per-pilot HP/shield/dash panels in their colours with marks and downed state; shared XP/level/score/timer/combo). Must fit 1280x720, 1920x1080 and narrow/mobile; the SOLO HUD must look exactly as today.
4. Replace App.coopToasts (DOM toasts for downed/revived/last stand and similar) with in-world callouts and HUD cues; keep a DOM toast only where text is clearly better (e.g. a controller disconnect handled elsewhere).
5. Migrate renderer.ts and hud.ts off the P1 aliases (world.player/stats/build/rerolls/pendingCaches -> world.players[pid]) and remove both from PENDING_MIGRATION in tests/no-p1-alias.test.ts (the test then enforces it).
6. Comms panel fade (src/ui/comms.ts): while any enemy, enemy bullet, boss or player ship is under the comms panel's screen rect, fade the panel to about 25-35% opacity with a short CSS transition; restore when clear. Never hide it fully. Cache the panel rect (refresh on resize/show), test with renderer.worldToScreen a few times per second rather than every frame if it costs anything measurable. Works in solo and co-op, on mobile too.
Verify with screenshots: ?coop=2 and ?coop=4 (bots/autoplay) incl. a spread-out zoomed-out team, a downed pilot being revived, last stand, the co-op HUD at 1280x720, 1920x1080 and a Pixel 7 viewport, the solo HUD unchanged (compare against a build of the chain's base commit 3d3e601 if needed), and the comms panel fading over enemies. e2e/coop.spec.ts must pass. Run the full checks before the final commit.
${prev}`

const PLATFORM = `${brief(PWT, 'wave3/platform', 4431, OUT + '/platform')}

YOUR TASK: PLATFORM WIRING for the web and Steam desktop builds, plus BUNDLED FONTS. (A separate chain is changing rendering in another worktree; avoid touching src/render/*.)
Inputs: ${PLAN}/steam.md (verified Steam/Electron spec: sections 2.4 preload bridge, 2.5 rich presence mapping, 2.6 saves and Auto-Cloud, 2.7 window settings, 5 Steam Deck checklist, 11 open risks), docs/STEAM.md, src/platform/{platform,web,desktop,storage,achievements,presence}.ts (already written, NOT yet wired into the game), desktop/main.cjs, desktop/preload.cjs (window.shardstormDesktop), tests/platform.test.ts, tests/desktop.test.ts, scripts/desktop-smoke.mjs.
Do:
1. main.ts: initPlatform() at boot (web vs desktop chosen by the platform layer) before the App is created; pass the platform into App (or a small module singleton) without breaking tests or the e2e harness (window.shardstorm).
2. Saves: route src/meta/save.ts load/write through the platform storage adapter (web: localStorage as today, same key 'shardstorm.save' so existing saves and e2e seeding keep working; desktop: the bridge's file storage for Steam Auto-Cloud per steam.md 2.6, with a one-time migration from localStorage if the desktop finds an old save there). Keep writes synchronous-looking for the game (async bridge calls must not lose data on quit: flush on beforeunload / the bridge's quit path).
3. Achievements: when the game unlocks an achievement (checkAchievements in src/meta/achievements.ts, called from app.ts), report it to the platform (Steam via src/platform/achievements.ts id map; failures queued and retried, as already designed). On desktop startup, re-sync already-unlocked achievements once (idempotent).
4. Rich presence: update on state changes per steam.md 2.5 (title, hangar, solo run with sector/time, co-op run with pilot count, boss fight, victory/overtime), throttled; no-op on web.
5. Desktop-only UI: a 'Quit to desktop' button on the title screen and a Fullscreen toggle in Settings (persisted; applies via the bridge; F11 also toggles), hidden on web. Steam Deck: make sure the game starts fullscreen there if steam.md says so.
6. Bundled fonts: self-host Chakra Petch (400-700), Kode Mono (400-700) and Tektur (500-900), latin subset, woff2, instead of the Google Fonts <link> in index.html (privacy, offline desktop, no third-party request). Get the files from the npm registry (@fontsource packages, as devDependencies or vendored under src/assets/fonts; licence OFL: include the licence text), declare @font-face in src/ui/style.css with font-display: swap, keep the same family names so CSS doesn't change. Make sure npm run build and build:single include them (single file may inline them as data URIs: keep the HTML size reasonable, report it). Remove the Google Fonts preconnects and any CSP allowances for fonts.googleapis/gstatic in desktop/main.cjs if no longer needed. Update the comment in playwright.config.ts if it mentions Google Fonts.
7. Electron smoke: the Electron binary may be missing from node_modules: try node ${ROOT}/node_modules/electron/install.js (needs network; it is fine if it fails, then report it). If available, run the desktop smoke under xvfb (npm run desktop:smoke; see scripts/desktop-smoke.mjs and steam.md section 10) and fix what breaks. Steam itself is not available here: the game must run fine without it (graceful fallback).
8. Unit tests for the new wiring (storage routing + migration, achievement reporting/queueing, presence mapping/throttle) in the existing test style.
9. Update docs/STEAM.md and README if behaviour changed.
Verify: web build unchanged for players (fonts look identical: screenshot the title, settings and a run before/after), desktop smoke (if Electron could be installed), all checks green.`

phase('Graphics chain')
const chain = async () => {
  const out = {}
  let prev = ''
  const steps = [
    ['galaxy', GALAXY],
    ['entities', ENTITIES],
    ['postfx', POSTFX],
    ['grid', GRID],
    ['coopRender', COOPR],
  ]
  for (const [key, make] of steps) {
    const r = await agent(make(prev), { label: 'gfx:' + key, phase: 'Graphics chain', schema: RESULT })
    out[key] = r
    log(key + (r ? ' done at ' + r.head_commit + ' (vitest ' + r.vitest + ', e2e ' + r.e2e + ')' : ' FAILED (no result)'))
    prev = r
      ? 'NOTES FROM THE PREVIOUS STEP (' + key + ', committed at ' + r.head_commit + '): ' + r.summary +
        (r.deviations.length ? '\nIts deviations: ' + r.deviations.join(' | ') : '') +
        (r.followups.length ? '\nIts follow-ups (handle those in your area): ' + r.followups.join(' | ') : '')
      : 'NOTE: the previous step (' + key + ') did not return a result; check git log and the worktree state carefully before you start.'
  }
  return out
}
const [gfx, platform] = await parallel([
  chain,
  () => agent(PLATFORM, { label: 'platform', phase: 'Platform', schema: RESULT }),
])
return { gfx, platform }
