# WebGL2 post-processing (bloom, shockwaves) with 2D fallback

Task 3c of `docs/HANDOFF.md` (graphics push). The steps are sequential because each one edits
`src/render/renderer.ts`. This step lands **after 3a (galaxy, `docs/specs/03a-galaxy.md`) and 3b
(entity art, `docs/specs/03b-entities.md`)**, and before 3d (WarpGrid) and 3e (co-op rendering). There
is no WIP branch for it: the pipeline module is finished and art-reviewed as a prototype
(`prototypes/postfx/`). The work is porting its glue onto the current renderer, the setting, tests and
verification.

## 1. Goal

On any machine with WebGL2 the game looks like a lit neon arcade cabinet instead of flat canvas
drawing. White-hot things (engine cores, enemy plasma, crystal cores, hot shards, explosions) bloom
softly. Saturated crystal facets keep their definition. Big moments push the air: a boss death sends
two refracting shockwave rings across the galaxy and the swarm, with a short bloom surge and lens
streaks; a bomb, a player death, a capital-ship kill, a nova, a perfect dash and large explosions get
smaller rings. Taking a hit gives a brief colour-fringe tick. Low HP darkens and reddens only the dark
backdrop near the screen edges. The HUD, callouts, damage numbers and the sector card stay razor
sharp, because they are drawn on top after post-processing. The title screen's attract demo goes
through the same pipeline. A slow machine quietly steps itself down to cheaper settings and, if it
has to, back to the plain 2D look, which also happens when WebGL2 is missing or the GPU context is
lost. A new **Enhanced graphics** setting (on by default) turns it off. Reduced flashing and screen
shake 0 are fully respected. Gameplay is untouched: same runs, same golden master.

## 2. Starting point

- **Base:** the PR branch `claude/dazzling-faraday-2kxdhl` with tasks 1, 2, 3a and 3b merged (HANDOFF
  order). Before you start, confirm `renderer.bg.galaxy` (3a) and `renderer.fx` (an `EntityFx`, 3b)
  exist in `src/render/renderer.ts`, and that `SpriteCache.setGlowScale` exists in
  `src/render/sprites.ts` (3b step 5). If 3a/3b are missing, stop: this step calls their hooks.
  Work on a branch (for example `wip/wave3-postfx`, to be created); merge with a merge commit, no
  force-push; one or a few focused commits, all checks green.
- **Source (in-tree, no other branch needed):** `prototypes/postfx/`:
  - `postfx.ts`: the module, 977 lines, no imports, shaders inline. Typechecks clean with the repo's
    strict flags (checked 2026-10-11 with `npx tsc --noEmit --strict --noUnusedLocals
    --noUnusedParameters --verbatimModuleSyntax --isolatedModules --useDefineForClassFields
    --target es2022 --module esnext --moduleResolution bundler --lib es2022,dom,dom.iterable
    prototypes/postfx/postfx.ts`).
  - `NOTES.md`: the integration guide (v2, after the art review).
  - `integration.patch`: post-FX only, against `687bc97` (an ancestor of the PR head). Checked
    2026-10-11: it applies cleanly to `687bc97`; against `a114403` (the PR head that day) the hunks for
    `renderer.ts`, `sprites.ts`, `postfx.ts`, `main.ts`, `index.html`, `save.ts`, `style.css` and
    `e2e/smoke.spec.ts` still apply (`renderer.ts`/`sprites.ts` are unchanged since `687bc97`), the
    `app.ts` and `ui.ts` hunks do not. After 3a/3b the `renderer.ts` hunk will not apply either:
    **port by hand**. 3b already ported the `sprites.ts` hunk; do not apply it twice.
  - `combined.patch`: all four layers on the older base `8456790`, a merge reference only. It contains
    capture-only code (`?god`, `?seed`, `?legacybg`, `debugBgOnly`, `__galaxyEvents`): never port it.
  - `tools/*.mjs`: capture and benchmark harness. They import Playwright from the absolute path
    `/home/user/addictive-game/node_modules/playwright/index.mjs` and serve `combined-dist/`, both from
    the original build machine: adjust the paths. `lib.mjs` has the useful parts (`installStorm`: 400
    live aliens and 60 real kills per sim-second; an rAF freeze/step init script; `redraw()`, which still
    uses the v1 name `r.fx.art.setGlowScale`, now `r.fx.setGlowScale`).
- **Reference build (optional, recommended):** `git archive a114403 | tar -x -C <scratch>` (outside the
  repo), `git apply prototypes/postfx/integration.patch` there, and read the resulting
  `src/render/renderer.ts` as the complete 2D + post-FX renderer before 3a/3b. Never commit it.
- **Target look:** `origin/wip/prototypes:gfx/postfx/shots/{title,early,warden,bossdeath,voidheart,nova,
  lowhp,storm,glow}-compare.png` and `gfx/review/postfx-sheet.jpg`, `postfx-sheet2.jpg` (read with
  `git show origin/wip/prototypes:<path> > /tmp/x.png`). Optional if you cannot fetch.
- **Environment fact (checked 2026-10-11):** the Playwright Chromium used by `npm run e2e`
  (Playwright 1.56.1) has WebGL2 through SwiftShader, with `EXT_color_buffer_float` and
  `WEBGL_lose_context`. Post-FX therefore runs in e2e and headless captures, slowly: the auto ladder
  will step down within seconds there.

## 3. Read first

1. `AGENTS.md`, then `docs/HANDOFF.md` §3c.
2. `prototypes/postfx/NOTES.md` in full: §1 (review items, all done in the module), §2 (pipeline and
   quality table), §3 (API and the event→effect table), §5 (integration points), §6 (timings).
3. `prototypes/postfx/postfx.ts`, then the `renderer.ts` hunk of `prototypes/postfx/integration.patch`.
4. `docs/specs/03a-galaxy.md` §5 "Interfaces this step exposes" (warp, punch, `Background.draw`) and
   `docs/specs/03b-entities.md` §4 item 4 and §5 "Interfaces this step exposes" (`fx.setGlowScale`,
   `fx.postFx`, `fx.setCostTier`, `sprites.setGlowScale`); `prototypes/entities/NOTES.md` §4.4.
5. Current code: `index.html`; `src/main.ts` (`boot`); `src/app.ts` (`constructor`, `applySettings`,
   `frame`, `stepAttract`, `stepGame`, `readDebugParams`); `src/render/renderer.ts` (`resize`, `reset`,
   `addFlash`, `consume`, `draw`); `src/render/sprites.ts`; `src/render/hud.ts` (`HudState`, the
   `showFps` block in `drawHud`); `src/core/input.ts` (`Input.attach`); `src/meta/save.ts`
   (`Settings`, `defaultSettings`, `migrate`); `src/ui/ui.ts` (`showSettings`); `src/ui/style.css`
   (`#game`); `e2e/smoke.spec.ts`; `tests/no-p1-alias.test.ts`.

## 4. Owner decisions and constraints (non-negotiable)

1. **Canvas layout.** A WebGL2 canvas `#fx` sits **under** `#game`. `#game` stays the visible top canvas
   and the input target: `src/core/input.ts` is not changed. The world (galaxy backdrop, grid,
   entities, particles) is drawn to an **offscreen world canvas**, uploaded, post-processed and output
   to `#fx`. The HUD, callouts, damage numbers and 3a's sector card are drawn on `#game` **after**
   post-FX, never bloomed or warped. All canvases share the device-pixel size (only the world canvas
   shrinks on the lowest ladder rung). With post-FX off or unavailable, everything draws to `#game`
   as before; the 2D path stays correct (intended 2D changes are only those listed in step 8).
2. **Bloom keyed to near-white:** the bright pass measures heat `mix(max, min, 0.6)` of the channels,
   threshold 0.6, knee 0.1, so saturated crystal facets do not turn into blobs. Keep the prototype's
   values (`DEFAULT_POSTFX`, `PostFx.tune`). Do not switch back to a max-channel threshold (§10).
3. **Lens streaks only during bloom surges** (boss death 0.8, bomb 0.8, perfect dash 0.35).
4. **Shockwave budget:** boss death (two waves), boss kill, bomb and player death always play
   (`major`); everything else draws from a token bucket of 3/s, burst 3, and is dropped over budget.
   Explosions get a wave only when `r >= 60`. At most 8 live waves. Hurt gets **no** wave.
5. **Chromatic aberration only as brief spikes** (hurt 0.25, boss death 0.5, player death 0.5, decay
   3/s, `CA_SCALE` 0.006); **zero with reduced flashing**. No permanent low-HP aberration. The low-HP
   effect is the red edge that tints only the dark backdrop. **No CRT mode.**
6. **Sprite glow ×0.15** for shape sprites **and** vessel art while post-FX is active, through 3b's
   hooks; back to **1.0 whenever post-FX is off** (setting, context loss, auto-off, no WebGL2).
7. **Auto-quality ladder** (HANDOFF's "q3 → q0 → q0 at 0.75 → off" is shorthand for): q3 → q2 → q1 →
   q0 → q0 at render scale 0.75 → off. Steps down after sustained slow frames, back up with
   hysteresis and a cap on oscillation. It exposes **`renderer.costTier`**; 3b's shard detail follows
   it now, 3d's grid quality will.
8. **Fallback:** no WebGL2 (or a shader failure) → post-FX never activates; `webglcontextlost` →
   plain 2D immediately, without a black frame; `webglcontextrestored` → back on.
9. **Setting:** `Settings.postfx: boolean`, default `true`, old saves default to `true`; an
   **"Enhanced graphics"** toggle in the settings screen; the settings layout stays tidy on mobile.
10. **World-anchored shockwaves** that use the renderer's camera transform **including co-op zoom and
    screen shake** (see step 5 for how this survives 3e's zoom-aware camera).
11. **The title-screen attract mode renders through post-FX** too (also results and lobby, which use
    the same attract path).
12. **e2e:** the smoke test's "canvas draws" pixel-variety check must probe the **world image** when
    post-FX is on, so it stays meaningful.
13. **Galaxy warp punch + post-FX flash must not stack into a white-out:** cap them combined (step 9).
14. `AGENTS.md` hard rules: the simulation stays bit-identical (`tests/golden.solo.test.ts` passes
    unchanged; no edits under `src/game/`); render code never mutates sim state or draws from the sim
    RNG streams; strict TypeScript; `npm run build:single` keeps working; never skip, disable or
    loosen a test; reduced flashing and shake 0 respected; Pixel 7 works; original IP; code idiomatic
    to the surrounding files; update `docs/GAME_DESIGN.md`.

## 5. Implementation plan

**Step 1. The module.** Copy `prototypes/postfx/postfx.ts` to `src/render/postfx.ts` (to be created)
unchanged except:
- Fix two stale comments: `PostFxSettings.threshold` says "on max(r,g,b)" and `FS_PREFILTER` says
  "'bright' works on the brightest channel"; both now describe heat (`tune.white` = 0.6).
- Add `export function flashBudget(punchAlpha: number, flashes: boolean, postFx: boolean): number`
  (to be created): the whole-screen flash alpha still allowed while the galaxy punch shows,
  `Math.max(0, cap - punchAlpha)` with `cap` = post-FX `flashes ? 0.35 : 0.15`, 2D
  `flashes ? 0.45 : 0.15`. Keep it pure (unit-tested in Node).
- Failure paths log with `console.warn` only (as the prototype does): the desktop smoke test fails on
  renderer console **errors**.
Keep every constant (`CA_SCALE`, `SURGE_GAIN`, `STREAK_GAIN`, `FLASH_MAX` 0.25, `WAVE_RATE`,
`WAVE_BURST`, `MAX_WAVES`, `LOW_RENDER_SCALE`, `QUALITY`, `tune`) and the API of NOTES §3.

**Step 2. DOM and CSS.**
- `index.html`: `<canvas id="fx" aria-hidden="true"></canvas>` immediately before
  `<canvas id="game" …>` (task 2 removed the Google Fonts links above; the body is otherwise as today).
- `src/ui/style.css`: copy the patch's hunk. The `#game` rule becomes `#game, #fx` (fixed, inset 0,
  100%, `touch-action: none`, `background: var(--void)`); `#fx { z-index: 0; pointer-events: none;
  display: none; }`; `#game { z-index: 1; }`; `body.fx-on #fx { display: block; }`;
  `body.fx-on #game { background: transparent; }`. `#ui` stays at z-index 2.

**Step 3. App wiring** (`src/main.ts`, `src/app.ts`).
- `boot()`: `const fx = document.getElementById('fx') as HTMLCanvasElement | null;` and pass it to the
  App. After task 2 the call is `new App(canvas, ui, p)`; make it `new App(canvas, ui, p, fx)` with
  the new last parameter `fxCanvas: HTMLCanvasElement | null = null` (without task 2:
  `(canvas, uiRoot, fxCanvas = null)`).
- `App` constructor: `new Renderer(canvas, fxCanvas)`.
- `readDebugParams()`: add `noFx: q.get('fx') === '0'` (forces the 2D path) and `fxq` (to be created):
  `?fxq=0..3` pins `postfx.settings.quality` (no ladder; for tests and captures), absent = `'auto'`.
  Set it right after `new Renderer(...)` and before the constructor's first `applySettings`, so the
  first `applyFxMode` → `onFxQuality` already computes `costTier` from the pinned rung.
- `applySettings(s)`: append `this.renderer.setPostFx(s.postfx && !this.debug.noFx);`.
- `frame`: before `realDt` is clamped, report the raw interval:
  `this.renderer.postfx?.reportFrameTime(now - this.last)` (the module ignores ≤ 0 and > 250 ms, so a
  tab switch does not count; the clamped `realDt` would hide that).

**Step 4. Renderer fields and constructor** (`src/render/renderer.ts`; names from the patch).
- Import `PostFx, flashBudget, type FxQuality` from `./postfx`.
- Constants: `FX_GLOW = 0.15`; `FX_PUNCH = 0.6` (galaxy punch sprite scale under post-FX, a starting
  value to tune in step 9). 3b already added the `+score` density gate; do not add a second one.
- Fields: `ctx` becomes mutable (world canvas in post-FX mode, `#game` otherwise; nothing outside the
  renderer reads it, checked); `readonly hudCtx` (always `#game`); `readonly worldCanvas` and
  `private readonly worldCtx` (`getContext('2d', { alpha: false })`; never `willReadFrequently`);
  `readonly postfx: PostFx | null`; `private fxWanted = true`; `private fxOn = false`;
  `private worldScale = 1`; `costTier = 4`; `private hurtCaT = 0` (hurt-aberration limiter);
  `private camZoom = 1` (the zoom the view actually applies; 1 until 3e drives it).
- Constructor: create `PostFx.create(fxCanvas)` **first**, then the `#game` context with
  `alpha: this.postfx !== null` (the patch used `fxCanvas !== null`; an opaque canvas is cheaper when
  WebGL2 is missing). Hook `postfx.onActiveChange = () => this.applyFxMode()` and
  `postfx.onQualityChange = (q, rs) => this.onFxQuality(q, rs)`. End with `this.resize();
  this.applyFxMode();`.

**Step 5. `resize()` and one view transform.**
- `resize()`: after sizing `#game`, `this.postfx?.resize(this.w, this.h)` and `sizeWorldCanvas()`
  (to be created: `round(w·worldScale) × round(h·worldScale)`; size it 1×1 while post-FX is off to
  free ~8–32 MB). Sprite resolution: `this.sprites.setResolution(this.scale * this.dpr *
  this.worldScale)` and the same value for `this.fx.setResolution(...)` (3b's interface; keep it
  zoom-independent). The returned half extents stay `cssW / 2 / scale`, `cssH / 2 / scale`:
  **`world.viewHalfW/H` is sim state and must never depend on `worldScale`**.
- Add `private view(tw: number, th: number, s: number): { k: number; ox: number; oy: number }` (to be
  created): `k = this.scale * this.dpr * s / this.camZoom`, `ox = tw / 2 - this.camX * k +
  this.shake.x * this.dpr * s`, `oy` likewise. `draw()` uses it for the world target
  (`s = worldScale`, the world canvas size in post-FX mode, else `s = 1` and `#game`) **and** for the
  overlay (`s = 1`, `this.w`, `this.h`). Never compute a camera transform anywhere else. 3e makes the
  camera zoom-aware by setting `camZoom` (and its `worldToScreen`) from this one place, and the
  shockwaves follow because `postfx.setView` is fed from it (step 8).

**Step 6. Mode switching** (port from the patch, with these changes).
- `setPostFx(on)`: **edge-triggered** re-enable:
  `if (on && !this.fxWanted) this.postfx?.reenable(); this.fxWanted = on; this.applyFxMode();`.
  `App.applySettings` runs on **every** pointerdown/keydown (the audio `unlock` listener is not
  `once`), so an unconditional `reenable()` would undo every auto-off on the next click.
- `get postFxActive(): boolean` returns `fxOn`.
- `applyFxMode()`: `on = fxWanted && !!postfx && postfx.active`; set `fxOn`; `ctx = on ? worldCtx :
  hudCtx`; `g = on ? FX_GLOW : 1`; `this.sprites.setGlowScale(g)`; `this.fx.setGlowScale(g)` (it
  re-queues its own vessel prewarm, per 3b); `this.fx.postFx = on`; `this.bg.galaxy.punchScale = on ?
  FX_PUNCH : 1` (step 9); `onFxQuality(...)` as in the patch; `sizeWorldCanvas()`;
  `document.body.classList.toggle('fx-on', on)`.
- `onFxQuality(_q, renderScale)`: `costTier = fxOn && px ? px.costTier : px?.autoOff ? 0 : 4`; then
  `this.fx.setCostTier(this.costTier)`; world scale = `fxOn ? renderScale : 1`, `resize()` when it
  changes. Leave a one-line comment that 3d sets its grid quality here.

**Step 7. `consume()` and `reset()`.**
- `reset(world)`: first line `this.postfx?.clearEffects();`.
- `private wave(x, y, radius, strength, duration, glow, thickness, major = false)` (to be created):
  no-op unless `fxOn`; passes `strength / this.camZoom` (strength is px at 1080p; radius and thickness
  are world units and scale through `setView` already).
- Add to the existing cases (they run after 3b's `this.fx.onEvent(ev, world, P)`), values from
  NOTES §3 (radius, strength, duration, glow, thickness):

| event | post-FX call(s) |
|---|---|
| `bossdead` | `wave(x, y, 1100, 50, 1.6, 0.3, 90, true)`; `wave(x, y, 520, 26, 0.9, 0.2, 50, true)`; `kickAberration(0.5)`; `kickBloom(0.8)` |
| `kill`, `boss` | `wave(x, y, r·6, 40, 1, 0.2, max(18, r·0.7), true)` |
| `kill`, `elite` | `wave(x, y, r·6, 16, 0.55, 0.2, max(18, r·0.7))` |
| `bomb` | `wave(x, y, 1300, 60, 1.1, 0.3, 80, true)`; `kickBloom(0.8)` |
| `death` (run over) | `wave(x, y, 700, 45, 1.2, 0.25, 70, true)`; `kickAberration(0.5)` |
| `downed` (co-op; spec decision) | `wave(x, y, 420, 27, 0.9, 0.2, 50)` (minor); aberration through the hurt limiter |
| `ring` (Bastion nova and other rings) | `wave(x, y, r·1.05, 12, 0.6, 0.1, max(20, r·0.1))` |
| `perfect` | `wave(x, y, 170, 16, 0.45, 0.25, 22)`; `kickBloom(0.35)` |
| `explode`, `r >= 60` only | `wave(x, y, r·1.8, 9, 0.4, 0.08, max(18, r·0.2))` |
| `hurt` | no wave; `kickAberration(0.25)` only if `hurtCaT <= 0`, then `hurtCaT = 0.4` (real time; four pilots must not keep the fringe on) |

**Step 8. `draw()`** (3a+3b's world order is unchanged; only the target and the tail change).
1. Decrement `hurtCaT` by `rdt`. `fxMode = this.fxOn && this.postfx !== null`. World target size
   `tw, th` = world canvas in `fxMode`, else `this.w, this.h`; `{k, ox, oy} = this.view(tw, th,
   fxMode ? worldScale : 1)`; culling extents from `tw, th, k` as today. Pass `tw, th` (not
   `this.w, this.h`) to `bg.draw` and every other world-layer call that takes the size.
2. Draw the world exactly as 3b left it into `ctx`. Only change: the white capital-blast **fill** (the
   `blasts` loop, boss death and bomb) uses `fxMode ? 0.10 : 0.18` with flashes on (bloom doubles it);
   keep 3b's reduced-flashing cap (0.15 for `r > 300`) and the stroke as is.
3. Overlay: `hud = this.hudCtx`. In `fxMode` reset its transform, `globalAlpha = 1`, `source-over`
   and `clearRect(0, 0, this.w, this.h)` **every frame, attract included** (else the last game HUD
   stays over the title screen).
4. Damage numbers and world text: `hud.setTransform` from `this.view(this.w, this.h, 1)`, then
   `this.texts.draw(hud, 1)`. In 2D mode `hud === ctx` and this is today's call at today's place.
5. Low HP: `lowHp` = the largest pulse `(sin(time·6)·0.5 + 0.5)·(0.3 − hpK)·1.6` over up pilots
   (`world.isUp(p)`, `hpK = p.hp / p.stats.maxHp < 0.3`) from `world.players`, 0 in attract. Solo
   is identical to today's P1 value. Do not add new `world.player`/`world.stats` reads.
6. Flash: `punchA = galaxy.warpFx.punch * (flashes ? 0.35 : 0.09) * galaxy.punchScale`;
   `flashA = Math.min(this.flash.a, flashBudget(punchA, this.settings.flashes, fxMode))`.
7. `fxMode`: `fx.settings.flashes = settings.flashes`; `fx.settings.shake = settings.shake`;
   `fx.damage = lowHp * 2`; `fx.setFlash(this.flash.color, flashA > 0.01 ? flashA : 0)`;
   `fx.setView(k, ox, oy)`; `if (!fx.render(this.worldCanvas, rdt))` → first draw this frame's world
   under the overlay (`destination-over`, `drawImage(worldCanvas, 0, 0, this.w, this.h)`), **then**
   `applyFxMode()` (it shrinks the world canvas, which would wipe it), so a mid-frame loss shows no
   black frame. (The patch calls `applyFxMode()` first; that only works without the shrink.) Effects
   run on real time (`rdt`) like flash and shake today.
8. 2D mode: `bg.drawVignette`, the low-HP gradient (from `lowHp`) and the flash with `flashA` as today.
   The only intended 2D changes in this step: the flash is gated by `flashBudget` (0.45, 0.15 with
   reduced flashing, minus the punch) instead of unbounded, and the low-HP pulse considers every pilot
   in co-op.
9. Not attract: `drawHud(hud, world, this.w, this.h, this.ui, this.hud)`, `callouts.draw(hud, …)` and
   3a's `sectorCard.draw(hud, …)`, all on the overlay at native resolution.

**Step 9. Galaxy punch coupling** (`src/render/galaxy.ts`, 3a's file).
- Add `punch: number` to `WarpFx` (to be created unless 3a did): 0..1, `1 - tp / PUNCH_S` inside the
  100 ms punch window (`tp = (p - WARP_TUNNEL) · dur`, exactly as `draw()` computes it), else 0.
- Add `punchScale = 1` to `GalaxyBackdrop` (to be created) and multiply the punch sprite alpha in
  `draw()` by it. The renderer sets 0.6 under post-FX (bloom adds energy) and 1 in 2D.
- With step 8.6 the punch and the whole-screen flash share one budget: ≤ 0.35 under post-FX, 0.45 in
  2D, 0.15 with reduced flashing. Tune `FX_PUNCH` and the caps on screenshots (§9) and record the
  final values in `docs/GAME_DESIGN.md`.

**Step 10. Setting and UI** (§6).

**Step 11. FPS overlay (should).** Add `fxLabel: string` to `HudState` (to be created) and append it
to the `showFps` line in `drawHud`: `FX q3`, `FX q0 ×0.75`, `2D`, `2D (auto)`; the renderer fills it
each frame. It only shows with Show FPS on, so the default HUD does not change. It is what the
owner's real-hardware check reads.

**Step 12. Docs.** `docs/GAME_DESIGN.md`: §7 rows "Player hurt" (red edge, brief colour fringe under
post-FX), "Boss death" (two shockwaves, bloom surge, lens streaks), "Bomb" if listed; §9 a bullet for
the WebGL2 post-processing layer (offscreen world canvas, HUD on top, auto-quality ladder, 2D
fallback); the reduced-flashing guardrail in §4 (no aberration, surges or streaks; softer waves; shake
0 = no screen warping). `AGENTS.md` and `README.md` debug-parameter lines: `?fx=0`, `?fxq=N`.
`docs/HANDOFF.md`: mark 3c done and list the interfaces below.

**Interfaces this step exposes (3d, 3e and task 4 use them; keep them stable):**
- `renderer.postfx: PostFx | null`, `renderer.postFxActive: boolean`, `renderer.setPostFx(on)`.
- `renderer.costTier: number`: 4 = q3, 3 = q2, 2 = q1, 1 = q0, 0 = q0 at 0.75 or auto-off; 4 in the
  plain 2D path unless post-FX switched itself off. 3d sets grid quality from it in `onFxQuality`
  (hairlines only while `postFxActive`).
- `renderer.worldCanvas`, `renderer.hudCtx`; the private `view()` helper and `camZoom`, which 3e turns
  into the zoom-aware camera and `worldToScreen` (one transform for every layer).
- `flashBudget()` in `src/render/postfx.ts`; `WarpFx.punch`, `GalaxyBackdrop.punchScale`.
- Debug: `?fx=0`, `?fxq=N`; `window.shardstorm.renderer.postfx.stats()` (`cpuMs`, `uploadMs`,
  `frameMs`, `waves`, `wavesDropped`, `halfFloat`, `renderScale`).

## 6. Settings and save data

- `src/meta/save.ts`: `Settings.postfx: boolean` with a doc comment ("WebGL2 post-processing (bloom,
  shockwaves). Falls back to plain 2D when unavailable."); `defaultSettings()` → `postfx: true`.
- Old saves: `migrate()` already merges `{ ...base.settings, ...r.settings }`, so a missing field
  becomes `true`. Also add `if (typeof out.settings.postfx !== 'boolean') out.settings.postfx = true;`
  next to the `trail`/`chatter` normalisation. No `SAVE_VERSION` bump. Storage is task 2's platform
  adapter; nothing changes there.
- `src/ui/ui.ts` `showSettings`: `${toggle('postfx', 'Enhanced graphics', 'Bloom and shockwaves
  (WebGL2). Turn off on slow machines', st.postfx)}` directly after the "Screen flashes" toggle; add
  `postfx: ($(s, '#set-postfx') as HTMLInputElement).checked` to `read()` (it builds a full `Settings`,
  so TS requires it). It works from the pause menu too: `settingsChanged` → `applySettings` →
  `setPostFx`, applied immediately (one re-bake of sprites).
- The toggle shows the player's wish. When the ladder has switched post-FX off, the toggle stays on;
  turning it off and on retries from q1 (`reenable`). Auto-off is not persisted.
- No collision with 3d's grid-motion setting or task 2's desktop Fullscreen row (which is not part of
  the save).

## 7. Accessibility, mobile, co-op and performance requirements

- **Reduced flashing** (`Settings.flashes = false`): aberration 0, `kickBloom` ignored (so no surges
  and no streaks), no wavefront brightening, refraction ×0.45, whole-screen flash ≤ 0.15 (after
  `addFlash`'s ×0.25), 3b's disc caps. **Shake 0:** refraction ×0, so no screen warping at all
  (`render` then sends no waves). The HUD, text and callouts are never warped or bloomed. The low-HP
  edge never tints sprites. Grain is luma-weighted (darks only), amplitude 0.02.
- **Mobile (Pixel 7):** the e2e mobile project stays green. `#fx` has `pointer-events: none`, so touch
  input on `#game` is unchanged. DPR is capped at 2 (824×1830 device px). Without float colour buffers
  the module falls back to RGBA8 (built in). The settings row fits at 412 CSS px and the list still
  scrolls: screenshot it.
- **Co-op (1–4 pilots):** one wave budget for everyone; hurt aberration limited to one kick per 0.4 s;
  `downed` is a minor wave; the low-HP edge follows the most endangered up pilot. Waves stay anchored
  at any zoom through `view()`/`camZoom` (verified by unit test now, visually by 3e).
- **Performance** (60 fps on a mid laptop at 1080p with every layer on; a 300–400-enemy fight must stay
  readable). Measure in headless Chromium (SwiftShader: JS numbers are meaningful, raster/GPU numbers
  pessimistic):
  - post-FX main-thread JS per frame (`postfx.stats().cpuMs`, upload + command encoding) **p50 ≤ 0.5 ms**
    at 1920×1080 in the kill storm (prototype: 0.2 ms; p95 1–3 ms were SwiftShader stalls; report p95);
  - `consume()` mean ≤ 0.25 ms in the storm, including wave mapping (prototype 0.16 ms);
  - ≤ 14 GL draws per frame (11 without a surge);
  - baked sprite pixels with glow 0.15 at least 50 % below glow 1 (`sprites.pixelCount()`; prototype
    −55 % to −80 %);
  - the lowest rung (q0 at 0.75) must be cheaper than the plain 2D frame in the frozen storm frame
    (prototype 31.2 ms vs 54.8 ms at 1080p, flushed, SwiftShader);
  - GPU on a mid iGPU at 1080p: estimated 0.6–1.2 ms at q3, unmeasured; the **owner's real-hardware
    check** (any iGPU laptop, kill storm, Show FPS on) is part of acceptance.
- **Ladder (keep the prototype's numbers):** auto starts at q2; EMA (α 0.05) of `reportFrameTime`;
  above 19.5 ms for 2 s → down one rung (EMA reset to 16.7); below 13.5 ms for 8 s → up (first the
  render scale, then quality), and only while fewer than 3 downgrades have happened since start or
  `reenable()`; out of rungs → off (`autoOff`, `onActiveChange(false)`). A pinned quality disables it.

## 8. Tests to add or update

- **`tests/postfx.test.ts`** (to be created; Vitest runs in Node, so no DOM). Use a fake canvas
  (`getContext`, `addEventListener`, `removeEventListener`, `width`, `height`) and a `Proxy`-based fake
  WebGL2 context: unknown members are no-op functions; override `getShaderParameter`/
  `getProgramParameter` → `true`, `isContextLost` → `false`, `getExtension` → `null`,
  `getUniformLocation` → `{ name }`, and record `uniform1f/1i/4fv` by name. (Checked 2026-10-11: this
  runs the real `postfx.ts` end to end in Node, including `render()`.) Cover:
  1. `PostFx.create` returns `null` when `getContext` returns `null` or throws.
  2. Budget: three minor waves accepted, the fourth refused and `stats().wavesDropped` counts it;
     `major` always accepted; tokens refill at 3/s through `render(src, dt)`; with 8 live waves a
     weaker newcomer is dropped and a stronger one replaces the weakest.
  3. Ladder: `reportFrameTime(30)` repeatedly → `onQualityChange` sequence `(1,1)`, `(0,1)`,
     `(0,0.75)`, then `onActiveChange(false)`, `autoOff`, `costTier` 0; `costTier` 3 at q2, 4 at q3;
     fast frames climb, but not after 3 downgrades; `settings.quality = 2` pins it; `reenable()`
     restores q1 and `active`.
  4. Accessibility: after `kickAberration(1)` and `kickBloom(1)` with `settings.flashes = false`,
     `render` sets `uCA` 0 and `uStreakAmt` 0; `settings.shake = 0` → `uWaveCount` 0; `setFlash` caps
     at 0.25.
  5. Context: dispatching `webglcontextlost` → `active` false and `onActiveChange(false)`;
     `webglcontextrestored` → `active` true again.
  6. Anchoring: `resize(1280, 720)`, `setView(k, ox, oy)` with a zoomed `k` (e.g.
     `scale·dpr / 1.45`) and a 960×540 source (render scale 0.75): `uWave[0]` centre is
     `((ox + x·k)·1280/960, 720 − (oy + y·k)·720/540)`.
  7. `flashBudget`: no punch → 0.35 / 0.45 / 0.15; a full punch leaves 0 with reduced flashing; never
     negative.
- **`tests/meta.test.ts`:** `defaultSettings().postfx === true`; `migrate({ settings: { music: 0.1 }
  }).settings.postfx === true`; `postfx: false` survives; a non-boolean becomes `true`.
- **`e2e/smoke.spec.ts`** ("a run starts, the world simulates and the canvas draws"): probe
  `renderer.worldCanvas` when `renderer.postFxActive`, else `#game` (patch hunk; update the comment).
  Draw it into the small probe canvas as today; never `getImageData` the world canvas itself.
- **`e2e/postfx.spec.ts`** (to be created; both projects; `skipIntro`; error tracking as in the other
  specs):
  1. On by default (`?fxq=0` pins the ladder): `body.fx-on`, `postFxActive`, `#fx` visible; during a
     run the world canvas has pixel variety > 20 and so does a `page.screenshot()` of the composited
     page (decode it in the page with an `Image` and a probe canvas; reading `#fx` back with
     `drawImage` is unreliable because `preserveDrawingBuffer` is false).
  2. Context loss: take `WEBGL_lose_context` from `#fx`'s `getContext('webgl2')` **before** losing,
     `loseContext()` → poll `postFxActive === false`, no `fx-on`, `#game` has variety;
     `restoreContext()` → poll `postFxActive === true`. No console errors.
  3. Setting: uncheck `#set-postfx` → `fx-on` gone, saved `settings.postfx === false`; reload → still
     off; check it again → on.
  4. `?fx=0` → 2D path (`postFxActive` false, `#game` has variety).
- **Must not change:** `tests/golden.solo.test.ts`, `tests/no-p1-alias.test.ts` (no new alias reads;
  do not name any new field `player`, `stats` or `build` in `src/`, its regex matches `this.stats`),
  `tests/determinism.guard.test.ts` (from task 1: never import `src/render/*` from `src/game/*`),
  `e2e/coop.spec.ts` and `e2e/story.spec.ts` (must pass unchanged), the save key `shardstorm.save`,
  `src/core/input.ts`, anything under `src/game/`.

## 9. Acceptance checklist

- `npm run typecheck`, `npm test` (all pass), `npm run build`, `npm run build:single` (then open
  `dist-single/shardstorm.html` from `file://` in Chromium: `postFxActive` is true, no console
  errors), `E2E_PORT=<free port> npm run e2e` (desktop and mobile green), `xvfb-run -a npm run
  desktop:smoke` if Electron is installed (green; note whether post-FX was active there).
- `git diff --stat <merge-base>..HEAD -- src/game tests/golden.solo.test.ts tests/no-p1-alias.test.ts`
  is empty.
- Screenshots (outside the repo; before = `?fx=0` or a redraw with `setPostFx(false)`, after = default,
  same frame; pin `?fxq=3` for the intended look): title; early game (`?autoplay&warp=40`); Warden
  fight (`?autoplay&warp=185`); a live boss death ~0.3 s after the kill (debug only: set
  `window.shardstorm.world.boss.hp = 1`); Bastion nova (seed the save with `achievements: { warden: 1
  }`, `ship: 'bastion'`); low HP (debug: `world.players[0].hp` at 8 % plus a hurt); a 400-enemy kill
  storm at 1920×1080 (adapt `installStorm`); reduced flashing and shake 0 during a boss death; a forced
  context loss and its restore; the lowest rung (`?fxq=0` and `postfx.settings.renderScale = 0.75`);
  `?coop=4&autoplay`; a bomb fired during a warp punch (`galaxy.setWarpPreview(0, 1, 0.555)` then
  `renderer.consume([{ t: 'bomb', x, y }], world)`, frozen with the rAF helper), with flashes on and
  off, showing no white-out; Pixel 7: title, a run, the settings screen with the new row; the 2D
  fallback (setting off) for the same scenes. Look at every image.
- Report: the §7 performance numbers (1280×720 and 1920×1080), `wavesDropped` over 10 s of storm, the
  headless ladder timeline in auto mode (time of each rung; expect it to reach off on SwiftShader), the
  measured punch + flash caps, and the owner's real-hardware result (or "not done").

## 10. Pitfalls and known issues

- **Ladder vs display rate:** it measures the rAF interval, so a 50 Hz display, a 30 fps
  battery-saver cap (Chrome battery saver, iOS low-power mode) or a throttled background tab reads as
  "slow" and walks post-FX off although the GPU is idle. Accepted for now (it degrades to the 2D look,
  which is correct); note it in HANDOFF. A refresh-relative threshold is a possible follow-up.
- **Headless runs** step down within seconds (software GL). Pin `?fxq` in tests and captures; never
  assert post-FX stays on in auto mode.
- **Readbacks demote canvases:** repeated `getImageData` on the world canvas or `#game` can switch
  Chrome to a CPU canvas and make `texSubImage2D` slow. Read through a probe canvas only; flush GL
  timings with `postfx.finish()`.
- **Galaxy at the 0.75 rung:** `GalaxyBackdrop.draw` derives its generation quality from the size it is
  given, so the world canvas at 0.75 schedules a debounced background regeneration (in the worker, or
  chunked on the main thread when no Worker can start). Verify there is no visible pop or hitch when
  the ladder moves; up to three bounces are possible. If it hitches, pass the galaxy the native size
  basis instead (your call; note it).
- **Glow switches re-bake sprites** (setting toggle, loss, restore, auto-off): one hitch each, by design.
- **Do not "fix" the bright pass** back to max channel: the crystal hulls are drawn at max channel
  0.6–1.0, far above the facet budget, and would bloom into flat blobs (NOTES §4).
- **Unclamped `hp/maxHp`** in the brute core pulse turned into a screen-filling glow under bloom; 3b
  clamps it. Re-check in the storm capture.
- **`preserveDrawingBuffer: false`:** `#fx` cannot be read back reliably outside its frame; use page
  screenshots.
- **Context-loss test:** `getExtension('WEBGL_lose_context')` may return `null` once the context is
  lost; keep the object from before.
- **Electron:** under xvfb the GPU may be missing; post-FX must fall back silently (`console.warn`
  only). `powerPreference: 'high-performance'` selects the discrete GPU on dual-GPU laptops (battery);
  kept from the prototype.
- **Firefox on Linux** often has a non-accelerated 2D canvas, so the upload costs a readback; the
  ladder copes.
- **Menus are DOM** and never post-processed: 3b gave the UI its own `VesselArt` at glow 1; do not
  route menu art through the renderer's instances.
- Shader compilation (5 programs) is synchronous at boot; acceptable, measure it once.

## 11. Out of scope

- The WarpGrid and its quality mapping (3d); the zoom-aware camera, `renderer.worldToScreen`, co-op
  HUD, name tags and revive cues (3e).
- A CRT/scanline mode (cut by the review), a user-facing quality slider (the setting is on/off),
  persisting auto-off across sessions, GPU timer queries, parallel shader compilation, a "not
  supported" hint on the toggle.
- Any change to `src/game/`, the golden master or the P1-alias guard.
- Steam store assets and the real-hardware test itself (owner).
