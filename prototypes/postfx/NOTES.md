# SHARDSTORM post-FX (WebGL2): definitive integration guide (v2, after the art review)

Nothing under `/home/user/addictive-game` was modified. v1 (the build the review looked at) is archived in `v1/`.

## 0. Files

| Path | What it is |
|---|---|
| `postfx.ts` | **Repo file `src/render/postfx.ts`.** Shaders inline, no imports. Passes `tsc --noEmit --strict --noUnusedLocals --noUnusedParameters --verbatimModuleSyntax --target es2022 --module esnext --moduleResolution bundler --lib es2022,dom`. |
| `integration.patch` | **Post-FX only**, `git apply`-able on the current repo HEAD `687bc97` (checked on a clean `git archive HEAD`: applies, `tsc -p` clean, vitest 234/234, Playwright e2e smoke 10 passed / 2 skipped as before). Touches `index.html`, `src/main.ts`, `src/app.ts`, `src/ui/style.css`, `src/ui/ui.ts`, `src/meta/save.ts`, `src/render/renderer.ts`, `src/render/sprites.ts`, `e2e/smoke.spec.ts`, and adds `src/render/postfx.ts`. Reference tree: `head-src/`. |
| `combined/` + `combined.patch` | **The review's merge gate: all four layers in one build** (galaxy backdrop + warp grid + entities + post-FX). `combined.patch` is against `8456790` (the base the sibling patches were cut from; `687bc97` has since merged part of the galaxy sim side, so use it as a merge reference, not a blind apply). It contains capture-only debug bits inherited from the galaxy copy (`?god`, `?seed`, `?legacybg`, `debugBgOnly`). Built to `combined-dist/`. |
| `tools/refresh.sh` | Pulls the siblings' latest repo modules (`galaxy.ts`, `grid.ts`→`warpgrid.ts`, `gridfx.ts`, `vessels.ts`, `shardfx.ts`, `entityfx.ts`) into `combined/`. Last refreshed: galaxy 06:41, grid 06:53, entities 06:24. |
| `tools/build.sh` | Copies `postfx.ts` into `combined/`, runs `tsc -p`, builds `combined-dist/`. |
| `tools/shoot.mjs` | Real-game captures of the combined build. Every pair is the **same frozen frame** drawn twice: *before* = the same build's 2D fallback (full sprite glow, 2D vignette/flash), *after* = post-FX. |
| `tools/bench.mjs` | Kill-storm timings (400 live aliens, 60 real kills per sim-second). |
| `tools/budget.mjs` | Brightness-budget audit: max(r,g,b) distribution per element class on the pre-post world canvas. |
| `tools/tune.mjs`, `cmp.mjs`, `montage.mjs`, `lib.mjs` | Tuning sweeps, crops, contact sheets, shared harness (`installStorm`). |

## 1. Review items: what was done

| # | Review item | Status |
|---|---|---|
| 1 | Remove permanent low-HP aberration | **Done.** The `damage` term is gone from the CA amount. Low HP drives only the red edge, which is now *readable*: it darkens and tints the dark backdrop only (weighted by `1 - luma`), so ships, aliens and bullets keep their colours (`shots/lowhp-compare.png`). |
| 2 | Cap aberration spikes | **Done.** `CA_SCALE` 0.012 → **0.006**. Kicks: hurt **0.25**, boss death **0.5**, player death **0.5**. Decay 3/s. |
| 3 | Remove hurt shockwave | **Done.** Hurt = aberration tick + red edge + existing shake. |
| 4 | Milky grey on boss death | **Done.** In post-FX mode the flash is **additive, tinted, proportional to what is already lit**: `col += flash.rgb * a * (col*1.6 + 0.035)`, `a` capped at **0.25** inside the module. Blacks stay black. Bloom surge gain 1.4 → 0.4×(base). The renderer's white capital-blast fill is 0.10 in post-FX mode (0.18 in 2D), stroke 0.8. Compare `shots/bossdeath-compare.png` (2D greys the frame; post-FX does not). |
| 5 | Re-tune threshold/bloom against the new art | **Done, with a pushback on the metric** (see §4): bright-pass on **heat** = `mix(max, min, 0.6)` of the channels, threshold **0.6**, knee **0.1**, gain 4.0, tight-halo share 0.3. |
| 6 | Event-only lens streaks | **Done.** Streak gain = `streaks × 0.3 × surge²`; the three streak passes are not even run unless a surge is live. Surges come from boss death (0.8), bomb (0.8) and perfect dash (0.35). |
| 7 | Budget the shockwaves | **Done.** `ShockwaveOpts.major` (boss death ×2, boss kill, bomb, player death) always plays. Everything else (nova, perfect dash, elite kill, explode **r ≥ 60**) draws from a token bucket of **3/s, burst 3** inside PostFx; `shockwave()` returns false and counts `stats().wavesDropped` when over budget. Small blasts get grid ripples only. |
| 8 | Glow 0.15 must reach the vessel art | **Done.** `applyFxMode()` calls `sprites.setGlowScale(g)` **and** `fx.art.setGlowScale(g)` (0.15 in post-FX, **1.0 whenever post-FX turns off**: setting, context loss, auto-off) and then `fx.setResolution(...)` to re-queue the vessel prewarm, because the glow change drops every baked sprite. Verified in the context-loss test: glow 1 after loss, 0.15 after restore. |
| 9 | Widen the auto-quality ladder | **Done.** Ladder: q3 → q2 → q1 → q0 → **q0 + renderScale 0.75** → off. The world canvas is drawn at `device px × 0.75` (with the renderer's DPR cap of 2 this is ≤ 1.5 world px per CSS px) and the composite upsamples it; the HUD overlay stays native. `settings.renderScale` also lets a user/option cap it. One controller: `PostFx.costTier` (4 … 0) → `renderer.costTier`, which sets grid quality (0 under post-FX or when post-FX switched itself off for speed; 1 only in the plain 2D path). **Shard LOD:** entities exposes no knob yet; they should read `renderer.costTier` (e.g. ≤ 1 → halve shards per kill). |
| 10 | Cut CRT; ship the setting + e2e fix | **Done.** CRT removed from shader, settings and API. `Settings.postfx: boolean` (default true; old saves merge to true) with an "Enhanced graphics" toggle in the settings screen; `?fx=0` still forces 2D. `e2e/smoke.spec.ts` probes `renderer.worldCanvas` when `postFxActive`. |
| G | Draw order: enemy bullets last in the world | **Done in both patches** (bullets after the player ship, still additive). |
| G | Gate the whole-screen 2D flash | **Done** for the fallback: capped at 0.45 (0.15 with reduced flashing). |
| G | Suppress per-kill "+100" floats when dense | **Done:** plain score floats skipped above 150 live enemies; elites/bosses keep theirs. |
| G | Boss white disc ≤ 0.15 with reduced flashing | **Done:** fill 0.12, stroke 0.45 with reduced flashing. |
| G | Grid: beat pulse off with reduced flashing, shake 0 = no motion, quality 0 under post-FX | Wired in `combined/` through the grid team's new API (`motion`, `beatPulse`, `flareAllowed`, `quality`). |
| G | Galaxy: no own vignette | Already true: the 2D vignette is only drawn in fallback mode. |

## 2. Pipeline

```
world Canvas2D (offscreen, alpha:false, device px × worldScale)
   │ texSubImage2D (GPU→GPU copy on accelerated browsers)
   ▼
prefilter : soft-knee bright pass on HEAT = mix(max(rgb), min(rgb), 0.6), thr 0.6, knee 0.1,
            mild Karis weight vs fireflies; 4 bilinear taps → L0 at 1/2 (q2,q3) or 1/4 (q0,q1) of the SOURCE
down      : dual-Kawase 5-tap, L0 → … → Ln (n = 3..6 by quality)
streaks   : only while a surge is live: 3 widening horizontal 9-tap passes from L1 (q2+)
up        : dual-Kawase 8-tap, dst' = up(src)·w + keep·dst; keep(L0) 0.3, levels ≥4 damped 0.7;
            normalised by chain energy so the gain means the same at every quality
composite (output res, upsamples the source when renderScale < 1):
   ≤ 8 shockwaves (lens-shaped refraction + front brighten), radial CA (event spikes only),
   + bloom·4.0·(1 + 0.4·surge) + event streaks, additive tinted flash (≤ 0.25),
   low-HP edge (backdrop-only), hue-preserving soft shoulder at 0.8, vignette,
   luma-weighted grain 0.02 (+ 1/255 dither)
```

RGBA16F targets when `EXT_color_buffer_float`/`_half_float` work (verified with a framebuffer check), else RGBA8 with a ×0.5/×2 range trick. One fullscreen triangle from `gl_VertexID`, 5 programs, ≤ 14 draws/frame (11 without a surge).

| q | prefilter | levels | streaks (surge only) | grain |
|---|---|---|---|---|
| 3 | 1/2 | 6 | yes | yes |
| 2 (start) | 1/2 | 5 | yes | yes |
| 1 | 1/4 | 4 | no | yes |
| 0 | 1/4 | 3 | no | no |
| 0 + renderScale 0.75 | 1/4 of the 0.75 source | 3 | no | no |
| off | plain 2D path (`onActiveChange(false)`, `autoOff` true) | | | |

`auto`: EMA of real frame time; > 19.5 ms for 2 s steps down; < 13.5 ms for 8 s steps up (first restores renderScale, then quality), at most 3 times after any downgrade.

## 3. API (`src/render/postfx.ts`)

```ts
const fx = PostFx.create(glCanvas);        // null without WebGL2 / on shader failure
fx.settings: PostFxSettings                // bloom 1, threshold 0.6, knee 0.1, flashes, shake, vignette 1,
                                           // grain 1, streaks 1, quality 'auto' | 0..3, renderScale 1
fx.tune                                    // art knobs: { l0Keep 0.3, gain 4, grain 0.02, white 0.6 }
fx.onActiveChange = (active) => …          // context lost/restored, auto-off, reenable
fx.onQualityChange = (q, renderScale) => … // ladder moved: resize world canvas, scale other costs
fx.active / fx.autoOff / fx.quality / fx.renderScale / fx.costTier (4..0)
fx.resize(wDevicePx, hDevicePx)            // OUTPUT size (= visible canvas)
fx.setView(k, ox, oy)                      // world → SOURCE px affine (= the renderer's world transform)
fx.shockwave(x, y, { radius, duration?, strength?, thickness?, glow?, major? }): boolean
fx.kickAberration(0..1); fx.kickBloom(0..1)   // both ignored with reduced flashing
fx.setFlash('#rrggbb', alpha)              // per frame, capped at 0.25, additive on lit pixels
fx.damage = 0..1                           // per frame, red edge only
fx.render(sourceCanvas, dtSeconds): boolean   // false → show the 2D path this frame
fx.reportFrameTime(ms); fx.reenable(q?); fx.clearEffects(); fx.stats(); fx.finish(); fx.dispose()
```

Event → effect mapping (in `Renderer.consume`; strengths are px at 1080p):

| event | wave (radius / strength / duration) | budget | extra |
|---|---|---|---|
| `bossdead` | 1100 / 50 / 1.6 s **and** 520 / 26 / 0.9 s | major | CA 0.5, surge 0.8 (→ streaks) |
| `kill` boss | 6r / 40 / 1 s | major | |
| `bomb` | 1300 / 60 / 1.1 s | major | surge 0.8 |
| `death` | 700 / 45 / 1.2 s | major | CA 0.5 |
| `kill` elite | 6r / 16 / 0.55 s | minor | |
| `ring` (nova) | 1.05r / 12 / 0.6 s | minor | |
| `perfect` | 170 / 16 / 0.45 s | minor | surge 0.35 |
| `explode` r ≥ 60 | 1.8r / 9 / 0.4 s | minor | |
| `hurt` | none | | CA 0.25 |

Accessibility: `flashes = false` → CA 0, no surges, no streaks, no front brightening, refraction ×0.45; renderer flash ×0.25 then shader cap. `shake` (0..1) multiplies refraction, so **shake 0 = no screen warping** (`shots/bossdeath-after-shake0.png`), and in `combined/` also grid motion 0.

## 4. Brightness budget: measured, and the pushback on the bright-pass metric

`tools/budget.mjs` on a real mid-game frame (pre-post world canvas, glow 0.15), share of each entity's pixels by max(r,g,b):

| element | > 0.45 | > 0.6 | > 0.9 | budget says |
|---|---|---|---|---|
| shooter (gunship) | 99.9 % | 99.8 % | 56 % | facets 0.35–0.5 |
| brute | 86 % | 84 % | 33 % | facets 0.35–0.5 |
| Warden | 78 % | 76 % | 59 % | facets 0.35–0.5, core 0.9–1 |
| swarmling / dasher | 62–67 % | 61–63 % | 30–40 % | facets 0.35–0.5 |
| enemy bullets | 100 % | 100 % | 99 % | white-hot (correct) |
| player | 58 % | 36 % | 12 % | rim ≈ 0.8, engine/canopy 1.0 |
| backdrop, centre 60 % | p90 0.19 | | | ≤ 0.22 (ok) |

The crystal hulls are drawn in fully saturated colours at max channel 0.6–1.0, far above the facet budget. With the review's max-channel threshold 0.45, whole hulls bloom: gunships turn into flat pink blobs and the Warden's facets fill in (`tune/`, sweep montages). **Pushback:** instead of only moving the threshold, the bright pass measures *heat* = `mix(max, min, 0.6)`. A white-hot core (all channels high) scores 1.0; a saturated facet at max 1.0 scores ~0.5 and stays under threshold 0.6 (knee 0.1). That implements the budget's intent (cores, bullets, engines, nav lights and hot shards bloom; facets and alloy do not) and keeps working if the art drifts. For in-budget art (facets ≤ 0.5 max channel) the result is the same. Verified on Warden and mid-game crops: facet definition is kept, cores and plasma glow. **Ask for entities:** bring facets toward the budget anyway (they still read brighter than the cores in the 2D fallback).

Also found while building the kill-storm harness: `entityfx.ts` brute core pulse `0.85 + (1 - e.hp / e.maxHp) * 0.5 …` (line ~774) is unclamped. With `hp > maxHp` (any harness or future heal effect) it goes hugely negative and the glow covers the whole screen. That is the "white-magenta blob" the review saw in `heavy-final-new-*`; entities' `heavy.mjs` sets `hp = 1e9` without `maxHp`. Clamp `hp/maxHp` to [0, 1].

## 5. Integration, exact points (all in `integration.patch`; `combined/` has the same glue plus grid/entities/galaxy)

**DOM** (`index.html`): `<canvas id="fx" aria-hidden>` (WebGL2, z 0) → `<canvas id="game">` (2D, z 1, input target) → `#ui` → toasts. `style.css`: `#fx` is `pointer-events:none` and `display:none` unless `body.fx-on`; `body.fx-on #game { background: transparent }`. `input.ts` is unchanged (same element, rect, pointer capture, `touch-action`).

**`main.ts`**: pass `#fx` to `new App(canvas, ui, fx)`. **`app.ts`**: `new Renderer(canvas, fxCanvas)`; `applySettings` ends with `renderer.setPostFx(s.postfx && !debug.noFx)` (`?fx=0`); the rAF loop calls `renderer.postfx?.reportFrameTime(realDt * 1000)`.

**`meta/save.ts`**: `Settings.postfx: boolean`, default `true` (old saves merge to true via the existing `{...defaults, ...saved}`). **`ui/ui.ts`**: toggle "Enhanced graphics — Bloom and shockwaves (WebGL2). Turn off on slow machines", read back as `postfx`.

**`render/sprites.ts`**: `setGlowScale(g)` (scales the shadowBlur halo and its padding, clears the cache) and `pixelCount()`.

**`render/renderer.ts`**:
- Fields: `ctx` (mutable: world canvas in post-FX mode, `#game` otherwise), `hudCtx` (always `#game`), `worldCanvas` (offscreen, `alpha:false`), `postfx`, private `fxWanted/fxOn/worldScale`, public `costTier`. `#game` gets `alpha: true` only when an fx canvas exists.
- `resize()`: sizes `#game` to device px, `postfx.resize(w, h)`, world canvas to `round(w·worldScale) × round(h·worldScale)`, sprite/vessel resolution `scale·dpr·worldScale`.
- `setPostFx(on)`, `postFxActive`, `applyFxMode()` (ctx switch, glow 0.15/1 for sprites **and** `fx.art`, prewarm re-queue, `fx-on` class), `onFxQuality(q, rs)` (costTier, grid quality, world scale), `wave(…, major)`.
- `consume()`: the table in §3; `reset()` calls `postfx.clearEffects()`.
- `draw()`: world transform uses `k = scale·dpr·worldScale` and world-canvas size; enemy bullets after the player; capital-blast alpha caps; then the HUD overlay is cleared, **damage numbers are drawn on the overlay at native resolution**, and in post-FX mode `fx.settings.flashes/shake`, `damage`, `setFlash`, `setView(k, ox, oy)` and `render(worldCanvas, rdt)` run. If `render` returns false mid-frame, the renderer flips to 2D and blits that frame's world under the HUD (`destination-over`), so there is no black frame. In 2D mode the 2D vignette, low-HP gradient and the gated flash are drawn as before. HUD and callouts always go to `hudCtx`.

**For `combined/` (four layers)** the draw order is: galaxy → warp grid (`G.motion = shake`, `beatPulse = flashes ? 0.5 : 0`, `flareAllowed = flashes`, `quality` from `onFxQuality`) → rings/mines/pickups → telegraphs → enemies → elite rings → additive projectiles/blades/particles/shards/lightning/blasts → player ships → **enemy bullets** → (post-FX) → overlay text/HUD. Entities' cooled-shards-below-enemies split is theirs to add.

**Fallback**: no WebGL2 → `create` returns null → today's 2D path. `webglcontextlost` → `preventDefault`, GL objects dropped, `onActiveChange(false)` → 2D path with glow 1. `webglcontextrestored` → rebuild and flip back. Verified: `shots/context-lost-fallback.png`, `context-restored.png`, and `report.json.contextLoss` = `{afterLoss: false, glow: 1}` then `{active: true, fx-on, glow: 0.15}`.

## 6. Timings (combined build, kill storm: 400 live aliens, 60 kills/s, real kill events)

Headless Chromium with SwiftShader: the 2D canvas *and* WebGL run on the CPU. In post-FX mode the deferred 2D raster lands inside `texSubImage2D`; in 2D mode it happens after `draw()` returns, so live "draw" numbers are not comparable across modes. Compare the **frozen, flushed** rows, and read `post_js` as the real main-thread cost of post-FX.

| ms (median) | 1280×720 | 1920×1080 |
|---|---|---|
| Post-FX JS (GL command encoding), live p50 / p95 | **0.2 / 1.4** | **0.2 / 3.3** |
| Post-FX JS, frozen q3 / q0 | 0.2 / 0.2 | 0.2 / 0.1 |
| consume() incl. wave mapping, live mean | 0.10 | 0.16 |
| 2D fallback frame, flushed (glow 1) | 43.1 | 54.8 |
| Post-FX frame q3 (2D raster + upload + post, all software) | 48.4 | 82.5 |
| Post-FX frame q1 / q0 | 48.0 / 51.3 | 57.6 / 57.6 |
| **Post-FX lowest rung (q0 + renderScale 0.75)** | **32.8** | **31.2** |
| Cached sprite px (SpriteCache) glow 1 → 0.15 | 17.9 k → 8.0 k (−55 %) | 28.0 k → 5.6 k (−80 %) |
| Same, storm frame in `shoot.mjs` (`report.json.spritePx`) | | 16.8 k → 7.4 k (−56 %) |

Vessel and crystal art (`fx.art`): `glowScale` shrinks its shadowBlur, but its canvas padding (`extent + glow + 3`) does not scale, so its sprite pixels stay the same. Ask for entities: scale the padding by `glowScale` too (as `sprites.ts` does) to get the same fill savings.

What this says:
- The post-FX main-thread cost is 0.1–0.2 ms (p95 1–3 ms are SwiftShader stalls inside GL calls; a real driver queues them).
- On software GL the full-res bloom chain is the expensive part (q3 at 1080p +28 ms over q1); that is CPU shading and does not transfer to a GPU. Estimate on a mid iGPU (Iris Xe / Vega 8) at 1080p: 0.6–1.2 ms GPU at q3, 0.4–0.7 ms at q1, plus 0.1–0.3 ms for the canvas copy (not measured on real hardware).
- The lowest rung is a real lever: it cuts the 2D raster by ~45 % and is faster than the plain 2D fallback, which is why the ladder tries it before switching post-FX off.
- In this environment the `auto` ladder (correctly) walks down within seconds; all screenshots pin q3 so they show the intended look.
- **Before merging, run one real-hardware check** (any iGPU laptop) of `combined-dist/` with the FPS overlay on, in a kill storm.

## 7. Screenshots (`shots/`; combined four-layer build; *before* = same build's 2D fallback, *after* = post-FX, same frozen frame)

- Contact sheets: `title-compare.png`, `early-compare.png`, `warden-compare.png`, `bossdeath-compare.png`, `voidheart-compare.png`, `nova-compare.png`, `lowhp-compare.png`, `storm-compare.png` (1080p kill storm crop), `bossdeath-accessibility.png` (post-FX / reduced flashing / shake 0 / 2D reduced flashing), `glow-compare.png` (A 2D glow 1, B post-FX glow 1, C post-FX glow 0.15 = shipped, D glow 0).
- Singles: `title-*`, `early-*`, `warden-*` (Warden charging a volley), `bossdeath-*` (real Warden kill, 0.33 s after: wave front refracting grid and galaxy, no grey veil), `bossdeath-live.png` and `bossdeath-live-2.png` (live, 14 frames later, with the galaxy sector warp starting), `bossdeath-after-reduced-flashes.png`, `bossdeath-before-reduced-flashes.png`, `bossdeath-after-shake0.png`, `voidheart-*`, `nova-*`, `lowhp-*` (8 % HP + fresh hit), `storm-*` and `storm-crop-*` (1920×1080, 400 aliens), `storm-after-lowest-rung.png` (q0 + renderScale 0.75), `glow-*`, `context-lost-fallback.png`, `context-restored.png`.
- Data: `report.json`, `bench-1920x1080.json`, `bench-1280x720.json`, `budget-mid.json`.

## 8. Notes for the sibling teams

- **Entities**: clamp `hp/maxHp` (§4); scale vessel sprite padding with `glowScale` (§6); bring facets toward the 0.35–0.5 budget; read `renderer.costTier` for shard LOD; `setGlowScale` should ideally re-queue its own prewarm (the renderer does it for now via `setResolution`). The player ship is still hard to find in heavy frames (review item E1); post-FX helps only once the engine core is white-hot.
- **Grid**: integrated with your 06:53 API in `combined/`. Under post-FX the grid runs at quality 0 and stays under the bloom threshold except on flare fronts, as the budget wants.
- **Galaxy**: the grey smoke in sectors 1/2 still lowers neon contrast in game (visible in every `*-before/after`); post-FX's vignette and grain sit on top of it and do not hide it.
- **Hydra** frames were not captured: the spawned Hydra kept leaving the screen under the bot, and the boss frames are covered by the Warden and Void Heart.
