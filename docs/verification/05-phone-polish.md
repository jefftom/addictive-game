# Solo phone polish — 2026-10-18

Baseline: `aa727d2358adae8af7ede1745f2c3dbe9e901f93` on
`claude/dazzling-faraday-2kxdhl`. This is a presentation/input pass; no game
simulation, balance table or golden fixture changed.

## Changes

- Coarse-pointer phones retain the reviewed shaders and original art, with a
  world-buffer limit of 1.25 pixels per CSS pixel. At capped DPR 2 this is
  render scale 0.625, about 61% fewer world-buffer pixels. Output and HUD retain
  native capped DPR. The q3 pass count stays 12 normal / 15 surge.
- Coloured enemy hulls survive hit feedback; dark hostile-bullet separation,
  a stronger pilot locator/shadow, fewer numbers and decorative particles make
  crowded fights easier to read. Reduced flashing and shake settings still apply.
- Portrait health, timer/boss and score occupy separate areas. DASH is 76 CSS
  pixels across, respects bottom/right safe areas, and remains independent of
  the 52-pixel floating stick. An 18% dead zone filters finger jitter, followed
  by continuous speed control. Blur, cancellation and rotation release input.
- The phone effect budget also applies in plain 2D. The decorative grid steps
  at 30 Hz; deterministic gameplay still steps at 60 Hz.

## Validation and reproducibility

Local strict TypeScript, 454 unit tests (26 suites), normal/single-file builds,
91 browser cases (13 unchanged device exclusions), and 49 Windows Electron
checks passed. The original solo HUD call snapshot and deterministic golden
remain unchanged. Browser cases exercise real two-finger Chromium touch events,
dead-zone speed, simultaneous dash, cancellation, queued-action cleanup,
portrait/landscape/320-pixel layouts and native HUD versus scaled world buffers.
The final small-phone timer positioning is also covered by a unit layout check.

Windows Playwright WebKit separately loaded 390×844 and 844×390 touch contexts:
WebGL2, inline galaxy worker, phone budget and touch DASH worked without page
errors. Its in-session viewport resize retained the initial canvas height even
when `innerHeight` changed, so that attempt is retained as a harness limitation;
it is not a passing Safari rotation test. Chromium rotation cases pass.

`npm run qa:phone` captures seven phone scenes and performs three alternating
before/after timing rounds for q3 and 2D. Set `PHONE_BASELINE` to the baseline
`dist` directory, `PHONE_OUT` to an evidence folder, and optionally `PHONE_MODE`
to `shots` or `perf`. The workload uses seed 1000, a veteran save, 400 live
enemies and 60 synthetic kills/second. Timings include renderer event consumption
and draw submission over 240 frames, dropping the first 30. Performance runs
use normal damage and a fixed 1/60 simulation step. Visual fixtures protect the
pilot; these screenshots are explicitly labelled synthetic and are not balance
or survival evidence. Warden composition also protects the pilot.

Evidence is in `F:\addictive-game-handoff\2026-10-18-phone`: final screenshots in
`visuals-delivery`, baseline comparisons in `visuals-reviewed`, raw benchmark
samples in `performance`, and test/build logs. Initial failures and superseded
captures are retained. The grid test originally assumed a 60 Hz 2D grid on
phones; it now explicitly tests the intended 30 Hz cadence and its next step.

## Remaining acceptance

The benchmark is desktop software-renderer submission cost, not phone FPS.
Physical Android/iPhone sustained frame rate, thermal behaviour, browser chrome,
safe areas, rotation and thumb comfort still need a device playtest. Dense
400-enemy weapon effects can still fill much of the screen; this pass does not
claim an unrestricted readability or 60 FPS guarantee. Previous co-op balance
and hardware gaps in task 4 remain open. PR #1 remains open for review; no main,
Pages or Steam deployment is part of this checkpoint.

Suggested device check: play a normal solo run for 10 minutes in each orientation,
try steering while dashing, background/restore the browser, and compare Enhanced
graphics on/off plus reduced flashing. Record device/browser, temperature/thermal
throttling, sustained FPS, missed gestures and whether hazards remain readable.
