# Warp grid v2: integration guide

The warp grid replaces the static beat grid in `Background.draw` with an infinite spring-mass energy grid. Gameplay forces bend it: kill ripples, travelling shock fronts, gravity wells and dash wakes. Lines that are strained glow hotter. This is **v2**: it applies the art review (grid section plus the global brightness budget). It was tuned against the **all-layers build**: galaxy v2, warp grid, entities (vessels and crystal armada) and post-FX, all in one game copy.

v1 is archived in `v1/`, including its notes, patches and shots.

---

## 1. Files

| File | What it is |
|---|---|
| `grid.ts` | **`WarpGrid`**. Becomes `src/render/warpgrid.ts`. It has no imports, does not allocate after `resize()`, and passes the strict single-file `tsc` (strict, `noUnused*`, `verbatimModuleSyntax`). |
| `gridfx.ts` | Maps events and world state to grid forces; all tuning lives here. Becomes `src/render/gridfx.ts`. It is co-op aware: it reads `world.players[]` and never the P1 alias, so it passes `tests/no-p1-alias.test.ts`. |
| `combo-head/` | **The all-layers game copy on current repo HEAD `687bc97`** (story, Steam and co-op fixes, sector tracking in the sim). It is the `combo/` layer commits cherry-picked onto a snapshot of `687bc97`. The only conflict was `meta/save.ts` `migrate()`: keep upstream's `out.story = …` line and add the `gridMotion` line after it. `src/` typechecks. The only `tsc -p .` error is `tests/story.test.ts:100`, a `kill` event literal that lacks entities' 4 new fields, which is an entities issue. |
| `combo/` | The same layers on the older base `8456790`. All captures and timings were taken from this build (`game-dist/`). Its render files are byte-identical to `combo-head/`'s, because upstream did not touch `src/render`, `app.ts` or `ui.ts`. |
| `siblings-merged.patch` | `687bc97` → galaxy + entities + post-FX, with the `renderer.ts` conflicts resolved. This is the base the grid patch applies on. The `8456790` versions are archived in `orig/base-8456790/`. |
| `integration.patch` | **The warp-grid integration** (`687bc97` + siblings → + grid). It touches `renderer.ts`, `background.ts`, `app.ts`, `meta/save.ts` and `ui/ui.ts`, and adds `warpgrid.ts` and `gridfx.ts`. |
| `game-dist/` | `combo/` built. |
| `harness.ts`, `harness.html`, `tools/shoot.mjs` | Standalone harness: live galaxy backdrop, stars, WarpGrid, game sprites and particles. It runs scripted scenarios through the same `gridfx`. `--measure` is the brightness-budget probe; `--perf` is the benchmark. |
| `tools/combo.mjs` | **Real-game captures of the all-layers build** under a fake clock. `--perf` measures in-game JS cost. |
| `tools/strip.mjs`, `tools/crop.mjs`, `tools/micro.mjs` | Contact strips, crops, and the canvas stroke micro-benchmark from v1. |

Commands. Run them all with `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`:
- `node tools/shoot.mjs [--only=kill,boss] [--measure] [--perf]`
- `node tools/combo.mjs [--build] [--only=storm,bossdead,...] [--perf]`

---

## 2. API (`src/render/warpgrid.ts`)

```ts
const grid = new WarpGrid({ spacing?: 32, majorEvery?: 5 });
grid.resize(viewW, viewH);     // visible WORLD size (+ shake margin; x ZOOM_MAX in co-op). Allocates only when growing.
grid.reset();                  // zero displacement, pending kicks and fronts (run start, sector arrival)
grid.setRate(60 | 30);         // integration rate (30 = lowest auto-quality rung)

// one-shot (world units; strength = units/s of velocity kick); lvl = heat permit (see §3)
grid.impulse(x, y, radius, strength, lvl = 2);   // radial kick; queued, merged within 64 u, ≤ 8 applied per frame
grid.shock(x, y, maxRadius, strength, speed = 900, lvl = 5, flare = 0, band = auto); // travelling front
grid.wake(x0, y0, x1, y1, strength, radius = 72, lvl = 3); // dash wake along a segment
// continuous (call every frame with dt; strength = units/s²)
grid.implode(x, y, radius, strength, dt, swirl = 0.55);   // gravity well: heat x0.5, capped at level 3
grid.ring(x, y, radius, band, strength, dt, lvl = 3);     // shove along a moving ring front

// per frame
grid.update(dt, camX, camY, frontDt = dt);  // re-anchor + flush kicks + advance fronts + fixed-step integration
grid.draw(ctx, camX, camY, k, w, h, '#rrggbb', beat);   // device px; sets its own transform; source-over hairlines

// knobs (renderer sets these every frame from settings; see §5)
grid.motion        // 0..1 force scale. The remainder becomes glow-only heat, so motion 0 = never moves, events still glow.
grid.maxLevel      // 5, or 3 with reduced flashing
grid.flareAllowed  // boss-death / bomb fronts may exceed the bloom threshold; false with reduced flashing
grid.beatPulse     // calm-line beat brightening: 0.5 default, 0 with reduced flashing
grid.brightness    // (1 - 0.25 x intensity) x galaxy warpFx.gridAlpha
grid.quality       // 0 = hairlines (post-FX on; bloom is the halo) | 1 = + offset-hairline halo on levels 4-5 (2D fallback)
grid.edgeFade      // calm lattice fade outside the play ellipse (0.55)
// stats: pointCount, maxHeat, hotFrac, exposure, flare, stepsLast, impulsesIn, impulsesApplied

export function coolRGB(hex): [r, g, b];   // clamps any tint to hue 190-270°, saturation ≤ 0.45, lightness 0.5-0.7
export const GRID_TINTS = ['#6aa6c4', '#8a8acc', '#8e80d6', '#7e96bc'];  // sectors 0-3 (cool variants)
```

Changes from v1: `push()` is removed (the brute and boss dents were cut). Quality 2 is removed. `forceScale` became `motion`. The `blasts` argument of `gridFrame` is gone, because the grid owns its fronts. This replaces review item 10 (entities' `ghost: true` blasts): the grid starts its own `shock()` from the `kill` (elite) and `explode` events in `gridEvent`, so it needs no renderer blast entries, ghost or not. It also stays correct if entities or post-FX change how blasts are drawn. New: `shock()`, `setRate()`, the `lvl` arguments, `motion`, `flareAllowed`, `beatPulse`, `edgeFade`, `coolRGB`, `GRID_TINTS`, and `frontDt`.

---

## 3. How it works (and what the review changed)

**Review checklist** (grid section and global section):

| # | Review asked | Status |
|---|---|---|
| 1 | Hot lattice far too bright: alpha 0.45/0.40 → 0.28/0.22, `WHITE_MIX` 0.32 → 0.12, hot lines under the bloom threshold | **Done, as a per-level peak budget instead of fixed alphas** (table below). Alpha is solved from the target max channel, so the budget holds for every tint. `WHITE_MIX` is 0.12. Measured hot ≤ 0.35 at p99.9 (single-pixel max 0.365 at line crossings); only flare fronts pass 0.45. |
| 2 | Cool grid in every sector (hue 190–270°), cool-shifted `gridTint` | **Done.** `coolRGB()` clamps every tint; `GRID_TINTS` has one per sector. |
| 3 | Screen-wide impulses → travelling front plus a small central kick | **Done.** `shock()` pool; boss death, bomb, player death, revive, elite, perfect and big explosions. |
| 4 | Wells: heat at ~30% or capped at level 3; Void Heart 480 → 320 | **Done, with heat at 50%** (pushback: at 30% the funnel is unreadable on galaxy v2). Cap 3 and r 320 as asked. |
| 5 | Kill-ripple budget: merge within 64 u, ≤ 8 per frame, ordinary kills ≤ level 2 | **Done** (merge queue + heat permit). |
| 6 | Cut brute and boss dents and the nova-spawn impulse | **Done.** `push()` removed. |
| 7 | Reduced flashing: no beat pulse; beat default 0.5; shake 0 = no motion; "Grid motion" slider defaulting to shake | **Done.** `beatPulse` 0.5 or 0; `motion` with no minimum (heat still shows events); slider plus save migration. |
| 8 | Post-FX on → quality 0; 2D fallback → quality 1; delete quality 2 | **Done.** |
| 9 | Calm major alpha 0.14 → ~0.10; don't cage the planets | **Done.** Rest peak 0.075 (≤ 0.12 at a full beat), plus `edgeFade` outside the play ellipse where galaxy v2 places its centrepieces. |
| 10 | Take entities' `ghost: true` blasts so the grid sees elite and explode fronts | **Not taken; replaced.** The grid starts its own fronts from the `kill` and `explode` events (see §2). There is no dependency on renderer blast entries. |
| Global | Draw order step 2 (galaxy → grid → ground layer) inside the post-FX world canvas | **Done** (§5). |
| Global | Calm grid at most about 1.5x local backdrop brightness | Met where the backdrop is darkest (the centre, galaxy ≤ 0.22 against grid rest ≤ 0.12) and below it elsewhere. |
| Global | Auto-quality ladder also lowers the grid | **Hook provided:** `setRate(30)` and `quality`. The mapping is in §6; the controller belongs to post-FX. |

**Physics** (unchanged from v1):
- **Lattice:** 32-unit spacing. 1,334–1,600 points at every resolution (the camera keeps the visible world area constant).
- **Springs:** an anchor spring back to rest plus 4-neighbour Laplacian coupling. Symplectic Euler at a fixed 60 Hz, at most 4 steps per frame. Ripples travel at about 600 u/s.
- **Storage:** toroidal. Only scrolled-in rows and columns are cleared, and the outer 2 cells are heavily damped.

**Heat:** `|Laplacian| x 2.2 + |disp| x 0.4 + |vel| x 0.012`, in cells, plus the glow-only deposit. It is quantised into 6 levels. A shifted block stays cool; only bending glows.

**Brightness budget.** Each level has a **peak**: the max RGB channel of a major-line pixel over black. Line alpha is computed from it as `peak / maxChannel(style)`, so the budget holds for any tint.

| level | peak | flare peak (boss death / bomb) | used by |
|---|---|---|---|
| 0 (calm) | 0.075 (x (1 + 0.5 x beat) → ≤ 0.12) | — | rest lattice |
| 1 | 0.125 | — | ripple tails |
| 2 | 0.18 | — | ordinary kills (cap) |
| 3 | 0.245 | 0.24 | big explosions, novas, dash, wells (cap) |
| 4 | 0.29 | 0.40 | elites, perfect dash, player death |
| 5 | 0.34 | 0.54 | capital-ship death, bomb |

Minor lines are drawn at 0.6x. Hot colours keep the cool tint pushed to vivid, mixed toward cool white by at most 12% (v1 used 32%).

**Measured** (`tools/shoot.mjs --measure`, grid alone over black, 1080p, quality 1 including halo; `shots/brightness.json`). Values are the max channel, with the p99.9 in brackets:

| moment | normal | reduced flashing |
|---|---|---|
| rest, full beat | 0.12 (0.086) | 0.08 (0.06) |
| kill chain + elite | ≤ 0.365 (0.21) | ≤ 0.33 (0.20) |
| Warden death front | ≤ 0.58 (0.37), 0.01% of pixels above 0.45, for about 0.5 s | ≤ 0.33 (0.20) |
| Singularity pull and detonation | ≤ 0.31 (0.19) | ≤ 0.27 |
| Void Heart well | ≤ 0.255 (0.16) | ≤ 0.23 |
| dash wake | ≤ 0.255 (0.16) | ≤ 0.24 |
| chaos (300 enemies, 25 kills/s, Void Heart + Singularity) | ≤ 0.24 (0.15) | ≤ 0.22 |

Against the targets: grid at rest ≤ 0.12, hot ≤ 0.35, fronts ≤ 0.6. The hot target is met at p99.9; the single brightest pixel overshoots to 0.365 at line crossings. Only boss-death and bomb fronts cross the 0.45 bloom threshold, and only briefly.

**Heat permit** (review item 5). Each point carries a level cap, which decays at 7 levels/s back to **2**. Forces raise it inside their area: ordinary kill 2; explosion with r ≥ 60, nova, dash or well 3; elite, perfect or player death 4; capital ship or bomb 5. So ordinary kills top out at level 2 however many land, and a ripple that leaves an elite's area falls back to level 2.

**Kick budget** (review item 5). `impulse()` is queued. Kicks within 64 units of a queued one merge: strength-weighted position, strength `big + 0.3 x small`, radius `max + 0.15 x min`, max permit. At most 8 apply per frame. When the queue is full, a kick replaces the weakest one if it is stronger, and is dropped otherwise. In the 60-kills/s storm, about 60 kicks per second arrive and at most 8 per frame are applied.

**Travelling fronts** (review item 3). Boss death, bomb, player death, revive, elites, perfect dash and big explosions use `shock()`. It is a pool of 6 rings that expand at `speed` and push the mesh along a band (36–80 u), with strength fading toward `maxRadius`. Each also carries only a small central kick, so only the wave front glows and the screen never lights up all at once.

Fronts advance on **real time** whenever game time flows (`frontDt`). That includes hitstop and slow-mo frames that take no sim step: the renderer checks whether `world.hitstop` or `world.slowmoT` changed since last frame. Fronts also deposit their own glow (`GLOW_FRONT`) along the band, so the front reads even through hitstop and with grid motion 0. In the composed game every boss death starts a sector warp, and the galaxy fades the grid to 15% from about 0.1 s into the warp. With real time, the Warden front crosses most of the screen during the 0.3x death slow-mo, before the fade. The membrane itself still runs on sim time, so pause and hitstop freeze it.

**Wells** (review item 4, partly pushed back). Void Heart and Singularity are capped at level 3, and the Void Heart radius went from 480 to 320, as asked. Their strain counts at **50%** into heat, not the suggested 30%. At 30% on the darker galaxy v2 the funnel dropped to level 1 to 2 and could not be read in `combo-voidheart` (the boss's pull is a gameplay cue). At 50% the well peaks at 0.255 max channel (p99.9 0.16), which is still under the 0.35 hot budget, and the level-3 cap keeps it below the bloom threshold.

**Calm lattice** (review item 9). The major rest peak went from about 0.14 to 0.075 (≤ 0.12 at a full beat). It fades by 27% in a ring outside the play ellipse (0.42w x 0.40h semi-axes), and by 55% in the outer corners. Those corners are where galaxy v2 anchors its centrepieces (outside `PLAY_ELLIPSE`), so the lattice no longer cages the planets. This costs 2 extra paths.

**Cool tint** (review item 2). `draw()` passes every tint through `coolRGB`, which clamps it to hue 190–270° and saturation ≤ 0.45. `GRID_TINTS` leans slightly toward each sector inside that family. The renderer picks `GRID_TINTS[galaxy.sector]`. Galaxy v2's single `gridRGB` (`#707ec4`, hue 231°) is also valid input.

**Auto-exposure and intensity** are unchanged. If more than 10% of the mesh is at level 3 or above, the hot levels dim to as low as 0.45x (slow attack). `brightness` also drops by up to 25% in busy fights.

**Rendering** is unchanged in principle: 1 px hairlines with `source-over`. In SwiftShader, hairlines raster about 5x cheaper than wide strokes, and `lighter` doubles the cost. The paths are 8 buckets x major/minor, and buckets with no points are skipped. Quality 1 adds 2 offset hairlines on levels 4–5.

---

## 4. Event → force map (`gridfx.ts`)

**One-shot (`gridEvent(g, ev, world)`, first line of the `consume()` loop):**

| event | force | permit |
|---|---|---|
| `kill` ordinary | `impulse(x, y, 80+4r, 220+12r)` | 2 |
| `kill` elite | `impulse(x, y, 100+4r, 420)` + `shock(x, y, 150+6r, 2600, 750)` | 4 |
| `kill` boss | `impulse(x, y, 240, 800)` (the front comes from `bossdead`) | 5 |
| `explode` r ≥ 60 (Singularity, big mines) | `impulse(x, y, 50+1.2r, 300+2r)` + `shock(x, y, 1.7r, 2000, 650)` | 3 |
| `explode` r < 60 (missiles) | `impulse(x, y, 50+1.5r, 260+3r)` | 2 |
| `bossdead` | `impulse(x, y, 260, 900)` + `shock(x, y, 1500, 5200, 1000, flare 1, band 80)` | 5 |
| `bomb` | `impulse(x, y, 220, 700)` + `shock(x, y, 1800, 5200, 1400, flare 1, band 80)` | 5 |
| `death` (player) | `impulse(x, y, 180, 700)` + `shock(x, y, 1000, 4200, 800, flare 0.4)` | 4 |
| `revive` | `shock(x, y, 800, 3600, 900)` | 4 |
| `perfect` | `impulse(x, y, 150, 450)` + `shock(x, y, 280, 3000, 900)` | 4 |
| `dash` | `wake(x-50dx, y-50dy, x, y, 420, 80)` | 3 |
| `hurt` | `impulse(x, y, 110, 260)` | 2 |
| `shieldbreak` | `impulse(x, y, 150, 420)` | 3 |
| `levelup` | `impulse(p, 240, 380)` for every live pilot | 3 |
| `ring` (nova spawn) | **removed**: the ring front already pushes (review item 6) | |

**Continuous (`gridFrame(g, world, prev, dt)`, once per frame before `update`):**

| source | force |
|---|---|
| each pilot with `dashT > 0` | `wake(prev, cur, 420 x dt x 60, 84)`, permit 3 (frame-rate independent) |
| Void Heart (spawned, alive) | `implode(x, y, 320, 3000 x (hp < 50% ? 1.4 : 1), dt, 0.6)` |
| triggered pull mine (Singularity) | `implode(x, y, 2.2 x radius, 6500, dt, 0.8)` |
| `world.rings` (Bastion nova) | `ring(x, y, radius, 44, 2400, dt)`, permit 3 |
| brute / boss dents | **removed** (review item 6) |

The sector warp is wired in the renderer's `Background` callback. On `warp-punch`: `grid.reset()`, then `grid.shock(cam, 1300, 3600, 1100, lvl 4)`, an arrival ripple across the new sector.

---

## 5. Exact integration points

Apply `siblings-merged.patch` (or the three sibling patches in this order: galaxy, entities, post-FX), then `integration.patch`. Spelled out:

### `src/render/renderer.ts`
- **Imports:** `gridEvent, gridFrame` from `./gridfx`; `GRID_TINTS, WarpGrid` from `./warpgrid`; `ZOOM_MAX` from `../game/content/coop`.
- **`RenderSettings`:** add `gridMotion: number`. The default object gets `gridMotion: 1`.
- **Fields:** `readonly grid = new WarpGrid()`, `gridTint`, `gridMs` (profiling; can be dropped), `private readonly gridPrev = new Float32Array(8)` (4 pilots), `private gridZoom = 1`, `private gridHit = 0`, `private gridSlow = 0` (detect hitstop / slow-mo progress).
- **`bg` construction:** the galaxy event callback becomes `(e) => { if (e.t === 'warp-punch') { this.grid.reset(); this.grid.shock(this.camX, this.camY, 1300, 3600, 1100, 4); } this.onGalaxy?.(e); }`.
- **`resize()`:** after `fx.setResolution`, call `this.resizeGrid()`, which is `grid.resize(cssW/scale x gridZoom + 60, cssH/scale x gridZoom + 60)`.
- **`applyFxMode()`:** `this.grid.quality = on ? 0 : 1`.
- **`reset(world)`:** `gridZoom = world.coop ? ZOOM_MAX : 1; resizeGrid(); grid.reset();` then seed `gridPrev` from `world.players`.
- **`consume()`:** the first line in the event loop is `gridEvent(this.grid, ev, world)`.
- **`draw()`:** after `fx.begin(...)` and before `bg.draw`:
  ```ts
  const flashes = this.settings.flashes;
  G.motion = clamp(this.settings.gridMotion, 0, 1);
  G.maxLevel = flashes ? 5 : 3;  G.flareAllowed = flashes;  G.beatPulse = flashes ? 0.5 : 0;
  G.brightness = (1 - this.intensity * 0.25) * this.bg.galaxy.warpFx.gridAlpha;
  gridFrame(G, world, this.gridPrev, dt);
  // fronts on real time while game time flows (hitstop / slow-mo included); frozen on pause and level-up
  const flowing = dt > 0 || world.hitstop !== this.gridHit || world.slowmoT !== this.gridSlow;
  this.gridHit = world.hitstop; this.gridSlow = world.slowmoT;
  G.update(dt, this.camX, this.camY, flowing ? Math.max(dt, Math.min(rdt, 0.05)) : 0);
  ```
  `bg.draw` is then called with `bgCamX/bgCamY`, the shaken camera, which is unchanged. **Immediately after it** (and after the `debugBgOnly` early-out):
  `this.gridTint = GRID_TINTS[max(0, galaxy.sector) % 4]; G.draw(ctx, bgCamX, bgCamY, k, w, h, this.gridTint, this.beat);`
  This gives draw order step 2 of the global order: galaxy → **grid** → ground layer → … In post-FX mode `ctx` is the world canvas, so the grid goes through bloom.
- **Co-op zoom:** when the co-op wave makes `k` zoom-aware (`k = scale x dpr / world.zoom`), pass that same `k` to `G.draw`. The mesh is already sized for `ZOOM_MAX`.

### `src/render/background.ts`
Delete the "Grid (world space, pulses on the beat, fades out through a warp)" block at the end of `draw()`, and drop the now-unused `SECTORS` import. Keep the `beat` parameter, which galaxy v2 still uses. `PAL.grid` and `PAL.gridMajor` in `palette.ts` become unused.

### `src/meta/save.ts`, `src/app.ts`, `src/ui/ui.ts` (the "Grid motion" setting, review item 7)
- `Settings.gridMotion: number` (0..1), with `defaultSettings()` giving `gridMotion: 1`.
- In `migrate()`, for saves without the field: `out.settings.gridMotion = out.settings.shake`, so it defaults to the player's shake choice.
- `app.applySettings`: `gridMotion: s.gridMotion` into `renderer.settings`.
- `ui.ts`: `${slider('gridMotion', 'Grid motion', st.gridMotion)}` under "Screen shake", plus the matching `read()` line.

### `src/render/sprites.ts`, `src/game/types.ts`, `src/game/world.ts`
**No change for the grid.** `gridfx` uses event fields that already exist (`x, y, r, elite, boss, dx, dy`) and the existing world arrays. The entities layer needs its own 4 `kill` fields; see §8.

---

## 6. Settings and fallbacks

| condition | grid behaviour |
|---|---|
| post-FX active | `quality 0` (hairlines); bloom supplies the halo. Hot lines stay below the bloom threshold, so only flare fronts bloom. |
| 2D fallback (no WebGL2, `?fx=0`, context lost, auto-off) | `quality 1` (+ offset-hairline halo on levels 4–5), switched in `applyFxMode()` together with the sprite glow scale. |
| reduced flashing (`flashes = false`) | `maxLevel 3`, no flare, `beatPulse 0` (no full-screen brightness flicker at music tempo). Measured ≤ 0.33 everywhere. |
| grid motion 0 | no displacement at all. Forces deposit glow-only heat instead (it decays at 5/s), so kills, fronts, wells and dashes still show as heat without anything moving. Intermediate values split the two. |
| screen shake | no longer drives the grid (that is the separate slider; old saves copy their shake value into it). |
| sector warp | `brightness x warpFx.gridAlpha` (fades to 15% through the tunnel); reset plus an arrival front on `warp-punch`. |
| pause / hitstop | the membrane freezes (sim dt = 0); fronts freeze while paused (`frontDt = 0`). |
| auto-quality ladder (post-FX item 9) | proposed mapping for the post-FX controller: q3–q1 → grid unchanged; q0 → `grid.setRate(30)`; post-FX off → 2D mode, `quality 1`. Below that, the renderer can skip `G.draw` entirely. |

---

## 7. Performance

All numbers are from headless Chromium with **SwiftShader (software GL)** at device-pixel ratio 1. Treat the raster and frame columns as pessimistic. `performance.now()` resolution is 0.1 ms here.

**In game, all-layers build** (`tools/combo.mjs --perf`, `shots/combo/report-perf.json`). This is the heavy storm scenario: 400 live crystal vessels and 60 kills/s, real clock, 220 frames. *Grid* covers the whole per-frame cost (`gridFrame` forces + `update` + `draw` JS).

| Run | Points | Grid JS mean | p50 | p95 | `update` mean | `draw` JS mean | Whole frame (software GL) |
|---|---|---|---|---|---|---|---|
| 1080p, post-FX on (pinned at q0), grid quality 0 | 1632 | **0.68 ms** | 0.5 | 1.2 | 0.14 | 0.50 | 221 ms |
| 1080p, 2D fallback, grid quality 1 | 1632 | **0.46 ms** | 0.4 | 0.7 | 0.07 | 0.36 | 43 ms |
| 1440p, post-FX on (q0) | 1632 | **0.61 ms** | 0.5 | 1.0 | 0.15 | 0.43 | 306 ms |
| 720p, post-FX on (q0) | 1380 | **0.43 ms** | 0.4 | 0.7 | 0.09 | 0.31 | 73 ms |

Mean JS is inside the 1 ms budget at every resolution. The p95 of 1.0–1.2 ms with post-FX on comes from the main thread being saturated by SwiftShader's 200–300 ms frames (GC and timer jitter), not from the grid's work. The same scene in 2D has a p95 of 0.7 ms. Unpinned, post-FX auto-turns itself off in this environment within seconds.

**Isolated, standalone harness** (`tools/shoot.mjs --perf`, `shots/perf.json`). This is a 200-frame scripted mix of kills, wells, fronts and dashes with no galaxy. *Raster* is the extra time to flush the GPU after `draw`, minus a fill-only baseline.

| Resolution | Points | `update` JS | `draw` JS q0 / q1 | Raster q0 / q1 (mean, p95) | Old static grid raster |
|---|---|---|---|---|---|
| 1080p | 1600 | 0.08 ms | 0.35 / 0.34 ms | 1.6 (3.0) / 1.7 (2.9) ms | 0.96 ms |
| 1440p | 1600 | 0.04 ms | 0.26 / 0.31 ms | 1.6 (2.8) / 1.9 (3.0) ms | 0.92 ms |
| 720p | 1334 | 0.03 ms | 0.22 / 0.23 ms | 0.85 (1.3) / 0.93 (1.5) ms | ~0 |

- Integration is a fixed 60 Hz step; `setRate(30)` halves `update` (rarely needed, since `update` is already ≤ 0.15 ms).
- No per-frame allocation: typed arrays are sized in `resize()`, and kick and front pools are fixed (8 and 6).
- Raster is about 0.6–0.7 ms over the old static grid in software GL. On a real iGPU, 1 px `source-over` hairlines are expected to cost well under 0.5 ms; this is the review's GPU estimate and is still **unmeasured on real hardware**. Quality 2 (wide glow strokes, about 10 ms here) is deleted.
- Fallback when frames are slow: the post-FX ladder's lowest rung switches to `setRate(30)`. If that is still slow, the renderer can skip `G.draw` (calm backdrop only) and keep `update` so physics stays continuous.


---

## 8. Findings from the all-layers build (for the other workstreams)

- **Every boss death is also a sector warp.** Galaxy's director warps on boss defeat, and the grid fades to 15% within about 0.3 s. That is why the grid's boss front runs on real time. The grid's real "big moment" in the composed game is the arrival front on `warp-punch`.
- **Entities `integration.patch` → `world.ts` is stale.** Its diff of `world.ts` reverts the co-op code (`applyLeash`, `downPlayer`, `ZOOM_*` imports, …), because it was cut against an older file. Applied to HEAD it breaks `bot.ts` and `coop.test.ts`. In `combo/` I took only the 4 `kill` fields (`kind, angle, kx, ky`) and kept HEAD's `world.ts`.
- **Entities + post-FX conflict in `renderer.ts`**, and both declare `const fx` in `draw()`. Resolved in `siblings-merged.patch`: the post-FX local is renamed to `pfx`, and `fx.art.setGlowScale` is called next to `sprites.setGlowScale` (review post-FX item 8).
- **Galaxy breaks 2 suites in the combined tree.** `no-p1-alias.test.ts` flags `galaxy.ts` (`this.stats.set(...)` matches the `this.stats` alias regex), and `golden.solo.test.ts` fails because the warp calm shifts the spawn stream. The galaxy team needs to rename the field and regenerate the golden master. No grid file is involved.
- **Upstream moved to `687bc97` during this phase.** All three sibling layers plus the grid cherry-pick cleanly onto it apart from one trivial `save.ts` conflict (see `combo-head/`). The vitest suite in `combo-head` shows the same 6 failures with and without the grid commit: galaxy's `this.stats` alias, galaxy's golden-master and sector-advance drift against upstream's new sector tracking, and the bot-run test. So **the grid adds no test failures**; those 6 belong to galaxy and entities.
- **Milky boss and bomb frames** (`combo/bossdead-00`, `bomb-00/01`). The grey veil from the 2D flash, the bloom surge and the white blast disc is still there; this is post-FX item 4 and the renderer blast. The grid adds nothing to it: its flare peak is ≤ 0.58 on a thin front.

---

## 9. Screenshots

All paths are relative to this folder. *Real game* = the all-layers build (galaxy v2 + warp grid + entities + post-FX) at 1080p under a fake clock (`tools/combo.mjs`). Full frames are in `shots/combo/<name>-NN.png`, the per-frame grid stats (max heat, hot fraction, exposure, flare) in `shots/combo/report.json`, and the run log in `shots/combo-log.txt`. *Harness* = standalone (`tools/shoot.mjs`); it uses the old geometric sprites and its own 2D flash, and is meant for isolating the grid. Full frames are in `shots/seq/`, the brightness probe in `shots/brightness.json`, and the log in `shots/shoot-log.txt`.

| What | Real game (all layers) | Harness |
|---|---|---|
| Ordinary fight + Bastion nova bending the lattice | `combo-fight-strip.png`, `combo/fight-01.png` | `nova-strip.png` |
| Kill storm (400 enemies, 60 kills/s), sector 0 | `combo-storm-strip.png`, `combo/storm-00.png` | `kill-strip.png`, `chaos-strip.png` |
| Kill storm, crimson / gold sectors (grid stays cool) | `combo-storm-s1-strip.png`, `combo-storm-s3-strip.png`, `crop-sectors.png` (top row) | — |
| Kill storm, reduced flashing / 2D fallback | `combo-storm-reduced-strip.png`, `combo-storm-2d-strip.png` | — |
| Capital-ship (Warden) death front | `combo-bossdead-strip.png`, `combo/bossdead-02.png` | `boss-strip.png` |
| … reduced flashing / 2D fallback / grid motion 0 (heat only) | `combo-bossdead-reduced-strip.png`, `combo-bossdead-2d-strip.png`, `combo-bossdead-still-strip.png` | `boss-reduced-strip.png` |
| Bomb (normal / reduced flashing) | `combo-bomb-strip.png`, `combo-bomb-reduced-strip.png` | — |
| Singularity implosion + detonation | `combo-singularity-strip.png`, `crop-singularity.png` (full-res crop of the funnel and the push) | `blackhole-strip.png` |
| Void Heart well (r 320) | `combo-voidheart-strip.png` | `voidheart-strip.png` |
| Dash wake | `combo-dash-strip.png`, `combo/dash-02.png` | `dash-strip.png` |
| Player death front | `combo-death-strip.png` | — |

**What the frames show.**
- The grid now sits *under* the action. In the storm it is a faint cool lattice that never competes with bullets, and it no longer turns pink or gold in the crimson and gold sectors.
- The big moments read as a single bending front: the boss-death front inside and around the blast disc, the Singularity funnel and push, and nova rings.
- Within about a second of a boss death, the galaxy's sector warp fades the grid to 15%, so later boss frames are mostly the tunnel.
- The boss-death and bomb frames still show the grey veil (post-FX item 4 and the renderer's white disc), as noted in §8. It is not from the grid.
- Superseded v1 captures (brute dents, the v1 real-game strips, v1 perf) are in `v1/` and `v1/stale/`.

