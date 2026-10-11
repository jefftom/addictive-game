# Task 4/5 verification

Working checkout: `F:\addictive-game`, `wip/verify`, based on `95b6d05` after
all task 3e remote gates passed. Date: 2026-10-11. Merged at `467d047`, with the
mobile focus recovery below on the PR branch. Generated evidence is kept outside Git.

## Balance method and constraints

Harness commit `9100a10` makes all fresh profiles use seeds `SIM_SEED_BASE + i`
(default 1000), adds 3P, removes 4P's six-run limit, and prints Warden/10:00
rates and fight durations. `SIM_TICK_MS=1` times only `world.update` at 350+
enemies; bot inputs are prepared before the timer. `SIM_OUTPUT_DIR` optionally
saves complete per-seed results. Veteran profiles use base + 1000; clumsy keeps
its separate block. These tools do not alter simulation RNG or gameplay.

The 24-run post-determinism baseline uses rank 1, skill 0.6, alternating
Spark/Vanguard in co-op and a 660-second ceiling. Solo and 2P rows, shared
revive constants, and the solo golden are frozen. Only 3P/4P row values change.

An existing cap distinction matters: `spawnEnemy` limits regular enemies but
admits scheduled bosses beyond that setting. The frozen baseline itself reaches
421 total enemies at solo's 420 setting and 501 at 2P's 500. A trial with the
old 4P setting of 600 reached 601 and correctly failed the unchanged hard-limit
assertion. The new 597 setting reserves room for the three scheduled bosses;
the observed 4P total must still pass 600. The spec's stricter total-at-most-row
wording is not met by the existing boss exemption. Changing that spawn rule is
outside this task's allowed rows and is recorded as a gameplay follow-up.

Final configuration: trial 13. Both 48-seed blocks and every iteration are
recorded in [the balance receipts](04-balance.md).

| Squad | Median survival (s) | Warden killed | Reached 10:00 | Level at 1:00 | Warden fight (s) | Downs / revives |
|---|---|---|---|---|---|---|
| 1P | 374.3 | 28/48 (58.3%) | 9/48 (18.8%) | 6 | 50.3 | 0 / 0 |
| 2P | 402.1 | 37/48 (77.1%) | 14/48 (29.2%) | 5.5 | 63.2 | 2 / 1 |
| 3P | 412.5 | 35/48 (72.9%) | 10/48 (20.8%) | 6 | 72.7 | 5 / 3.5 |
| 4P | 435.8 | 34/48 (70.8%) | 12/48 (25.0%) | 6 | 93.2 | 9 / 6.5 |

Held-out seeds 5000–5047:

| Squad | Median survival (s) | Warden killed | Reached 10:00 | Level at 1:00 | Warden fight (s) | Downs / revives |
|---|---|---|---|---|---|---|
| 1P | 343.6 | 20/48 (41.7%) | 8/48 (16.7%) | 6 | 32.3 | 0 / 0 |
| 2P | 421.1 | 35/48 (72.9%) | 10/48 (20.8%) | 6 | 59.6 | 2 / 1 |
| 3P | 398.8 | 30/48 (62.5%) | 4/48 (8.3%) | 6 | 77.6 | 5 / 3 |
| 4P | 415.7 | 38/48 (79.2%) | 10/48 (20.8%) | 6 | 94.1 | 8 / 5 |

The main quantitative bands pass. Held-out rate bands pass with the specified 5-point slack, but the 4P median Warden fight is 94.08 s versus a limit of 89.40 s (1.58× 2P). Outcome difficulty is not strictly monotone: 4P reaches 10:00 in 12/48 main seeds versus 3P's 10/48, and on held-out seeds 4P beats the Warden in 38/48 versus 3P's 30/48 and reaches 10:00 in 10/48 versus 4/48. Multiplier rows are monotone. The 4P hard total cap passes at 598 ≤ 600; scheduled bosses still exceed the regular-enemy row cap (also true in frozen solo/2P). These are disclosed balance acceptance gaps, not an all-bands pass. Trial 14 shortened fights but worsened the main 10:00 rate, so trial 13 is the documented playtest candidate; solo/2P and shared revive mechanics stay unchanged.
Bots do not coordinate like humans; a short real 3–4 player session remains
necessary to assess revive reliability and how the fights feel.

## Review findings

1. **Determinism:** the task 4 simulation diff is limited to rows 3 and 4.
   The golden history contains only task 1's deliberate deterministic-math
   recapture. A temporary `Math.sin` in `world.ts` was rejected by the guard;
   the original file was restored and verified byte-for-byte. The consumer
   scan finds no simulation RNG use. Its `w.t` match in post-FX is a local
   visual wave, not `World`; App matches are the existing loop bookkeeping.
   Debug `?seed=N` is URL-only, unsigned 32-bit and ignored for Daily Runs.
2. **Accessibility:** review reproduced a pulsing solo low-HP edge even with
   reduced flashing. `lowHpPressure` now holds it steady and caps it at 0.15;
   normal flashing keeps the same formula. Passive-rank text at Deck resolution
   was 8.42 px solo / 7.37 px co-op: it now has a 9 px floor there. The frozen
   720p solo HUD snapshot is unchanged. A title capture at 1280×720 clipped
   the logo's kicker; safe centering and compact spacing/font sizes fix it.
   Regression tests cover those cases and keyboard access to the new settings.
3. **Save migration:** `tests/fixtures/save-pre-wave3.json` comes from the actual
   `3d3e601` default schema with played progress/settings filled in. Deep equality
   proves every field survives, `postfx` defaults true and `gridMotion` inherits
   shake. Corrupt JSON defaults safely; `shardstorm.save` and the version stay
   unchanged. Desktop migration remains covered by the real Electron smoke.
4. **Single-file/Pages:** Chromium loaded the standalone HTML from `file://`
   and the normal build from `/game/`. Both loaded Tektur, Chakra Petch and Kode
   Mono, ran the inline galaxy worker and pinned post-FX, and recorded zero page
   errors and external requests. `dist-single/embed.html` exists.
5. **Platform/security:** the shell retains its isolated preload, sandbox and
   app-protocol CSP. The existing smoke checks bridge isolation and absence of
   Electron/Steam imports in the web bundle. Per task 2's explicit scope,
   timeout/hydration races and macOS native fullscreen preference persistence
   are deferred (see Known issues in HANDOFF).
6. **Original IP:** new visible copy uses the game's own fleet/ship/alien names.
   Store tools use procedural game art and bundled OFL fonts only. Valve's
   current capsule/library rules were checked; the hero has no text and the
   transparent logo contains only SHARDSTORM. Every generated image is reviewed
   before handoff.
7. **Code health:** `PENDING_MIGRATION` stays empty and `App.coopToasts` remains
   removed. No tests were loosened or skipped to accept a failure. Debug seed
   logic is inert without its parameter. Final checks are recorded below.

## Performance and visual acceptance

The approved q3 pipeline remains **12 normal / 15 surge GL draws**, per the
owner's decision. Earlier software-backend findings remain valid evidence:
1080p q0×0.75 was slower than plain 2D in task 3c, and task 3e's first live-frame
comparison exceeded +1 ms before a controlled fixed-step comparison passed.
Those measurements are preserved in the corresponding verification reports.

The final composed benchmark uses three alternating runs, 360 frames with the
first 30 discarded, and one normal 1/60-second App step per rendered frame.
An initial wall-time-driven attempt let software stalls advance different
amounts of combat and its 2D pilot died before 360 frames; that failed receipt
is retained as `perf-live-failed.json`. The controlled benchmark changes no
health, damage or invulnerability. The synthetic storm uses real spawn/kill
events at 60 kills per simulation second; about 89% of sampled frames are
playing and the remainder are normal bot upgrade pauses. Mean live count is
400.4–400.5, with transient additions from regular spawning/splitting.

Windows x64, Ryzen 9 9900X, 24 logical CPUs, 65,128 MiB RAM. The baseline sample
reported **61.99% CPU busy**, 34,525 MiB free RAM; this shared host was not idle.
The GL string confirms ANGLE/Vulkan **SwiftShader**, not the host RTX 5070 Ti.
These are loaded-host diagnostic measurements, not real-GPU frame-rate proof.

| Scenario | Mean / p50 / p95 (`consume` + `draw`, ms) | Background mean | Grid mean | Post-FX p50 / upload p50 | Consume mean |
|---|---|---|---|---|---|
| 1080p storm, q3 | 30.246 / 34.4 / 44.4 | 0.106 | 0.214 | 32.0 / 32.0 | 0.061 |
| 1080p storm, 2D | 2.953 / 2.9 / 3.9 | 0.107 | 0.258 | 0 / 0 | 0.048 |
| 720p storm, q3 | 21.933 / 22.7 / 31.5 | 0.103 | 0.234 | 19.9 / 19.8 | 0.064 |
| 4P maximum spread, q3 (trial 12) | 8.188 / 7.8 / 11.0 | 0.108 | 0.210 | 6.3 / 6.2 | 0.016 |
| 4P maximum spread, q3 (final trial 13) | 9.921 / 10.2 / 12.5 | 0.121 | 0.220 | 8.3 / 8.2 | 0.015 |

The 1080p all-layer 7/14 ms and post-FX 0.5 ms hypotheses **fail** here;
texture upload/driver blocking dominates. Background ≤2 ms, grid ≤1 ms,
consume ≤0.25 ms and the 2D ≤7 ms budget pass. The trial-12 co-op median mean
meets 8.5 ms, though its third run alone was 10.19 ms. The final trial-13
recheck fails that target at 9.921 ms, again dominated by the 8.2 ms upload.
That separate run had 28.65% host CPU busy and 37,843 MiB free; 56.4% of its
frames were playing, with normal bot upgrade pauses accounting for the rest.
Mean live enemies were 71.8; no HP protection was added. The entity delta was already measured in task 3b
(+0.464 ms mean / +0.65 ms p95); no entity runtime code changes in task 4.

The same-page heap run kept every render layer, regular damage and browser GC:
title **4.49 MiB**, at 121.45 seconds **6.37 MiB**, at 600.03 seconds **8.52 MiB**
with the pilot alive. Growth **2.15 MiB**, below the 50 MiB investigation threshold.
Title plus ready galaxy took **0.77 seconds**. No forced GC was used. Balance
trial 13 ran concurrently with the latter part of the heap run, after all
timed renderer samples were complete; its tick timings therefore include load.

Final Node simulation costs at 350+ enemies (main / held-out, mean and p95 ms):
solo 0.113/0.169 and 0.141/0.215; 2P 0.150/0.273 and 0.180/0.292;
3P 0.169/0.285 and 0.173/0.314; 4P 0.178/0.326 and 0.216/0.401.
All pass the 1 ms mean / 2 ms p95 simulation budget.

The composed matrix has **104 images** across all 19 scenario groups, including
1080p, 720p, Pixel 7 and Deck-size captures; default, 2D, reduced flashing,
zero shake/grid motion, grayscale pilot marks, and WebGL loss/restore. Every
image was inspected in contact sheets, with full-size checks of the crowded,
mobile, boss, title and accessibility cases. Capture-only fixtures are labelled
in `captures.json` and the script. A frozen-frame comms overlay and zero-age
last-stand callout were corrected in the tool; modal and event retakes were
reviewed. The capture tool now waits through the initial galaxy fade as well
as worker readiness; title/2D/menu retakes and the scrolled mobile settings
footer were inspected. No external requests or page errors were accepted.

The dark sector backgrounds, crisp HUD and grayscale pilot marks pass visual
review. The synthetic 400-enemy pile can still obscure the pilot with local
shards/callouts, and forced maximum spread lets tags and ghost labels overlap
the HUD. Both are filed in HANDOFF for the relevant presentation layers; this
is not a claim of complete combat-readability acceptance.

`store:assets` produced **22 files**: seven required capsule/library art files,
one transparent 1280×232 logo, a 1438×810 background, nine 1920×1080 gameplay
screenshots, a 184×184 JPEG community icon, a 1024×1024 PNG application icon,
and two event images. Native PNG/JPEG dimensions are asserted from their saved
headers. All images were inspected; a leaking pause control and enlarged-cache
blur were fixed in the generator and the affected art regenerated and reviewed.
The hero has no text; the logo alpha spans 0–255 with 124,922 fully transparent
pixels. Capsule text is only the game name. Gameplay shots preserve the HUD;
synthetic storm/spread fixtures are labelled. No external art, images or fonts
are used. Optional 46 achievement icons and the trailer are not generated.
The final 4P store shot retains maximum zoom but places captains inside the
HUD bands; the QA captures retain the maximum-leash overlap finding.

The installed electron-builder icon converter successfully derived both ICO
(89,986 bytes) and ICNS (1,626,316 bytes) from the generated PNG in an isolated
output directory. An isolated Windows packaging run also accepted the PNG
through `--config.win.icon`, and its packaged smoke exited 0 at `app://game`
with Steam disabled and an isolated user-data directory. No application-icon
configuration was changed; the release
packages retain their existing default icon until the owner adopts the art.

Midrange iGPU laptop acceptance: **not done**. Physical Steam Deck acceptance:
**not done**. This Windows RTX 5070 Ti host and SwiftShader measurements cannot
prove those hardware targets.

## Evidence and final gates

Local receipts: `outputs/task-04-verify/` in the Codex task folder; generated
images and measurement outputs: `qa-shots/` and `store-assets/` in the F: checkout.
Scripts are committed; generated images are not.

Local gates: `npm ci`, `npm run check` (448 tests in 25 suites),
`build:single`, achievements check, and 87 Playwright tests passed. The 13
browser device exclusions are unchanged; no test needed a retry. Keyboard
and controller-navigation handlers both reach the new graphics settings.
Standalone size after focus recovery is 588,623 bytes / 240,884 gzip bytes,
including bundled fonts.
The Windows Electron smoke passed 49 checks with post-FX active at q3 and
the galaxy worker active. The final default-icon Windows package passed
its smoke at `app://game`, isolated storage, Steam disabled, exit 0.

The PR receives the final remote CI links and actual Windows/macOS packaged
smoke outcomes after the push. Readiness requires green web CI and all three
desktop jobs, with no flaky browser retries. No merge, Pages deployment or
Steam upload is part of this checkpoint.

### Mobile focus recovery

The first final web run, [38130274256](https://github.com/jefftom/addictive-game/actions/runs/38130274256),
failed the new mobile settings-focus check on both attempts: the focused
Enhanced graphics checkbox ended at CSS y=839.3125 in an 839-pixel viewport.
86 other browser cases passed; the 13 device exclusions were unchanged.
All desktop jobs and their actual packaged smokes passed at `467d047`.

Settings focus now scrolls the whole labelled row into view, with an 8-pixel
scroll margin. This keeps the control and its focus ring away from fractional
scroll rounding at the viewport edge. The strict test bounds are unchanged.
The debug/settings/title suite passed 18 repeated desktop/mobile cases locally;
typecheck, all 448 unit tests, normal and standalone builds also passed again.
The initial failed run and both traces remain in the evidence. The full remote
suite must pass on the recovery commit before the PR is marked ready.

The next web run, [38131231935](https://github.com/jefftom/addictive-game/actions/runs/38131231935),
passed the focus bounds but found the pointer counterpart: scrolling on
checkbox focus could move it between pointerdown and click, so the mobile
post-FX checkbox did not toggle. Both attempts failed; all other cases and
all desktop jobs passed. The second correction limits focus-event scrolling
to `:focus-visible` and explicitly reveals rows for directional keyboard/
gamepad navigation in `moveFocus`. Pointer focus keeps the native behavior.
Neither failing test nor its assertion was changed. Both failed runs/traces
are retained. Typecheck, 448 unit tests and both builds passed again.
The complete local desktop/mobile suite then passed 87 tests in 3.7 minutes,
with 13 unchanged device exclusions and no retries, including both regressions.
