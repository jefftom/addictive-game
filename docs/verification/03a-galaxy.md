# Task 3a: galaxy integration evidence

Local acceptance completed on 2026-10-11 (UTC). The WIP source `df7a114` was
preserved by merge `2224fe9`, on top of task 1 follow-up `b29d9d1`. CI is pending
on the finishing commit; the next task must wait for both workflows.

## Changes

The four sector palettes, inline worker, chunked fallback, presentation-only
warp, audio riser/boom and sector cards are integrated. `genStats` replaces the
generation map's conflicting name. Electron permits local blob workers and both
network checks accept only blobs belonging to their own application origin.

The card occupies the upper callout area in landscape, reserving 80 UI units
above boss callouts, and remains below the ship in portrait. Pause, upgrade and
victory dialogs hold the warp and card clocks. Hitstop and slow-motion retain
real-time transitions. Forced-boundary anticipation is a pure helper tested at
357.4, 537.4 and 597.4 seconds. Amethyst's gas lightness cap was lowered from
0.20 to 0.18 after full-pixel checks caught camouflage under the grid; its hue
and colour-identity checks still pass.

No changes to `src/game`, the golden data, determinism guard, P1-alias guard or
font tests relative to `b29d9d1`. No gameplay timing, spawn calming, bullet clear
or simulation RNG calls were added.

## Verification

- Clean dependency install, typecheck and production build passed.
- 361 unit tests passed, including 18 new colour/anticipation checks. Every
  second tile pixel at quality 0.5 is checked against all specified gameplay
  colours, including all four pilot colours; colour identity is also guarded.
- 46 browser tests passed across desktop and Pixel 7; 8 existing input/device
  exclusions remained unchanged. The 14 new checks cover worker generation,
  render-only event order, cards, modal freezing, full-pixel contrast and both
  worker-failure paths.
- Coverage tests found zero uncovered pixels for all sectors, all four warp
  phases, three camera positions, and normal/maximum co-op zoom. Coverage is
  checked after the initial fade-in has finished.
- All 49 Windows Electron smoke checks passed, including worker generation and
  the Deck fullscreen lock. Steam was explicitly disabled for this run.
- `build:single` produced a 482,540-byte standalone file (471.2 KiB), 75,957 bytes
  above task 2. Opening it through `file://` loaded the worker without errors.

## Frame cost and readability

Headless Chromium 141.0.7390.37 on Windows, software rendering flags
`--disable-gpu --use-angle=swiftshader --enable-unsafe-swiftshader`. Each stable
draw measurement is the median of three batches of 30 moving-camera frames,
including a one-pixel readback. Background includes galaxy, stars and grid.
The prior production build at `b29d9d1` supplies the matched legacy comparison.
These measurements do not establish real-laptop GPU performance.

| Viewport | Sector | Galaxy ms | Background ms | Background at zoom 1.45 ms |
| --- | --- | ---: | ---: | ---: |
| 1280×720 | Turquoise | 0.263 | 0.343 | 0.453 |
| 1280×720 | Garnet | 0.203 | 0.360 | 0.360 |
| 1280×720 | Amethyst | 0.413 | 0.407 | 0.453 |
| 1280×720 | Gilded | 0.477 | 0.510 | 0.617 |
| 1920×1080 | Turquoise | 0.610 | 1.670 | 0.983 |
| 1920×1080 | Garnet | 0.667 | 1.950 | 1.290 |
| 1920×1080 | Amethyst | 1.350 | 2.787 | 1.687 |
| 1920×1080 | Gilded | 1.320 | 2.717 | 1.723 |

Legacy background: 3.220 ms at 720p and 7.227 ms at 1080p. Galaxy-only and whole
background costs meet their budgets. Readback/caching variance explains why some
zoomed samples are faster; these are direct costs, not an asserted zoom speedup.

Warp averages use three 132-frame sweeps. Turquoise→Garnet and Amethyst→Gilded
average 2.87/3.16 ms at 720p (worst 8.7/10.1 ms), and 6.72/7.83 ms at 1080p (worst
17.9/20.8 ms). All average budgets pass. Peak retained image memory is 13.36 MB
at 720p and 29.69 MB at 1080p, within 14/32 MB limits.

Full central-box pixels, beat 0.5 and four camera positions:

| Viewport | Sector | Worst camouflage share | L P99 |
| --- | --- | ---: | ---: |
| 1280×720 | Turquoise | 0.436% | 0.245 |
| 1280×720 | Garnet | 0.168% | 0.223 |
| 1280×720 | Amethyst | 0.306% | 0.206 |
| 1280×720 | Gilded | 0.135% | 0.237 |
| 1920×1080 | Turquoise | 0.299% | 0.242 |
| 1920×1080 | Garnet | 0.072% | 0.213 |
| 1920×1080 | Amethyst | 0.137% | 0.201 |
| 1920×1080 | Gilded | 0.195% | 0.230 |

All are below 0.5% camouflage and 0.27 luminance. The colour list excludes only
the backdrop colours and non-hex entries, as specified. Alternate-pixel sampling
missed some one-pixel grid strokes: the original Amethyst cap reached 0.629%
at 720p and 0.512% at 1080p. Full-pixel readback exposed this and now runs in e2e.

`galaxy-final.json` contains the final sequential matched benchmark and contrast
receipt. Earlier trials are retained too. `galaxy-corrected.json` ran alongside
screenshot capture and exceeded timing limits under that contention; its timings
are excluded from acceptance. The final run had no concurrent test or capture
workload. Synchronous generation timings inside these draw probes are test
setup only; the independent startup probe below measures the actual worker.

A separate unmodified-worker startup probe found sector 0 ready at 392 ms over
HTTP and 382 ms from the standalone file at 1080p. Worker response handlers took
0.5 ms; generation recorded zero main-thread busy time. Boot frame intervals
included 33.3–33.4 ms before completion, so this does not claim every application
startup frame is below 33 ms. Generation itself ran in the worker. Both failure
modes are independently tested with chunked generation on the main thread.

## Visual review and remaining boundaries

Screenshots and machine-readable measurements are outside the repository in
the local task's `outputs/task-03a-galaxy` directory. Captures include every
sector at 720p, 1080p, Pixel 7 portrait (412×839 CSS) and landscape (863×360 CSS),
the four warp phases, warning/death cards at all four sizes, reduced flashing
and shake 0, four-pilot play, maximum zoom background, and title/results.
All final captures were inspected. Compared with the prototype, colour
identities are distinct while enemy rims, bullets and pickups remain brighter.

The dense capture uses seed 1000, rank 1 and the existing skill-1 warp bot:
420 naturally spawned enemies at 120.033 seconds, with Garnet/Amethyst selected
only in render state. Most enemies are outside the camera, so the receipt states
the world count rather than claiming 420 simultaneously visible enemies. The
results capture uses seed 2000, a valid veteran workshop and 610.017 simulated
seconds, reaching sector index 3; returning to results/title restored index 0.
Scene staging, seed selection and frozen capture frames live only in the
external Playwright harness, with no committed capture-only controls.

Reduced flashing uses the original softer punch/static decorative motion;
tunnel streak alpha is unchanged. Audio cue wiring was exercised by browser
transitions; subjective listening remains part of player review. The optional
results fade polish was left unchanged. Existing title overflow at short
landscape heights is visible in the captures and remains a task 4 UI-review
item. Co-op camera and pilot rendering remain task 3e work.
