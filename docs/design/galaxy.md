# Galaxy sector backdrops: final design (v2, after the art review)

`plan/galaxy/galaxy.ts` is a self-contained module (2,796 lines, no imports) that you copy to `src/render/galaxy.ts`. It passes `tsc --noEmit --strict --noUnusedLocals --noUnusedParameters --verbatimModuleSyntax --target es2022 --module esnext --moduleResolution bundler --lib es2022,dom`. Generation is DOM-free up to quantisation, so the same file also serves as the worker body; the second file you need is a two-line `galaxy.worker.ts`.

A working integration exists in a patched copy of the game at `plan/galaxy/game/` (built to `plan/galaxy/game-dist/`). The diffs against the real repo are in `plan/galaxy/integration/*.patch`. The bot played that copy through all four sectors for the readability captures (section 6).

**Result summary (1080p, SwiftShader, quiet machine; v1 was re-measured in the same session as a control, and its numbers 1.98/1.14/1.83/8.27/32.5 ms match the review's):**

| | v1 (review) | v2 |
|---|---|---|
| Draw per frame, sectors 1/2/3/4 | 1.94 / 1.19 / 1.84 / 8.75 ms | **1.25 / 1.06 / 1.40 / 1.62 ms** (bench floor 0.45 ms included) |
| Warp frame (avg over the whole warp) | 25.6 ms (35 ms in the review's bench) | **5.4 ms** (1→2), **6.3 ms** (3→4), worst single frame 18–28 ms |
| Generation, main thread blocked | 900–1281 ms per sector | **0 ms** with the worker (main-thread frames stay at 17–20 ms during generation). The fallback is chunked, with worst frames of 22–42 ms |
| Generation CPU per sector (Node, warm / cold) | — | 1080p **0.47–0.56 s / 0.59–0.74 s**; 720p **0.30–0.37 s / 0.35–0.56 s**. The ≤400 ms target is **met at 720p and missed by 15–40% at 1080p**. It runs off-thread with a lead of up to 180 s, so it is never on the critical path |


---

## 1. What changed in response to the review (item by item)

| # | Review item | Status | What was done |
|---|---|---|---|
| 1 | Rebuild the sector 4 vortex | Done | Anchor (0.86, 0.20), size 1.22 (1.3 cost too much fill; see perf), rendered for 1:1 blits, no 2x upscale. The filament noise is **band-limited per pixel** (`fbmBL`): each octave fades out between 0.12 and 0.25 cycles per sample using the local frequency `PER·sqrt(1+twist²)/(2π·r)`, so there is no hatching. PER went from 60 to 36 with 3 octaves. The smooth fields (ridge value, arm weight, glow) are computed on a 0.5x grid, B-spline magnified, and only then sharpened (cubed) and coloured at full resolution, which keeps the ridges crisp at a quarter of the noise cost. The eye ring (r 0.06, 0.4 strength, white-gold `#fff2d6`) is the focal point. The body is bronze-grey (`#4a443a`) and gold (`#f0c068`) appears only on ridge highlights. **Spin:** only the core (r < 0.3, soft cross-fade from 0.2 to 0.3 with the static outer layer) rotates. It is rotated into a cached canvas every 8 frames and blitted 1:1. |
| 2 | Colour budget | Done | The tile's final quantise pass caps chroma (max−min RGB) at 0.045 (0.04 in sector 4). New hues: sector 1 slate-blue, sector 2 ash/umber with ember only in the filaments, sector 3 indigo, sector 4 bronze-grey. Each sector's signature hue now lives only in its centerpiece. A **gas luminance budget** (`lumMax` 0.15, soft-knee, stars excluded) keeps cloud brightness below the dim glow of every neon sprite. Grid: every sector uses one desaturated `PAL.grid` (`GRID_RGB = [112,126,196]`). **Automated check:** `colourCheck()` in the harness computes OKLab ΔE between each of 28 gameplay colours (palette, enemies, weapons) at "glow" strength (0.3×) and every pixel of the central 40% box, and fails if more than 0.5% of pixels fall within ΔE 0.05 (`camoMap()` paints the offenders). All four sectors pass: the worst case is 0.25% (arc lightning in sector 1). The check is what drove moving the spiral and the black hole further out (their halos had been intruding into the box). |
| 2b | Galaxy core ≤ ~0.55 | Done (in substance) | Bulge 0.9 → 0.5 and a **brightness budget**: additive centerpieces are hard-capped at Rec.709 luma 0.40–0.44 after the tonemap (`SPRITE_CAP`), and opaque planets at 0.5 (`OPAQUE_CAP`). In the central 40% the brightest backdrop pixel is 0.31–0.38 (it was 0.81 at the core). Corner cores still add up to 0.6–0.75 for a few hundred pixels at a full beat pulse (sprite + nebula + glow). That happens far from the player, and the game's vignette dims it further. |
| 3 | Rewrite the warp | Done | The two sectors are never drawn in the same frame and there is no canvas self-copy. **Spool** (0–0.3): the old sector zooms 1 → 1.25 (cubic ease-in) and darkens to 94% black with one fill. **Tunnel** (0.3–0.55): a black field with **260 streaks** in the destination tint, 2.0 px body with 3.4 px white-tinted heads at 1080p, alpha 0.6/0.85, up to 0.6 of the diagonal long. They go in **2 stroke() calls**, because each stroke() has a ~1.2 ms fixed cost in SwiftShader (8 calls cost 7.4 ms against 3.6 ms for 1). **Punch** at 0.55: a 100 ms flash from a pre-rendered 256² sprite, ≤ 0.35 alpha, additive, centred on the screen. **Arrival** (0.55–1): the new sector zooms 1.3 → 1 (ease-out), the centerpiece overshoots (an extra additive draw at up to 0.7 × sin), and the darkness lifts. `warpFx` exposes `stretch` (the renderer streaks its own stars) and `gridAlpha` (fades the grid to 15%). `onEvent` emits `warp-spool` / `warp-tunnel` / `warp-punch` / `warp-done` for the audio riser, the boom and the story sector card. Zoomed tile draws use nearest sampling (about 2x cheaper in software rasterisers and invisible on moving soft gas). **Timing:** the sim decides (see 4.4). The warp fires on boss defeat, during the boss-death slow-mo, or 3 s before the next boss is due. It comes with a 3 s spawn calm and an enemy-bullet clear, so it never lands on a boss entrance. |
| 4 | `setSector()` must not freeze | Done | A warp starts immediately even if the target is not ready, and the tunnel **holds** (time frozen at 0.55, streaks keep flowing, `warpFx.holding = true`) until it is. In fallback mode, `update()` pumps generation during a warp at 2.3× the normal budget (~7 ms). Without a warp, `setSector` is asynchronous: it keeps the current sector, or shows the plain void, until the target is ready, then swaps or fades in over 0.6 s. `{ sync: true }` is for tools and tests only. Becoming current always requests sector i+1, which gives a lead of up to 180 s. Sector 0 is requested at boot, so it generates during the title screen. **Resize:** `draw()` sees `h` change, debounces 0.4 s, regenerates in the background (current and next), and keeps drawing the old images scaled until the swap (`resizeTest`, section 5). |
| 5 | Off main thread, ≤ 400 ms | Done / near | `runGalaxyWorker()` is the module-worker entry. It generates, then `createImageBitmap` on every piece, and transfers the bitmaps, so the main thread does no pixel work: it only receives bitmaps and makes one 128² glow canvas. The chunked generator remains as a fallback (no Worker, or a worker error, which re-queues automatically). Cost cuts: the spiral tests its window before doing any noise and computes its field at 1/3 resolution; window + bloom + tonemap + cap + toe + dither + quantise are fused into one pass (`finalizeAdd`); bloom is sampled bilinearly from the small blurred buffer inside that pass (no full-size resample-and-add); the base field uses 4 octaves, the warp 2 and the dust 3; there is one 400×300 field pass for the whole tile (base, coverage, lanes, filaments); a centerpiece **cull rect** skips pixels that can never be on screen at any aspect up to 2.4:1 under the clamp; `Math.hypot`/`Math.pow` are gone from the hot loops. Result (section 5): 0.47–0.56 s warm per sector at 1080p and 0.30–0.37 s at 720p (v1: 0.9–1.3 s at 1080p). The 400 ms target is met at 720p and missed at 1080p, but it no longer matters for frame times: the main thread's worst frame during worker generation is 18–20 ms. |
| 6 | Sectors 1 and 3 under 1.5 ms | Done (S1 1.25, S3 1.40; S4 1.62) | Biggest win: emissive sprites stored as straight alpha and drawn with source-over (about 5× cheaper than `'lighter'` in SwiftShader; see section 5). **Block cropping**: sprites are split into 128 px blocks, blocks whose max is under 6/255 are dropped, kept blocks are merged into row runs, and each run is trimmed to its exact bbox. The spiral now has 6 pieces (380k px) instead of a 1.6k² square, and the black hole has 4 + 2. The window is (0.5, 0.8), spiral size 1.2, and the black-hole window is 0.42 × 0.2 of its canvas. |
| 7 | Bright things out of the play area; `intensity` | Done | **One-sided clamp** (`driftRange`): a centerpiece drifts at most 0.05 h toward the centre (tanh) and up to 0.3 h away from it. Every anchor sits outside the central 0.45 w × 0.32 h ellipse (`PLAY_ELLIPSE`), and the colour check confirms no halo enters the central 40% box. Gas giant: radius 230, anchor (0.12, 0.86), ring tilt −0.05, so the ring runs along the bottom edge. **Intensity:** centerpiece, planet and glow alpha go from 1 down to 0.65 as `intensity` (the renderer's existing value) goes from 0 to 1. Comets fly only in the top and bottom bands and roughly horizontally, never across the arena. |
| 8 | Black hole | Done, with a tweak | Photon ring σ 0.028 in shadow radii, Doppler-weighted (0.25 to 1.0), added **after** the tonemap. Tonemap peak 0.7, then the sprite cap. Doppler 0.22 → 1.5 (linear), with colour driven by Doppler and radius: the approaching side is white-hot and the receding side is the deep violet `#3a1670`. **Pushback:** the review's lensed-arc slope `rrTop = 2 + (q−1.05)·10` merged the arc into the photon ring and again read as "a planet with a ring". I used **5.5**, which still hugs the shadow (cut at q < 1.8 instead of 3.2) and reads as the wrapped far side of the disk. The bottom-right planet is radius 70 with a cool `#8fb4ff` rim, backlit. Window 0.42 × 0.2, disk outer fade 4.4–6.6 shadow radii. |
| 9 | Real empty space | Done | Coarse **coverage mask** (3 × 2 cells per tile), **eroded by the density field** so cloud edges are fractal rather than blob outlines. A percentile threshold sets the empty share per sector (0.38–0.52) to true black with stars. Dust lanes are carved only where density > 0.35 (2 octaves, power 2). A lit rim runs on the outer edge band of clouds, with weight 0.2 + 0.8·facing² towards each sector's light, which points at its centerpiece. **Per-sector texture** comes from noise cells (`cells: [4,3]`, `[3,5]` streamers in sector 3, `[5,4]` with warp 3.2 in sector 4), warp, gain and empty share. I tried ridged and billow styles: both create crease lines that read as marble again, so all four sectors use plain fBm, and the `style` option remains. |
| 10 | Planets | Done | Backlit (`light.z` −0.4 to −0.78), terminator `smoothstep(−0.06, 0.18)`, thin bright rim (`(1−nz)^6`, strength 0.55–0.75, extent 0.03). Gas-giant bands are posterised into 4 saturated steps (garnet → ember) with short ramps. Rings are brighter than the body (forward scattering when backlit). Bodies under 40 px are silhouettes with a 1 px rim, no craters and no noise. Parallax is capped at 0.15 (0.1–0.15 used). The orbit-line accent is **not done** (optional; it would be a vector stroke per body, costing about 1.2 ms per stroke call in SwiftShader). |
| 11 | Cheap motion | Done | Beat glow: a ≤ 128 px source sprite, either a blob or a ring, on the galaxy core, the photon ring and the vortex eye, with alpha `base + amp·beat` (the renderer's existing `beat`). A comet is one gradient line of 1.2 s, in roughly half of each 19 s period, deterministic in time. Vortex core spin as in item 1. `animate: false` (a reduced-motion setting) turns all three off. Measured cost of glow + comet: about 0.1 ms (the "glow" column below includes the bench's fixed floor). |
| 12 | Readability in motion | Done | `tools/game.mjs`: the real game copy plays `?autoplay&god&seed=777&warp=N` (bot; damage × 0.08 so it reaches the late bosses), and each game-second captures 4 renders of **the same frame state** (galaxy full / galaxy backdrop-only / legacy full / legacy backdrop-only). It then compares the sprite-vs-local-backdrop OKLab ΔE of galaxy against legacy, at 720p, 1080p, 1280×800 and 1440p, through the Warden fight + surge, the Hydra, the Void Heart and the forced final warp. Results are in section 6. |

**Other pushbacks / deviations**
- **Tile resolution cap:** the review suggested `min(quality, 1)` for the nebula tile. I used `min(quality, 1.34)` for both tile and centerpieces. Now that generation is off-thread with a 180 s lead, per-frame draw cost matters more than generation time, and below 1440p only a 1:1 tile takes the cheap unfiltered blit path. Above 1440p (4K) everything is drawn scaled, which is GPU territory.
- **GPU-`drawImage` bloom:** replaced by bilinear sampling of the small blurred buffer inside the fused finalise pass. It removes the same full-size pass and works identically in the worker without OffscreenCanvas.
- **Baking for Steam:** not implemented, but `generateSectorSync(index, quality)` (DOM-free, returns `RawImage[]`) makes a build-time bake script trivial. I recommend it only if a Steam Deck cold start shows the title-screen generation of sector 0 taking longer than about 2 s.
- **Tile shape:** the tile is now 2048 × 1536 instead of 1536². At 1536 the same cloud appeared twice across a 1920-wide screen.

---

## 2. Final API (`src/render/galaxy.ts`)

```ts
// data
export const SECTORS: SectorDef[];               // 4 sectors (names match story-script-v2: Turquoise Whorl, Garnet Nebula, Amethyst Abyss, Gilded Throne)
export const SECTOR_FORCE_AT = [360, 540, 600];  // run seconds at which sectors 1..3 are forced
export const PLAY_ELLIPSE = { w: 0.45, h: 0.32 };
export function sectorForRun(bossesDefeated: number, runTime: number, lead = 3): number;

// worker / tools
export function runGalaxyWorker(scope: GalaxyWorkerScope): void;           // worker entry
export function generateSectorSync(index: number, quality: number): { timings; images: RawImage[] }; // node / bake

export interface GalaxyOptions {
  quality?: number;        // device height / 1080 (auto-tracked from draw()'s h afterwards)
  keep?: number;           // sectors kept in memory (default 2: current + prewarmed next)
  animate?: boolean;       // core spin, beat glows, comets (false = reduced motion)
  worker?: (() => Worker) | null;  // module worker factory; absent/failed => chunked main-thread fallback
  budgetMs?: number;       // fallback pump budget per update() (default 3; x2.3 while a tunnel holds)
  onEvent?: (e: GalaxyEvent) => void;
}
export type GalaxyEvent =
  | { t: 'ready'; sector; ms } | { t: 'warp-spool'; from; to } | { t: 'warp-tunnel'; from; to }
  | { t: 'warp-punch'; from; to } | { t: 'warp-done'; from; to };
export interface WarpFx { active; phase: 'spool'|'tunnel'|'arrive'|null; progress; holding; stretch; gridAlpha; tint }

export class GalaxyBackdrop {
  constructor(opts?: GalaxyOptions);
  quality: number; animate: boolean; onEvent; layerMask; readonly stats;
  get sector(): number;  isReady(i): boolean;  get usesWorker(): boolean;
  request(i): void;                                   // background generation (worker or chunked job)
  setSector(i, { warp?, duration? = 2.2, sync? }): void;
  setQuality(q): void;                                // explicit; draw() also auto-detects h changes
  update(realDt): void;                               // per frame: warp clock, swaps, debounced resize, fallback pump
  get warpFx(): WarpFx;
  draw(ctx, camX, camY, k, w, h, time, { intensity?, beat? }): void;
  prepare(i): void; prepareAsync(i, sliceMs?): Promise<void>; pump(ms): boolean;   // tools / tests
  setWarpPreview(from, to, p, clock?): void; clearWarp(): void;                     // harness
  memoryBytes(): number; dispose(): void;
}
```

---

## 3. Integration (what to replace and where to call what)

Reference implementation: `plan/galaxy/game/src/...` and the diffs in `plan/galaxy/integration/`. The capture-only bits in those diffs (`?god`, `?seed`, `?legacybg`, `debugBgOnly`, `__galaxyEvents`) should not be ported.

**3.1 New files**
- `src/render/galaxy.ts`: copy of `plan/galaxy/galaxy.ts`.
- `src/render/galaxy.worker.ts`:
  ```ts
  import { runGalaxyWorker, type GalaxyWorkerScope } from './galaxy';
  runGalaxyWorker(self as unknown as GalaxyWorkerScope);
  ```

**3.2 `src/render/background.ts`** (full patched file: `plan/galaxy/game/src/render/background.ts`)
- Remove the `#05040f` base fill and the radial-gradient nebula loop (it cost 9.3 ms at 1080p in SwiftShader). The first call in `draw()` becomes `this.galaxy.draw(ctx, camX, camY, k, w, h, time, { intensity: tint, beat })`.
- Add `readonly galaxy = new GalaxyBackdrop({ quality: innerHeight*dpr/1080, worker: makeGalaxyWorker, onEvent })`, where `makeGalaxyWorker = () => new Worker(new URL('./galaxy.worker.ts', import.meta.url), { type: 'module' })`. **For `build:single` and the Electron build**, use `import GalaxyWorker from './galaxy.worker.ts?worker&inline'` and `() => new GalaxyWorker()`. `scripts/build-single.mjs` only inlines the entry chunk, and `file://` module workers are unreliable in Electron. If the Worker cannot be created, the module falls back to main-thread chunks on its own.
- Star layers: read `const fx = this.galaxy.warpFx`. When `fx.stretch > 0.02`, draw each layer as **one path** of radial segments, `(x,y) → (x + (x−cx)·f, y + (y−cy)·f)` with `f = stretch·(0.35 + parallax)·0.6`, stroked in `fx.tint`. Use one `stroke()` per layer, not per star.
- Grid: colour `SECTORS[galaxy.sector].gridRGB` (a desaturated `PAL.grid`), alpha × `fx.gridAlpha`. **Coordinate with the WarpGrid workstream** (`plan/gfx/grid`): its `gridTint` should take `gridRGB`, and its alpha should be multiplied by `fx.gridAlpha`.
- Keep the vignette as it is.

**3.3 `src/render/renderer.ts`**
- `bg` becomes public, constructed with `new Background((e) => this.onGalaxy?.(e))`; add `onGalaxy: ((e: GalaxyEvent) => void) | null`.
- At the top of `draw()`, call `this.bg.galaxy.update(rdt)`, using **real** dt so the warp and resize clocks run through hitstop and slow-mo.
- `bg.draw(...)` must receive the **zoom-aware `k`** that co-op computes (coop.md §"background.draw must accept the zoomed k"), and `camX/camY` of the shared camera (team centre). The warp is screen-centred, which works for a shared screen.
- In `consume()`, on the new `{ t: 'sector', index }` event, call `this.bg.galaxy.setSector(ev.index, { warp: true })`.
- Do **not** add the renderer's own full-screen flash on `warp-punch`. The backdrop punch sits *under* the sprites, which is the point; a flash over the sprites hurts readability.

**3.4 `src/game/director.ts` + `types.ts`: how a sector change is triggered (deterministic, sim-side)**
- `sector = max(bossesKilled, #{SECTOR_FORCE_AT[j] − 3 ≤ t})`, capped at 3. In words: the number of bosses defeated, or forced 3 s before the next boss is due (Hydra 6:00 forces sector 1, Void Heart 9:00 forces sector 2, victory 10:00 forces sector 3), whichever comes first. This is `sectorForRun()` in galaxy.ts, and the patched director inlines the same rule.
- When it increases: `holdT = 3` (no continuous spawns, no surge clock during the calm), mark every enemy bullet dead, and push `{ t: 'sector', index }`. In the captures the Warden kill at 3:14 fired the warp during the boss-death slow-mo, and the forced warp at 9:57 finished exactly as 10:00 hit.
- It lives in the sim (not in app or renderer) because it changes spawning. It stays deterministic (inputs are time and kills), which co-op lockstep and replays need. Re-run `npm run sim` and any seeded-outcome tests: the calm shifts the spawn stream.
- Overtime: the sector stays at 3.

**3.5 `src/app.ts`**
- Constructor: `renderer.bg.galaxy.setSector(0)`. This is asynchronous: sector 0 generates in the worker while the title screen is up, and it fades in over the plain void when ready (about 0.6–1.4 s on this box). The attract-mode bot plays in sector 0.
- `startRun()` (after any `?warp` fast-forward): `renderer.bg.galaxy.setSector(world.director.sector)`, with no warp.
- `toTitle()`: `setSector(0)`.
- `renderer.onGalaxy = (e) => …`: on `warp-spool`, start the audio riser; on `warp-punch`, play the boom and show the story `sectors[to]` title card, then queue the arrival comms (story-bible: 2–4 lines, 2.2 s apart). Optionally extend the director calm while `warpFx.holding` is set.
- Settings: map a reduced-motion setting to `galaxy.animate = false`.

**3.6 Prewarm without hitches**
- Worker path: the main thread only receives transferred ImageBitmaps; per sector it does about 0.1 ms of bookkeeping plus one 128² glow canvas.
- `setSector(i)` always requests i+1 (180 s lead). `keep = 2` holds about 30 MB at 1080p (13 MB at 720p). LRU eviction never drops the current sector, the warp pair or anything queued.
- Fallback path (no Worker): `update()` pumps 3 ms per frame (7 ms while a tunnel waits). Slices are bounded by row-level yields in every heavy loop.

---

## 4. Sector looks (final parameters)

| Sector | Centerpiece | Nebula (broad) | Planets |
|---|---|---|---|
| 1 Turquoise Whorl | Spiral, size 1.2, at (0.79, 0.23), teal arms (signature), core cap ≈0.40 + breathing core glow | slate-blue grey, fBm cells 4×3, 45% empty, lit rims towards the galaxy | backlit ocean world r 92, ice moon r 30 (silhouette) |
| 2 Garnet Nebula | Ringed gas giant r 230 at (0.12, 0.86), posterised garnet/ember bands, bright backlit ring along the bottom edge | ash/umber grey, ember-tinted filaments, 50% empty | rocky r 44 (backlit), moon r 18 (silhouette) |
| 3 Amethyst Abyss | Black hole at (0.22, 0.27), rot −0.22, violet disk with white-hot approaching side, lensed arc, thin photon ring + ring glow | indigo grey, horizontal streamers (cells 3×5), 52% empty | rocky r 70 with cool rim, ice moon r 22 |
| 4 Gilded Throne | Vortex at (0.86, 0.20), size 1.22, bronze body, gold ridges, white-gold eye ring, spinning core | bronze-grey, high-warp turbulent fBm (cells 5×4), 38% empty | obsidian r 76 with gold cracks + ring |

---

## 5. Performance (headless Chromium, SwiftShader; numbers include the bench's ~0.4–0.5 ms clear+readback floor)

All numbers come from `tools/shoot.mjs --perf` (`shots/report.json`), `tools/warpbench.mjs` and `tools/prof.mjs`, taken on the same 4-core box once other agents' load had dropped (load average ≈ 1). Every draw figure **includes the bench's fixed ~0.2–0.6 ms floor** (one clear + a 1-pixel readback per frame). The per-layer columns are each measured alone, so they do not add up to "all".

**Draw cost per frame (ms)**

| Size | Legacy nebula | S1 all | S2 all | S3 all | S4 all | Warp 1→2 avg (spool / tunnel / arrive) | Warp 3→4 avg |
|---|---|---|---|---|---|---|---|
| 1280×720 | 4.68 | 0.68 | 0.53 | 0.77 | 0.79 | 2.96 (3.3 / 3.0 / 2.7) | 3.32 |
| 1280×800 (Deck) | 4.91 | 0.76 | 0.63 | 0.80 | 0.91 | 3.37 | 3.76 |
| 1920×1080 | 9.59 | **1.25** | **1.06** | **1.40** | **1.62** | **5.37** (5.9 / 4.8 / 5.4) | **6.26** |
| 2560×1440 | 17.34 | 2.26 | 1.82 | 2.36 | 2.61 | 8.29 | 9.68 |

1080p per layer (each alone, floor included): tile 0.79–0.90, centerpiece 0.57–0.95, planets 0.39–0.44, glow + comet 0.37–0.70. Sector 4 is 0.12 ms over the 1.5 ms budget because the corner vortex covers about 380k on-screen pixels plus the core cache. Reducing the vortex size from 1.22 to about 1.1 would fix it; I kept the size for the look. The levers that mattered most:
- **Emissive sprites are stored as straight alpha and drawn with source-over** (a = max channel, colour = rgb/a). That is the same image as additive, except the gas behind bright parts is attenuated (the galaxy is in front of it). In SwiftShader a 700² blit costs 0.07 ms with source-over against 0.38 ms with `'lighter'`, and with this change S1 went from 1.48 to 1.21 ms.
- Streaks use 2 `stroke()` calls (from 8) and source-over (stroke cost halves). Tunnel phase: 13 ms → 4.8 ms.
- Nearest sampling for the zoomed tile during warps.
- Block-cropped pieces.

**Generation**

| | 720p | 800p | 1080p | 1440p |
|---|---|---|---|---|
| Main-thread `prepare()` (browser, sync, includes the upload) | 321–427 ms | 373–490 ms | 684–852 ms | 795–1022 ms |
| Worker: request → ready (wall, cold worker, includes createImageBitmap + transfer) | 446–513 ms | 558–729 ms | 679–977 ms | — |
| Worker: worst main-thread frame meanwhile | 17.8–20.4 ms | 18.8–26.9 ms | 18.0–19.9 ms | — |
| Chunked fallback (3 ms/frame budget): wall / worst frame | 0.71–0.95 s / 17–20 ms | 0.91–1.05 s / 17–25 ms | 1.56–1.77 s / 22–42 ms | — |
| Node warm (per sector) | 0.30–0.37 s | 0.34–0.43 s | 0.47–0.56 s | — |

Breakdown at 1080p (warm, Node): tile 225–245 ms (noise 90–100 at fixed resolution, colour 30, B-spline upscale 70, quantise 40) + centerpiece 165–290 (spiral 165, black hole 220, gas giant 245, vortex 290) + planets 8–80.

**Live behaviour** (`liveWarp`, a warp whose target is *not* generated yet):
- Worker, 1080p: total 2.21 s (no hold needed; the target was ready at 0.77 s, before the tunnel ended at 1.21 s), worst frame 31 ms.
- Chunked, 1080p: the tunnel held for 0.7 s (ready at 1.90 s), total 2.90 s, worst frame 44 ms.
- 720p: 2.21 s and 2.31 s.

**Resize** 720p → 1080p (`resizeTest`): the worker swapped in 1.0 s (chunked 2.6 s) with a worst frame of 20 ms. Until the swap, the old images draw scaled.

**Memory:** 13.0 MB for 2 resident sectors at 720p (about 29 MB at 1080p). Pieces of 1080p centerpieces: spiral 6 (380k px), gas giant 4 (315k), black hole 2 + 4 (41k + 207k), vortex 7 (538k, of which about 380k are on screen at 16:9) + core cache 420².

---

## 6. Readability in motion (`tools/game.mjs`, `shots/game/readability*.json`)

Each row is the median over 76 frames per size: 1 frame every 2 game-seconds through 4 windows (2:52–3:34 Warden + surge + warp, 5:53–6:31 Hydra, 8:54–9:32 Void Heart, 9:57–10:23 forced final warp + Overtime). In each frame, **sprite pixels** are those where ΔE(full, backdrop-only) > 0.03. "weak" is the share of them with ΔE < 0.08 (soft glow tails); "coreP10" is the 10th percentile contrast of bright sprite cores (OKLab L > 0.7).

| Size | weak: galaxy / legacy | median ΔE: galaxy / legacy | core P10: galaxy / legacy | worst frame "weak": galaxy / legacy | backdrop P99 luma, centre 40% |
|---|---|---|---|---|---|
| 1280×720 | 0.269 / 0.256 | 0.161 / 0.170 | 0.572 / 0.630 | 0.639 / 0.626 | 0.217 |
| 1280×800 | 0.286 / 0.276 | 0.149 / 0.152 | 0.577 / 0.628 | 0.727 / 0.734 | 0.437* |
| 1920×1080 (final build) | 0.251 / 0.237 | 0.176 / 0.195 | 0.576 / 0.621 | 0.767 / 0.771 | 0.164 |
| 2560×1440 | 0.243 / 0.234 | 0.186 / 0.194 | 0.590 / 0.633 | 0.768 / 0.770 | 0.170 |

*At 800p the camera put a lit cloud edge or a planet rim in the central box for a few frames. The P99 includes the renderer's own star dots.

**Reading:** sprite-vs-backdrop contrast is at parity with the old backdrop. Soft-tail pixels are 1–1.5 points more often "weak" (the new backdrop is not a uniform dark violet), the median contrast is 0.01–0.02 lower, and bright cores stay at ΔE ≥ 0.57 (P10), where 0.02 is a just-noticeable difference. The worst frames (dense Void Heart barrages) are identical to legacy. The static colour check (section 1, item 2) passes in all four sectors. The frames themselves are in `shots/game/` (for example `1920x1080-s1-surge-warden-t196.png` right after the first warp, and `1920x1080-s3-voidheart-t546.png`).

Warp timing observed in the real game (`:events` in the JSON):
- Warden kill: warp at 3:14 (1080p) / 3:13.6 (800p), during the boss-death slow-mo.
- Hydra kill: 6:29 (800p) / 6:19 (1440p).
- Forced final warp: spool at 9:57, punch at 9:58, done at 9:59.

---

## 7. Screenshots

All files are in `/tmp/claude-0/-home-user-addictive-game/1abae5b2-c201-57a9-8979-0317e8f22528/scratchpad/plan/galaxy/shots/`.

- **1080p finals** (`shots/final/`):
  - In-game overlays: `1080-s1.png`, `1080-s2.png`, `1080-s3.png`, `1080-s4.png`.
  - Centerpiece crops: `1080-spiral.png`, `1080-giant.png`, `1080-bh.png`, `1080-vortex.png`.
  - Warp: `1080-warp-tunnel.png`, `1080-warp-arrive.png`.
- **720p set** (`shots/`):
  - `sector-N.png` (backdrop + game stars/grid/vignette), `sector-N-overlay.png` (with sample gameplay sprites), `sector-N-moved.png` (camera at (5200, −3100), checking tiling, parallax and the clamp).
  - `warp-1-p15.png` … `warp-7-p90.png` (spool 0.15/0.28, tunnel 0.42, punch 0.56, arrival 0.62/0.75/0.90).
- **Real game** (`shots/game/`): `<size>-<window>-t<sec>.png` at 720p / 1080p / 1280×800 / 1440p, plus `readability-720.json`, `readability-1080.json` (final build) and `readability-1080-800-1440-prev.json`.
- **Reports:** `shots/report.json` (colour check, luminance, perf), `shots/game/*.json`.
- **v1 for comparison:** `/tmp/claude-0/-home-user-addictive-game/1abae5b2-c201-57a9-8979-0317e8f22528/scratchpad/plan/galaxy/v1/shots/`.

---

## 8. Tools (all in `plan/galaxy/tools/`, run with `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`)

- `shoot.mjs [--perf]`: all sector shots (plain, overlay, moved camera), 7 warp frames, the colour-distance check, luminance stats, and with `--perf`: draw cost per layer at 4 sizes, warp cost per phase, worker and chunked background generation with main-thread frame gaps, a live warp with an ungenerated target, and resize regeneration. Output goes to `shots/report.json`.
- `look.mjs WxH name:sector:mode[:clip]`: ad-hoc renders (`plain|overlay|bare|moved|warp<p>|camo<hex>|time<t>`).
- `game.mjs`: the real-game readability captures (section 6).
- `prof.mjs [quality]`: Node generation profile with sub-timings (`node tools/prof.mjs 1` after `rolldown galaxy.ts --file dist/galaxy.mjs --format esm --platform node`).
- `warpbench.mjs`, `v1bench.mjs`: draw and warp bench of v2, and the same bench of the v1 prototype (`plan/galaxy/v1/`) to calibrate against machine load.
- `hot.mjs`: clusters of backdrop pixels above luma 0.55.
