# Task 3b: entity art integration evidence

Local acceptance completed on 2026-10-11. Base: `f003dc5`, after task 3a's
CI and all desktop jobs completed. Implementation branch: `wip/wave3-entities`.
Remote validation is recorded after the merge is pushed.

## Implementation

The three entity modules were ported from the in-tree prototype. Renderer
hunks were reconciled individually with the galaxy integration. No prototype
snapshot replaced an existing game file. Simulation changes are only the four
optional kill-event fields (`kind`, `angle`, `kx`, `ky`), including knockback
from the killing blow. The golden replay, P1-alias migration list and
determinism guard are unchanged.

All five fleet vessels share the same painter in gameplay and menus. Solo
keeps class accents and the selected exhaust cosmetic; co-op uses each pilot's
colour. Downed pilots have the specified grey-violet hull at 0.35 alpha,
without engines, lights, shields or afterimages. Hangar, lobby, results and
the fleet log use the same art, including grey silhouettes for locked ships.

Timer and HP scales are clamped. Capital-ship animation follows simulation
dt, with frame-rate-independent neck easing and zero-dt freezing. Reduced
flashing uses steady invulnerability alpha and the prototype's softened
lights and shatter. Boss kill flashes were additionally brought under the
specified 80 ms / 0.6 alpha caps. Enemy plasma is last in the world layer,
above vessels and effects; cooled debris is below live enemies.

## Stable interfaces for the next steps

- `EntityFx.drawVessel`: world coordinates through the last `begin` view;
  accent, alpha, ghost, thrust, bank and scale options. Restores canvas state.
- `paintVessel`: local +x forward; incoming alpha multiplies internal layers.
  Bank squash affects hull and nozzle/light positions, not flame geometry.
  Hull-only blink alpha does not dim engines or running lights.
- `vesselIcon`: square menu canvas, default nose up, steady idle lights/flames;
  locked icons use the ghost variant without engines/lights.
- `setGlowScale`, `postFx`, `setCostTier`, `prewarm`, `shards.count`, `art.size`;
  `SpriteCache.setGlowScale` / `pixelCount` are ready for task 3c.
- `warmPilots` prioritizes roster accents and remembers them through cache
  rebuilds; giants Daily radii and elite parts are also queued. Resolution is
  independent of camera zoom and bounded to 1–4 pixels per world unit.
- All task 3a galaxy hooks and modal-clock behavior remain intact.

## Checks

| Check | Result |
|---|---|
| TypeScript | Pass |
| Unit suite | 395 tests, 19 files; golden and guards unchanged |
| Browser suite | 50 pass; 8 unchanged device-specific exclusions |
| Production build | Pass |
| Single HTML | 536,820 bytes (524.2 KiB), from 482,540 bytes (471.2 KiB) |
| Standalone `file://` | Sim advances, 96 baked sprites, finite HP, zero page errors or HTTP requests |
| Windows Electron | 49 checks pass with `SHARDSTORM_NO_STEAM=1` |
| Diff checks | No whitespace errors; only allowed simulation fields |

The first local desktop smoke invocation detected the owner's running Steam
client, so its four no-Steam assertions failed. The documented per-process
opt-out then passed all 49 checks without changing tests or stopping Steam.
This is fallback verification, not Steam distribution acceptance.

New tests cover kill metadata, negative gunship timers, six shatter recipes,
flash caps, quality/pool limits, pilot colours and every geometry entry.
Browser checks exercise menu art, mobile overflow, drawing-state preservation,
one-draw ghost hulls and capital-ship animation at 60/120 Hz and zero dt.
Galaxy pixel checks now include the fleet rim and glow colours.

## Performance

Six alternating baseline/entity runs, 1920×1080, frames 30–359 of each
360-frame run, approximately 400 live enemies and 60 scripted kills per
simulation second through `World.killEnemy`. Baseline is a saved build of
`f003dc5`. Both versions use the same seeded fixture generator, separately
from render randomness. Chromium ran software raster/SwiftShader; these
measure renderer JavaScript, not a hardware 60 fps certification.

Median across the six runs, milliseconds:

| `consume + draw` | Baseline | Entities | Increase |
|---|---:|---:|---:|
| Mean | 1.323 | 1.787 | 0.464 |
| p50 | 1.25 | 1.70 | 0.45 |
| p95 | 1.85 | 2.50 | 0.65 |

Every paired mean increase is below 1 ms (worst 0.779); every paired p95
increase is below 3 ms (worst 1.6). Entity run means span 1.651–2.107 ms.
The final scenes had 400–408 enemies, 148–200 live shards and 104–105 cached
sprites. The final boss-flash duration/alpha adjustment followed this benchmark;
the fixture kills non-bosses only, so it does not exercise that changed path.

| Entity method | Mean | p50 | p95 |
|---|---:|---:|---:|
| drawEnemies | 0.709 | 0.7 | 1.0 |
| drawPlayers | 0.099 | 0.1 | 0.2 |
| drawShards | 0.075 | 0.1 | 0.2 |
| drawDebris | 0.034 | 0 | 0.1 |
| drawTelegraphs | 0.034 | 0 | 0.1 |
| onEvent | 0.022 | 0 | 0.1 |
| begin | 0.012 | 0 | 0.1 |
| drawBullets | 0.010 | 0 | 0.1 |
| drawProjectiles | 0.007 | 0 | 0.1 |
| drawLightning | 0.005 | 0 | 0.05 |

The queue checks a 2 ms frame budget between indivisible sprite bakes. As in
the prototype's documented limitation, one large bake can exceed that budget;
it is not a hard per-bake deadline. Captures and steady-state benchmarks drain
the warm queue before measurement. No iGPU laptop is attached; this host has
an RTX 5070 Ti, so laptop GPU acceptance remains for the final hardware pass.

## Visual evidence

Evidence lives outside the repository in the task's
`outputs/task-03b-entities/`: full frames and device-resolution crops for all
five ships in idle/thrust/bank/dash poses; every enemy and an elite; three
bosses; four galaxy sectors; kill storms; reduced flashing; four co-op accents
and a downed ghost; menu art; Pixel 7 run, Hangar, lobby and results; standalone
HTML; twelve benchmark images and JSON measurements. Contact sheets preserve
the originals. Final captures were inspected against prototype references.

Scene staging is confined to capture scripts outside the repo: deterministic
warps, pose/charge values, close roster positions, spawning an enemy lineup,
health top-ups and scripted kills. These are art checks, not balance outcomes.
The touch-only title deliberately hides co-op; the mobile lobby layout was
opened through the existing debug handle. All measured screens have zero
horizontal overflow. The existing narrow lobby status line is close to its
bottom cards; include it in task 4's layout review. Task 3e still owns camera
zoom, pilot marks/tags, revive rings, edge cues and the co-op HUD.
