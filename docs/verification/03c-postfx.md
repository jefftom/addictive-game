# Task 3c: WebGL2 post-processing evidence

Implementation based on `402a2f796986ae842be6923709fca6f135b323f5`, after
task 3b passed CI and all desktop jobs. Work branch: `wip/wave3-postfx`.
Local verification: 2026-10-11. Remote run links are recorded after push.

## Implementation and review

The world renders offscreen, uploads to WebGL2 and presents on `#fx` beneath
the native-resolution `#game` HUD/input canvas. Damage numbers, callouts and
sector cards stay on the overlay. The same path serves the attract demo.
Enhanced graphics defaults on, migrates old/malformed saves, persists an
explicit opt-out, and retries auto-off only on an off/on setting edge.

The reviewed shader pipeline, constants and quality levels are preserved.
One correctness fix admits major events when all eight wave slots contain
stronger waves; minors still obey the strength replacement rule and 3/s bucket.
The owner explicitly chose to preserve the reviewed pipeline and document
the actual **12 normal / 15 surge draws at q3**, resolving the spec's conflicting
11/14 estimate. This is not a claim that the original numerical limit passed.

The renderer restores both sprite caches to full glow on fallback, frees the
world canvas to 1×1, keeps simulation view extents independent of render scale,
and copies the current world under the overlay before a mid-frame failure
can free it. Hurt aberration is shared across pilots and limited to one kick
per 0.4 seconds. The low-HP edge considers every up pilot. Modal galaxy clocks
and the entity draw order are preserved.

No changes under `src/game/`, to the input module, golden replay, determinism
guard, P1-alias guard, or co-op/story browser specs. `?fx=0`, `?fxq=N`,
`postfx`, `postFxActive`, `setPostFx`, `costTier`, `worldCanvas`, `hudCtx`,
the shared view transform, `flashBudget` and galaxy punch fields are available
to tasks 3d/3e.

## Local checks

- Strict typecheck and 411 unit tests, including wave admission/refill,
  quality hysteresis, pinning/retry, accessibility uniforms, loss/restore,
  zoom/scale anchoring and save migration.
- Final browser suite: **66 pass**, eight unchanged device exclusions.
  The 16 post-FX cases cover both desktop and Pixel 7, including unavailable
  WebGL2, resolution/overlay state and preservation of a mid-frame failure.
- Windows Electron: 49 checks pass with `SHARDSTORM_NO_STEAM=1`; the owner's
  running Steam client was left untouched. Post-FX availability/active state
  is included in the run-start smoke diagnostic: both were **true** locally.
- Standalone HTML: **559,675 bytes (546.6 KiB)**, up from 536,820 bytes.
  Opened through `file://`: enhanced graphics active, simulation past four
  seconds, no page errors or HTTP requests. Bundled fonts and worker retained.

## Performance and remaining acceptance limits

Chromium/ANGLE **SwiftShader (Subzero)**, Windows, GPU rasterization enabled,
360 live frames at each viewport, first 30 excluded, about 400 living enemies,
60 scripted kills per simulation second. Fixture randomness is seeded;
normal simulation/weapon effects continue. Timings include post-FX upload.

| Viewport | Post-FX median / p95 | consume mean / p95 | whole renderer + consume mean / p95 |
| --- | --- | --- | --- |
| 1280×720 | 0.5 / 0.8 ms | 0.062 / 0.2 ms | 2.928 / 4.4 ms |
| 1920×1080 | 0.4 / 0.7 ms | 0.065 / 0.2 ms | 2.452 / 3.8 ms |

The 1080p post-FX median and consume targets pass. These are JS timings;
they do not imply 60 fps under software GL. Scene evolution differs between
viewports, so the table is not a pixel-count scaling comparison.

Frozen frames use 25 measured samples after five warmups. A separate 1×1 probe
flushes the Canvas 2D path; `postfx.finish()` plus a probe flush the GL path.
No world/HUD canvas is repeatedly read back. At 720p, 2D median/p95 is
56.6/60.2 ms and q0×0.75 is 54.2/59.1 ms. At 1080p, 2D is 56.0/59.6 ms and
q0×0.75 is **65.3/69.1 ms**: the spec's lowest-rung-faster-than-2D criterion
**does not pass on this software backend**. Keep this open for task 4 rather
than changing the reviewed pipeline to fit one software driver.

Shape-sprite pixels at equal native scale fall from 10,002 to 4,395 at 720p
(−56.1%), and 36,222 to 16,148 at 1080p (−55.4%). At the 1080p lowest rung the
shape cache is 7,130 pixels. Vessel cache counts remain 98–101.

A separate diagnostic with GPU rasterization disabled is preserved: upload
median 22.4 ms, total post-FX median 22.5 ms at 1080p. Its frozen 2D/q0×0.75
medians are 40.6/61.2 ms. CPU-canvas uploads are expensive; the ladder correctly
falls back, rather than hiding this configuration from the report.

The natural auto-mode stress run stepped q2 → q1 at 1.25 s, q0 at 3.72 s,
q0×0.75 at 7.10 s, and off at 10.39 s after the run-start observation began
(the controller already observed title frames). Its 12-second wall window
contained 4.23 sim seconds, 254 scripted kills and one budget drop. A separate
controlled 10-second effect-clock storm at 60 kills/s, with 400 living aliens
and 10% elite spawns, dropped 60 minor waves and peaked at four live waves.
Major-event saturation is independently unit-tested.

Boot compiled five programs / ten shaders in 10.6 ms from WebGL context
creation return to the final link-status query. The local NVIDIA RTX 5070 Ti
is not a midrange iGPU laptop. **Owner iGPU hardware check: not done.**
The accepted refresh-rate limitation remains: 50 Hz, battery saver and
background throttling can walk the ladder down despite spare GPU capacity.

## Visual and accessibility evidence

Evidence is outside the repo in `outputs/task-03c-postfx/`: paired 2D/q3
frames for title, 40-second play, Warden, a live Warden death after 0.3 seconds,
Bastion nova, low HP plus hurt, 400-enemy storm, four pilots, reduced flashing,
shake 0, warp plus bomb, and Pixel 7 title/run/settings. Loss/restore, lowest
rung and standalone frames are included. Every final frame was inspected;
prototype boss-death/storm references were compared. Frozen scene edits are
capture-only; boss death and nova go through the live game event path.

At warp preview 0.555, measured punch + flash alphas are 0.45 in 2D and 0.35
under post-FX, or 0.15 with reduced flashing in either mode. Sprite punch
scales are 1 and 0.6 respectively. No white-out; plasma/hulls and native HUD
remain readable. Reduced flashing sets aberration and streak uniforms to
zero; shake 0 submits zero waves. The new mobile settings row fits and the
list scrolls. The pre-existing short-desktop title top clipping remains in
task 4's layout review queue.
