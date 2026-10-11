# Handoff: where SHARDSTORM stands and what is left

Read `AGENTS.md` first (commands and hard rules). This file is the task list.

## Branches

| Branch | State |
|---|---|
| `claude/dazzling-faraday-2kxdhl` | **The game.** Draft PR #1 into `main` (`main` is an empty root commit, so the PR shows everything). Tasks 1 and 2 passed all CI jobs. A task 1 follow-up covers module-load calculations under the runtime trap, per the corrected spec. See `docs/verification/`. |
| `wip/fix-dmath` | Merged with merge commit `c806d39`, preserving `2980d33`. Numerical review, guard hardening, e2e and single-file validation completed on the PR branch. |
| `wip/wave3-platform` | Merged with `ec48096`, preserving `361c4c1`. Task 2 verification and the specified Deck/licence fixes are on the PR branch. |
| `wip/wave3-gfx` | Merged at `2224fe9`, preserving `df7a114`. Task 3a local acceptance passed; awaiting CI on the finishing commit. |
| `wip/prototypes` | Orphan branch, not code to merge: design docs (`design/coop.md`, `design/galaxy.md`, `design/steam.md`, story bible) and graphics prototypes with integration guides (`galaxy/`, `gfx/postfx/`, `gfx/grid/`, `gfx/entities/`). Read with `git show origin/wip/prototypes:<path>` or a separate worktree. |

All `wip/*` branches are based on the PR branch at `3d3e601` (`wip/fix-dmath` on `ab45301`). Merge them into the PR branch (merge commits, no force-push) once each one passes every check.

## 1. Cross-platform determinism — complete

**Current status:** complete at `2be4888`: CI and macOS/Windows/Linux desktop jobs
passed. Numerical, mutation, performance and balance evidence and run links are in
[`verification/01-determinism.md`](verification/01-determinism.md).
The original problem and finishing checklist below are retained as context.

**Problem:** `tests/golden.solo.test.ts` passes on Linux and Windows x64 but diverges on the macOS arm64 runner (`desktop` workflow). The sim used `Math.sin/cos/atan2/exp/pow/hypot` and `**`. ECMAScript allows these to be approximated, and V8 on arm64 returns different last bits. The chaotic sim amplifies that, so a Daily Run also plays differently on a Mac than on a PC.

**Fix in progress on `wip/fix-dmath`:**
- `src/core/dmath.ts`: replacements built only from exactly specified operations (+ − × ÷, `Math.sqrt`, floor/abs etc., bit access).
- The sim's call sites are switched over.
- `tests/determinism.guard.test.ts` fails on any transcendental `Math.*` call or `**` inside the sim's import closure.
- `tests/dmath.test.ts` tests the module.
- The golden master is re-captured on purpose, with its header explaining why.

**To finish:**
1. Review `dmath` accuracy. Fuzz it against `Math.*` over game ranges and edge cases: ±0, NaN, ±∞, huge angles, exp overflow/underflow, pow edge cases, atan2 quadrants.
2. Confirm the guard really covers the sim's whole import closure. Mutation-test it.
3. Check gameplay is unchanged in spirit. Compare a bot batch or `npm run sim` before and after; also compare sim cost per tick.
4. Run `npm run e2e` and `build:single`.
5. Merge into the PR branch and push. **Done when the macOS `desktop` job is green.**

## 2. Merge the platform wiring (`wip/wave3-platform`) — complete

**Current status:** merged at `ec48096`; specified Deck fullscreen and standalone
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
- **To finish:**
  1. Merge it into the PR branch after task 1.
  2. Run `npm run e2e` and `xvfb-run npm run desktop:smoke`.
  3. Check that `npm run steam:achievements -- --check` still passes.
  4. Check that the fonts render the same as before.

## 3. Graphics push (sequential: every step edits `src/render/renderer.ts`)

The owner asked for noticeably more spectacular visuals while keeping 60 fps on a mid laptop. A 300-enemy fight must stay readable. Each prototype on `wip/prototypes` has a `NOTES.md` integration guide (API, exact renderer hook points, settings, fallbacks, timings) and before/after screenshots. Integrate them in this order, one commit (or a few) per step, with all checks green at each step.

### 3a. Galaxy sector backdrops — local acceptance complete, CI pending

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

### 3b. Starship and crystalline-alien entity art

- **Source:** `gfx/entities/` (`src/vessels.ts`, `shardfx.ts`, `entityfx.ts`; exact integration points in NOTES §4: event fields §4.1, renderer §4.2, post-FX hooks §4.4).
- **Caution:** its `integration.patch` was made against an older base and **reverts co-op code**. Port it by hand.
- **Requirements:**
  - Clamp the runaway gunship/boss charge glow on the render side.
  - Give co-op pilots a `PLAYER_COLORS` accent.
  - Expose `setGlowScale` / `postFx` / `setCostTier` hooks for 3c.
  - Use the new art in the menus too: hangar, lobby and results.

### 3c. WebGL2 post-FX

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

### 3d. WarpGrid spring-mesh grid

- **Source:** `gfx/grid/` (`grid.ts`, `gridfx.ts`).
- **What it does:**
  - Replaces the static grid.
  - Event→force mapping: kill ripples with a budget, boss-death fronts on real time, singularity and void-heart wells, dash wake, nova fronts.
  - Readability dimming.
  - Grid quality follows the post-FX auto-quality.
- **Settings:** a "Grid motion" slider, where 0 means static.
- **Co-op:** the mesh must cover the view at any zoom.

### 3e. Co-op rendering and comms fade

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

## 4. Verification before calling it done

- **Balance:** 4-player co-op is too easy. Tune the 3P and 4P rows of `COOP_SCALING` in `src/game/content/coop.ts` with bot sims. For reference, 2P is tuned to a median of about 7:42 against 6:16 solo.
- **Visual QA:** take screenshots of every sector and boss, a kill storm, co-op at 2 and 4 players, reduced flashing, mobile, and the 2D fallback.
- **Performance:** JS frame cost at about 400 enemies with every layer on; report it.
- **Desktop:** Electron smoke test on Linux (CI does this too). Steam itself is optional: the game must run without it.
- **Review:** a full review of the diff (correctness, determinism, accessibility).

## 5. Nice to have

- **Steam store assets:** a capsule and screenshot generator using the exact sizes in `design/steam.md` §7. Only the owner can do the Steam steps in `docs/STEAM.md` (AppID, depots, pricing).
- **Docs:** update `README.md` and `docs/GAME_DESIGN.md` for everything above.
