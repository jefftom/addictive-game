# Entities workstream: starship vessels, crystal armada, shatter, trails, explosions (v2)

This is the definitive integration guide. It is a prototype under `plan/gfx/entities/`; nothing in `/home/user/addictive-game` was modified.

**v2** applies the art-direction review (Entities E1–E10, plus the global draw order and brightness budget). See §8 for each item and the two pushbacks.

## 1. Files

| Path | What it is |
|---|---|
| `src/vessels.ts` | **Repo file `src/render/vessels.ts`.** The art: 5 allied vessel designs (fleet livery), 7 crystal alien hulls plus 12 animated boss/alien sub-parts, crystal and alloy painters, and `VesselArt`, a baked-sprite cache with allocation-free numeric keys. Also `fragmentsOf()`, `shadow()` and `SHIP_SCALE`. |
| `src/shardfx.ts` | **Repo file `src/render/shardfx.ts`.** `ShardFx`, a SoA pool (CAP 1400) of shards and embers in 3 layers: hot shards, embers and cooled debris. Draws are batched by counting sort on (colour, alpha bucket). |
| `src/entityfx.ts` | **Repo file `src/render/entityfx.ts`.** `EntityFx`, the draw-time system: starships, aliens, capital ships, telegraphs, projectile ribbons, enemy plasma, shatter, explosions, lightning, sprite prewarm, reduced-flash handling and quality hooks. |
| `integration.patch` | `git apply`-able on the repo's **current HEAD `ab1d37d`**. It is identical for `687bc97`, because neither commit touched the patched files. It adds the 3 files and changes `src/game/types.ts`, `src/game/world.ts` and `src/render/renderer.ts`. |
| `tools/patch.sh [--test]` | Regenerates `integration.patch` in a clean `git archive HEAD` tree (`verify/`). It runs `tsc -p`, the strict-flag check on the 3 modules and (with `--test`) vitest. It refuses to run if upstream changed `renderer.ts`, `types.ts` or `world.ts` since `orig/head/`. |
| `game-src/` | Repo copy with the patch applied. `tools/build.sh` runs `tsc -p`, builds `game-dist/` and the gallery `harness-dist/`, and syncs the 3 modules to `src/`. |
| `game-dist-base/` | Unmodified build of current HEAD, for A/B timings. |
| `harness/main.ts` | Gallery harness. It renders every vessel, state and effect through the real `EntityFx` code (`gallery('ships' / 'aliens' / 'bosses' / 'fx')`). |
| `tools/gallery.mjs`, `tools/scenes.mjs`, `tools/heavy.mjs`, `tools/montage.mjs`, `tools/crop.mjs` | Screenshot and benchmark drivers (see §7). |

**Verification** (`tools/patch.sh --test` on a clean HEAD tree):
- `tsc -p` is clean.
- The 3 modules pass `tsc --noEmit --strict --noUnusedLocals --noUnusedParameters --verbatimModuleSyntax --target es2022 --module esnext --moduleResolution bundler --lib es2022,dom`.
- vitest passes 234/234, golden-master included.
- Playwright e2e smoke: 10 passed, 2 skipped, the same as upstream.
- The new `kill` fields are **optional**, so `tests/story.test.ts`'s `kill` literal (and any other event literal) still compiles. The grid notes reported this as a v1 error.

## 2. Design summary

**Material language.**
- **Allied fleet:** opaque dark alloy with a white-cyan rim and a near-white inner edge. The vessel reads as a solid object.
- **Shardstorm armada:** translucent faceted crystal in the warm enemy colours, with small hot cores. The aliens read as gems or menace.

**Fleet livery (E3).** Every class uses the same alloy hull, `FLEET_RIM #a9e9f6` rim and `FLEET_GLOW #6fe4ff` under-glow. The class colour (`content/ships.ts`) appears **only** on the canopy, an accent stripe, the engine intakes, engine flames and the Bastion's deflector. Pink Phantom and violet Tempest therefore stay "cool allies" next to the magenta gunship and the lilac buds.

| id | class | silhouette (all original; no saucer + twin-nacelle forms) |
|---|---|---|
| spark | light frigate | slim arrow fuselage, swept delta wings, wing-tip engine pods |
| vanguard | heavy cruiser | long armoured wedge (~1.65:1) with a sharp prow, long bridge superstructure, one centreline forward turret and two staggered aft sponson turrets (no "face") |
| tempest | interceptor | twin prongs **bridged** by a wound coil emitter (closed loop, no open mandibles) |
| bastion | shield dreadnought | stout hex hull, forward crescent deflector on struts, dome bridge |
| phantom | stealth raider | manta flying wing, sawtooth trailing edge, missile rails |

Hulls are designed at a half-length of about 17.5 units and drawn at `SHIP_SCALE = 1.12`, so the drawn half-length is 17.9–21.7 (spark 19.6). The hitbox stays r = 11.

**Aliens.** Collision radii are unchanged, and only thin spikes go past r (extent 1.0–1.34 r).
- The drone (drifter) and lancer (dasher) are now **asymmetric jagged crystal clusters**: no wings and no mirror symmetry (E4).
- Animations:
  - drone: the eye pulses;
  - lancer: squeezes while aiming and stretches ×1.34 while charging;
  - splitter: ring of orbiting buds;
  - gunship: aims at the pilot, its inner hex counter-rotates, and the core and muzzles charge for 0.7 s before each shot;
  - bulwark: plates break off at 75/50/25 % HP.
- Hits flash white and squash along the knockback vector; bosses get a soft additive overlay instead.

**Bosses.**
- **Warden:** counter-rotating crystal rings, a core that charges and dashed volley-lane spokes.
- **Hydra:** 3 segmented necks with trailing hunter heads, and a charge corridor with a fuse sweep.
- **Void Heart:** hive hull, 8 spires that light up before escorts launch, 6 pulsing tendrils, a heartbeat core and an inward-spiralling mote halo.

**Shatter (E2).** A kill breaks into 4–9 fragments (+3 for elites) cut from the vessel's outline at its rendered angle. Fragments inherit outward speed + 45 % of knockback, and spin.
- **Hot phase (~0.12 s):** additive fill pushed to white, plus white edges. Drawn with the explosions.
- **Cooled phase:** dim desaturated outline, `alpha ≤ 0.35`, normal blending, drawn **below the enemies**. Lives about 0.45 s (elite 0.6 s).
- **LOD:** above 400 live entries, new kills spawn half the shards with 0.7× life. `setCostTier` scales it further.
- **Flash and ring:** each kill adds a white core flash (≤ 2.5 r, peak alpha 0.6, ≤ 80 ms), a tinted fireball (≤ 0.5) and a thin ring.
- **Bosses** break in 3 layers and add 9 delayed secondary detonations.

**Player (E1, E6, E7).**
1. A **contact shadow** (dark radial disc, 1.6 r, alpha 0.48, normal blending) under the hull separates it from the swarm.
2. The **exhaust ribbon** is short (capped at 92 units, about 2.4 ship lengths), additive and tapered. It is built from a **low-passed hull-centre history** shifted rigidly onto the main nozzle, so stick or bot jitter and hull rotation no longer make it squiggle. Its alpha follows speed: `0.25 + 0.55·speed/230`.
3. **Engine flames** grow with thrust, and each nozzle has a **white-hot core** that blooms under post-FX.
4. A **cool fleet under-glow** sits under the hull.
5. **Banking** narrows the hull and lights the raised wing.
6. **Nav lights:** port red and starboard green blink; the white strobe double-flashes.
7. **Dash afterimages** are skipped **inside the shield bubble** (they stacked into a disc).
8. **Shield bubble:** the fill is ≤ 0.2 at the very rim × draw alpha 0.62–0.72, so effectively **≤ 0.15**. It adds a hex lattice and a shimmer arc, and shatters into 12 shards on `shieldbreak`.
9. **Perfect dash** draws a thin expanding ring from EntityFx. The renderer's filled r = 90 disc was the real cause of the "solid cyan disc" in `final-dash.png`.
10. **Crowd locator:** when ≥ 16 enemies are within 190 units of a pilot, four thin brackets with inward ticks fade in round the ship, at radius max(shieldR + 5, 30). Alpha is 0.42, with a slow steady rotation and no pulse. It fades in at 6/s and out at 2/s.

## 3. API (`src/render/entityfx.ts`)

```ts
const fx = new EntityFx();                     // renderer field: readonly fx
fx.setResolution(pxPerUnit)                    // in resize(); re-queues the sprite prewarm when res changes
fx.setGlowScale(g)                             // post-FX: 0.15, 2D fallback: 1.0. Clears baked vessel sprites, re-queues prewarm
fx.setCostTier(tier)                           // 4..0 from an auto-quality controller: >=2 full, 1 half, 0 ~1/3 shards+embers per kill
fx.postFx = bool                               // true while bloom is active: drops the lightning glow pass
fx.flashes = settings.flashes                  // reduced flashing (set every frame before begin)
fx.reset()                                     // run reset
fx.prewarm(budgetMs): boolean                  // optional: bake everything on a loading screen
fx.onEvent(ev, world, particles)               // first line of the consume() loop
fx.begin({k, ox, oy, minX, minY, maxX, maxY}, dt, rdt)   // once per frame
fx.drawTelegraphs(ctx, world)                  // ground layer (additive, sets its own op)
fx.drawDebris(ctx)                             // cooled shards, normal blending, BELOW enemies
fx.drawEnemies(ctx, world)                     // hulls, then additive cores, then capital ships
fx.drawProjectiles(ctx, world, PAL.bolt)       // caller has 'lighter'
fx.drawShards(ctx)                             // hot shards, embers, flashes, rings; caller has 'lighter'
fx.drawLightning(ctx, arcs.items)              // caller has 'lighter'
fx.drawPlayers(ctx, world, dt, rdt, settings.trail)  // all pilots; sets its own ops
fx.drawBullets(ctx, world, bulletDot)          // LAST in the world; sets 'lighter' itself
fx.explosion(x, y, r, color, particles)        // also called from onEvent('explode')
fx.art: VesselArt                              // ship(id, color, variant) etc.: menus can show the in-game vessel
fx.shards: ShardFx                             // count, quality (diagnostics)
```

## 4. Integration points (exact; all in `integration.patch`)

### 4.1 `src/game/types.ts` and `src/game/world.ts`
- The `kill` event gains 4 **optional**, render-only fields: `kind?: EnemyKind; angle?: number; kx?: number; ky?: number`.
- `World.killEnemy` appends `kind: e.kind, angle: e.angle, kx: e.kx, ky: e.ky` to the pushed event.
- `kx/ky` already include the killing blow, because `damageEnemy` applies knockback before it calls `killEnemy`.
- If the fields are missing, the shatter falls back to a random angle with no inherited push.
- There are no sim changes; the golden master is unchanged.

### 4.2 `src/render/renderer.ts`
- **Imports and fields:**
  - Add `import { EntityFx } from './entityfx'` and `readonly fx = new EntityFx()`.
  - Remove `trail`, `boltDot` and the `ENEMIES` import.
- **`resize()`:** call `this.fx.setResolution(this.scale * this.dpr)` next to `sprites.setResolution`. Under post-FX use `scale·dpr·worldScale`, as the post-FX patch already does.
- **`reset()`:** call `this.fx.reset()`.
- **`consume()`:** the first line in the loop is `this.fx.onEvent(ev, world, P)`.
  - `kill`: the particle burst is reduced to sparks (`n = boss ? 80 : elite ? 30 : 3 + r·0.2`). The white elite burst and the elite `blasts.push` are removed. The per-kill `+score` float is shown only while `world.enemies.length < 150`; elites always get theirs (review "visual noise").
  - `explode`: a smaller burst, and no `blasts.push`. EntityFx draws the layered explosion.
  - `perfect`: no `blasts.push` (EntityFx ring).
  - `bossdead` and `bomb` keep their blasts.
- **`draw()`:** after `visible`, add `fx.flashes = this.settings.flashes; fx.begin({ k, ox, oy, minX, minY, maxX, maxY }, dt, rdt);`.
- **Draw order** (matches the review's global order):
  1. `bg.draw`: galaxy backdrop, then the warp grid (siblings; untouched).
  2. Rings, mines, pickups (unchanged).
  3. `fx.drawTelegraphs` (replaces the telegraph loop).
  4. **`fx.drawDebris`**: cooled shards.
  5. `fx.drawEnemies` (replaces the enemy loop), then `world2()`.
  6. Elite HP rings (unchanged).
  7. `'lighter'` block:
     - beams (unchanged);
     - `fx.drawProjectiles`;
     - blades (unchanged);
     - `particles.draw`;
     - `fx.drawShards`;
     - `fx.drawLightning` (replaces `arcs.draw`);
     - remaining blasts (boss death, bomb). With reduced flashing, any blast with r > 300 is capped at **alpha 0.15** for both stroke and fill.
  8. `fx.drawPlayers` (replaces the trail, afterimage, hull and shield code; draws every `world.players` entry, with downed co-op pilots as 35 % ghosts), then `world2()` and the magnet hint.
  9. **`fx.drawBullets`**: enemy plasma, last in the world.
  10. World text, vignette, flash, HUD (unchanged). Under post-FX these go on the overlay.

### 4.3 `src/render/sprites.ts`
**No change.** Pickups, mines and blades still use `SpriteCache`. Its `'player'` and enemy shapes become unused and can be removed later, or kept for menus.

### 4.4 Post-FX hooks (in the post-FX patch's `applyFxMode` / `onFxQuality`)
- `applyFxMode()`:
  - call `this.fx.setGlowScale(g)` next to `sprites.setGlowScale(g)`, with g = 0.15 under post-FX and 1.0 whenever post-FX is off (setting, context loss, auto-off);
  - set `this.fx.postFx = postFxActive`.
  - `setGlowScale` re-queues its own prewarm, so the extra `setResolution` call is no longer needed. It stays harmless.
- `onFxQuality()`: call `this.fx.setCostTier(this.costTier)` to tie shard LOD to the auto-quality ladder.
- The vessel sprite padding already scales with `glowScale`, so the same fill savings as `sprites.ts` apply.
- Shockwave suggestions (post-FX owns the budget): elite and boss `kill`, `explode` with r ≥ 60, `perfect`.

### 4.5 Warp grid
The grid (v2) starts its own fronts from the `kill` and `explode` events in `gridEvent` and no longer reads `renderer.blasts`. Entities therefore pushes **no** ghost blast entries; the v1 suggestion was dropped (see §8). EntityFx never touches the background or grid.

### 4.6 For the all-layers builds (`grid/combo-head`, `postfx/combined`)
Both currently contain entities **v1**. To refresh them:
- copy `src/{vessels,shardfx,entityfx}.ts` (post-FX's `tools/refresh.sh` already pulls from here);
- in their `renderer.ts`:
  - add `fx.drawDebris(ctx)` between `drawTelegraphs` and `drawEnemies`;
  - make sure `fx.drawBullets` runs after `fx.drawPlayers`;
  - drop the `perfect` `blasts.push`;
  - apply the reduced-flash blast cap and the `+score` density gate;
- `fx.setGlowScale`, `fx.postFx` and `fx.setCostTier` as in §4.4.

## 5. Settings and fallback behaviour

**`settings.flashes = false` (reduced flashing):**
- hit frames become soft additive tints, and bosses get no white frame;
- kill and explosion flashes run at 35 %;
- hot shard edges drop to alpha 0.4 and hot shard fills to 60 %;
- nav lights stay steady (no strobe or blink);
- there is no Warden charge jitter;
- lightning re-jitters at 8 Hz instead of 30 Hz;
- the dasher telegraph pulses instead of flickering;
- the hurt hull is not flash-white, and the red hurt glow is halved;
- the renderer's boss-death and bomb discs are capped at alpha 0.15.

**`settings.shake`:** EntityFx adds no shake or camera motion of its own. The renderer's existing `shake.add` calls are unchanged, so shake 0 means no motion from this layer.

**Fallbacks:**
- Everything is Canvas 2D, with no WebGL dependency.
- Without post-FX, glow scale 1.0 bakes the full halo into sprites, and lightning keeps its faint glow pass.
- `kill` events without the new fields still shatter.
- Sprites bake lazily if the prewarm queue has not reached them; the queue bakes at most 2 ms per frame from the title screen onward.

**Robustness fixes:** every timer- or HP-derived scale is clamped to [0, 1]: gunship charge, Warden charge and spokes, Void Heart summon, and bulwark core / `hpK`. See E8.

## 6. Performance

`tools/heavy.mjs` runs the real game at 1920×1080 with 400 live enemies and ~62 kill events per sim-second, through `world.killEnemy`. It times `consume` + `draw` per frame, frames 30–360, in headless Chromium. Canvas raster is **SwiftShader** (software), and the machine was shared with sibling benchmarks (load 2–9 on 4 cores), so the numbers are noisy. Six alternating A/B runs; the base is current HEAD unmodified.

| build | draw mean (median of 6 runs, range) | draw p50 | draw p95 | consume mean | frame interval p50 (SwiftShader) |
|---|---|---|---|---|---|
| base | 1.82 ms (1.56–2.23) | 1.55 ms | 3.4 ms | 0.02–0.04 ms | 38 ms |
| entities v2 | 2.87 ms (2.34–3.26) | 2.35 ms | 6.2 ms | 0.06–0.14 ms | 52 ms |

**Extra JS: about +1.0 ms mean, +0.8 ms p50, +2.8 ms p95, inside the 3 ms budget.**

The p95 and max spikes appear in *every* method, including trivial ones (`drawTelegraphs` max 4 ms, `drawLightning` max 5 ms). That points to canvas command-buffer flushes under software raster and to machine contention, not to a hot loop.

EntityFx breakdown (median over runs, p50 / mean in ms):

| method | p50 | mean |
|---|---|---|
| `drawEnemies` (replaces the old ~0.5 ms enemy loop) | 0.8 | 1.02 |
| `drawShards` (hot) | 0.1 | 0.13 |
| `drawDebris` | 0.1 | 0.07 |
| `drawPlayers` (incl. locator density scan) | 0.1 | 0.12 |
| `drawTelegraphs`, `drawBullets`, `drawProjectiles`, `drawLightning`, `onEvent`, `begin` | ≤ 0.05 each | ≤ 0.065 each |

Live shards were 170–250. Sprite cache size is about 105.

**GPU:** the extra raster is about 400 small additive core quads, a few hundred stroked or filled shard triangles (cooled debris is stroke-only), and per-pilot ribbons. It is not measured on real hardware. Run the combined build on any iGPU laptop before merging, as the review asks.

## 7. Screenshots (`shots/`, all re-rendered with the v2 code)

- **Galleries** (real `EntityFx` code; `node tools/gallery.mjs ships,aliens,bosses,fx final2`):
  - `final2-ships.png`: 5 vessels at 3x and 1x; idle, thrust, bank, dash, shield+dash, hurt and crowd locator at 2x.
  - `final2-aliens.png`: 7 kinds at 3x for normal, elite, hit squash, special state, warp-in, plus 1x.
  - `final2-bosses.png`: idle, telegraph, enraged+hit, plus 1x.
  - `final2-fx.png`: shatter timelines (hot, then cooled debris), bolts, missiles, plasma, lightning, explosion.
- **Real game, 1280×720** (`node tools/scenes.mjs game-dist final2`):
  - Bosses: `final2-warden.png`, `final2-hydra-tele.png`, `final2-hydra-volley.png`, `final2-voidheart.png`.
  - Kill storm: `final2-kills.png`.
  - Ship: `final2-ship.png` / `final2-ship-full.png`.
  - Dash: `final2-dash.png` / `final2-dash-full.png`.
  - All five ships in game: `final2-ships-montage.png` (`final2<ship>-ship.png`).
  - Reduced flashing: `final2nf-kills.png`, `final2nf-dash.png`, `final2nf-warden.png`.
- **Heavy scene, 1920×1080:** `heavy-final2-new-{1..6}.png` (+ `.json`); baseline `heavy-final2-base-{1..6}.png`. `heavy-final2-new-6.png` is the clean one, with no invulnerability blink.
- **Older iterations (v1):** `final-*.png`, `s*-*.png`, `heavy-final-*.png`.

## 8. Review response (Entities section + global)

| # | Item | Status |
|---|---|---|
| E1 | Player hardest to find | **Done.** White-cyan rim with a 0.85-white inner edge; white engine cores; 1.6 r contact shadow at 0.48; drawn 12 % larger; crowd locator brackets. |
| E2 | Shard debris reads as live enemies | **Done.** About 0.12 s white-hot, then dim desaturated outlines at ≤ 0.35 with normal blending, drawn below the enemies, life about 0.45 s. LOD above 400 halves shards per kill and shortens life. |
| E3 | Ship colours clash with enemies | **Done:** one fleet livery, with the class colour on accents only. |
| E4 | Drifter and lancer look like jet fighters | **Done:** asymmetric jagged crystal clusters, with facets and core kept. |
| E5 | Hydra lane opaque; Warden starburst | **Done.** The Hydra lane is an additive fill of 0.04–0.07 plus a fuse band ≤ 0.05 (≤ 0.12 total), bright rails 0.3–0.6, and a sweeping fuse cross-bar. Warden spokes are ≤ 2.4 r with a radial fade and alpha ≤ 0.35. |
| E6 | Shield + dash makes a solid disc | **Done.** Root cause was the renderer's filled perfect-dash blast; it is now a thin EntityFx ring. Bubble fill is ≤ 0.15, and afterimages are skipped inside the bubble. |
| E7 | Exhaust is a dark squiggly worm | **Done:** low-passed history, ≤ 92 units, additive, tapered, brightness by speed. |
| E8 | Oversized glows | **Done.** The white-magenta blob was a **real gameplay bug**, not only the harness: a gunship out of range (d ≥ 560) keeps counting `fireT` below 0, and the unclamped charge scaled its core glow and muzzle to hundreds of px. Clamped, together with the Warden and Void Heart charges and bulwark `hp/maxHp`. Kill and elite flashes are ≤ 2.5 r with peak ≤ 0.6, and the boss-death disc is ≤ 0.15 with reduced flashing. |
| E9 | Lightning glow pass reads as a dark outline | **Done:** glow pass 5 px at 0.16; dropped entirely when `fx.postFx`. |
| E10 | Vanguard skull; Tempest mandibles | **Done.** Vanguard is a long sharp wedge with off-axis turrets; Tempest's prongs are closed by the coil. |
| Global | Draw order | **Done**, as in §4.2. Enemy bullets are last in the world and debris is below the enemies. |
| Global | Brightness budget | Facet fills are lowered (alpha 0.07 + 0.27·lit, white mix 0.1 + 0.4·lit, ridges 0.38). Cores, engine cores, nav lights, bullets and hot shards remain the only near-white elements. Post-FX's heat-based threshold handles the rest. |
| Global | Visual noise | `+score` floats are gated by density in this patch. The whole-screen 2D flash gate is post-FX's. Telegraph spokes fade with distance. |

**Pushbacks:**
- **E1 size, 12 % instead of 15 %:** this gives a half-length of 19.6 for the default Spark, which is inside the requested 19–20. A larger sprite would widen the gap between what is drawn and the r = 11 hitbox, and players read the hull edge as the hitbox. The shadow, rim and locator do the "find me" work.
- **Grid item 10, `ghost: true` blasts:** not implemented, because the grid v2 owns its fronts from events and no longer reads `renderer.blasts`. A ghost list would be dead state.

## 9. Known limits
- Hit squash is stateless (`e.flash` ≤ 0.08 s). A longer elastic wobble would need a per-id spring.
- Boss state (neck chains, ring spin) is keyed by enemy id and never swept, which is fine at 3 bosses per run. Bulwark plate counts are swept every 2 s.
- A single large boss bake can take tens of ms on SwiftShader if it is still queued when the boss appears. The queue normally finishes on the title screen; call `fx.prewarm(1000)` on a loading screen to be sure.
- Galaxy, grid and post-FX were not in this copy. The all-layers gate builds are the siblings' (`grid/combo-head`, `postfx/combined`) and need the v2 refresh in §4.6.
