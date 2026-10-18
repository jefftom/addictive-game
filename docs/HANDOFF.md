# Handoff: where SHARDSTORM stands and what is left

Read `AGENTS.md` first (commands and hard rules). This file is the task list.

## Latest checkpoint — solo phone polish (2026-10-18)

The owner authorized a polished solo phone build on the same PR branch.
Phone readability, native-resolution HUD layout, two-thumb controls and device
render budgets are implemented; gameplay/balance and the approved q3 pipeline
are preserved. See [phone verification](verification/05-phone-polish.md) for
checks, evidence, reproducibility and physical-device acceptance still needed.
Exact final SHA and remote CI gates are recorded on PR #1 and in the local
`F:\addictive-game-handoff\2026-10-18-phone` receipt. Earlier task reports and
their balance/hardware gaps remain applicable.

## Branches

| Branch | State |
|---|---|
| `claude/dazzling-faraday-2kxdhl` | **The game.** PR #1 into `main` (`main` is an empty root commit, so the PR shows everything). Tasks 1–3e passed all CI jobs in order. Task 4/5 implementation and evidence are complete; final remote gates and review readiness are recorded on the PR. Balance/hardware acceptance gaps are explicit below. |
| `wip/fix-dmath` | Merged with merge commit `c806d39`, preserving `2980d33`. Numerical review, guard hardening, e2e and single-file validation completed on the PR branch. |
| `wip/wave3-platform` | Merged with `ec48096`, preserving `361c4c1`. Task 2 verification and the specified Deck/licence fixes are on the PR branch. |
| `wip/wave3-gfx` | Merged at `2224fe9`, preserving `df7a114`. Task 3a passed CI and all three desktop jobs at `f003dc5`. |
| `wip/wave3-entities` | Task 3b merged at `402a2f7`; all remote gates passed. |
| `wip/wave3-postfx` | Task 3c merged at `c3a1ca6`; all remote gates passed. Owner retains 12 normal / 15 surge q3 draws. |
| `wip/wave3-grid` | Task 3d and timing recovery merged at `b5ee3c3`; all remote gates passed. |
| `wip/wave3-coop-render` | Task 3e merged at `95b6d05`; all remote gates passed. |
| `wip/verify` | Task 4/5 harness, balance candidate, review fixes, capture/performance/store tools and docs; merged into the PR branch as the final checkpoint. |
| `wip/prototypes` | Orphan branch, not code to merge: design docs (`design/coop.md`, `design/galaxy.md`, `design/steam.md`, story bible) and graphics prototypes with integration guides (`galaxy/`, `gfx/postfx/`, `gfx/grid/`, `gfx/entities/`). Read with `git show origin/wip/prototypes:<path>` or a separate worktree. |

The original `wip/*` branches started at `3d3e601` (`wip/fix-dmath` at `ab45301`). Later graphics and verification branches start at the preceding accepted PR checkpoint. Integration uses merge commits and normal pushes.

## 1. Cross-platform determinism — complete

**Current status:** completed 2026-10-10 at `2be4888`: CI and macOS/Windows/Linux desktop jobs
passed. Numerical, mutation, performance and balance evidence and run links are in
[`verification/01-determinism.md`](verification/01-determinism.md).
The original problem and finishing checklist below are retained as context.

**Problem:** `tests/golden.solo.test.ts` passes on Linux and Windows x64 but diverges on the macOS arm64 runner (`desktop` workflow). The sim used `Math.sin/cos/atan2/exp/pow/hypot` and `**`. ECMAScript allows these to be approximated, and V8 on arm64 returns different last bits. The chaotic sim amplifies that, so a Daily Run also plays differently on a Mac than on a PC.

**Implemented from `wip/fix-dmath`:**
- `src/core/dmath.ts`: replacements built only from exactly specified operations (+ − × ÷, `Math.sqrt`, floor/abs etc., bit access).
- The sim's call sites are switched over.
- `tests/determinism.guard.test.ts` fails on any transcendental `Math.*` call or `**` inside the sim's import closure.
- `tests/dmath.test.ts` tests the module.
- The golden master is re-captured on purpose, with its header explaining why.

**Completed checklist:**
1. Review `dmath` accuracy. Fuzz it against `Math.*` over game ranges and edge cases: ±0, NaN, ±∞, huge angles, exp overflow/underflow, pow edge cases, atan2 quadrants.
2. Confirm the guard really covers the sim's whole import closure. Mutation-test it.
3. Check gameplay is unchanged in spirit. Compare a bot batch or `npm run sim` before and after; also compare sim cost per tick.
4. Run `npm run e2e` and `build:single`.
5. Merge into the PR branch and push. **Done when the macOS `desktop` job is green.**

## 2. Merge the platform wiring (`wip/wave3-platform`) — complete

**Current status:** completed 2026-10-10, merged at `ec48096`; specified Deck fullscreen and standalone
font-licence fixes are implemented. Local verification includes 343 unit tests,
32 browser tests (8 unchanged device exclusions), 48 Windows Electron checks,
and the achievement table check. CI and all three desktop jobs passed at
`10a84c7`, including all 48 Linux smoke checks. Font comparison and run links are
in [`verification/02-platform.md`](verification/02-platform.md).

- **What the branch does:**
  - `initPlatform()` at boot.
  - Saves go through the platform storage adapter: localStorage on the web (same key, existing saves keep working), the bridge with Steam Auto-Cloud on desktop.
  - Achievements are reported to Steam.
  - Rich presence is set.
  - On desktop only: a Quit to desktop button and a fullscreen toggle.
  - Chakra Petch, Kode Mono and Tektur are self-hosted, replacing Google Fonts.
- **Verified steps:**
  1. Merge it into the PR branch after task 1.
  2. Run `npm run e2e` and `xvfb-run npm run desktop:smoke`.
  3. Check that `npm run steam:achievements -- --check` still passes.
  4. Check that the fonts render the same as before.

## 3. Graphics push — implementation complete 2026-10-11

The owner asked for noticeably more spectacular visuals while keeping 60 fps on a mid laptop. A 300-enemy fight must stay readable. Each prototype on `wip/prototypes` has a `NOTES.md` integration guide (API, exact renderer hook points, settings, fallbacks, timings) and before/after screenshots. Integrate them in this order, one commit (or a few) per step, with all checks green at each step.

### 3a. Galaxy sector backdrops — complete

Merged with worker permissions and the generation-field rename. Cards clear
boss callouts on all four target viewports and freeze with warps under modals.
361 unit tests, 46 browser tests and 49 Windows Electron checks pass. Contrast,
coverage and frame budgets pass; details are in
[`verification/03a-galaxy.md`](verification/03a-galaxy.md).

Stable hooks for 3c/3d/3e: public `renderer.bg.galaxy`, `Background.draw` with
explicit context/scale/target size, `galaxy.warpFx`, `onGalaxyEvent` then
`renderer.onGalaxy`, `showSectorCard`, `genStats`/`memoryBytes`, and the pure
`sectorwarp.ts` anticipation helper. Later draw refactors must preserve
`opts.modal` clock freezing. The historical starting checklist follows.

- **Design:** `design/galaxy.md` and `galaxy/`.
- **Already on the branch:** `src/render/galaxy.ts`, `src/render/galaxy.worker.ts`, and hooks in the renderer, background, effects, audio and app.
- **Failing test:** `tests/no-p1-alias.test.ts`. Its regex flags galaxy's own `this.stats` Map (generation timings). Rename that field (e.g. `genStats`). Do not touch the guard.
- **Owner decisions, which override the design doc:**
  - Sector changes come only from the existing `world.sector` / `{ t: 'sector' }` event. The warp is purely visual: no sim timing changes, no spawn calm, no bullet clear, golden unchanged.
  - Push each sector's colour identity well beyond the greyish prototype, while keeping the OKLab camouflage check and the luminance budget (the backdrop stays darker than every gameplay sprite).
  - Bundle the worker inline (`?worker&inline`) and keep the main-thread fallback.
  - Hook the warp events to an audio riser and boom, plus a sector title card.
  - The title screen shows the sector-1 galaxy.
  - The backdrop must cover the screen at co-op zoom-out (`world.zoom`).

### 3b. Starship and crystalline-alien entity art — complete

Merged at `402a2f7` after local verification on `wip/wave3-entities`;
CI and all three desktop jobs passed before 3c began. See
[`verification/03b-entities.md`](verification/03b-entities.md): 395 unit tests,
50 browser tests and 49 Windows Electron checks pass. Six alternating heavy
scenes measure +0.464 ms mean / +0.65 ms p95 renderer JS over 3a.

- **Source:** `gfx/entities/` (`src/vessels.ts`, `shardfx.ts`, `entityfx.ts`; exact integration points in NOTES §4: event fields §4.1, renderer §4.2, post-FX hooks §4.4).
- **Caution:** its `integration.patch` was made against an older base and **reverts co-op code**. Port it by hand.
- **Requirements:**
  - Clamp the runaway gunship/boss charge glow on the render side.
  - Give co-op pilots a `PLAYER_COLORS` accent.
  - Expose `setGlowScale` / `postFx` / `setCostTier` hooks for 3c.
  - Use the new art in the menus too: hangar, lobby and results.

### 3c. WebGL2 post-FX

Merged at `c3a1ca6`; CI and all three desktop jobs passed before 3d began.
See [`verification/03c-postfx.md`](verification/03c-postfx.md). The owner chose
to preserve the reviewed pipeline's actual 12/15 q3 draw counts. JS budgets
pass; the fully flushed 1080p SwiftShader lowest rung is slower than plain 2D,
so that performance criterion and the owner's iGPU test remain open for task 4.
Low-refresh/battery-saver frame caps can also trigger the ladder.

Stable hooks: `postfx`, `postFxActive`, `setPostFx`, `costTier`, `worldCanvas`,
`hudCtx`, one `view` transform and `camZoom`, `flashBudget`, `WarpFx.punch`,
`GalaxyBackdrop.punchScale`, `?fx=0`, and `?fxq=N`. Grid quality follows
`onFxQuality` in 3d; 3e drives camera zoom through the shared transform.

- **Source:** `gfx/postfx/`.
- **Canvas layout:**
  - A `#fx` WebGL canvas sits under `#game`. `#game` stays the input target.
  - The world is drawn to an offscreen canvas, then post-processed onto `#fx`.
  - The HUD, callouts and damage numbers are drawn on `#game` after post-FX, so they stay crisp.
- **Effects:**
  - Bloom keyed to near-white.
  - Lens streaks only during surges.
  - A shockwave budget.
  - Aberration only as brief spikes (none with reduced flashing).
  - Sprite glow ×0.15 while post-FX is active.
- **Quality and fallback:**
  - Auto-quality ladder: q3 → q0 → q0 at 0.75 scale → off.
  - Clean fallback when context is lost or WebGL2 is unavailable.
- **Settings and tests:**
  - An "Enhanced graphics" setting, with defaulting for old saves.
  - Point the e2e smoke test's canvas check at the world image.

### 3d. WarpGrid spring-mesh grid — complete

Merged with CI recovery at `b5ee3c3`; CI and all three desktop jobs passed
before 3e began. CI ran 431 unit and 75 browser tests with no retries. See
[`verification/03d-grid.md`](verification/03d-grid.md). Required grid mean
budgets pass at 0.31–0.36 ms, including four pilots. The grid is capped at
1,800 points; old saves inherit shake for the new Grid motion setting.

Stable hooks for 3e/4: `renderer.grid` and `gridMs`, all mesh stats including
`spacing`, `gridSpacingFor`/`GRID_MAX_POINTS`/`GRID_TINTS`/`coolRGB`, and
`gridEvent`/`gridFrame`/`GridWorldView`. The world transform already drives
grid drawing, and co-op reserves `ZOOM_MAX` at reset; do not resize per zoom.

- **Source:** `gfx/grid/` (`grid.ts`, `gridfx.ts`).
- **What it does:**
  - Replaces the static grid.
  - Event→force mapping: kill ripples with a budget, boss-death fronts on real time, singularity and void-heart wells, dash wake, nova fronts.
  - Readability dimming.
  - Grid quality follows the post-FX auto-quality.
- **Settings:** a "Grid motion" slider, where 0 means static.
- **Co-op:** the mesh must cover the view at any zoom.

### 3e. Co-op rendering and comms fade — complete

Implemented on `wip/wave3-coop-render`, after 3d's successful remote gates.
The solo HUD call-log snapshot was committed first at `e9be690` and remains
unchanged; desktop and Pixel 7 HUD comparisons have zero changed pixels.
Local verification and performance caveats are in
[`verification/03e-coop-render.md`](verification/03e-coop-render.md).
Completed 2026-10-11 at `95b6d05`: CI passed 444 unit and 81 browser checks
without retries, and all three desktop jobs passed before task 4 began.

Stable interfaces: `renderer.worldToScreen` (CSS pixels, steady camera),
`screenToWorld`, `viewZoom`, `viewOf`/`followCamera`/`CAM_INSET`,
`coopPanelLayout`/`coopHudBand`, `PilotOverlay`/`drawPilotMark`/`leashEdges`/
`edgeIndicator`, `EntityFx.pilotScale`, `UI.announce`/`#sr-announce`,
`body.coop-run`, and `gameplayUnder`/`FadeGate`/`CommsPanel.updateFade`/
`.comms.under`. The P1 migration allowlist is empty.

Spec decisions S1–S5: input and DOM projection ignore shake and return CSS
pixels (input converts to device pixels); render zoom applies the simulation's
zoom exactly; ship/tag positioning and damage numbers use square-root zoom
compensation while revive/magnet circles retain their world radius; the red
low-HP edge is solo-only; the warning says **LAST CAPTAIN STANDING**.
Dedicated co-op audio cues and a co-op attract mode remain follow-ups.

- **Spec:** `design/coop.md` §3 (renderer/hud/background/app entries), §4 (consumer API), §5.4–5.5 (camera, grid coverage).
- **Camera:** zoom-aware, following `world.teamCenter()` and `world.zoom`. Add a single `renderer.worldToScreen`, used by every layer.
- **Pilots:**
  - Per-pilot colour plus `PLAYER_MARKS` (▲●■◆, colour-blind safe), with P1–P4 name tags.
  - Downed pilots show as a ghost ship with a revive ring.
  - Edge indicators for pilots off screen, and a last-stand cue.
- **HUD:** a co-op HUD. The solo HUD must not change.
- **Code changes:**
  - Replace `App.coopToasts` with in-world cues.
  - Move `renderer.ts` and `hud.ts` off the P1 aliases and remove them from `PENDING_MIGRATION`.
- **Comms fade:** the comms panel fades to about 30% while gameplay is under it, and never disappears completely.

## 4. Verification — implementation and evidence complete 2026-10-11

See [`verification/04-verify-and-ship.md`](verification/04-verify-and-ship.md) and
the [14-trial balance record](verification/04-balance.md). The harness is at
`9100a10`, review fixes at `41b7672`, and capture tools at `343d0bc`.
Local checks pass: 448 unit tests, 87 browser tests without retries, 49 Windows
Electron checks and the packaged smoke. All 104 QA images and 22 store images
were inspected. Acceptance is qualified by the balance, readability and
hardware findings below; this does not mean every speculative budget passed.
The first final web CI exposed a fractional mobile focus-scroll defect at
`467d047`. The recovery scrolls the whole settings row with a visible margin;
18 repeated targeted browser checks and all 448 unit tests passed locally.
Its final remote result is on PR #1; the failed trace is preserved.
The first focus correction also moved a checkbox during pointer clicks on
mobile. Scrolling is now restricted to keyboard/gamepad navigation; both CI
failures are preserved and the original strict tests remain unchanged.

- **Balance:** only 3P/4P rows changed. Trial 13 was confirmed on 48 shared seeds each at bases 1000 and 5000. The main rate/fight bands pass; held-out fight duration and monotone outcomes remain playtest acceptance gaps. Solo and 2P match the baseline exactly.
- **Visual QA:** take screenshots of every sector and boss, a kill storm, co-op at 2 and 4 players, reduced flashing, mobile, and the 2D fallback.
- **Performance:** JS frame cost at about 400 enemies with every layer on; report it.
- **Desktop:** Electron smoke test on Linux (CI does this too). Steam itself is optional: the game must run without it.
- **Review:** a full review of the diff (correctness, determinism, accessibility).

## 5. Store assets and docs — complete 2026-10-11

- **Steam store assets:** `npm run store:assets` generates 22 native-size files with dimension and local-request checks. Capsules/library art, nine gameplay screenshots, two icons and event images are available in `store-assets/`; the transparent logo was checked. Optional achievement icons and the trailer remain outside this checkpoint. The generated app icon passed isolated ICO/ICNS conversion and Windows packaging; adopting it remains an owner choice.
- **Docs:** README, design, agent commands, Steam guide and verification records now describe the implemented behavior and measured results. Generated images are ignored by Git and shared in local archives.

## Known issues and owner acceptance

- Balance is a documented review candidate, not an all-bands pass. Held-out 4P
  Warden duration is 94.08 s against 89.40 s. Four pilots outperform three on
  held-out Warden/10:00 rates; multiplier rows themselves remain monotone.
  Further tuning or acceptance needs real 3–4-player feedback. Shared revive,
  solo and 2P rules remain unchanged.
- Regular-enemy caps exclude scheduled bosses. The baseline reaches 421 at the solo
  setting of 420 and 501 at the frozen 2P setting of 500. Task 4 reserves room below
  600 for 4P, but changing the spawn exemption requires a separate gameplay decision.
- At forced maximum spread, captain tags can meet the top HUD or a bottom panel;
  clustered ghost/revive labels can also overlap. Marks and P# remain visible.
  Follow up in the co-op presentation layer without changing the simulation leash.
- The synthetic 400-alien storm can obscure the pilot with local shard piles and
  stacked callouts, especially at 720p. The screen does not fully white out, but
  the entity/effect layer needs another readability pass before hardware acceptance.
- The approved post-FX pipeline uses 12 normal / 15 surge q3 draws. On the measured
  1080p SwiftShader backend, its lowest active rung can be slower than plain 2D.
  Low-refresh or battery-saver frame caps can also step the automatic ladder down.
  Task 4's composed storm costs 30.246 ms mean / 44.4 ms p95; final co-op costs
  9.921 / 12.5 ms. Texture upload dominates these software-backend misses.
  Plain 2D, galaxy, grid, event consumption, sim and heap budgets pass.
- Per task 2's scope, platform boot timeout/hydration races remain: starting from
  localStorage after an error/timeout can lead to overwriting a newer cloud file;
  late hydration can replace localStorage beneath a running App. Native macOS
  green-button/menu fullscreen changes do not yet persist the preference.
- Dedicated co-op audio cues and a co-op attract mode are presentation follow-ups.
- The musl `scalbn` attribution remains pending owner confirmation as recorded in
  task 1. Preserve the fdlibm and bundled-font notices.

Owner-only release steps: real 3–4-player playtesting; midrange iGPU and physical
Steam Deck performance checks; Steam AppID/depots/store page/pricing/uploads and
Steam-client/Remote Play Together validation (`STEAM.md` §2); application icons,
signing/notarisation; and deciding whether to merge PR #1 into `main` (which
publishes GitHub Pages). These are not claimed by local scripts or CI packaging.
