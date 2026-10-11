# Task 3e: co-op rendering evidence

Base: `b5ee3c35eba7945993953b4447262d95bde1c589`, after task 3d passed
CI and all desktop jobs. Work branch: `wip/wave3-coop-render`.
The independent solo-HUD guard commit is `e9be690`; its snapshot is frozen.
Local verification date: 2026-10-11. Remote gates are required before task 4.

## Local checks

- Typecheck and **444 unit tests** in 25 files pass, including the immutable
  solo HUD log, golden replay, empty P1 allowlist and the new camera/pilot/comms
  contracts.
- **81 browser tests pass** across desktop and Pixel 7, without retries.
  Thirteen exclusions comprise the nine existing device exclusions plus four
  new desktop-only co-op rendering checks, as specified.
- Normal and single-file builds pass. The standalone HTML is **587,788 bytes**
  (574.0 KiB). `file://` co-op runs with two captains, enhanced graphics and the
  inline galaxy worker active, loaded fonts, no console errors and no HTTP
  requests.
- Windows Electron passes **49 smoke checks** without Steam, including the
  offline worker, save migration, bridge isolation and Deck fullscreen rules.
- The focused camera/revive/HiDPI steering/comms browser run also passed all
  26 applicable checks. Other existing co-op and story assertions are unchanged.

## Changes and review

One camera transform supplies world drawing, backdrop parallax, grid, effects,
native damage text, pilot overlays and input projection. Solo follows the old
look-ahead/damping formula exactly; co-op uses squad centre/velocity and the
simulation's zoom. Bounds include ghosts and reserve the HUD band when it fits,
falling back to symmetric margins and then the bounding-box centre. The base
view extents and sprite bake resolution remain independent of zoom.

Pilot identity uses vector marks plus P1–P4 labels, with health arcs, ghost
revive circles, last-stand halos, leash glows and offscreen arrows. Panels show
per-captain health, dash, shield, build and revive state at three width tiers.
Damage and pickup feedback follows its recipient. Shared celebrations use the
team centre. Down/revive/last-stand announcements retain screen-reader parity
without adding visible DOM toasts. The live region retains four messages.

Comms uses an eight-per-second maximum occlusion probe with a 0.4-second clear
hold. It caches the panel rectangle and invalidates it on show, resume, resize,
orientation change and animation completion. CSS filter opacity reaches 0.3;
entrance/exit opacity animation remains independent. Portrait docking is
preserved and co-op landscape comms/toasts clear the panel band.

Reduced flashing freezes dash rotation, halo/border/leash pulses and caps panel
HP flashes; shake zero applies to the down cue. No new per-frame blur is used.
The existing 3b ghost hull, 3c waves and 3d force hooks remain in place. The
reviewed post-FX pipeline still has 12 normal / 15 surge q3 draws, as approved.

S1–S5: steady CSS projection with an explicit device-pixel input conversion;
exact sim zoom without a second filter; square-root zoom compensation for
ships/tag placement/damage text with true-radius revive and magnet circles;
solo-only low-health screen edges; **LAST CAPTAIN STANDING** copy.

No simulation, save-format, golden replay or determinism guard changes.
`PENDING_MIGRATION` is empty; its regex and pid method table are unchanged.
The solo canvas call log is byte-for-byte unchanged in Git. Captured desktop
and Pixel 7 HUD layers also compare with **zero changed pixels**.

## Performance

Headless Chromium, 1920×1080, SwiftShader with GPU rasterization, 600 frames
per scene, seed 1000 for four players and surviving seed 1001 for solo. Invulnerable
pilots, autoplay from 240 seconds, normal automatic quality ladder. Timers wrap
the production functions in scratch builds; no instrumentation ships.

| Component | Mean ms | p95 ms | Mean budget |
|---|---:|---:|---:|
| Solo HUD before / after | 0.177 / 0.173 | 0.3 / 0.3 | delta within ±0.05 |
| Four-player camera | 0.0063 | 0.1 | 0.02 |
| Four-player overlay | 0.0502 | 0.1 | 0.25 |
| Four-player HUD | 0.3307 | 0.5 | 0.4 |
| Comms probe, 600 enemies + 400 bullets | 0.0253 | 0.1 | 0.05 |
| Comms update, per frame | 0.0098 | 0.1 | — |

The comms run made 75 probes in 9.987 seconds (7.51/s), with **one layout read**
across 600 frames. Camera follow loops existing player arrays and copies scalar
values from the simulation's scratch helpers, allocating nothing per frame.

The initial live-frame comparison measured consume+draw at **3.4445 → 4.7662 ms
mean** (+1.3217, above the +1.0 target), p95 3.2 → 5.2 ms. The slower software
frames also advanced the game farther (266.78 → 271.08 seconds), so a second
comparison fixes the simulation input to 0.05 seconds per rendered frame while
retaining real browser frames and the automatic quality ladder. It measures
**3.5485 → 4.4043 ms mean** (+0.8558, within target), p95 3.6 → 5.1 ms. Both
finish at approximately 264.75 seconds and average 111 enemies. That matched
comparison's HUD is 0.3432 ms and overlay 0.0517 ms.

All initial and controlled samples are retained. Do not equate the controlled
JS budget with a universal live-frame guarantee: the initial overage remains
part of task 4's performance review. Shader/texture transitions produce large
outliers on this software backend. Actual frame intervals are 67–96 ms, so these
are JS timing measurements, **not 60 fps or iGPU laptop acceptance**.

## Visual checks

Evidence is outside the repository under `outputs/task-03e-coop-render/` in
the task workspace. `captures.json`, contact sheets and original PNGs cover:
two/four captains; maximum zoom, bomb, particles and aligned damage numbers in
FX/2D; down at zero/mid-revive, revived, two/four-player last stand; actual
opposing keyboard flight to the leash; 720p/1080p/Pixel 7 portrait/landscape/
360px compact panels; solo before/after; dimmed desktop/portrait/raised co-op
comms; reduced flashing/shake zero; and offscreen safety arrows. Every capture
was inspected, with the narrow HUD checked at full resolution.

The vertically spread squad cannot always fit above the panel band. The specified
camera fallback and panel translucency keep those pilots visible. Closely grouped
ghosts can overlap their world labels; per-captain panels and marks remain
distinct. Task 4 retains the broader dense-scene and hardware review. Dedicated
down/revive/last-stand audio and a co-op title demo remain out of scope.
