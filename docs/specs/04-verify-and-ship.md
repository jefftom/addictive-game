# Final verification, co-op balance, store assets, docs

Task 4 of `docs/HANDOFF.md` ("Verification before calling it done"), plus its task 5 ("Nice to have":
store assets and docs). This is the last step. It lands after task 1 (`docs/specs/01-determinism.md`),
task 2 (`docs/specs/02-platform.md`) and the graphics chain 3a–3e (`docs/specs/03a-galaxy.md`,
`03b-entities.md`, `03c-postfx.md`, `03d-grid.md` and `03e-coop-render.md`). It has seven parts:

- **A.** Co-op balance for 3 and 4 pilots.
- **B.** A visual QA screenshot matrix.
- **C.** Performance budgets and how to measure them.
- **D.** The Electron smoke test.
- **E.** An adversarial review.
- **F.** A Steam store-asset generator.
- **G.** Docs and finishing the PR.

## 1. Goal

A squad of three or four captains gets roughly the same fight as a pair. Today a full squad cruises
past the Warden and often reaches 10:00 (see §2). With every graphics layer on, the game looks right in
every sector, boss fight, co-op zoom-out, accessibility mode and on a phone. It also holds its frame
budget in a 400-enemy kill storm. The desktop build starts and quits cleanly without Steam. A
fresh-eyes review finds no determinism, accessibility, save or single-file regressions. One command
renders every Steam capsule and screenshot at the exact pixel sizes Steam asks for, using only the
game's own art. The README and design doc describe the shipped game. PR #1 is green on Linux, Windows
and macOS and marked ready for review.

## 2. Starting point

- **Base:** the PR branch `claude/dazzling-faraday-2kxdhl` after tasks 1, 2 and 3a–3e have been merged
  (merge commits, no force-push).
  - **Part A needs only task 1.** Deterministic math changes the sim's numbers, so tuning before task 1
    lands is wasted. Part A touches only `src/game/content/coop.ts`, `tests/balance.sim.ts`,
    `tests/helpers.ts`, `vitest.sim.config.ts`, `tests/coop.test.ts` and docs, so it can run on its own
    branch (for example `wip/coop-balance`, to be created) in parallel with the graphics chain.
  - **Parts B–G need 3e merged.** Commit them on the PR branch or on a `wip/verify` branch (to be
    created) that is merged with a merge commit.
- **Nothing for this task exists on any branch.** Verified on 2026-10-11 against PR head `a114403`
  (Linux x64, 4 cores, Node 22.22, vitest 5.0.3):
  - **Balance harness.** `tests/balance.sim.ts` runs through `vitest.sim.config.ts` (`npm run sim`):
    - It has the profiles `fresh`, `clumsy`, `veteran`, `coop2`, `coop2vet` and `coop4`, selected with
      the env vars `SIM_RUNS` (default 12), `SIM_SKILL` (0.6) and `SIM_ONLY`.
    - **There is no 3-pilot profile.**
    - `coop4` uses other seeds (4000+) and at most 6 runs, so it cannot be compared with `coop2`
      (seeds 1000+).
    - Runs are played by `simulateRun` in `tests/helpers.ts`, which returns a `SimResult`.
  - **`npm run sim` prints nothing by default.** vitest 5 hides the console output of passing tests.
    `npm run sim -- --silent=false`, or `silent: false` in the config, shows it. Both were checked.
    The README's "prints survival times…" is therefore currently untrue.
  - **Run times.** The full `npm run sim` takes 2 min 17 s. A 24-run batch takes 24 s solo, 43 s at
    2P, 73 s at 3P and 119 s at 4P.
  - **Baseline** (scratch harness equivalent to the profiles below: seeds 1000–1023, skill 0.6,
    rank 1, ships alternating `spark`/`vanguard`, max 660 s, 24 runs each, **pre-task-1**):

    | Squad | Median survival | Warden killed | Reached 10:00 | Level @1:00 | Downs / revives (median) | Peak enemies (median) |
    |---|---|---|---|---|---|---|
    | Solo | 4:38 | 12/24 (50 %) | 3/24 | 6 | – | 277 |
    | 2P | 7:02 | 15/24 (63 %) | 7/24 (29 %) | 5.5 | 2 / 1.5 | 342 (cap 500) |
    | 3P | 9:12 | 22/24 (92 %) | 10/24 (42 %) | 7 | 6 / 4 | 532 (cap 560) |
    | 4P | 10:38 | 21/24 (88 %) | 14/24 (58 %) | 7 | 8.5 / 7 | **600 (cap 600)** |

  - **"Small samples lie" (`docs/GAME_DESIGN.md` §6).** The stock 12-run `npm run sim` gave a solo
    median of 6:53 and a 2P median of 7:42. That is where HANDOFF's "7:42 vs 6:16" comes from. The 6:16
    is the README's older 16-run figure. On 24 runs the solo median falls to 4:38. Tune on rates over
    many runs, not on 12-run medians.
  - **Sim cost per tick** (`world.update`, Node, 4P veteran run): 0.36 ms mean and 0.45 ms p95 at 350
    or more live enemies; 0.15 ms below 200.
- **CI** on `a114403` (run `38105188871` for `CI`, run `38105188791` for `desktop`):
  - `CI` is green.
  - In `desktop`, Linux and Windows are green and macOS is red (the golden master; task 1 fixes it).
  - The macOS job has never reached its packaging steps.
- **Steam assets:**
  - There is no store-asset tooling and no `build/` directory. `electron-builder.yml` expects
    `build/icon.*` (comment at its top).
  - `steam/achievements.json` has **23** achievements, so **46** icons are needed. `docs/STEAM.md` §5
    has this right. `docs/design/steam.md` §7 ("42 files, 21 + 21") is out of date.
- **Interfaces consumed from earlier steps** (to be created by them; check the names on the merged code):
  - **3a:** `renderer.bg.galaxy` (`isReady(i)`, `setSector(i, { sync: true })`, `setWarpPreview`,
    `clearWarp`, `usesWorker`, `sector`) and `Background.draw`.
  - **3b:** `renderer.fx` (`drawVessel`, `art`, `shards.count`).
  - **3c:** `renderer.postfx.stats()`, `renderer.postFxActive`, `renderer.setPostFx`,
    `renderer.costTier`, `?fx=0` and `?fxq=N`.
  - **3d:** `renderer.gridMs` and `Settings.gridMotion`.
  - **3e:** `renderer.worldToScreen` and the co-op HUD and pilot marks.
  - **2:** the platform storage adapter (`src/platform/`), and the desktop-only Fullscreen toggle
    (`#set-fullscreen`) and "Quit to desktop" button (branch `wip/wave3-platform`).

## 3. Read first

1. `AGENTS.md`, `docs/HANDOFF.md` §4–§5.
2. `tests/balance.sim.ts`, `tests/helpers.ts` (`simulateRun`, `SimResult`, `botRngFor`), `vitest.sim.config.ts`.
3. `src/game/content/coop.ts` (`CoopScaling`, `COOP_SCALING`, `coopScaling`). The scaling row is
   consumed by:
   - `src/game/director.ts`: `spawn`, `hp`, `bossHp`, `eliteEvery`, `surge`, `opening`;
   - `src/game/world.ts`: `maxEnemies`, `xpReq`;
   - `src/meta/result.ts`: `scoreNorm = score / scaling.spawn`, which sets co-op cores and rank XP.
4. `docs/design/coop.md` §10 (risks), §11.4 (balance-sim targets) and §5.2 (zoom).
5. `docs/design/steam.md` §5 (Deck checklist: 1280×800, 9 px text, 30 fps), §7 (asset sizes) and §10
   (smoke record; its `scratchpad/plan/electron-smoke/` location is on the original build machine and
   not in the repo). Also `docs/STEAM.md` §5 and §12.
6. `scripts/desktop-smoke.mjs`, `.github/workflows/{ci,desktop,deploy}.yml`, `playwright.config.ts`,
   `e2e/helpers.ts` (`skipIntro`).
7. `prototypes/postfx/tools/lib.mjs`:
   - `serve`, the rAF freeze `INIT`, `openGame`, `waitGalaxy`, `startRun`, `redraw`, `freezeWhen`,
     `installStorm`;
   - `prototypes/entities/tools/heavy.mjs`, the 400-enemy benchmark.
   They import Playwright from `/home/user/addictive-game/node_modules/playwright/index.mjs`, an
   absolute path on the original build machine. Port them; do not run them as they are.
8. `docs/specs/03a`–`03d` §7 and §9 (each layer's budgets and captures). Do not duplicate their
   per-layer QA; this task re-checks the composed result.

## 4. Owner decisions and constraints (non-negotiable)

1. **Balance:** only rows `3` and `4` of `COOP_SCALING` change.
   - Row `1` stays all ones (`maxEnemies` 420), so solo stays bit-identical.
   - Row `2` is tuned and frozen.
   - Revive constants (`REVIVE_*`) are shared by every squad size, so leave them alone. If the targets
     cannot be met without them, stop and ask the owner.
   - `maxEnemies` must not exceed 600 (the performance cap, also asserted by the `coop4` profile).
2. **The golden master never changes in this task.** `tests/golden.solo.test.ts` passes unmodified.
   No change under `src/game/` except `src/game/content/coop.ts`.
3. **Targets are hypotheses to tune toward,** not facts (§5 A3). The owner's statement is "4-player
   co-op is too easy". Tune 3P and 4P toward the same challenge as 2P, measured on the same commit with
   the same seeds.
4. **Original IP only.** Store art is rendered from the game itself: the procedural ships, aliens,
   galaxies and effects, the bundled OFL fonts and the game's name. There are no external images,
   stock art, traced silhouettes, franchise names, logos or catchphrases. The generator makes no
   network requests.
5. **Accessibility:** reduced flashing (`Settings.flashes = false`), screen shake 0 and grid motion 0
   must hold in every new effect. Mobile (Pixel 7) stays green.
6. **Never skip, disable or loosen a test** to get green. A flaky test is a bug to fix and report.
7. **Do not merge PR #1 into `main`.** A push to `main` publishes the web build to GitHub Pages
   (`deploy.yml`). That is the owner's decision. This task ends at "ready for review".
8. **Steam steps are the owner's** (`docs/STEAM.md` §2): AppID, uploads, store page, pricing, review.
   The game must run without a Steam client.
9. **Generated images are not committed** (screenshots, capsules, perf output). Their scripts are.

## 5. Implementation plan

### A. Co-op balance (after task 1)

**A1. Harness** (`tests/balance.sim.ts`, `tests/helpers.ts`, `vitest.sim.config.ts`):

- `vitest.sim.config.ts`: add `silent: false` to `test` so `npm run sim` prints its report (verified to
  work on vitest 5.0.3).
- Add `SIM_SEED_BASE` (to be created; default `1000`). Every fresh profile uses `seed: base + i`, so
  solo, 2P, 3P and 4P play the same seeds. The veteran profiles use `base + 1000 + i`; the clumsy profile
  keeps its own block. Held-out validation runs with `SIM_SEED_BASE=5000`.
- Add a `coop3` profile (to be created): `players: ['spark', 'vanguard', 'spark']`, `RUNS` runs.
- Change `coop4` to `RUNS` runs on the shared seeds, with the label "co-op 4P fresh". Keep its
  `peakEnemies <= 600` assertion. Optional: add `coop3vet` and `coop4vet` (to be created; rank 8,
  `VETERAN`) as a sanity check only.
- In `report()`:
  - add the Warden kill rate (`bosses.includes('warden')`) and the 10:00 rate (`time >= 600`);
  - in co-op, also print the median Warden fight duration.
  The existing lines keep their wording.
- `SimResult` gets two fields (to be created), recorded in `simulateRun` by watching
  `world.runStats.bossesKilled.length` and `world.boss` each tick:
  - `wardenSpawnAt` (the first tick `world.boss?.kind === 'warden'`);
  - `bossKillAt: number[]`.
  Fight duration = kill time − spawn time. This is the guard against "spongy" bosses.
- Optional: time `world.update` per tick in `simulateRun` (`performance.now()`). Report the mean and
  p95 for ticks with ≥ 350 live enemies (`tickMs`, to be created). This gives the Part C sim budget for
  free.

**A2. Baseline.** On the post-task-1 commit, run
`SIM_RUNS=24 SIM_ONLY=fresh,coop2,coop3,coop4 npm run sim`, save the output outside the repo, and fill
in the §2 table again with the new numbers.

**A3. Target bands for 3P and 4P fresh** (skill 0.6, rank 1, same seeds; "2P" means 2P measured in the
same batch):

| Metric | Target band (hypothesis: "a full squad fights about as hard as a pair") |
|---|---|
| Warden kill rate | 2P ± 15 percentage points, and inside 40–75 % (`docs/design/coop.md` §11.4) |
| Reached 10:00 | 2P ± 10 points |
| Median survival | 2P ± 1:00 (secondary: outcomes are bimodal) |
| Level at 1:00 (median) | solo ± 1 (coop.md §11.4) |
| Warden fight duration (median) | ≤ 1.5 × 2P's |
| Revives per run (median) | ≥ 1 |
| Runs ending on the first down | ≤ 2 of 24 |
| Peak enemies | ≤ `maxEnemies` (4P ≤ 600) |

3P should land at or slightly above 2P's challenge, and 4P at or slightly above 3P's (monotone, never
easier with more pilots).

**A4. Tuning loop.**
- Change one or two knobs of row 3 or row 4 per iteration and run `SIM_ONLY=coop3,coop4` with 24 runs.
- Keep an iteration log (row values → metrics) and put it in the PR description.
- Guidance from the baseline:
  - **The caps bind.** 4P sits at `maxEnemies` 600, and 3P is near its 560. So raising `spawn`,
    `surge` or `opening` adds little after the first minutes. The director's budget is also capped at
    `60 * spawn` (`Director` in `src/game/director.ts`).
  - The main levers are `hp` (non-boss toughness, all run long) and `bossHp` (the Warden rate).
    `bossHp` is bounded by the fight-duration guard.
  - `xpReq` (3P/4P reach level 7 by 1:00 vs solo 6) is a secondary lever: slower levelling is less
    power.
  - `eliteEvery` < 1 means more elites, so more caches and **more** power. Do not lower it to make
    things harder.
  - Do not lower `spawn`: `scoreNorm` divides rewards by it, so it would shift co-op cores and rank XP.
- Rows must stay monotone in pilot count: `spawn`, `hp`, `bossHp`, `xpReq`, `surge`, `opening` and
  `maxEnemies` non-decreasing from 2 → 3 → 4, and `eliteEvery` non-increasing.

**A5. Confirm and record.**
- Confirm with `SIM_RUNS=48` on base 1000 and again on `SIM_SEED_BASE=5000` (allow 5 more points of
  slack on the held-out seeds).
- Re-run `coop2` and check that it matches A2 exactly. Its row did not change and the sim is
  deterministic, so it must.
- Update the doc comment above `COOP_SCALING` with one line: how the 3P/4P rows were tuned (commit, run
  count, resulting rates).
- Update `docs/GAME_DESIGN.md` §6 and the README (Part G).
- Tell the owner that the bot cannot coordinate like humans, and recommend a short real 3–4 player
  session.

### B. Visual QA matrix (after 3e)

Write `scripts/qa-shots.mjs` (to be created) on a shared helper module `scripts/capture-lib.mjs` (to be
created).
- **Source.** Port `serve`, the rAF-freeze `INIT`, `openGame`, `waitGalaxy`, `startRun`, `redraw`,
  `freezeWhen` and `installStorm` from `prototypes/postfx/tools/lib.mjs`. Import `chromium` from
  `@playwright/test` (the installed devDependency; it exports `chromium` and `_electron`).
- **Server and browser.** Serve `dist/` with `node:http` on `127.0.0.1:0` (an ephemeral port that
  closes when the script ends). Launch with `--ignore-gpu-blocklist --enable-unsafe-swiftshader` so
  WebGL2 works headless.
- **Save seeding** (`addInitScript`, like `e2e/helpers.ts` `skipIntro`):
  - `story: { introSeen: true }`, `tutorialDone: true`;
  - a veteran profile (`rank: 8` and a workshop like `VETERAN` in `tests/balance.sim.ts`), so `?warp`
    runs survive;
  - `achievements: { survive3: 1, combo150: 1, warden: 1, perfect10: 1 }`, so every ship is unlocked;
  - per-variant `settings` (`flashes: false`, `shake: 0`, `gridMotion: 0`, `postfx: false`).
- **Pin `?fxq=3`** in every post-FX capture: the auto ladder steps down on SwiftShader.
- **Hide** `#toasts` and `#tutorial`. Keep `#comms` unless the row says otherwise.
- **Output:** `qa-shots/<scenario>__<variant>__<viewport>.png` (add `qa-shots/` to `.gitignore`), plus
  `qa-shots/index.html`, a contact sheet with one `<img>` per file and its caption.
- npm script: `"qa:shots": "vite build && node scripts/qa-shots.mjs"` (to be created).

Viewports: **D** = 1920×1080, **H** = 1280×720, **M** = Pixel 7 (`devices['Pixel 7']`), **Dk** =
1280×800 (Steam Deck).

| # | Scenario | Setup | Viewports | Variants |
|---|---|---|---|---|
| 1 | Title (sector-1 galaxy, logo) | `/`, wait `galaxy.isReady(0)` | D, H, M, Dk | default, `?fx=0` |
| 2 | Sector 1, early swarm, a dash | `?autoplay&warp=40` | D, M | default, `?fx=0`, reduced flashing |
| 3 | Warden fight with volley | `?autoplay&warp=185` | D | default, `?fx=0`, reduced flashing, shake 0 |
| 4 | Each sector backdrop in play (Turquoise Whorl, Garnet Nebula, Amethyst Abyss, Gilded Throne) | run until `world.sector === i` (`?autoplay&warp=250/430/610`; `?autoplay` continues into Overtime). If the bot has not got there, force it render-side with `renderer.bg.galaxy.setSector(i, { sync: true })` and say so in the caption | D | default |
| 5 | Warp mid-transition (spool, tunnel, punch, arrival) | `galaxy.setWarpPreview(0, 1, p)`, p ∈ {0.15, 0.42, 0.56, 0.8}, then `clearWarp()` | D | default, reduced flashing |
| 6 | Hydra charge lane | `?autoplay&warp=365` | D | default |
| 7 | Void Heart with lit spires | `?autoplay&warp=545` | D | default, reduced flashing |
| 8 | Live boss death, about 0.3 s after the kill | set `world.boss.hp = 1` (capture only), then `freezeWhen` on the `bossdead` event | D | default, reduced flashing, shake 0, `?fx=0` |
| 9 | Kill storm: 400 aliens, 60 kills/s | `installStorm(page, 400, 60)` after `?autoplay&warp=200` | D, H | default, `?fx=0`, reduced flashing, grid motion 0 |
| 10 | Bastion nova, perfect dash, bomb | save `ship: 'bastion'`, `?autoplay&warp=120` | D | default, reduced flashing |
| 11 | Low HP | `world.players[0].hp` to 8 % of max plus one hurt (capture only) | D | default, reduced flashing |
| 12 | Co-op 2P | `?coop=2&autoplay&warp=90` (without `autoplay`, P1/P2 are idle keyboard slots) | D, H | default, `?fx=0` |
| 13 | Co-op 4P zoomed out | `?coop=4&autoplay&warp=120`; spread the pilots (capture only) until `world.zoom` ≥ 1.4 (`ZOOM_MAX` 1.45) | D, H, M | default, `?fx=0`, reduced flashing |
| 14 | Co-op downed ghost + revive ring, last stand, edge indicator | `world.hurtPlayer(1e6, x, y, 1)` on P2, then move P1 onto P2; for last stand down all but one | D | default |
| 15 | Co-op HUD | from 12 and 13 | H, D, M | default; also a grayscale copy of 13 (canvas filter in page) to check marks ▲●■◆ read without colour |
| 16 | Comms panel faded over enemies | a run where enemies pass under `#comms` | D, M | default |
| 17 | Menus: hangar, settings (new rows), co-op lobby (`?bots`), Ship's Log, solo and co-op results, level-up cards | click through | D, M | default |
| 18 | WebGL context loss and restore | `WEBGL_lose_context` on the post-FX canvas, then `restoreContext()` | D | default |
| 19 | Single-file build | `dist-single/shardstorm.html` opened from `file://` (title, `?autoplay&warp=40`) | H | default |

**Look at every image.** Check that:
- the backdrop stays darker than every sprite;
- the pilot and enemy bullets read clearly in row 9;
- the HUD, callouts and damage numbers are crisp (never bloomed or warped);
- nothing whites out (rows 5 and 8);
- reduced flashing has no full-screen flash brighter than 0.15 alpha and no aberration;
- shake 0 has no screen warp;
- grid motion 0 has no grid displacement;
- text is never clipped on M or Dk, and the smallest text is at least 9 px at 1280×800
  (`docs/design/steam.md` §5);
- the pilot marks are distinguishable in grayscale.

File each defect as a fix in this task, or as a follow-up in HANDOFF if it belongs to a layer's own
spec.

### C. Performance (after 3e)

Write `scripts/perf-bench.mjs` (to be created; npm `"perf:bench": "vite build && node
scripts/perf-bench.mjs"`) on `scripts/capture-lib.mjs`.
- **What to time.** Wrap `renderer.consume` and `renderer.draw` (instance properties over the prototype
  methods, as `prototypes/entities/tools/heavy.mjs` does). Also record `renderer.postfx.stats()`
  (`cpuMs`, `uploadMs`), `renderer.gridMs` and a wrapped `renderer.bg.draw`.
- **Sampling.** Frames 30–360, 3 alternating runs per scenario, median of the runs. Report mean, p50 and
  p95 per metric. Also report `world.enemies.length`, `world.zoom`, `renderer.costTier`,
  `renderer.fx.shards.count` and `performance.memory.usedJSHeapSize`.
- **Output.** Write `qa-shots/perf.json` and print a table.

Scenarios:
1. Storm (`installStorm` 400/60) at 1920×1080: `?autoplay&warp=200&fxq=3`, then `?fx=0`.
2. Storm at 1280×720 with `?fxq=3`.
3. `?coop=4&autoplay&warp=120&fxq=3` at 1920×1080 with zoom near `ZOOM_MAX`.
4. Heap: after the title, at 2:00 and at 10:00 of `?autoplay`.

Budgets. Headless Chromium uses SwiftShader, so only JS timings mean anything; GPU and raster numbers
are pessimistic. Run on an idle machine and report the load.

| Metric | Budget | Source |
|---|---|---|
| Renderer JS (`consume` + `draw`, all layers), 1080p storm `?fxq=3` | mean ≤ 7.0 ms, p95 ≤ 14 ms | Derived from the layer budgets: pre-3b base ~1.8 ms + entities +1.0 + galaxy ≤ 2.0 + grid ≤ 1.0 + post-FX CPU ≤ 0.5 + headroom. **A hypothesis:** if it is over, find the layer that is over its own budget. |
| Same on the 2D path (`?fx=0`) | mean ≤ 7.0 ms | |
| `?coop=4` at max zoom | mean ≤ 8.5 ms, report p95 | Hypothesis: more on screen |
| `galaxy` / `Background.draw` | ≤ 2.0 ms at 1080p | 03a §7 |
| Entities | ≤ +1.0 ms mean, +3 ms p95 vs pre-3b | 03b §7 |
| `postfx.stats().cpuMs` | p50 ≤ 0.5 ms; `consume` mean ≤ 0.25 ms | 03c §7 |
| `renderer.gridMs` | mean ≤ 1.0 ms | 03d §7 |
| Sim `world.update` at ≥ 350 enemies (Node, from A1's `tickMs`) | mean ≤ 1.0 ms, p95 ≤ 2.0 ms | Measured 0.36 / 0.45 ms before task 1 |
| Heap growth between 2:00 and 10:00 | report; above 50 MB, investigate as a leak | |
| Title plus sector-1 galaxy ready | ≤ 10 s headless | 03a §8 |
| `dist-single/shardstorm.html` | report bytes and gzip bytes | README size line |

**Owner's real-hardware check** (part of acceptance; write "not done" if it was not):
- any mid iGPU laptop at 1080p with Show FPS on: ≥ 55 fps in a late-run kill storm with every layer on,
  and with `?coop=4&autoplay` (`docs/design/coop.md` §10);
- Steam Deck when available: ≥ 30 fps sustained (`docs/design/steam.md` §5 item 8).

### D. Electron smoke (after 3e)

1. If the Electron binary is missing (installs with `ELECTRON_SKIP_BINARY_DOWNLOAD`), run
   `node node_modules/electron/install.js`. It needs network access.
2. Run `npm run desktop:smoke`. It builds, then runs `scripts/desktop-smoke.mjs`, which re-runs itself
   under `xvfb-run -a` on Linux without `DISPLAY`. Every check must say PASS. Task 2's version has 47
   checks, and 3a adds a galaxy-worker check.
3. Add one informational line to the smoke output (not a check): `renderer.postFxActive`,
   `renderer.costTier` and `renderer.bg.galaxy.usesWorker` after the run starts. WebGL2 may be missing
   under xvfb, and the 2D fallback is acceptable there. Note it in the report.
4. Run the packaged build as CI does: `npm run desktop:pack`, then
   `SHARDSTORM_SMOKE=1 SHARDSTORM_NO_STEAM=1 xvfb-run -a release/linux-unpacked/shardstorm --no-sandbox`.
   It must exit 0.
5. Do not use `--ozone-platform=headless`: Electron crashes there (`docs/design/steam.md` §10, run C).
6. A real Steam client is optional and done by the owner (`docs/STEAM.md` §12).

### E. Adversarial review (after 3e; before the store assets)

Review `git diff 3d3e601..HEAD`, plus `ab45301..` for task 1's files, with each lens below. Each
finding needs a reproduction (command plus output, or input plus wrong result). Fix it, or record it in
HANDOFF "Known issues" with the reason.

1. **Determinism.**
   - `git diff 3d3e601..HEAD -- src/game` should show only task 1's call-site changes, `coop.ts` rows 3
     and 4, and any purely informational event fields from 3b.
   - `tests/golden.solo.test.ts` changed only in task 1's deliberate re-capture. Check with
     `git log --oneline -- tests/golden.solo.test.ts`.
   - Mutation-test `tests/determinism.guard.test.ts` (added by task 1): insert a `Math.sin(` into
     `src/game/world.ts`, check that the guard fails, then revert.
   - Run `grep -rnE "\b(world|w)\.[A-Za-z_][A-Za-z0-9_.]*(\[[^]]*\])?\s*(=[^=]|\+=|-=|\*=|\+\+|--)"
     src/render src/ui src/audio src/story src/app.ts`. Today it lists only `src/app.ts`'s loop
     bookkeeping (`viewHalfW/H`, `events.length = 0`, `hitstop`, `slowmoT`, `slowmoScale`). Anything new
     in `src/render`, `src/ui`, `src/audio` or `src/story` is a bug.
   - `grep -rnE "\.(rng|spawnRng|lootRng|posRng)\b" src/render src/ui src/audio src/app.ts` must find
     nothing. `src/story` uses only its own `this.rng`.
   - Two solo `?autoplay&warp=120` loads with the same fixed seed give the same `world.score`, read
     right after the warp. The solo warp uses `App.botRng`, which is seeded with 1234. This needs the
     optional `?seed=N` (§10); without it, compare two `simulateRun` calls.
2. **Accessibility.**
   - Every new effect reads `settings.flashes` and `settings.shake`: grep `src/render` for each effect
     added since `3d3e601`. `gridMotion` 0 means zero displacement.
   - No new full-screen flash bypasses `flashBudget` (3c).
   - Focus and keyboard/gamepad navigation reach every new settings row (Enhanced graphics, Grid
     motion, Fullscreen on desktop).
   - The co-op marks show beside the colour everywhere: HUD, name tags, edge indicators, lobby,
     results.
   - Reduced flashing also mutes the galaxy punch and the post-FX aberration.
3. **Save migration.**
   - Add a frozen fixture `tests/fixtures/save-pre-wave3.json` (to be created): the JSON of a played
     save written by the `3d3e601` build (`defaultSave()` with progress and settings filled in).
   - A test asserts that `migrate()` keeps every field and defaults the new settings: `postfx` → `true`;
     `gridMotion` → follows `shake` (03d §6).
   - Corrupt JSON loads defaults without throwing (`loadSave`).
   - The key stays `shardstorm.save`.
   - On desktop, the localStorage → file migration is covered by the smoke (`migrated-local`).
   - No `SAVE_VERSION` bump unless a field changes meaning.
4. **Single-file and Pages builds.**
   - `npm run build:single`, then open `dist-single/shardstorm.html` from `file://` in Chromium. Check:
     no console errors; the galaxy worker runs inline (`usesWorker`); post-FX is active with `?fxq=3`;
     the bundled fonts are loaded (`document.fonts`); no request leaves `file:`, `data:` or `blob:`.
     `dist-single/embed.html` also exists.
   - Serve `dist/` under a sub-path (copy it into `<tmp>/x/game/` and serve `<tmp>/x`), as GitHub Pages
     does, and load `/game/`: workers, fonts and assets resolve (`base: './'`).
5. **Platform and security.**
   - The web bundle has no `steamworks` or `require("electron")` (the smoke checks this).
   - The CSP has no remote hosts.
   - Desktop-only controls are absent on the web (e2e).
6. **Original IP.**
   - Read every player-visible string added since `3d3e601`: `git diff 3d3e601..HEAD -- src/story src/ui
     src/render | grep '^+'`. Look at every generated store image.
   - Rename anything that resembles an existing franchise's names, ships, logos or catchphrases.
7. **Code health.**
   - `npm run typecheck` is clean.
   - `PENDING_MIGRATION` in `tests/no-p1-alias.test.ts` is empty (3e).
   - `App.coopToasts` is gone.
   - No debug-only code runs without its URL parameter.
   - Comment density and naming match the surrounding files.

### F. Store-asset generator

Write `scripts/store-assets.mjs` (to be created; npm `"store:assets": "vite build && node
scripts/store-assets.mjs"`) on `scripts/capture-lib.mjs`. The output goes to `store-assets/`
(gitignored, to be created) and is overwritten on each run.

How it captures:
- Serve `dist/` as in B, seed the same veteran save, pin `?fxq=3`, and wait for `galaxy.isReady`.
- Set the viewport to the **exact asset size at `deviceScaleFactor: 1`**. A viewport screenshot is
  then exactly that size, and the renderer lays out natively at that aspect.
- Choose frames with `freezeWhen` predicates. Examples: a boss on screen (`world.boss`), at least 150
  live enemies, the pilot in the middle third of the view.
- **Key art without the HUD:** wrap `renderer.draw` so it passes `{ ...opts, attract: true }`. The
  renderer skips the HUD and low-HP cues in attract mode (`Renderer.draw`, `if (!opts.attract)`
  blocks). Hide `#ui`, `#toasts`, `#tutorial` and `#comms` with CSS. If 3c restructured `draw` so this
  no longer hides the HUD, add a debug-only `?nohud` (to be created) in `readDebugParams` instead.
- **Logo:** a DOM `<h1 class="logo"><span>ALLIED BEACON FLEET</span>SHARD<br/>STORM</h1>` overlaid with
  absolute positioning. It is the title screen's markup (`src/ui/ui.ts`) and `.logo` style
  (`src/ui/style.css`), so it matches the game exactly. Await
  `document.fonts.load('900 100px Tektur')` and assert `document.fonts.check(...)` before every
  capture.
- After writing each file, read its PNG IHDR width and height (bytes 16–23) in Node and **fail if they
  differ** from the table. Log `asset → scenario, sector, enemies, world.time`. Fail if any request
  leaves the local server's origin.

| File | Size (px) | Content |
|---|---|---|
| `header_capsule.png`, `library_header.png` | 920×430 | Sector-1 swarm, pilot dashing; logo left, about 45 % of the height |
| `small_capsule.png` | 462×174 | Logo fills about 80 % of the height over darkened art; must stay readable |
| `main_capsule.png` | 1232×706 | Boss fight (Warden or Void Heart) with a swarm; logo lower left |
| `vertical_capsule.png` | 748×896 | Logo top third; pilot vessel and swarm below |
| `library_capsule.png` | 600×900 | Same composition style as the vertical capsule |
| `library_hero.png` | 3840×1240 | **No text or logo**; key subject inside the centred 860×380 safe area |
| `library_logo.png` | 1280 wide, ≤ 720 high | Logo only, on a transparent background: hide the game canvases, set `html, body { background: transparent }` and use `omitBackground: true`. Crop to the text, with one side at full size. |
| `page_background.png` | 1438×810 | Optional; galaxy only, low contrast (Gilded Throne or Garnet Nebula). Draw `renderer.bg.draw(...)` into a fresh canvas (`Background.draw` signature from 03a §5), then darken by about 50 %. No sprites or logo. |
| `screenshot_01..08.png` | 1920×1080 | Gameplay **with** the HUD: the four sectors, Warden, Hydra lane, Void Heart, 4P co-op zoomed out, kill storm. At least 5 (Steam minimum). Keep the comms panel in one or two. |
| `community_icon.jpg` | 184×184 | JPEG (`type: 'jpeg', quality: 92`): the player vessel drawn with `renderer.fx.drawVessel` (3b; check its signature) on the dark fleet background, no text |
| `app_icon_1024.png` | 1024×1024 | Same as the community icon. The owner may copy it to `build/icon.png`. electron-builder can derive `.ico`/`.icns` from it; verify that in the packaging log. |
| `achievements/<apiName>.png`, `<apiName>_locked.png` (optional) | 256×256 | 46 files from `steam/achievements.json`. Consistent frame and readable at 64 px. Locked = grayscale and dimmed. |
| `event_cover.png`, `event_header.png` (optional) | 800×450, 1920×622 | For launch posts |

- Capsule text: the game name only, plus the optional "ALLIED BEACON FLEET" kicker. No other text, and
  no review, award or discount claims **[check Valve's capsule rules in Steamworks]**.
- Re-check every size on the Steamworks upload pages before uploading (`docs/design/steam.md` §7 is
  the 2024–2025 spec).
- The trailer is out of scope.

### G. Docs and PR finishing

1. **`README.md`:**
   - Balance section: say `npm run sim` prints (after A1). Replace "16 runs per profile" with the real
     run count and seed base. Add 2P/3P/4P rows with the final numbers.
   - Debug-parameter line: add `?coop=N`, `?bots`, `?fx=0`, `?fxq=N` (and `?seed=N`/`?nohud` if added).
   - Development table: add `qa:shots`, `perf:bench` and `store:assets`.
   - Measure and update the size claim ("about 50 KB gzipped") with `gzip -c dist-single/shardstorm.html
     | wc -c`.
   - Project layout: add `scripts/`, `docs/specs/` and `prototypes/`, and remove the stray blank line
     before `platform/`.
   - Credits: check that task 1's notice and task 2's fonts lines are present.
2. **`docs/GAME_DESIGN.md`:**
   - §3.5: how difficulty scales per squad size.
   - §6: co-op rows (target and bot result) and the run counts; replace the "Frame budget" row's
     result with Part C's numbers.
   - "Lessons from tuning": the cap binds at 4P, so HP, not spawn rate, sets the challenge.
   - §9: one line each for dmath, the platform layer, the galaxy worker, WebGL2 post-FX with the 2D
     fallback, WarpGrid and the co-op camera. Leave out any line a graphics step already added.
3. **`AGENTS.md`:** the new npm scripts and debug parameters.
4. **`docs/STEAM.md` §5:** point to `npm run store:assets` and `store-assets/`. Fix the icon count in
   `docs/design/steam.md` §7 to 46 (23 achievements).
5. **`docs/HANDOFF.md`:**
   - mark tasks 1–5 done with dates;
   - list the owner-only steps: Steam (`docs/STEAM.md` §2), the real-hardware perf check, Deck
     hardware, signing, merging to `main`;
   - list known issues from E.
6. **Push and CI:**
   - `git push origin claude/dazzling-faraday-2kxdhl` (normal push).
   - The PR diff always includes `desktop/**` (`main` is empty), so both `CI` and `desktop` run.
     `gh workflow run desktop.yml` does not work for the same reason (01 spec §5 step 6).
   - Watch with `gh pr checks 1` and `gh run list --branch claude/dazzling-faraday-2kxdhl`; read
     failures with `gh run view <id> --log-failed`.
   - **Green means all of these:**
     - `CI` / `test` (ubuntu: typecheck, unit, `build:single`, e2e desktop+mobile);
     - the three `desktop` `build` jobs (windows, macos, ubuntu): `npm run check`, the achievements
       check, the Linux desktop smoke, packaging, and the Linux packaged smoke.
     - `deploy` stays skipped.
   - The Windows and macOS packaged-smoke steps are `continue-on-error`. Open their logs and report
     whether they actually passed.
   - CI retries e2e once (`retries: 1`). A test that passed only on retry is flaky: fix it.
7. **PR description:** update it to cover:
   - what landed (tasks 1–5);
   - the check results;
   - the balance table and iteration log;
   - the perf table;
   - the QA contact-sheet summary (images are not committed; share `qa-shots/` with the owner as an
     archive);
   - the store-asset list;
   - known issues and the owner-only steps.
8. **Mark ready:** `gh pr ready 1` (or the "Ready for review" button). **Do not merge.**

## 6. Settings and save data

- No new settings or save fields in this task.
- It verifies the ones added by task 2 (desktop fullscreen in `desktop-settings.json`, not in `Settings`),
  3c (`Settings.postfx`) and 3d (`Settings.gridMotion`), through the fixture test in E3.
- The optional `?seed=N` and `?nohud` are URL-only debug parameters. They never touch the save or the
  Daily Run.

## 7. Accessibility, mobile, co-op and performance requirements

- **Accessibility:** B rows 2, 3, 5, 7, 8, 9, 10, 11 and 13 in reduced flashing; rows 3 and 8 at shake 0;
  row 9 at grid motion 0; row 15 in grayscale. Read E2.
- **Mobile:** B rows 1, 2, 13, 15, 16 and 17 at Pixel 7. The e2e mobile project stays green. The
  settings list scrolls with the new rows.
- **Deck:** B row 1 and the HUD at 1280×800. The smallest glyph is at least 9 px.
- **Co-op:**
  - B rows 12–16 and C scenario 3.
  - The balance bands in A3.
  - The HUD fits at 1280×720, 1920×1080 and Pixel 7.
- **Performance:** the budgets in C.

## 8. Tests to add or update

- `tests/balance.sim.ts` and `tests/helpers.ts`: A1 (`coop3`, shared seeds, `SIM_SEED_BASE`, rates,
  fight duration, optional `tickMs`). `vitest.sim.config.ts`: `silent: false`.
- `tests/coop.test.ts`: add "the scaling table is monotone in pilot count and solo is all ones".
  - Every `CoopScaling` multiplier of row 1 is exactly `1`.
  - `spawn`, `hp`, `bossHp`, `xpReq`, `surge`, `opening` and `maxEnemies` are non-decreasing over rows
    1–4, and `eliteEvery` is non-increasing.
  - `COOP_SCALING[4].maxEnemies <= 600`.
  Keep `the opening wave scales with the player count`: it reads row 4 by reference.
- `tests/meta.test.ts` (or `meta.coop.test.ts`): the E3 fixture test with
  `tests/fixtures/save-pre-wave3.json`.
- `scripts/desktop-smoke.mjs`: the D3 informational line, which must not fail the run.
- **Must not change:** `tests/golden.solo.test.ts`, `tests/determinism.guard.test.ts` (except to
  extend coverage) and `tests/no-p1-alias.test.ts`'s rules. The co-op tests that read `COOP_SCALING[2]`
  or the hard-coded `1.6` (`tests/coop.test.ts`, `xpNext` after a 2P level-up) must pass unchanged,
  because row 2 is frozen.
- `qa-shots`, `perf-bench` and `store-assets` are tools, not tests. Keep them out of `npm test`, `npm run
  e2e` and CI: they are slow and need WebGL.

## 9. Acceptance checklist

- [ ] `npm ci`, `npm run typecheck`, `npm test`, `npm run build`, `npm run build:single`,
      `E2E_PORT=<free port> npm run e2e` (desktop and mobile), `npm run steam:achievements -- --check`.
      All green.
- [ ] `npm run desktop:smoke`: all PASS. The packaged Linux smoke exits 0 (D4). Report the post-FX state
      under xvfb.
- [ ] `SIM_RUNS=48 SIM_ONLY=fresh,coop2,coop3,coop4 npm run sim` and the same with `SIM_SEED_BASE=5000`:
      3P and 4P inside every A3 band, 2P identical to before tuning. Paste both reports and the
      iteration log into the PR.
- [ ] `git diff <pre-task-4>..HEAD -- src/game` touches only rows 3 and 4 of `src/game/content/coop.ts`.
      `tests/golden.solo.test.ts` is unchanged.
- [ ] `npm run qa:shots`: every B row and variant captured and looked at, every defect fixed or filed;
      contact sheet shared with the owner.
- [ ] `npm run perf:bench`: the C table with the machine load, every budget met or explained by layer.
      Owner hardware result, or "not done".
- [ ] E lenses 1–7: each one done, with its findings and outcome listed.
- [ ] `npm run store:assets`: every required file at its exact size (the script asserts it), at least
      5 screenshots, no network requests, looked at for readability and original IP.
- [ ] Docs per G1–G5.
- [ ] Pushed. `CI` and all three `desktop` build jobs are green. The Windows and macOS packaged-smoke
      logs have been read. The PR description has been updated and the PR marked ready for review.
      Not merged.

## 10. Pitfalls and known issues

- **Bimodal outcomes.** A fresh run either falls to the Warden or snowballs, so medians swing by minutes
  between 12 and 24 runs (§2). Judge by rates over at least 24 runs, then confirm on 48 runs and on
  held-out seeds.
- **The old `coop4` is not comparable.** It used seeds 4000+ and 6 runs; A1 fixes both.
- **The bot is not a team.** Bots home in on downed teammates, so revives are frequent (4P median 7).
  Human squads revive less reliably, which makes real 4P somewhat harder than the sim. That is why the
  bands allow 3P/4P to sit slightly above 2P's challenge, not below it.
- **`spawn` changes rewards** (`scoreNorm` in `src/meta/result.ts`), and `tests/meta.coop.test.ts`
  reads `w.scaling.spawn` by reference. If you change `spawn` anyway, mention it in the PR.
- **Headless numbers.**
  - SwiftShader stalls cause p95 spikes in every method. Use alternating runs and report medians.
  - The post-FX auto ladder steps down within seconds headless, so always pin `?fxq`.
  - Wait for `galaxy.isReady` before timing or capturing: generation runs in a worker and the first
    frames can show the fallback.
- **Captures.**
  - A fresh save shows the opening crawl and the tutorial; seed `story.introSeen` and `tutorialDone`.
  - `?warp=N` plays the bot at skill 1 and can still die before N with a weak save; seed the veteran
    save. Top up `world.players[i].hp` only for a capture, and never in perf runs.
  - `?coop=N` without `?autoplay` leaves P1/P2 on idle keyboard slots.
  - Resizing the viewport mid-run re-runs `App.onResize`, which sets `world.viewHalfW/H`. It is harmless
    for captures, but do not reuse that page for perf.
- **Run seeds are random.** `App.startRun` uses `randomSeed()`, so captures differ between executions.
  If good frames are hard to find, add a debug-only `?seed=N` (to be created) to `readDebugParams` in
  `src/app.ts`:
  - it feeds `makeRunConfig({ seed })` and derives the bot streams from it;
  - it is ignored for Daily Runs;
  - a short e2e checks that it is inert without the parameter.
- **CI quirks.**
  - `workflow_dispatch` cannot be used: `main` is empty.
  - The macOS job has never reached packaging. A first-time universal-merge failure there is a
    packaging issue (`electron-builder.yml` `mac` section), not determinism. Fix it in its own commit.
  - The Windows and macOS packaged smoke is informational.
- **Electron.** `ELECTRON_SKIP_BINARY_DOWNLOAD` installs have no binary (D1). There is no ozone headless.
  WebGL2 under xvfb may fall back to 2D.
- **Doc drift.** `docs/design/steam.md` §7 says 42 achievement icons; it is 46 (23 achievements).
  `docs/design/steam.md` §10's smoke record lives on the original build machine.
  `scripts/desktop-smoke.mjs` is the reproducible record now.

## 11. Out of scope

- Any gameplay change beyond rows 3–4 of `COOP_SCALING`: revive rules, new content, solo or 2P
  retuning.
- Re-capturing the golden master.
- Steamworks configuration, uploads (`desktop.yml` `deploy`), the store page, pricing, IARC, code
  signing and notarisation, and Deck hardware testing. These are the owner's (`docs/STEAM.md` §2).
- The trailer, a UI-scale setting and Steam leaderboards.
- Merging PR #1 into `main` and the GitHub Pages deploy.
- Committing generated images.
