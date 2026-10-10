export const meta = {
  name: 'shardstorm-wave2a',
  description: 'Build co-op flow (input/lobby/level-ups/meta) and story UI + starship re-theme in parallel worktrees, each reviewed and fixed',
  phases: [
    { title: 'Build', detail: 'co-op flow and story UI in separate worktrees' },
    { title: 'Review', detail: 'correctness + UX reviewers per track' },
    { title: 'Fix', detail: 'apply confirmed findings per track' },
  ],
}

const ROOT = '/home/user/addictive-game'
const PLAN = '/tmp/claude-0/-home-user-addictive-game/1abae5b2-c201-57a9-8979-0317e8f22528/scratchpad/plan'
const TRAILER = `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01Ufw2FXiEUyE3RQq4NbkUr6`

const COMMON = `PROJECT: SHARDSTORM (TypeScript + Vite neon arena-survival roguelite), main repo ${ROOT} on branch claude/dazzling-faraday-2kxdhl (HEAD 687bc97). You work in an ISOLATED git worktree (your current directory). FIRST: \`git checkout -b BRANCH\` (name given below) and \`ln -s ${ROOT}/node_modules node_modules\` (gitignored; do not commit). Read docs/GAME_DESIGN.md.
Current state: the simulation supports 1-4 players (world.players, PlayerState, PickRequest level rounds, downed/revived/laststand events, world.sector + 'sector' events) - see ${PLAN}/coop.md and the code in src/game/. A story engine exists in src/story/ (script.ts STORY data, director.ts StoryDirector, logbook.ts) but nothing calls it yet. A Steam desktop shell exists (desktop/, src/platform/) but is not wired in yet (another wave does that). The game is being re-themed: the player captains a STARSHIP of the Allied Beacon Fleet vs the Resplendent Lattice crystal armada ("the Shardstorm"); see ${PLAN}/story-bible-v2.md. In parallel, ANOTHER team is rewriting src/render/* (galaxy backdrops, WebGL post-FX, warping grid, new starship/alien sprites), and later wave 3 adds co-op RENDERING (zoomed camera, ghost ships, co-op HUD) - so do NOT edit src/render/*, src/audio/*, desktop/, src/platform/.
Checks before every commit: \`npx tsc --noEmit\`, \`npx vitest run\` (234 tests at start), and the e2e suite: \`npm run build && PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npx playwright test --project=desktop\` plus \`--project=mobile\` (if port 4173 is busy, run with a different port by temporarily overriding the webServer via an env-aware playwright config change - keep the committed config working). All must pass; update existing e2e tests only where your feature legitimately changes the flow (explain in the commit).
Look at your UI with Playwright screenshots (desktop 1280x720 and phone 390x844) and iterate until it looks polished and matches the existing design language (chamfered panels, Tektur/Chakra Petch/Kode Mono fonts, ice-cyan accents, gold for rewards; see src/ui/style.css).
Commit messages end with exactly:
${TRAILER}`

const TRACKS = {
  coop: {
    branch: 'wave2/coop-flow',
    prompt: `YOUR TRACK (branch wave2/coop-flow): the CO-OP FLOW (everything except rendering). Implement ${PLAN}/coop.md sections 6 (input devices + lobby), 8 (level-up UX), 9 (meta/save) and the app/ui parts of section 3 (src/core/bindings.ts, src/core/input.ts, src/ui/lobby.ts, src/ui/ui.ts, src/ui/style.css, src/app.ts, src/meta/*, src/main.ts if needed):
- Input: device slots (kbA = WASD + Space/LeftShift; kbB = arrows + RightShift/Numpad0, Enter = kbB confirm; RightCtrl only when an \`allowCtrlDash\` flag is set (desktop build); gamepads 0-3 by index; touch solo-only). Solo: every device merges into P1 exactly as today (all existing e2e must still pass). Prevent browser shortcuts on game keys during co-op.
- Title gets a CO-OP button (desktop/gamepad; hidden on touch-only). Lobby screen: press-to-join per device, per-slot ship select limited to unlocked ships, per-slot colour/number, ready-up, start with 2-4 players, leave/back; gamepad + keyboard navigable; clear on-screen device hints.
- App: start a co-op run (makeRunConfig players), feed world.update an inputs array in slot order, drive level rounds with world.beginPick()/applyOffer(w, o, pid)/generateOffers(w, 3, cache, pid) with per-pilot rerolls, show whose pick it is (player number + colour + their ship), accept picks from that pilot's device (plus mouse/touch), keep the anti-mash grace; co-op pause/victory/results (team score, per-pilot summary rows). Downed/revived: minimal toasts for now (rendering comes later). Remove src/app.ts, src/ui/ui.ts, src/meta/result.ts from the no-p1-alias pending list by migrating them (renderer/hud stay pending for wave 3).
- Meta: save v2 per coop.md 9 (co-op runs/best, migrate from v1, keep the existing optional \`story\` field intact), progression for co-op results (team result; cores to the shared profile), achievements 'squad' and 'medic' (ids must match src/platform/achievements.ts names ACH_SQUAD/ACH_MEDIC), mission counting rules, Records shows co-op best; Daily stays solo-only.
- Tests: tests/lobby.test.ts, tests/bindings.test.ts, meta tests for v2 migration and co-op results; e2e/coop.spec.ts (desktop project only): two keyboard players join (kbA and kbB), pick ships, start, both pilots move independently, a forced level-up round makes both pick, pause/resume works, ending the run shows co-op results and saves coop stats.
Final answer: what you built, deviations from coop.md, test counts (unit + e2e), screenshots paths, branch name and worktree path, and anything wave 3 (co-op rendering) must know.`,
  },
  story: {
    branch: 'wave2/story-ui',
    prompt: `YOUR TRACK (branch wave2/story-ui): STORY UI + STARSHIP RE-THEME (src/ui/*, src/app.ts, src/main.ts, index.html, src/game/content/ships.ts + enemies.ts display strings only, src/story/* if needed, src/meta/save.ts story fields only, docs).
Use the story engine API in src/story/ (read director.ts/logbook.ts and the "Where each content type appears" table in ${PLAN}/story-bible-v2.md):
- COMMS PANEL: a non-blocking in-run comms display for CommsMessage (portrait glyph in the character's colour, name + role, text with a quick typewriter reveal, priority styling: story lines stand out, common barks are subtle), never covering the player's ship or the HUD's HP/timer/score/combo areas (the HUD is drawn on canvas: top-left HP/dash/build, top-centre timer/boss bar, top-right score/combo; touch has a joystick bottom-left and DASH button bottom-right). Must work at phone width. Respect prefers-reduced-motion. Setting "Crew chatter": All / Important only / Off (persisted).
- App wiring: one StoryDirector per session (cosmetic Rng stream), startRun({ships, daily, coop}), onEvents(world.events) each simulated frame (pass pid where relevant; the sim's player-scoped events carry pid), update(dt), signals: evolve/relic/cache picks, lowHp threshold crossing per pilot, bossHalf crossing, sector from the sim's 'sector' events, overtime when the player continues after victory, idle, co-op down/revive from the sim's downed/revived events; endRun on game over. Comms keep working in co-op (pilot captains resolved per pid).
- OPENING CRAWL: shown on first launch (story.introSeen), skippable with any key/tap after a moment, replayable from the Ship's Log. Make it a proper cinematic moment (slow scroll or paced reveal over the attract-mode game, title, cheesy fleet briefing tone) that respects reduced motion.
- SHIP'S LOG screen (title menu): logbook chapters with unlock hints/progress, unread badges, the intro replay, the cast (characters with roles), vessel classes. Check unlocks after every run (checkLogbook) and announce new chapters on the results screen.
- RESULTS: a game-over quip (pickGameOverQuip with persisted history) or the boss victory taunt when a boss killed you; VICTORY modal uses the victory text; Overtime lines when continuing.
- RE-THEME COPY: title eyebrow/tagline/logo copy for the starship premise (keep the SHARDSTORM logo); Hangar shows each vessel's class, ship name, captain and blurb (STORY.vessels/characters) while keeping weapons/traits/unlock info; tutorial/tips/achievement texts/README/docs/GAME_DESIGN.md pitch updated to the starship-vs-crystal-armada premise (keep gameplay facts accurate; keep code ids unchanged). No franchise terms (run ${PLAN}/tools-v2/check-story-final.mjs if you edit story text).
- Existing e2e tests start from a fresh save, so the opening crawl would block them: keep them passing (e.g. a test helper that seeds introSeen or skips the crawl) and add e2e/story.spec.ts: the crawl appears on first launch and can be skipped, the Ship's Log opens and lists chapters, a comms line appears early in a run, the chatter setting persists.
Final answer: what you built, test counts (unit + e2e), screenshot paths, branch name and worktree path, and integration notes for the rendering wave (e.g. where comms sit relative to the canvas HUD).`,
  },
}

const runTrack = async (key) => {
  const t = TRACKS[key]
  const impl = await agent(`${COMMON.replace('BRANCH', t.branch)}

${t.prompt}`, { label: `${key}:build`, phase: 'Build', isolation: 'worktree', effort: 'high' })

  const lenses = [
    ['correctness', 'Find real bugs: state-machine holes (stuck screens, double-starts, input routed to the wrong pilot or screen, keys that both act in-game and in a menu), save/migration mistakes, solo regressions (solo must behave exactly as before apart from the intended UI changes), missing cleanup between runs, event handling errors. Verify each with a concrete repro (unit test or Playwright script) before reporting.'],
    ['ux-visual', 'Play it in a real browser (Playwright, desktop 1280x720 and phone 390x844; also a 1920x1080 check): take screenshots of every new screen and in-run state, read them, and judge clarity, polish, readability over gameplay, consistency with the existing design language, copy quality (concise, plain words, no jargon), keyboard/gamepad/touch reachability, focus states and reduced-motion behaviour. Report concrete, actionable issues with screenshot paths.'],
  ]
  const reviews = await parallel(lenses.map(([n, focus]) => () => agent(`${COMMON.replace('BRANCH', 'review-' + key + '-' + n)}

You are an independent reviewer (lens: ${n}) of track "${key}". Do NOT create a branch or commit; instead inspect the implementer's branch: \`git log --oneline -5 ${t.branch}\` and check it out in YOUR worktree read-only (\`git checkout --detach ${t.branch}\`), with node_modules symlinked as above. Implementer's report:
${impl}

${focus}
Do not commit anything. Return a numbered list of CONFIRMED issues ranked by severity (file:line or screen, scenario, suggested fix), then "checked and fine". Return "NO ISSUES" if none.`, { label: `${key}:review:${n}`, phase: 'Review', isolation: 'worktree', effort: 'high' })))

  const fix = await agent(`${COMMON.replace('BRANCH', t.branch)}

NOTE: the branch ${t.branch} already exists with the implementation: run \`git checkout ${t.branch}\` instead of creating it (and symlink node_modules).
You are finishing track "${key}". Implementation report:
${impl}

Reviewer findings:
${lenses.map(([n], i) => `=== ${n} ===\n${reviews[i] ?? '(reviewer failed)'}`).join('\n\n')}

Re-verify each finding; fix real ones (with regression tests where sensible), explain any you reject. Run all checks (tsc, vitest, e2e desktop+mobile). Commit on ${t.branch}. Final answer: per-finding outcome table, final test counts, branch name, final commit hash, worktree path.`, { label: `${key}:fix`, phase: 'Fix', isolation: 'worktree', effort: 'high' })
  return { impl, reviews, fix }
}

phase('Build')
const [coop, story] = await parallel([() => runTrack('coop'), () => runTrack('story')])
return { coop, story }
