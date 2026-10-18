# WarpGrid spring-mesh background grid

Task 3d of `docs/HANDOFF.md` (graphics push). The steps are sequential because each one edits
`src/render/renderer.ts`. This step lands **after 3a (galaxy, `docs/specs/03a-galaxy.md`), 3b
(entities, `docs/specs/03b-entities.md`) and 3c (post-FX, `docs/specs/03c-postfx.md`)**, and before
3e (co-op rendering). The grid itself is a finished, art-reviewed prototype (v2). The work is to port
it into the real renderer, wire it to 3a's warp and 3c's quality ladder, add the "Grid motion"
setting, make co-op coverage cheap, test it and verify it.

## 1. Goal

The flat beat-pulsing lattice behind the arena becomes a living energy membrane. Kills send small
ripples through it. A capital-ship death or a bomb sends a single bright front across the screen.
The Singularity and the Void Heart bend it into swirling funnels. Dashes leave a wake, and nova rings
shove it outwards. Strained lines glow hotter, but the grid always stays a faint, cool blue-violet
under the action. It never takes a sector's warm hue, dims itself in busy fights, and never outshines
a bullet. During a sector warp it fades out, and a soft arrival ripple crosses the new sector. With
reduced flashing it loses its two brightest levels and its beat pulse. A new **Grid motion** slider
(0 = the grid never moves; events still show as glow) gives motion-sensitive players control. In
co-op the mesh covers the view at any zoom-out without costing more than in solo. Nothing about
gameplay changes, so the golden master stays bit-identical.

## 2. Starting point

- **Base:** the PR branch `claude/dazzling-faraday-2kxdhl` with 3a, 3b and 3c merged (tasks 1 and 2
  should be merged too). This step consumes interfaces from all three (§5, "Consumes"). If 3c has
  not landed, do not start: the grid's quality hook and draw target come from it. Work on a branch
  (for example `wip/wave3-grid`, to be created) and merge it with a merge commit, with no force-push.
  Use one focused commit, or a few, with all checks green at each.
- **There is no WIP for this step on any branch.** Checked with `git ls-tree` on `wave3/gfx`,
  `wave3/platform`, `fix/dmath` and the PR branch: no `warpgrid.ts`/`gridfx.ts` under `src/`.
- **Source (in-tree, committed on the PR branch):** `prototypes/grid/`. The files are byte-identical
  to `origin/wip/prototypes:gfx/grid/*` (checked):
  - `grid.ts` becomes `src/render/warpgrid.ts`. It has no imports and does not allocate after `resize()`.
  - `gridfx.ts` becomes `src/render/gridfx.ts`. It maps events and world state to forces and holds
    all the tuning.
  - `NOTES.md` is the integration guide (API §2, budget and review checklist §3, event map §4,
    hook points §5, fallbacks §6, timings §7, findings §8).
  - `integration.patch` is cut against `687bc97` plus the sibling patches. **Reference only:** its
    renderer hunk touches `debugBgOnly`, `this.legacy` and `fx.begin` from an older composed build.
    Port by hand from §5 below.
  - `harness.ts`/`harness.html`/`tools/*.mjs` do **not** run as they are. `tools/combo.mjs` imports
    Playwright from `/home/user/addictive-game/node_modules/playwright/index.mjs` (a path on the
    original build machine), serves `game-dist/` and copies into `combo/` (neither is in the repo), and
    uses `?god`/`?seed`, which the real game does not have. Its scenario functions (`STORM`,
    `BOSS_DEATH` and the singularity, voidheart, dash and death blocks) are still useful for captures
    (§9). `siblings-merged.patch` exists only on `origin/wip/prototypes` (`gfx/grid/siblings-merged.patch`).
  - Screenshots: only three exist on any branch:
    `origin/wip/prototypes:gfx/grid/shots/{combo-storm-2d-strip.png,combo-voidheart-strip.png,crop-singularity.png}`.
    The other names in NOTES §9 were never committed.
- **Verified on 2026-10-11** (scratch copies outside the repo, nothing committed):
  - `grid.ts` and `gridfx.ts`, copied as `src/render/warpgrid.ts`/`gridfx.ts` next to the PR head's
    `src/game`, typecheck under the repo's strict compiler options. `gridEvent`/`gridFrame` accept the
    real `World` (its structural `GridWorldView` matches `players`, `enemies`, `mines`, `rings`).
  - A Node probe with a recording fake 2D context (no DOM needed) confirmed the budget and behaviour.
    Values are max channel × alpha per stroke, beat 0:
    - rest lattice: 0.075 (0.1125 at a full beat);
    - an ordinary-kill storm (permit 2): ≤ 0.180;
    - a boss-death front with flare: 0.399, and 0.245 with reduced flashing;
    - motion 0: zero displacement while `maxHeat` is still 0.36;
    - a ZOOM_MAX co-op mesh drawn at `k / 1.45` covers the whole 1920×1080 frame.
  - Point counts at the prototype's fixed 32-unit spacing (the renderer keeps the visible world area
    about constant): solo 920 (Pixel 7) to 1,725 (32:9). Co-op sized for `ZOOM_MAX`: 1,566 to 3,168.
    That is about 1.9× the solo cost, which is why §5 caps it.

## 3. Read first

1. `AGENTS.md`, then `docs/HANDOFF.md` §3 and §3d.
2. `prototypes/grid/NOTES.md` in full. §5 and §6 are the hook points and fallbacks this spec adapts.
3. `prototypes/grid/grid.ts` (class `WarpGrid`, `coolRGB`, `GRID_TINTS`) and `prototypes/grid/gridfx.ts`
   (`GridWorldView`, `gridEvent`, `gridFrame`).
4. Interfaces from earlier steps:
   - `docs/specs/03a-galaxy.md` §5 "Interfaces this step exposes": `renderer.bg`, `Background.draw`,
     `galaxy.warpFx.gridAlpha`, `galaxy.sector`, `Renderer.onGalaxyEvent`.
   - `docs/specs/03b-entities.md` §5 step 3, "Resulting world order" (the grid is part of item 1).
   - `docs/specs/03c-postfx.md` §5 steps 4–8 (`view()`, `camZoom`, `applyFxMode`, `onFxQuality`,
     `costTier`) and its "Interfaces" list.
5. `docs/design/coop.md` §5.2 (zoom) and §5.4 (renderer camera, `k = scale·dpr/Z`). **Note:** §5.5
   "Grid coverage" is about the simulation's collision `SpatialGrid` (`src/core/grid.ts`), not this
   grid. Nothing in it changes here.
6. Current code:
   - `src/render/renderer.ts`: `RenderSettings`, `resize`, `reset`, `consume`, `draw`, plus
     `onGalaxyEvent` (3a) and `applyFxMode`/`onFxQuality`/`view` (3c).
   - `src/render/background.ts` (`Background.draw`, its grid block).
   - `src/meta/save.ts` (`Settings`, `defaultSettings`, `migrate`).
   - `src/ui/ui.ts` (`showSettings`).
   - `src/app.ts` (`applySettings`, `stepGame` (how `hitstop`/`slowmoT` tick on real time),
     `stepAttract`, `newAttractWorld`).
   - `src/game/world.ts` (`hitstop`, `slowmoT`, `zoom`, `downPlayer`, `teamWipe`, `addRing`).
   - `src/game/types.ts` (`GameEvent`, `Player`, `Mine`, `Ring`).
   - `src/game/content/coop.ts` (`ZOOM_MAX`, `MAX_PLAYERS`).

## 4. Owner decisions and constraints (non-negotiable)

1. **Replace the static grid.** Delete the beat-pulsing grid block from `Background.draw`. The
   renderer draws the WarpGrid **right after `bg.draw`** (galaxy backdrop and stars) and before
   rings, mines and pickups. In post-FX mode that is inside the offscreen world canvas, so the grid
   goes through bloom and shockwave refraction.
2. **Event → force mapping** lives in `gridfx.ts` (table in §5 step 2):
   - kill ripples with a budget: kicks within 64 units merge, at most 8 apply per frame, and ordinary
     kills light at most level 2;
   - capital-ship death and bomb **travelling fronts** that advance on real time through hitstop and
     slow-mo, and freeze only when game time stops (pause, level-up, victory screen);
   - Singularity (triggered pull mine) and Void Heart **gravity wells**;
   - the **dash wake**;
   - **nova ring fronts**.
3. **Brute and boss dents are not added.** The original brief listed them. The art review cut them
   (NOTES §3 item 6) and `docs/HANDOFF.md` §3d no longer lists them. The impulse on nova spawn (`ring`
   event) is cut too, because the ring front already pushes.
4. **Readability first:**
   - each heat level has a brightness peak: rest ≤ 0.12 at a full beat, hot ≤ 0.35 (under the bloom
     threshold); only capital-ship and bomb fronts may flare, briefly, up to about 0.6;
   - `brightness = (1 − 0.25 × renderer.intensity) × warpFx.gridAlpha`, plus the built-in
     auto-exposure (the hot levels dim when more than 10% of the mesh is hot);
   - the calm lattice fades outside the play ellipse, so it does not cage the galaxy's centrepieces.
5. **Reduced flashing** (`settings.flashes === false`): `maxLevel = 3` (the two brightest levels are
   removed), `flareAllowed = false`, `beatPulse = 0`.
6. **"Grid motion" slider**, 0..1 (0 = static: no displacement at all; forces become glow-only heat,
   so events still read). It is saved in `Settings` with defaulting for old saves: a save without the
   field copies its **Screen shake** value. It goes in the settings screen directly under "Screen
   shake". Screen shake no longer drives the grid.
7. **Cool, desaturated colour in every sector:** the tint is `GRID_TINTS[sector]`, passed through
   `coolRGB` (hue 190–270°, saturation ≤ 0.45, lightness 0.5–0.7). The crimson and gold sectors get a
   cool variant, never their own hue. This overrides `docs/design/galaxy.md` §3 and 03a's note that
   the grid takes `SECTORS[i].gridRGB`.
8. **Quality follows post-FX:** hairlines only (`quality 0`) when post-FX is on, because bloom
   supplies the halo. The plain 2D path uses `quality 1` (offset-hairline halo on levels 4–5). The
   integration rate follows `renderer.costTier` (mapping in §5 step 3e).
9. **Galaxy warp:** grid alpha × `warpFx.gridAlpha` (down to 15% through the tunnel). On
   `warp-punch`: `grid.reset()` plus an arrival front at the camera.
10. **Co-op:** the mesh covers the visible world at any zoom up to `ZOOM_MAX` (1.45). The point count
    is capped; coarser spacing in co-op is fine; nothing pops or reallocates when the zoom changes.
11. **Simulation untouched:** no diff under `src/game/`; `tests/golden.solo.test.ts` passes
    unchanged. The renderer reads `world.hitstop`, `world.slowmoT`, `players`, `enemies`, `mines` and
    `rings`, and never writes them or uses the sim RNG streams (`rng`, `spawnRng`, `lootRng`, `posRng`).
12. **Budget:** grid JS (forces + update + draw) of about **1 ms per frame or less at 1080p** in a
    400-enemy kill storm, with no per-frame allocation.
13. `AGENTS.md` hard rules:
    - strict TS;
    - `npm run build:single` keeps working;
    - never skip or loosen a test;
    - the `tests/no-p1-alias.test.ts` regex must not match new code (no `world.player`,
      `this.stats`/`this.player`/`this.build`);
    - Pixel 7 keeps working;
    - original IP;
    - code idiomatic to the surrounding files;
    - update `docs/GAME_DESIGN.md`.

## 5. Implementation plan

**Step 1. `src/render/warpgrid.ts`** (to be created): copy `prototypes/grid/grid.ts` with only
these changes.
- a. **Spacing set at resize.**
  - Replace `readonly spacing` with a private field and a `get spacing()`.
  - Add an optional third parameter: `resize(viewW, viewH, spacing = this.spacing)`. A spacing change
    re-lays the mesh exactly like a size change: recompute `cols`/`rows` even when they come out
    equal, set `dampFor = -1` and `hasOrigin = false`. The next `update()` then resets.
  - The constructor option stays the default.
- b. **Point cap.**
  - Export `GRID_MAX_POINTS = 1800` and
    `gridSpacingFor(viewW: number, viewH: number, maxPoints = GRID_MAX_POINTS): number` (both to be
    created).
  - `gridSpacingFor` returns the smallest even spacing ≥ 32 with
    `(ceil(viewW/S) + 6) × (ceil(viewH/S) + 6) ≤ maxPoints`. Share the cols/rows formula with
    `resize()` (one private helper) so the two can never disagree.
  - Why 1,800: every solo window up to 32:9 stays at 32 (max 1,725 points), and co-op costs at most
    about the solo worst case. You may raise it to about 2,100 (co-op spacing 40 at 1080p) only if the
    measured co-op grid JS stays ≤ 1 ms (§9).
- c. **`reset()`** also sets `exposure = 1` and `hotFrac = 0`. The prototype keeps the auto-exposure
  across resets, so a new run would start dimmed after a storm and take about 3 s to recover.
- d. Keep everything else as is:
  - constants and the brightness table;
  - `impulse`, `shock`, `implode`, `ring`, `wake`, `update(dt, camX, camY, frontDt)`, `setRate`,
    `draw(ctx, camX, camY, k, w, h, color, beat)`;
  - the knobs `motion`, `maxLevel`, `flareAllowed`, `beatPulse`, `brightness`, `quality`, `edgeFade`;
  - the stats `pointCount`, `maxHeat`, `hotFrac`, `exposure`, `flare`, `stepsLast`, `impulsesIn`,
    `impulsesApplied`;
  - `coolRGB`, `GRID_TINTS`, and the comments.

  Keep the file import-free. Do not name it `grid.ts`: `src/core/grid.ts` is the sim's spatial hash
  (inside the determinism guard's closure).

**Step 2. `src/render/gridfx.ts`** (to be created): copy `prototypes/grid/gridfx.ts` and import
`WarpGrid` as a type from `./warpgrid`. Changes:
- `GridWorldView.players` gains `downed: boolean`. `levelup` kicks only pilots with
  `p.alive && !p.downed`: ghosts stay `alive` while downed (see `Player.alive` in `types.ts`).
- Two new co-op cases (spec decisions; the prototype map has none). Tune them visually; they must
  stay under the permit-4 budget.
  - `downed`: `impulse(x, y, 150, 500, 4)` + `shock(x, y, 600, 3200, 800, 4)`. A smaller front than
    a run-ending `death`, matching 3c's minor wave for `downed`.
  - `revived`: `shock(x, y, 800, 3600, 900, 4)` (the same as `revive`).

The resulting map (strengths in world units/s; the last number is the heat permit):

| event | force | permit |
|---|---|---|
| `kill`, ordinary | `impulse(x, y, 80+4r, 220+12r)` | 2 |
| `kill`, elite | `impulse(x, y, 100+4r, 420)` + `shock(x, y, 150+6r, 2600, 750)` | 4 |
| `kill`, boss | `impulse(x, y, 240, 800)` (the front comes from `bossdead`) | 5 |
| `explode`, r ≥ 60 | `impulse(x, y, 50+1.2r, 300+2r)` + `shock(x, y, 1.7r, 2000, 650)` | 3 |
| `explode`, r < 60 | `impulse(x, y, 50+1.5r, 260+3r)` | 2 |
| `bossdead` | `impulse(x, y, 260, 900)` + `shock(x, y, 1500, 5200, 1000, flare 1, band 80)` | 5 |
| `bomb` | `impulse(x, y, 220, 700)` + `shock(x, y, 1800, 5200, 1400, flare 1, band 80)` | 5 |
| `death` (run over) | `impulse(x, y, 180, 700)` + `shock(x, y, 1000, 4200, 800, flare 0.4)` | 4 |
| `revive`, `revived` | `shock(x, y, 800, 3600, 900)` | 4 |
| `downed` | `impulse(x, y, 150, 500)` + `shock(x, y, 600, 3200, 800)` | 4 |
| `perfect` | `impulse(x, y, 150, 450)` + `shock(x, y, 280, 3000, 900)` | 4 |
| `dash` | `wake(x−50dx, y−50dy, x, y, 420, 80)` | 3 |
| `hurt` | `impulse(x, y, 110, 260)` | 2 |
| `shieldbreak` | `impulse(x, y, 150, 420)` | 3 |
| `levelup` | `impulse(p.x, p.y, 240, 380)` per up pilot | 3 |
| `ring`, `sector`, everything else | none | |

`gridFrame` keeps the prototype's continuous forces, applied only when `dt > 0`:
- each pilot with `alive && dashT > 0`:
  `wake(prev, cur, 420·dt·60, 84)`, permit 3;
- a spawned, live `voidheart`: `implode(x, y, 320, 3000 × (hp < 50% ? 1.4 : 1), dt, 0.6)`;
- each triggered pull mine: `implode(x, y, 2.2·radius, 6500, dt, 0.8)`;
- each running `world.rings` entry: `ring(x, y, radius, 44, 2400, dt)`, permit 3.

It also updates `prev` every frame.

**Step 3. `src/render/renderer.ts`.**
- a. **Imports:** `gridEvent, gridFrame` from `./gridfx`; `GRID_TINTS, WarpGrid, gridSpacingFor`
  from `./warpgrid`; `MAX_PLAYERS, ZOOM_MAX` from `../game/content/coop`.
- b. **`RenderSettings`:** add `gridMotion: number` (doc: "0..1; 0 = the grid never moves, events
  still glow"). Add `gridMotion: 1` to the default object.
- c. **Fields.** Declare `grid` **before** `bg`: `bg`'s galaxy callback uses it.
  - `readonly grid = new WarpGrid()`;
  - `gridMs = 0` (profiling: last frame's forces + update + draw in ms, read by captures; keep it);
  - `private readonly gridPrev = new Float32Array(MAX_PLAYERS * 2)`;
  - `private gridZoom = 1`, `private gridHit = 0`, `private gridSlow = 0`.
- d. **Sizing.** Add `private resizeGrid()` (to be created):
  `vw = (cssW / scale) · gridZoom + 60`, `vh = (cssH / scale) · gridZoom + 60` (the zoom-1 visible
  world plus the screen-shake margin, enlarged to `ZOOM_MAX` in co-op).
  Then `this.grid.resize(vw, vh, gridSpacingFor(vw, vh))`.
  - Call it at the end of `resize()`, after `scale` is set. 3c's `worldScale` changes call `resize()`,
    but the world view is unchanged, so `WarpGrid.resize` returns early.
  - Never resize per frame: a re-lay resets the mesh.
- e. **Quality.** Add `private applyGridTier()` (to be created) and call it at the end of 3c's
  `onFxQuality` (03c leaves a comment there; `applyFxMode` and the ladder both pass through it):
  - `grid.quality = postFxActive || (postfx?.autoOff ?? false) ? 0 : 1`: hairlines under post-FX and
    after post-FX switched itself off for speed; the halo only in the plain 2D path (setting off, no
    WebGL2, context lost).
  - `grid.setRate(costTier <= 1 ? 30 : 60)`: q3–q1 run at 60 Hz; q0, the 0.75 rung and auto-off run
    at 30 Hz.
  - Do not skip `grid.draw` on any tier (the Void Heart funnel is a gameplay cue).

  Resulting table:

  | state | `costTier` | quality | rate |
  |---|---|---|---|
  | post-FX q3 / q2 / q1 | 4 / 3 / 2 | 0 | 60 |
  | post-FX q0 | 1 | 0 | 30 |
  | q0 at 0.75 scale | 0 | 0 | 30 |
  | auto-off (2D) | 0 | 0 | 30 |
  | setting off, no WebGL2, context lost | 4 | 1 | 60 |

- f. **`reset(world)`:**
  - `this.gridZoom = world.coop ? ZOOM_MAX : 1; this.resizeGrid(); this.grid.reset();`;
  - seed `gridPrev[2i], gridPrev[2i+1]` from `world.players[i]` for `i < MAX_PLAYERS` (not the P1
    alias);
  - set `gridHit = world.hitstop` and `gridSlow = world.slowmoT`.

  Every run start (solo or co-op), `?warp` fast-forward and attract-world swap passes through here,
  so the spacing changes only at these points.
- g. **`onGalaxyEvent(e)`** (3a): on `e.t === 'warp-punch'`, call `this.grid.reset()` and
  `this.grid.shock(this.camX, this.camY, 1300, 3600, 1100, 4)` before the existing forwarding.
- h. **`consume()`:** the first statement inside the event loop is `gridEvent(this.grid, ev, world)`
  (before 3b's `this.fx.onEvent`).
- i. **`draw()`:** after the camera update and 3c's world-target `{ k, ox, oy }`/`tw, th`, and
  before `bg.draw`:
  - set the knobs from the settings every frame:
    - `motion = clamp(settings.gridMotion, 0, 1)`;
    - `maxLevel = flashes ? 5 : 3`;
    - `flareAllowed = flashes`;
    - `beatPulse = flashes ? 0.5 : 0`;
    - `brightness = (1 − intensity·0.25) × warpFx.gridAlpha` (read `warpFx` once per frame: the
      getter allocates);
  - call `gridFrame(G, world, gridPrev, dt)`;
  - fronts run on real time while game time flows:
    `flowing = dt > 0 || world.hitstop !== gridHit || world.slowmoT !== gridSlow`. Store the two new
    values, then call `G.update(dt, this.camX, this.camY, flowing ? Math.max(dt, Math.min(rdt, 0.05)) : 0)`.
    `App.stepGame` decrements `hitstop`/`slowmoT` by real time while playing, so hitstop and slow-mo
    frames count as flowing. Pause, level-up and victory leave them unchanged, so fronts freeze there.

  Right after `bg.draw`, draw the grid from the **world transform's own centre**, so the lattice
  sits exactly under the sprites at any shake, render scale or (after 3e) zoom:
  `G.draw(ctx, (tw/2 − ox)/k, (th/2 − oy)/k, k, tw, th, GRID_TINTS[max(0, galaxy.sector) % GRID_TINTS.length], this.beat)`.
  Time the three parts into `gridMs`. `update` re-anchors on the unshaken camera; that split is
  intended.

**Step 4. `src/render/background.ts`.** Delete the "Grid (world space, pulses on the beat, fades
through a warp)" block at the end of `Background.draw`.
- Drop whatever becomes unused: `SECTORS` from the `./galaxy` import; the local `fx` stays because
  the star streaks use it.
- Keep the `beat` parameter (the galaxy uses it) and the signature, so 3a/3c/3e call sites do not
  change.
- Update the class comment ("…three star layers; the world grid is the renderer's WarpGrid").

**Step 5. Settings** (§6): `src/meta/save.ts`, `src/app.ts` `applySettings` (`gridMotion: s.gridMotion`
into `renderer.settings`), `src/ui/ui.ts` `showSettings`.

**Step 6. Galaxy clean-up.** `SectorDef.gridRGB` and `GRID_RGB` in `src/render/galaxy.ts` lose their
only reader. Remove both if `grep -rn gridRGB src tests` finds nothing else (galaxy.ts is also the
worker body; dropping a data field is safe). Keep `WarpFx.gridAlpha`.

**Step 7. Docs.**
- `docs/GAME_DESIGN.md`:
  - §7 table: a row "Arena grid | spring-mesh lattice: kills ripple it, capital-ship deaths and bombs
    send one front, wells funnel it, dashes leave a wake; faint and cool in every sector, dims in
    busy fights | none".
  - §4 "Ethical guardrails": next to reduced flashing, add the Grid motion slider.
  - §9: one bullet "WarpGrid: render-only spring mesh (fixed 60/30 Hz, typed arrays, budgeted kicks
    and fronts); never touches the sim".
- `docs/HANDOFF.md`: mark 3d done and list the interfaces below.

**Consumes (from earlier steps):**
- 3a: `renderer.bg.galaxy.warpFx.gridAlpha`, `galaxy.sector` (−1 until sector 0 is ready),
  `Renderer.onGalaxyEvent`, `Background.draw(ctx, camX, camY, k, w, h, time, beat, tint)`.
- 3b: the `consume()` loop and the world draw order (grid = part of step 1).
- 3c:
  - `this.ctx` (the world canvas in post-FX mode);
  - `view()` → `k, ox, oy` and the world-target size `tw, th`;
  - `costTier`, `postFxActive`, `postfx?.autoOff`, `onFxQuality`;
  - debug `?fx=0` and `?fxq=N`.

**Interfaces this step exposes (3e and task 4 use them; keep them stable):**
- `renderer.grid: WarpGrid` (stats above, plus `spacing`) and `renderer.gridMs`.
- `gridSpacingFor`, `GRID_MAX_POINTS`, `GRID_TINTS`, `coolRGB` (warpgrid.ts); `gridEvent`,
  `gridFrame`, `GridWorldView` (gridfx.ts).
- **For 3e:**
  - the grid draws from the world transform, so the zoom-aware `view()`/`camZoom` flows in with no
    grid change;
  - the mesh is already sized for `ZOOM_MAX` whenever `world.coop` (at `reset()`); do not resize it
    per frame;
  - `update()` re-anchors on `this.camX/camY`, which become the team camera;
  - if 3e ever makes the attract world co-op, `reset()` handles it through `world.coop`.

## 6. Settings and save data

| Where | Change |
|---|---|
| `Settings` (`src/meta/save.ts`) | `gridMotion: number` with a doc comment ("Arena grid motion 0..1. 0 = the grid never moves; events still glow."). |
| `defaultSettings()` | `gridMotion: 1`. |
| `migrate()` | After the `trail`/`chatter`/`postfx` normalisation: if `typeof r.settings?.gridMotion` is a finite number, clamp it to [0, 1]. Otherwise set it to the save's shake (`out.settings.shake`, clamped to [0, 1], or 1 if that is not finite). The generic `{ ...base.settings, ...r.settings }` merge alone would give old saves 1, so read `r.settings` (the raw input), not `out.settings`. No `SAVE_VERSION` bump: the field is additive, like `chatter` and `postfx`. Storage is task 2's platform adapter; nothing changes there. |
| `RenderSettings` / `App.applySettings` | `gridMotion: s.gridMotion` (the literal must list every field; TS enforces it). |
| `showSettings` (`src/ui/ui.ts`) | `${slider('gridMotion', 'Grid motion', st.gridMotion)}` **directly after** `slider('shake', …)`, which puts it above task 2's desktop-only Fullscreen row and 3c's "Enhanced graphics" toggle. Add `gridMotion: Number(($(s, '#set-gridMotion') as HTMLInputElement).value) / 100` to `read()`. Recommended: give `slider` an optional `sub` argument (rendered as `<small>` like `toggle`) and pass "Arena grid ripples · 0 keeps it still"; the other sliders stay unchanged. It applies live from the pause menu too (`settingsChanged` → `applySettings`). |

Optional, not required: on a brand-new save, default `gridMotion` to 0 when
`matchMedia('(prefers-reduced-motion: reduce)')` matches (in `App`, not in the pure
`defaultSettings()`).

## 7. Accessibility, mobile, co-op and performance requirements

- **Brightness budget** (max RGB channel × alpha of any stroke over black, beat 0 unless noted):
  - rest ≤ 0.075, and ≤ 0.12 at a full beat;
  - ordinary-kill storms ≤ 0.18;
  - elites, perfect dashes and player death ≤ 0.29;
  - wells ≤ 0.245;
  - capital-ship and bomb fronts ≤ 0.54 (flare);
  - reduced flashing: everything ≤ 0.245 and no beat pulse.

  The renderer must not add any other brightening (no `lighter` compositing, no wider lines).
- **Grid motion 0:** zero displacement in every scenario. Kills, fronts, wells and dashes still show
  as decaying glow. The slider does not affect the post-FX shockwaves (those follow Screen shake, per
  3c).
- **Screen shake 0:** the grid does not shake (it draws from the world transform, which has no shake
  offset then).
- **Mobile (Pixel 7, DPR capped at 2):** about 920 points; no DOM or input change. Hairlines are 1
  device px (0.5 CSS px at DPR 2). Check the portrait shot: the calm lattice must still be faintly
  visible. If it disappears, report it; do not widen lines (wide strokes cost about 5× the raster in
  software, and the deleted quality 2 cost about 10 ms). The settings row must fit at 412 CSS px.
- **Co-op:** spacing from `gridSpacingFor` at `ZOOM_MAX` (point counts below). Lines must cover the
  frame at `k` and `k / ZOOM_MAX` with the shake margin. Expect a coarser lattice at zoom 1 in co-op
  (44 vs 32 units at 1080p); at full zoom-out it looks like solo. Ripples travel about
  `spacing·√stiffness` units/s, so they run faster in world units at S 44 and about the same on
  screen at full zoom-out. Check `?coop=4` at both zooms against solo. If kills or fronts read clearly
  weaker or stronger, compensate inside `WarpGrid` with one factor derived from `spacing / 32` (and
  document it), never per call site.

  | CSS viewport | solo points (S 32) | co-op S | co-op points |
  |---|---|---|---|
  | 1920×1080 / 2560×1440 | 1,632 | 44 | 1,749 |
  | 1280×720 | 1,380 | 40 | 1,716 |
  | 1366×768 | 1,440 | 42 | 1,632 |
  | 2560×1080 | 1,682 | 44 | 1,800 |
  | 3840×1080 | 1,725 | 46 | 1,725 |
  | Pixel 7 (412×915 or 915×412) | 920 | 32 | 1,566 |

- **Performance** (headless Chromium, `renderer.gridMs`, ≥ 200 frames of the 400-enemy kill storm):
  - **mean ≤ 1.0 ms at 1920×1080** with post-FX at 60 Hz (`?fxq=3`) and on the 2D path (`?fx=0`);
  - the same in `?coop=4` at 1920×1080;
  - report p50 and p95, and also `?fxq=0` (30 Hz) and 1280×720.

  Prototype reference: 0.68 ms mean (post-FX), 0.46 ms (2D), p95 up to 1.2 ms under SwiftShader
  saturation. No per-frame allocation (typed arrays sized in `resize`; fixed pools of 8 kicks and 6
  fronts). Raster on a real iGPU is unmeasured. The SwiftShader raster was about 1.6 ms against
  0.96 ms for the old static grid. Include the grid in the owner's real-hardware check (3c §7).

## 8. Tests to add or update

**`tests/warpgrid.test.ts`** (to be created; Vitest/node, no DOM: both modules are DOM-free).
Write a recording fake context (to be created in the test):
- it has `setTransform`, `beginPath`, `moveTo`, `lineTo`, `quadraticCurveTo`, `stroke`;
- it has the `strokeStyle`, `globalAlpha`, `lineWidth`, `lineCap`, `lineJoin`,
  `globalCompositeOperation` properties;
- cast it with `as unknown as CanvasRenderingContext2D`;
- per `stroke()`, record `globalAlpha × max(r, g, b) / 255` parsed from `rgb(...)`, plus every path x/y.

Defaults: grid `resize(1426, 828)`, `update(0, 0, 0)` once, frames of `update(1/60, 0, 0, 1/60)` then
`draw(fake, 0, 0, 1.4057, 1920, 1080, GRID_TINTS[0], beat)`. ε = 1e-3.
1. **Budget:**
   - rest ≤ 0.075 (beat 0) and ≤ 0.12 (beat 1);
   - 120 frames of 2 random ordinary-kill impulses (permit 2): ≤ 0.18;
   - an elite (`impulse` + `shock`, permit 4, no flare): ≤ 0.29;
   - 120 frames of a Void Heart `implode`: ≤ 0.245;
   - a `bossdead` pair (§5 table): ≤ 0.54 and > 0.35 on some frame (the flare happens);
   - the same with `maxLevel 3, flareAllowed false, beatPulse 0`: ≤ 0.245.
2. **Kick budget:** 60 impulses ≥ 100 units apart in one frame → `impulsesApplied === 8`. 100
   impulses at one spot → `impulsesApplied === 1` (merged).
3. **Motion 0:** after a `bossdead` pair, a `wake` and 30 frames of `implode`, every displacement is
   0 (read the private `dx`/`dy` through a cast). `maxHeat > 0.08` (events still glow).
4. **Front clock:**
   - with `update(0, 0, 0, 1/60)` repeated, a flare front's `flare` rises then decays to 0 within
     `maxRadius / speed` s, and `stepsLast === 0` (the membrane is frozen);
   - with `update(0, 0, 0, 0)`, `flare` stays constant (fronts are frozen too).
5. **Coverage:** two cases, each run with `update` at camera (5200, −3100) and then `draw` at that
   camera ± 16 units (shake):
   - solo: `resize(1426, 828)`, k 1.4057;
   - co-op: `vw = 1366·ZOOM_MAX + 60`, `vh = 768·ZOOM_MAX + 60`,
     `resize(vw, vh, gridSpacingFor(vw, vh))` (spacing 44), k = 1.4057 / ZOOM_MAX.

   The path extents must satisfy min x ≤ 0, max x ≥ 1920, min y ≤ 0, max y ≥ 1080. Probe: at least
   62 px of margin on every side in both cases.
6. **`gridSpacingFor`:** returns 32 for the solo world views of every row of the §7 table (+60). For
   the co-op views the spacing is even and ≥ 32, and `pointCount` after `resize` is
   ≤ `GRID_MAX_POINTS` and equals the formula. Hard-code the world sizes in the test, with a comment
   pointing at `Renderer.resize`.
7. **`coolRGB`:** inputs at every 10° of hue, with saturation {0.2, 1} and lightness {0.3, 0.5, 0.8}.
   The output hue must be in [189, 271], saturation ≤ 0.46 and lightness in [0.49, 0.71]. Every
   `GRID_TINTS` entry must pass too.
8. **`gridfx`** with a spy grid (an object recording `impulse`/`shock`/`wake`/`implode`/`ring` calls,
   cast to `WarpGrid`):
   - every §5 table row: method names, radius/strength formula, permit, `flare` for `bossdead`/`bomb`;
   - `ring` and `sector` → no calls;
   - `levelup` skips a downed pilot.

   `gridFrame`:
   - the wake fires only with `dt > 0` and `dashT > 0`;
   - the Void Heart strength is 3000, or 4200 under 50% HP, and there is no well while `spawnT > 0`;
   - a pull mine gets radius 2.2·r;
   - one `ring` call per running ring;
   - `prev` is updated when `dt === 0`.
9. **Save** (`tests/meta.test.ts` or a new file):
   - `defaultSettings().gridMotion === 1`;
   - `migrate({ settings: { shake: 0.4 } })` → 0.4;
   - `{ shake: 0.3, gridMotion: 0 }` → 0;
   - `migrate({})` → 1;
   - `gridMotion: 'x'` → follows shake;
   - 7 → 1 and −1 → 0.

   The existing "survives corrupt or partial data" test keeps passing unchanged.

**`e2e/grid.spec.ts`** (to be created; both projects unless noted). Use `skipIntro` and the
error-tracking pattern of `e2e/smoke.spec.ts`:
1. In a run: `renderer.grid.pointCount` is in [800, 1800] and `spacing === 32`; `renderer.gridMs`
   is finite; no console errors. Then `renderer.consume([{ t: 'bossdead', x, y, name: 'Test' }], app.world)`
   at P1's position: poll until `renderer.grid.flare > 0`.
2. Settings:
   - on a fresh save, `#set-gridMotion` has value `100`;
   - set it to 0 (`locator.fill('0')`, or set `.value` and dispatch `input`);
   - then the saved JSON `settings.gridMotion === 0` and `renderer.settings.gridMotion === 0`;
   - after reload the slider shows 0, and in a run `renderer.grid.motion === 0`.

   A second test seeds an old save (`{ story: { introSeen: true }, settings: { shake: 0.3 } }` via
   `addInitScript`): the slider shows 30.
3. Co-op (desktop only, like `e2e/coop.spec.ts`): `/?coop=4&autoplay` at 1280×720 →
   `grid.spacing === 40` and `pointCount <= 1800`. After quitting to the results screen, `spacing === 32`.

**Must not change:**
- `tests/golden.solo.test.ts`;
- `tests/no-p1-alias.test.ts` (and its `PENDING_MIGRATION` list);
- task 1's `tests/determinism.guard.test.ts`;
- 3c's `e2e/smoke.spec.ts` world-image check.

Nothing under `src/game/` changes.

## 9. Acceptance checklist

Commands (all must pass):
- `npm ci`, `npm run typecheck`, `npm test` (golden and both guards included);
- `npm run build` and `npm run build:single` (open `dist-single/shardstorm.html` from `file://`: the
  grid draws, no console errors);
- `npm run e2e`, desktop and mobile projects (set `E2E_PORT` if 4173 is busy);
- `git diff <PR head before the merge> -- src/game tests/golden.solo.test.ts` is empty.

Screenshots: build, serve with `npx vite preview --port <port>` (in the background, kill it after) and
drive with Playwright. Keep shots outside the repo and look at every one. Stage the scenes from
`window.shardstorm` in the capture script only, never in committed code. The staging functions in
`prototypes/grid/tools/combo.mjs` port almost verbatim. To make the pilot invulnerable, set
`p.invuln = 5` each frame in place of the prototype's `?god`.
1. Kill ripples in a normal fight (`?autoplay&warp=120`).
2. A 400-enemy kill storm (`STORM`: wraps `renderer.draw`, spawns with `world.spawnEnemy`, kills 60 per
   sim-second with `world.killEnemy`). Take it at 1920×1080 in every sector (force the backdrop with
   `renderer.bg.galaxy.setSector(i, { sync: true })`); the grid must stay cool in the crimson and gold
   sectors.
3. A capital-ship death front (`BOSS_DEATH`: spawn a `warden`, set `w.boss`, then `b.hp = 0;
   w.killEnemy(b, false, 0)`) at +0.03, 0.15, 0.3, 0.5 and 0.8 s, including the warp fade that follows.
4. A bomb (`world.bomb(0)`).
5. The Singularity funnel: push a triggered pull mine. Use `owner: 0`; the prototype's `pid: 0` is
   wrong for the current `Mine` type.
6. The Void Heart well (`spawnEnemy('voidheart', …)`, `spawnT = 0`, `w.boss = e`).
7. A dash wake (`players[0].dashBuffer = 0.2`).
8. Nova rings (`world.addRing(p.x, p.y, 460, 0.55, 60, 500, true, '#ffffff', 0, 0)`, or a Bastion run).
9. A player death.
10. A warp arrival ripple.
11. The title screen.
12. Accessibility variants of 2 and 3: reduced flashing, grid motion 0, the 2D path (`?fx=0`), and shake 0.
13. `?coop=4&autoplay` at 1920×1080. Until 3e the camera ignores zoom, so coverage at `k / ZOOM_MAX`
    is proven by the unit test; still capture the lattice.
14. Pixel 7 portrait and landscape.

Numbers to report:
- `renderer.gridMs` mean/p50/p95 per §7 (1080p `?fxq=3`, `?fx=0`, `?fxq=0`, 720p, `?coop=4`);
- `grid.pointCount`/`spacing` per run type;
- `grid.hotFrac`/`exposure` in the storm.

## 10. Pitfalls and known issues

- **Field order:** `bg` is built in a field initializer with a callback that touches `this.grid`;
  declare `grid` first.
- **Do not port the prototype patch's renderer hunk blindly.** It references `debugBgOnly`,
  `this.legacy` and `fx.begin` from another build, and puts the warp hook in an inline `Background`
  lambda. 3a made that `onGalaxyEvent`.
- **Front clock** depends on `App.stepGame` ticking `world.hitstop`/`slowmoT` by real time while
  playing. `stepAttract` zeroes both every frame; that is fine there, because `dt > 0`. During
  hitstop, fronts push velocities without integrating, and the membrane catches up when time resumes.
  That is intended.
- **Re-lays reset the mesh** (window resize, run start, solo ↔ co-op). Never call `resize` per frame,
  and never on zoom changes.
- `galaxy.sector` is −1 until sector 0 is generated: use `Math.max(0, …)`. At the warp tunnel the
  tint switches with `galaxy.sector` while the grid is at 15%, so the switch is hidden.
- **Well flags** are cleared in `draw()`. Its `brightness <= 0.001` early return skips that for a
  frame; harmless, but do not add another path that skips `draw` for long while still calling
  `implode`.
- **Edge coverage:** drawn lines reach at least 0.5 cell + 30 units past the right/bottom edge, and
  about 2.5 cells past the left/top. A huge front can pull edge points in by up to `2.2·spacing`, so
  a thin uncovered sliver could flash at the right or bottom edge. If you see it, raise the +60
  margin (e.g. to `2·spacing·maxDispK`) and re-measure.
- **Bloom:** 3c keys bloom on heat `mix(max, min, 0.6) ≥ 0.6`. The cool grid's flare peak (0.54 max
  channel) stays below it, so the grid practically never blooms. That is acceptable; do not raise the
  peaks to force it.
- **SwiftShader** frames of 50–300 ms run up to 4 membrane steps per frame, inflating `update` and
  p95. Compare means, and say so in the report.
- **`renderer.intensity`** is only set during runs; on the title it keeps the last run's value, so the
  grid can be up to 25% dimmer there. Optional one-line fix: set it to 0 in `App.stepAttract`.
- **The P1-alias regex** flags any `this.player`/`this.stats`/`this.build`/`world.player` line in
  `src/`. `gridfx` reads `world.players` only; keep it that way.
- **Determinism guard:** never import `src/render/*` from `src/game/*`. `warpgrid.ts` uses `Math.exp`
  and `Math.sqrt` freely because it is render-only.
- The prototype harness and tools need the missing `combo/`, `game-dist/` and machine-specific paths.
  Reuse the staging functions; do not revive the harness.

## 11. Out of scope

- The zoom-aware camera, `renderer.worldToScreen`, pilot marks, ghosts and the P1-alias migration of
  `renderer.ts`/`hud.ts` (3e).
- Skipping the grid draw on the lowest tier; a separate grid-quality setting; quality 2.
- Brute and boss dents; the nova-spawn impulse; any new sim field or event.
- Removing `PAL.grid`/`PAL.gridMajor` (already unused before this step); retuning post-FX or the
  galaxy.
- Defaulting new saves from `prefers-reduced-motion` (optional, §6).
