# Task 3d: WarpGrid evidence

Based on `c3a1ca62a535de053830b1c6c549574860c39121`, after task 3c's CI
and all desktop jobs passed. Work branch: `wip/wave3-grid`.
Local verification: 2026-10-11. Remote CI remains the gate before 3e.

## Implementation and review

The reviewed spring mesh replaces the static background grid and draws between
the galaxy/stars and gameplay objects, using the same world transform as the
ships. Its force map covers kills, blasts, capital deaths, bombs, player deaths,
revives, co-op downs, dashes, hurt, shield breaks and level-ups. Continuous
wakes, pull mines, Void Heart wells and nova fronts read existing world state.
Ghosts do not receive level-up kicks. No simulation files or RNG streams change.

Prototype physics, palette, force strengths, brightness tables and fixed pools
are preserved. Spacing is chosen at resize/reset, with a shared sizing formula
and a 1,800-point cap. Co-op reserves the maximum zoom view without per-frame
reallocation. Reset clears exposure. Galaxy arrival clears the mesh and starts
its own front. Fronts advance through hitstop/slow-mo and freeze with modals.

Grid motion is saved independently of shake. Old/malformed values inherit a
finite, clamped shake value; explicit zero stays zero. One accessibility fix
beyond the prototype stops existing displacement and velocity immediately when
motion changes to zero, preserving front/glow state. Tests cover this live change.

The initial 2D benchmark exposed the post-FX ladder running while enhanced
graphics was deliberately disabled. Frame-time feedback now runs only while
post-FX is active. A deliberate opt-out selects cost tier 4, grid quality 1 and
60 Hz, even after automatic fallback; automatic fallback retains tier 0,
hairlines and 30 Hz. The FPS label distinguishes those states. The final 2D
measurement below verifies the corrected path; the earlier diagnostic is kept.

The first remote browser run (`38119079754`) failed eight timing checks with
software WebGL readback stalls; its traces and logs are retained. All three
desktop jobs (`38119079729`) passed. The quality controller previously discarded
every frame over 250 ms, so sustained severe stalls could never lower quality.
It now bounds those samples to 250 ms instead: one tab-switch gap does not lower
quality, while sustained stalls reach the unchanged fallback ladder. Shader
programs and the approved 12/15 q3 draw counts are unchanged. Regression tests
cover invalid samples, a single long gap, sustained 500 ms frames and pinned
quality.

Browser CI uses one worker to avoid sharing the runner's CPU between two
software GPU workloads; it retains Playwright's default browser backend. Forcing
GPU canvas rasterization was tested locally but intermittently retained HUD
pixels in the mobile overlay-clear check, so that configuration was discarded.
Its failure evidence is preserved. No browser assertion, timeout, retry count
or test exclusion was weakened. The local software-raster diagnostic
measured title frame intervals of 27.7 ms with the grid versus 22.6 ms before it;
disabling only grid drawing returned 22.6 ms. Hardware acceptance remains open.

Review confirmed no change to `src/game/`, golden replay, either determinism/P1
guard, or the existing smoke test's world-image check. Mesh typed arrays allocate
at construction/resize; force pools stay at eight kicks and six fronts. Palette
styles rebuild only when the sector tint changes. The old galaxy gridRGB field
had no other consumers and was removed.

## Checks

- Fresh `npm ci`, strict typecheck and normal/single-file builds pass. Recovery
  validation has 431 passing unit tests (430 on the original grid commit).
- Browser tests cover bounded meshes, boss fronts, persistent settings, old saves,
  quality transitions and returning from co-op to solo spacing. The final suite
  passes all 75 tests, with eight unchanged device exclusions and the new
  desktop-only co-op grid test excluded on mobile as specified. No retries.
- Windows Electron: all 49 checks pass with Steam explicitly disabled for the
  test process. The owner's Steam client was left running.
- Standalone HTML is 575,617 bytes (562.1 KiB; 575,585 before the recovery) and opens through `file://`, with an active 1,380-point grid and
  enhanced graphics, no page errors and no HTTP requests.
- Recording-context tests enforce rest, storm, elite, well, capital-front and
  reduced-flashing stroke brightness limits; zero-motion displacement, heat,
  impulse merging/budgets, front clocks, palette and spacing are checked.
- Co-op maximum-zoom and solo coverage pass at camera (5200, -3100), with ±16
  world-unit shake. The smallest recorded margin is about 62 px (61.8 at the
  spec's rounded scale). Pixel 7 has 920 points in either orientation.

## Performance

Headless Chromium, SwiftShader with GPU rasterization enabled, DPR 1. Each run
has 270 live heavy-combat frames, discarding the first 30. The fixture requests
400 living enemies and 60 scripted kills per simulation second through the real
kill/event path. Additional normal kills/splits remain possible; the co-op run
ended with 434 enemy entries and about 100.5 total kill events/s. Grid motion is
explicitly 1, independent of the fixture's shake 0.

| View / mode | Points / spacing | Grid mean ms | p50 | p95 | Hot fraction mean | Exposure mean |
|---|---|---:|---:|---:|---:|---:|
| 1080p q3, 60 Hz | 1632 / 32 | 0.338 | 0.3 | 0.5 | 0.024 | 0.999 |
| 1080p deliberate 2D, 60 Hz | 1632 / 32 | 0.363 | 0.4 | 0.5 | 0.017 | 1.000 |
| 1080p q0, 30 Hz | 1632 / 32 | 0.310 | 0.3 | 0.5 | 0.031 | 1.000 |
| 720p q3, 60 Hz | 1380 / 32 | 0.323 | 0.3 | 0.5 | 0.041 | 0.982 |
| 1080p four pilots q3, 60 Hz | 1749 / 44 | 0.353 | 0.3 | 0.5 | 0.098 | 0.909 |

All required grid mean budgets pass. Renderer draw + consume means are 2.75,
2.137, 2.254, 2.890 and 4.337 ms respectively. These are CPU submission timings,
not complete rendered frames. Mean software-backend frame intervals are
94.9–195.7 ms; up to four membrane steps occur per frame under saturation.
The task 3c fully flushed performance limitation remains open for task 4.
Real midrange iGPU raster/frame acceptance remains unmeasured on this host.

## Visual evidence

Evidence lives outside the repository in `outputs/task-03d-grid/`, with source
capture scripts and raw benchmark JSON retained alongside the images. The three
available prototype screenshots were compared. Captures cover title, normal
fight, all four sector storms, capital death at +0.03/0.15/0.3/0.5/0.8 seconds
and the subsequent warp/modal, bomb, Singularity, Void Heart, dash, nova,
player death, arrival, co-op, Pixel 7 portrait/landscape and mobile settings.
Storm and capital-death variants include reduced flashing, motion 0, 2D and
shake 0. Every final frame was inspected.

The lattice remains cool in crimson/gold sectors and subordinate to ships and
plasma. Wells and wakes bend it visibly. Mobile hairlines remain faintly visible
at DPR 2 without widening; the settings row fits and the list scrolls. No exposed
right/bottom grid sliver was observed in these fronts. Motion-zero captures have
exactly zero mesh displacement; post-FX refraction still follows shake as designed.
Reduced-flashing captures have zero grid flare. Existing dense-scene readability,
short-window title layout and comms overlap remain part of tasks 3e/4.

Stable interfaces for 3e/4: `renderer.grid`, `gridMs`, `spacing`, `pointCount`,
`maxHeat`, `hotFrac`, `exposure`, `flare`, `stepsLast`, `impulsesIn`,
`impulsesApplied`, `gridSpacingFor`, `GRID_MAX_POINTS`, `GRID_TINTS`, `coolRGB`,
`gridEvent`, `gridFrame`, `GridWorldView`. Zoom enters through the existing view
transform; do not resize the mesh for per-frame zoom changes.
