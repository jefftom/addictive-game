# Starship and crystalline-alien entity art, shatter deaths

Task 3b of `docs/HANDOFF.md` (graphics push). The steps are sequential because each one edits
`src/render/renderer.ts`. This step lands **after 3a (galaxy backdrops, `docs/specs/03a-galaxy.md`)**
and before 3c (post-FX). The art and effects code is finished and reviewed as a prototype. The work
here is integration, the co-op accent, a drawing API for later steps, menu art, and verification.

## 1. Goal

Every pilot flies a recognisable vessel of the Allied Beacon Fleet, one design per class. All of them
share one fleet livery: a dark alloy hull, a white-cyan rim, a lit canopy, running lights, engine flames
that grow with thrust, banking, a short exhaust ribbon and a shield bubble. In solo the class colour sits
on the accents. In co-op each pilot's `PLAYER_COLORS` colour goes there instead. The Shardstorm armada
becomes translucent faceted crystal ships with hot cores and animated parts. The three capital ships
become multi-part machines whose attacks are easy to read. Every kill shatters the dead vessel into its
own fragments: a white-hot flash, then dim debris that cools below the living enemies. Enemy plasma is
always drawn on top. The Hangar, the co-op lobby, the Ship's Log fleet tab and the results screen show
the same vessels. Nothing about gameplay changes, so the golden master stays bit-identical. A
300–400-enemy fight must stay readable, at no more than about +1 ms of renderer JS per frame.

## 2. Starting point

- **Base:** the PR branch `claude/dazzling-faraday-2kxdhl` with 3a merged. Tasks 1 and 2 should be
  merged as well. Work on a branch (for example `wip/wave3-entities`, to be created) and merge it with a
  merge commit, with no force-push. Use one focused commit, or a few, with all checks green.
- **Source (in-tree):**
  - `prototypes/entities/src/{vessels,shardfx,entityfx}.ts`. These are byte-identical to the three files
    that `prototypes/entities/integration.patch` adds.
  - `prototypes/entities/NOTES.md`: the integration guide.
  - `prototypes/entities/integration.patch`, made against `ab1d37d`.
  - `prototypes/entities/tools/`: reference scripts (see §10).
- **Target look:** the screenshots on the orphan branch, for example
  `git show origin/wip/prototypes:gfx/entities/shots/final2-ships-montage.png > /tmp/ships.png`. Other
  shots: `final2-ships`, `-aliens`, `-bosses`, `-fx`, `-kills`, `-warden`, `-hydra-tele`, `-voidheart`,
  `final2nf-*` (reduced flashing). If the branch cannot be fetched, skip them. NOTES §2 and §8 describe
  the look in words.
- **Verified on 2026-10-11** (scratch copies, nothing committed):
  - On PR head `a114403`, `git apply --check prototypes/entities/integration.patch` succeeds, because
    `renderer.ts`, `types.ts` and `world.ts` are byte-identical to the patch base. With the patch
    applied: `tsc --noEmit` is clean, and vitest passes 14 files, **290/290**, including
    `tests/golden.solo.test.ts` and `tests/no-p1-alias.test.ts`.
  - Against the PR head, the patch removes **no co-op code**. Its only edit to a co-op line rewrites the
    `kill` union member and keeps `pid`. The handoff warning ("reverts co-op code") is still the rule:
    read every hunk, never copy a whole file over `src/` (apart from the three new modules), and never
    take files from the prototype's `game-src/` snapshots (not in-tree; older bases).
  - On 3a's WIP (`wave3/gfx` = `origin/wip/wave3-gfx`, `df7a114`), **2 of the 13 renderer hunks fail**:
    the import block and the field block. Hunk 6 (`consume`) applies with fuzz, in the right place
    (`fx.onEvent` before the new `case 'sector'`). With those two merged by hand, `tsc` is clean. The
    only failing unit test is 3a's known `galaxy.ts` `this.stats` alias hit, which 3a fixes.
  - The two `src/game` hunks also apply on task 1's `fix/dmath` (offset 1 line).
  - **Not verified:** e2e, `build:single`, the look over the galaxy backdrops, and performance on real
    GPUs. The prototype was measured only on SwiftShader (NOTES §6).
- **Not in the prototype (this task adds it):** co-op accent colours, a reusable vessel-drawing API,
  menu art, the downed-ghost tint, frame-rate-independent boss animation, a prewarm for co-op accents
  and the "giants" Daily, the `SpriteCache` glow hook, tests and docs.

## 3. Read first

1. `AGENTS.md` (hard rules), then `docs/HANDOFF.md` §3 and §3b.
2. `prototypes/entities/NOTES.md`: all of it. §3 is the API, §4 the integration points, §5 reduced
   flashing and fallbacks, §8 the review items. Its paths (`plan/gfx/entities/`, `game-src/`,
   `harness/`) refer to the original build machine.
3. `prototypes/entities/src/entityfx.ts`: the `EntityFx` public methods, `drawPlayers` /
   `drawPlayer`, `drawEnemies` (pass 2: cores and charge glows), `drawBoss`, `onEvent` and `shatter`.
4. `prototypes/entities/src/vessels.ts`: `SHIP_ART`, `ALIEN_ART`, `FLEET_RIM`, `FLEET_GLOW`,
   `VesselArt` (`ship`, `alien`, `part`, `glow`, `flame`, `setResolution`, `setGlowScale`) and
   `fragmentsOf`.
5. `prototypes/entities/src/shardfx.ts`: `ShardFx` (`quality`, `density`, `lifeScale`, `clear`).
6. The renderer hunks of `prototypes/entities/integration.patch`.
7. Current code:
   - `src/render/renderer.ts`, as left by 3a;
   - `src/game/world.ts` (`World.damageEnemy`, `World.killEnemy`) and `src/game/types.ts` (`GameEvent`);
   - `src/game/enemyai.ts`: `updateShooter`, `updateWarden`, `updateHydra`, `updateVoidHeart`;
   - `src/game/content/coop.ts` (`PLAYER_COLORS`) and `src/ui/ui.ts` (`UI.shipArt` and its callers).
8. `docs/design/coop.md` §3, the `renderer.ts` row for L507–568. It covers per-pilot colours and the
   downed ghost colour `#8890b0`.
9. `docs/specs/03a-galaxy.md` §5, "Interfaces this step exposes". Also `prototypes/postfx/NOTES.md`
   review items 8–9 and §5: what 3c will call.

## 4. Owner decisions and constraints (non-negotiable)

1. **The simulation stays bit-identical.**
   - `tests/golden.solo.test.ts` must pass unchanged; never edit or re-capture it.
   - The only `src/game` change allowed: four optional, render-only fields on the `kill` event,
     `kind?: EnemyKind; angle?: number; kx?: number; ky?: number`, filled in `World.killEnemy`.
   - Do not change sim timers or AI.
2. **Clamp the runaway charge glow on the render side.**
   - The cause is in `updateShooter`: out of range (`d >= 560`) a gunship keeps counting `fireT` below
     0, and an unclamped charge blew its core and muzzle glow up to hundreds of px.
   - Clamp every timer-derived or HP-derived scale to [0, 1]:
     - gunship charge;
     - Warden core charge and volley spokes;
     - Void Heart summon;
     - Bulwark (`brute`) `hp/maxHp`.
   - Do not "fix" `fireT` in the sim.
3. **Co-op accent.**
   - Every pilot in `world.players` is drawn with their own class's vessel.
   - In co-op, `PLAYER_COLORS[pid]` replaces the class colour on the canopy, stripe, intakes, engine
     flames, afterimages and exhaust ribbon.
   - The alloy hull and the `FLEET_RIM` rim are shared, so the squad still reads as one fleet.
   - Solo looks exactly as designed: class colour on the accents, and `renderer.settings.trail` (the
     player's trail cosmetic) for the exhaust.
4. **Hooks for 3c** (post-FX). Their defaults must give today's 2D look, so that 3c only has to call
   them:
   - `fx.setGlowScale(g)` (default 1);
   - `fx.postFx` (default `false`; when true the lightning glow pass is dropped);
   - `fx.setCostTier(tier)` (default full detail);
   - `SpriteCache.setGlowScale(g)` for the shape sprites (default 1).
5. **API for 3e** (co-op rendering). 3e must be able to draw a vessel anywhere, with an accent, an
   alpha or as a ghost, without touching EntityFx internals. See §5 step 4.
6. **Menus use the new art:**
   - Hangar;
   - co-op lobby slot cards;
   - results;
   - the Ship's Log fleet tab, which shares the same `UI.shipArt` helper.
   The title screen's attract demo goes through the renderer, so it gets the new art for free.
7. **Class mapping.** The designs are original. Do not move silhouettes toward any existing
   franchise: no saucer-plus-twin-nacelle forms, no recognisable logos or shapes.

   | Code id (display name) | Art class (`vessels.ts`) | Story class (`STORY.vessels`) |
   |---|---|---|
   | `spark` (Glimmer of Hope) | light frigate / scout: slim arrow, swept delta, wing-tip pods | Kindle-class light frigate |
   | `vanguard` (Immovable Object) | heavy cruiser: long sharp wedge, bridge, off-axis turrets | Monolith-class heavy cruiser |
   | `tempest` (Already Gone) | interceptor: twin prongs closed by a coil emitter | Zephyr-class interceptor |
   | `bastion` (Big Warm Hug) | shield dreadnought: hex hull, forward crescent deflector, dome bridge | Citadel-class shield dreadnought |
   | `phantom` (Definitely Not Here) | stealth raider: manta wing, sawtooth trailing edge | Whisper-class stealth raider |
   | `drifter` (Drone) | drone: asymmetric jagged crystal cluster | |
   | `swarmling` (Swarm Dart) | dart swarm: small crystal dart | |
   | `dasher` (Lancer) | lancer: long crystal lance (squeeze on aim, ×1.34 stretch on charge) | |
   | `splitter` / `splitling` (Cell / Cellet) | budding cell-ship with orbiting buds | |
   | `shooter` (Gunship) | gunship: aims at its target, counter-rotating hex, 0.7 s charge | |
   | `brute` (Bulwark Hauler) | bulwark: armour plates break off at 75/50/25 % HP | |
   | `warden` / `hydra` / `voidheart` | gate fortress / hunter-cruiser with 3 necks / hive mothership | |

8. **Port by hand** on top of 3a. Keep everything 3a added:
   - `bg.draw` first;
   - `case 'sector'`;
   - `anticipateSector` (or 3a's `sectorwarp.ts` helper);
   - `sectorCard`;
   - `onGalaxy`.
9. **Accessibility.**
   - Reduced flashing (`settings.flashes === false`) behaves as NOTES §5 describes.
   - EntityFx adds no shake or camera motion, so screen shake 0 means none from this layer.
   - Anything new must also follow these rules (see §7).
10. **P1 aliases.**
    - New files use `world.players[pid]` only.
    - `renderer.ts` and `hud.ts` stay in `PENDING_MIGRATION` (3e migrates them).
    - Do not add new P1-alias uses outside them.
11. **Performance.** At about 400 enemies and about 60 kills per sim-second at 1920×1080, the renderer's
    `consume` + `draw` JS may grow by at most about **+1 ms mean** over the pre-3b build.

## 5. Implementation plan

**Step 1. Add the modules.** Run `cp prototypes/entities/src/{vessels,shardfx,entityfx}.ts src/render/`.
Leave the prototype copies untouched. The imports already resolve (`../core/math`, `../game/...`,
`./particles`).

**Step 2. Event fields** (NOTES §4.1):
- In `src/game/types.ts`, the `kill` member of `GameEvent` gains the four optional fields, with the
  patch's doc comment ("Render-only (shatter fragments)…").
- In `World.killEnemy`, append `kind: e.kind, angle: e.angle, kx: e.kx, ky: e.ky` to the pushed event.
- `damageEnemy` applies knockback before it calls `killEnemy`, so `kx/ky` already include the killing
  blow.
- These edits use no `Math.*` calls, so task 1's `tests/determinism.guard.test.ts` is unaffected.
- The fields are optional, so the `kill` literals in `tests/story.test.ts` and `tests/storyui.test.ts`
  still compile.

**Step 3. Renderer wiring** (NOTES §4.2, mapped onto the current `src/render/renderer.ts`):

| Anchor | Change |
|---|---|
| Imports | Add `import { EntityFx } from './entityfx'`. Remove `ENEMIES` from the `../game/content/enemies` import (3a's line also imports `BOSS_SCHEDULE, VICTORY_TIME`; keep those if still used, drop the whole import if 3a moved them to `sectorwarp.ts`). |
| Fields | Add `readonly fx = new EntityFx();` with the patch's doc comment, next to 3a's `sectorCard`. Remove `trail` and `boltDot` (and its `makeGlowDot` line in the constructor). Keep `bulletDot`. |
| `resize()` | `this.fx.setResolution(this.scale * this.dpr)` next to `this.sprites.setResolution(...)`. |
| `reset(world)` | `this.fx.reset()` and `this.fx.warmPilots(world)` (step 4d). Remove `this.trail = []`. Keep 3a's `sectorCard.clear()` / `bg.galaxy.setSector`. |
| `consume()` | First line in the loop: `this.fx.onEvent(ev, world, P)`. `kill`: spark burst `n = boss ? 80 : elite ? 30 : 3 + r·0.2`; remove the white elite burst and the elite `blasts.push`; the `+score` float only while `world.enemies.length < 150` (elites/bosses always). `perfect`: remove `blasts.push`. `explode`: smaller burst (`6 + r·0.08`), remove `blasts.push`. `bossdead`, `bomb`: unchanged. |
| `draw()`, after `visible` | `const fx = this.fx; fx.flashes = this.settings.flashes; fx.begin({ k, ox, oy, minX, minY, maxX, maxY }, dt, rdt);` |
| `// ── Telegraphs ──` loop | Replace with `fx.drawTelegraphs(ctx, world)`, then `fx.drawDebris(ctx)`. |
| `// ── Enemies ──` loop | Replace with `fx.drawEnemies(ctx, world)`; keep `world2()` and the elite HP rings. |
| Additive layer | Beams unchanged. Replace the `world.projectiles` loop with `fx.drawProjectiles(ctx, world, PAL.bolt)`. **Remove the `world.bullets` loop here.** Blades unchanged. `particles.draw`, then `fx.drawShards(ctx)`, then `fx.drawLightning(ctx, this.arcs.items)` (replaces `this.arcs.draw`). |
| Blasts | Reduced flashing: `const discCap = this.settings.flashes ? 1 : 0.15`; for `b.r > 300` cap both stroke and fill alpha at `discCap` (exact code in the patch). |
| `// ── Player ──` | Replace the trail, afterimage, hull and shield code with `fx.drawPlayers(ctx, world, dt, rdt, this.settings.trail)`, then `world2()`. Keep the magnet hint inside `if (p.alive)` (P1 only until 3e). |
| Before `// ── World-space text ──` | `fx.drawBullets(ctx, world, this.bulletDot)`: enemy plasma **last in the world**. |

Resulting world order:
1. galaxy and grid (`bg.draw`);
2. rings, mines, pickups;
3. telegraphs;
4. cooled debris;
5. enemies;
6. elite rings;
7. additive layer: beams, projectiles, blades, particles, hot shards and booms, lightning, blasts;
8. pilots;
9. magnet hint;
10. enemy bullets;
11. world text;
12. vignette, flash, HUD, callouts, 3a's sector card.

`src/render/sprites.ts` keeps its `'player'` and enemy shapes. Do not delete them in this task.

**Step 4. EntityFx additions** (all in `src/render/entityfx.ts` unless stated):

- **4a. Pilot colours.** Export `pilotColors(world: World, pid: number, soloTrail: string): { accent: string; trail: string }` (to be created).
  - Solo: `accent = SHIPS[ship].color`, `trail = soloTrail`.
  - Co-op (`world.coop`): both are `PLAYER_COLORS[pid % PLAYER_COLORS.length]`.
  - `drawPlayers` uses it for each pilot. In `drawPlayer`, every `color` that comes from
    `SHIPS[p.ship].color` becomes `accent`: the hull sprite key, the nozzle glow, `ghostColor(...)` for
    afterimages, and the flame `mix(accent, trail, 0.35)`. The exhaust ribbon uses `trail`.
  - The shield bubble stays `#7ff9ff`. `FLEET_GLOW` / `FLEET_RIM` never change.
- **4b. Downed pilots.** Export `DOWNED_ACCENT = '#8890b0'` (to be created, from coop.md).
  - Draw a pilot with `p.downed` as `art.ship(p.ship, DOWNED_ACCENT, 'normal')` at alpha 0.35.
  - No shadow, flames, exhaust, afterimages, lights, shield or locator. The prototype already skips
    those; only the accent changes.
  - 3e adds the revive ring and name tags.
- **4c. Vessel API.**
  - In `vessels.ts`, add `paintVessel(ctx, art: VesselArt, ship: ShipId, accent: string, o: { thrust: number; bank: number; time: number; steadyLights: boolean; ghost: boolean })` (to be created). It draws flames, nozzle glows and white cores, the fleet under-glow, the hull and the running lights in the vessel's **local frame** (world units, +x forward; the caller sets the transform and alpha). It sets and restores its own composite ops.
  - Move the matching section of `drawPlayer` onto it. Shadow, exhaust ribbon, afterimages, bank
    highlight, hurt glow, shield and locator stay in `drawPlayer`.
  - The menus, `drawVessel` and `drawPlayer` then use identical sprite calls. Small ordering
    differences between additive layers are fine; compare before/after shots of all five ships.
  - Add `EntityFx.drawVessel(ctx, ship: ShipId, x: number, y: number, angle: number, opts?: { accent?: string; alpha?: number; ghost?: boolean; thrust?: number; bank?: number; scale?: number })` (to be created). It works in world coordinates through the view from the last `begin()`. Defaults: accent `SHIPS[ship].color`, alpha 1, thrust 0.6, bank 0, scale 1. `ghost` means `DOWNED_ACCENT` at 0.35 alpha, hull only. It restores alpha and composite op.
  - In `vessels.ts`, add `vesselIcon(art: VesselArt, ship: ShipId, accent: string, px: number, opts?: { locked?: boolean; angle?: number }): HTMLCanvasElement` (to be created) for DOM menus.
    - It returns a `px`×`px` canvas, nose up by default (`angle = -Math.PI / 2`, as `UI.shipArt` does
      today), fitting `SHIP_ART[ship].extent` into about 80 % of the canvas.
    - It shows idle flames (thrust about 0.6) and steady lights.
    - `locked`: the `'ghost'` variant silhouette in the given accent, with no flames or lights.
- **4d. Prewarm.** Add `EntityFx.warmPilots(world: World)` (to be created). It puts the accent sprites
  of the current roster at the front of the warm queue: `ship(id, accent, 'normal' | 'flash')` and the
  ghost afterimage. For `world.cfg.daily === 'giants'`, it also queues alien radii ×1.4 and ×1.4·1.35,
  because `World.spawnEnemy` scales `r` for that Daily. `begin()` keeps baking at most 2 ms per frame.
- **4e. Charge clamp helper.**
  - Export `chargeLevel(timer: number, lead: number): number` (to be created): 0 when
    `timer >= lead`, otherwise `clamp(1 - timer / lead, 0, 1)`.
  - Use it at every charge site:
    - gunship, `fireT` with lead 0.7 (only when `spawnT <= 0`);
    - Warden core charge, `fireT` with lead 1.0;
    - Warden spokes, lead 0.9;
    - Void Heart summon, `summonT` with lead 1.2.
  - Keep the `clamp(e.hp / e.maxHp, 0, 1)` in the Bulwark pulse and `drawBrutePlates`.
  - The telegraph timings mirror `enemyai.ts` (Lancer 0.6 s; Hydra 0.85 / 0.6 enraged; Warden volley
    offset `((state + 1) % 2)·0.2 + angle + rate·fireT`; all checked on 2026-10-11). Add a comment that
    names `enemyai.ts` as their source.
- **4f. Frame-rate-independent capital ships.** `drawBoss` uses `const dt = 1 / 60` for the Warden
  ring spin and the Hydra heading, so it spins twice as fast at 120 Hz and keeps spinning while paused.
  - Store the sim `dt` in `begin()` (a private field, to be created) and use it there.
  - `updateNecks` follows with a fixed per-frame factor `f = 0.22 + 0.06·(NECK_SEGS − i)`. Make it
    `1 - (1 - f) ** (dt * 60)`: identical at 60 Hz, and frozen at `dt = 0`.
- **4g. Reduced flashing for the invulnerability blink.** In `drawPlayer`, the 8 Hz alpha blink
  (`Math.floor(t * 16) % 2`) becomes a steady 0.6 alpha when `this.flashes` is false.
- Keep the 3c hooks exactly as in the prototype: `setGlowScale`, `postFx`, `setCostTier`, `prewarm`.
  Also keep `ms` and `shards.count` (diagnostics).

**Step 5. Shape-sprite glow hook.** Copy the `src/render/sprites.ts` hunk of
`prototypes/postfx/integration.patch`:
- the `glowScale` field and `setGlowScale(g)`, which clears the cache on change;
- `pixelCount()`;
- the `render()` sizing `glow = Math.max(6 * gs, radius * 0.9 * gs)`, `size = … + 2 + 2 * gs`.
At `gs = 1` this is byte-for-byte today's sprite. 3c's port of that hunk then becomes a no-op.

**Step 6. Menus** (`src/ui/ui.ts`, `src/ui/style.css`):
- Replace `import { SpriteCache } from '../render/sprites'` and the `sprites` field with
  `private vessels = new VesselArt()`. Call `this.vessels.setResolution(4)` once (its default is 2).
  - The UI owns its own instance on purpose. DOM canvases are never post-processed, so menu art must
    keep glow scale 1 even when 3c sets the in-game art to 0.15.
  - TS reports an unused private field, so remove the old one.
- Change `UI.shipArt(color)` to `shipArt(ship: ShipId, accent: string, locked = false)`. It wraps
  `vesselIcon` with `px` 168 (CSS 84/96/56 px as today) and sets `aria-hidden="true"`.
- Update the three callers:
  - `showHangar`: `SHIPS[id].color`, `locked = !isShipUnlocked(save, id)`.
  - `showLog` (fleet tab, filled from `fleetHtml`): the same as the Hangar.
  - `showLobby`: the slot's own ship. Today every slot gets the same `'player'` arrowhead sprite. Use
    `lobby.slots[i]!.ship` with `pilotColor(i)`, so a card shows the actual class in the pilot's colour.
- **Results** (new):
  - Solo: add `<div class="res-ship" aria-hidden="true"></div>` as the first child of `.results-head`,
    filled with `shipArt(r.ship, SHIPS[r.ship].color)`. Size 72 px, 48 px inside the existing
    `@media (max-width: 560px)` block.
  - Co-op: in `coopTable`, put `<span class="pilot-ship" aria-hidden="true" data-pilot-ship="i">` before
    `this.pilotTag(i, t.ship)`. Fill each after `innerHTML` with a 28 px icon in `pilotColor(i)`.
  - Keep `.results-head .eyebrow` and `.coop-table tbody tr`: e2e selects them.

**Step 7. Docs.**
- `docs/GAME_DESIGN.md`:
  - §5.1: one fleet livery, with class-colour accents in solo and pilot colours in co-op.
  - §5.5: replace the "Shape" column with the crystal designs (table above).
  - §7: the Kill row becomes "shatters into its own crystal fragments (white-hot, then cooled debris),
    spark burst, score popup (hidden in dense fights)". The Dash row: "afterimages, exhaust ribbon".
  - §9: the Canvas 2D bullet mentions baked vessel sprites plus the SoA shard pool.
- `docs/HANDOFF.md`: mark 3b done and list the interfaces below for 3c and 3e.

**Interfaces this step exposes (3c and 3e consume them; keep them stable):**
- `renderer.fx: EntityFx`:
  - `setResolution(pxPerUnit)`: pass a **zoom-independent** value. 3c uses `scale·dpr·worldScale`; 3e
    must not pass `k / world.zoom` every frame (see §10).
  - `setGlowScale(g)`, `postFx`, `setCostTier(tier)` (4..0: ≥2 full, 1 half, 0 about a third);
  - `flashes`, `prewarm(budgetMs)`, `art: VesselArt`, `shards: ShardFx`;
  - `drawVessel(...)`, `warmPilots(world)`;
  - the draw methods, in the order of step 3.
- `renderer.sprites.setGlowScale(g)`.
- From `entityfx.ts`: `pilotColors`, `DOWNED_ACCENT`, `chargeLevel`, `visualAngle`.
- From `vessels.ts`: `paintVessel`, `vesselIcon`, `SHIP_ART` (`nozzles`, `extent`, `shieldR`),
  `FLEET_RIM`, `FLEET_GLOW`.
- Post-FX shockwave candidates (3c owns the budget): elite and boss `kill`, `explode` with `r >= 60`,
  and `perfect`.

## 6. Settings and save data

No new settings and no save changes. Existing mappings:
- `Settings.flashes` → `renderer.settings.flashes` (`App.applySettings`) → `fx.flashes`, set every
  frame.
- `Settings.shake`: unchanged. EntityFx adds no shake of its own.
- `Settings.trail` (`TRAILS` in `src/meta/rank.ts`) → `renderer.settings.trail` → the solo exhaust
  ribbon and flame tint. It is ignored in co-op, where the pilot colour is used.

## 7. Accessibility, mobile, co-op and performance requirements

- **Reduced flashing:**
  - Everything in NOTES §5: soft hit tints; kill and explosion flashes at 35 %; hot shard edges 0.4 and
    fills 60 %; steady nav lights; no Warden jitter; lightning re-jitter at 8 Hz; a pulsing (not
    flickering) Lancer telegraph; hurt hull not white and the red glow halved; boss-death and bomb
    discs ≤ 0.15 alpha.
  - Plus step 4g (steady invulnerability alpha).
  - Peak brightness caps hold with flashing on as well: kill flash ≤ 2.5 r at peak alpha ≤ 0.6 and
    ≤ 80 ms; shield bubble fill ≤ 0.15; Hydra lane fill ≤ 0.12; Warden spokes ≤ 2.4 r at alpha ≤ 0.35.
- **Shake:** with shake 0 nothing in this layer moves the camera.
- **Readability:**
  - The pilot's vessel stays the easiest thing to find: contact shadow at 1.6 r and alpha 0.48, rim,
    white engine cores, and the crowd locator (≥ 16 enemies within 190 units).
  - Cooled debris stays ≤ 0.35 alpha, desaturated, and drawn below enemies.
  - Enemy bullets are drawn last.
  - The hitbox is unchanged (`PLAYER_RADIUS` 11, drawn half-length 17.9–21.7).
- **Over the galaxy:** in every sector (force one with `app.renderer.bg.galaxy.setSector(i, { sync: true })`),
  the rim, cores and bullets stay clearly visible. If 3a's `tests/galaxy.test.ts` exists, add
  `FLEET_RIM` and `FLEET_GLOW` to its gameplay colour list and keep it green. They are expected to pass;
  if they do not, raise the issue rather than loosen the check.
- **Mobile (Pixel 7 project):**
  - In-run, Hangar, lobby and results fit with no horizontal overflow (the smoke test checks
    `scrollWidth`).
  - The sprite resolution is capped by `VesselArt.setResolution` (1–4 px/unit), so memory stays bounded.
- **Co-op:**
  - All pilots are drawn with their accents.
  - Downed pilots are drawn as ghosts (4b).
  - Shatter direction uses the nearest pilot.
  - Enemies with `tgt === -1` fall back to P1 for facing.
  - The camera and zoom stay as they are (P1-follow) until 3e.
- **Performance budgets:**
  - At about 400 enemies, about 60 kills per sim-second and 1920×1080: renderer `consume` + `draw` JS
    at most +1.0 ms mean and +3 ms p95 over the pre-3b build. The prototype measured +1.0 mean and
    +2.8 p95 on SwiftShader.
  - No per-frame `shadowBlur` in world drawing; glow is baked or additive.
  - The shard pool is capped at 1400, with LOD above 400 live entries.
  - Prewarm costs at most 2 ms per frame.
  - About 105 baked sprites after the title prewarm.
  - No per-frame allocations in the enemy loops (numeric cache keys). The per-pilot string key in
    `art.ship` (≤ 4 per frame) is acceptable.

## 8. Tests to add or update

Vitest runs in `environment: 'node'`. `vessels.ts`, `shardfx.ts` and `entityfx.ts` import without the
DOM, and `onEvent` is DOM-free. `begin()`, `prewarm()`, the `draw*` methods and `vesselIcon` create
canvases, so do not call them in unit tests.

**`tests/entityfx.test.ts`** (to be created):
1. **Kill event fields.**
   - Setup: `new World(makeRunConfig({ seed: 1 }))`; `spawnEnemy('drifter', 100, 0)`; set
     `e.angle = 0.7`; `damageEnemy(e, 1e6, false, 1, 0, 300, false, 0)`.
   - The `kill` event has `kind === 'drifter'`, `angle === 0.7`, `kx === e.kx`, `ky === e.ky`, and
     `kx > 0`, because the killing blow's knockback is included.
2. **`chargeLevel`.** `(5, 0.7) → 0`, `(0.35, 0.7) → 0.5`, `(0, 0.7) → 1`, `(-50, 0.7) → 1`. The last
   case is the out-of-range gunship.
3. **Shatter counts.** Use a fresh `EntityFx`, a `Particles`, a solo world, and one `onEvent` per case.
   Numbers are as of the prototype; update them if you change the recipe on purpose.
   - drifter normal kill: `shards.count === 6`;
   - elite drifter (r 17.55): 31 (9 + 6 inner + 16 embers);
   - after `setCostTier(0)`: drifter count 2;
   - a `kill` without the optional fields still spawns shards (6 for a drifter) and does not throw;
   - a Warden kill spawns at least 31 (126 with embers);
   - a brute: 15.
   All of these numbers were checked against the prototype code on 2026-10-11.
4. **`setCostTier`.** 4, 2 → `shards.quality === 1`; 1 → 0.5; 0 → 0.35.
5. **`pilotColors`.** In solo, accent `SHIPS[ship].color` and trail = the passed trail. In a 2-pilot
   world (`makeRunConfig({ seed: 1, players: [{ ship: 'spark' }, { ship: 'bastion' }] })`), pilot 1 has
   `PLAYER_COLORS[1]` for both.
6. **Art coverage.**
   - Every `ShipId` has `SHIP_ART` with at least one nozzle, and `extent` in [17, 25].
   - Every `EnemyKind` has `ALIEN_ART` with an even outline length ≥ 6.
   - `fragmentsOf(outline, cx, cy, n)` returns exactly `n` finite triangles for n = 4 and 9.

**e2e** (both projects unless noted):
- In `e2e/smoke.spec.ts` "menus open and close": `#screen-hangar .ship-art canvas` has count 5.
- In "pause, resume and ending a run show the results screen": `#screen-results .res-ship canvas` has
  count 1.
- In "a run starts, the world simulates and the canvas draws": `window.shardstorm.renderer.fx.art.size > 0`.
  Leave the canvas-variety check as it is; 3c changes it.
- `e2e/coop.spec.ts` (desktop): in "two keyboard pilots join…", the lobby has
  `.slot-art canvas` count 2 and the results have `.coop-table .pilot-ship canvas` count 2.

**Must NOT change:**
- `tests/golden.solo.test.ts`: no edit and no re-capture.
- The `PENDING_MIGRATION` set in `tests/no-p1-alias.test.ts`.
- `tests/determinism.guard.test.ts`, if task 1 has landed.
- The solo HUD.
- Never skip or loosen a test.

## 9. Acceptance checklist

- **Commands** (all green):
  - `npm run typecheck`, `npm test`, `npm run build`;
  - `npm run build:single`: report the `dist-single/shardstorm.html` size before and after;
  - `E2E_PORT=<free port> npm run e2e`: desktop and mobile projects.
- **Diff checks:**
  - `git diff <base> -- src/game` shows only the four `kill` fields (types and `killEnemy`).
  - `git diff <base> -- tests/golden.solo.test.ts` is empty.
- **Screenshots.** Keep them outside the repo.
  - **How to capture:** `npx vite build --outDir <tmp>/dist`, then
    `npx vite preview --outDir <tmp>/dist --port <port> --strictPort` in the background. Stop it
    afterwards. Drive the page with Playwright.
  - **Seeding a ship:** seed `localStorage['shardstorm.save']` the way `e2e/coop.spec.ts` `SEED_SAVE`
    does, with `achievements: { survive3: 1, combo150: 1, warden: 1, perfect10: 1 }` and `ship: '<id>'`.
  - **Captures:**
    1. All five vessels in a run (`?autoplay&warp=20`), each at 1×, plus a 2× crop: idle, thrust, bank
       and dash.
    2. Every enemy kind including an elite, a Lancer charging and a gunship charging
       (`?autoplay&warp=160`).
    3. The Warden with its volley spokes (`warp=185`), the Hydra charge lane (poll until a `hydra` has
       `state === 1`, `warp=365`) and the Void Heart with lit spires (`warp=545`).
       - If the bot dies first, top up `app.world.players[0].hp`, or spawn the boss with
         `app.world.spawnEnemy(kind, x, y)`. Both are for capture only.
    4. A kill storm with shatter: the heavy scene below.
    5. Reduced flashing (save `settings.flashes: false`): kill storm, dash, Warden.
    6. Hangar, co-op lobby (`?bots`, add bots), Ship's Log fleet tab, solo and co-op results.
    7. `?coop=4&autoplay` in the first seconds, with four tinted ships, plus one downed ghost (set
       `players[1].downed = true` for the capture only).
    8. Each of the four sector backdrops with ships and enemies.
    9. A Pixel 7 viewport, in a run and in the Hangar.
- **Performance.** Report:
  - mean, p50 and p95 of `consume + draw` for the pre-3b build vs. this one: 6 alternating runs,
    frames 30–360, about 400 enemies, about 60 kills/s, 1920×1080;
  - the per-method EntityFx times;
  - `fx.shards.count` and `fx.art.size`.
  Adapt `prototypes/entities/tools/heavy.mjs` (see §10). Headless raster is SwiftShader, so report it as
  JS-side, pessimistic numbers. Run one check on a real iGPU laptop if one is available.

## 10. Pitfalls and known issues

- **The co-op caution and the patch.**
  - The patch is clean against the PR head (§2), but 3a changed `renderer.ts`, so port the renderer by
    hand.
  - The old enemy-loop `ENEMIES` import shares a line with 3a's `BOSS_SCHEDULE, VICTORY_TIME`.
  - `noUnusedLocals` fails if `ENEMIES`, `boltDot` or `trail` are left behind.
- **The bullets loop moves; it does not just disappear.**
  - Delete it from the additive block, otherwise plasma is drawn twice and `bulletDot` stays half-used.
  - Call `fx.drawBullets` once, after `fx.drawPlayers`.
- **Sprite resolution and zoom.**
  - `VesselArt.setResolution` and `SpriteCache.setResolution` round to 0.5 px/unit steps and clear their
    caches on change.
  - Feeding them a continuously changing `k / zoom` (3e's camera) would re-bake every sprite as the zoom
    eases, which hitches.
  - Keep the zoom-1 value. A slightly over-resolved sprite drawn smaller is fine.
- **Fast cache keys ignore colour.** `VesselArt.alien` and `.part` key on (kind or part, variant, r)
  only. Never draw one kind in two colours (for example per-sector or per-pilot enemy tints) without
  extending the key. `ship()` keys on colour, which is why co-op accents work.
- **`ShardFx` colour palette.**
  - At most 48 colours per run (`MAX_COLORS`); `clear()` on `fx.reset()` resets it.
  - Extra colours fall back to index 0.
  - Do not feed it per-frame or random colours.
- **First-sighting hitches.**
  - A boss bake can take tens of ms on software raster if the warm queue has not reached it.
  - The queue normally finishes on the title screen.
  - `?warp=N` skips the title, so call `fx.prewarm(1000)` once after a debug warp if captures stutter.
  - Co-op accents and giants radii are handled by `warmPilots` (4d).
- **Render randomness.**
  - `Math.random`, `Math.sin` and `**` in these files are fine. They are outside the sim's import
    closure, and task 1's guard scans only that closure.
  - Never import render modules from `src/game`.
  - Never draw from `world.rng`, `spawnRng`, `lootRng` or `posRng`.
- **The `no-p1-alias` regex** also matches `this.player`, `this.stats` and `this.build` in any file:
  that is how 3a's galaxy `this.stats` Map failed. Do not name new fields that way. The prototype has
  zero hits (checked).
- **Boss and plate state.**
  - The `bosses` Map is never swept, which is fine at a few bosses per run, Overtime included; it is
    cleared on `reset()`.
  - Bulwark plate counts are swept every 2 s.
  - Missile ribbons are kept in a `WeakMap` keyed by projectile object. That relies on the sim
    allocating new projectile objects (`weapons.ts` pushes literals). If the sim ever pools them, key
    the ribbons by an id.
- **Hit squash is stateless** (`e.flash ≤ 0.08 s`). An elastic wobble would need per-id state (not
  needed).
- **The reference tools are not runnable as they are.**
  - `tools/lib.mjs` imports Playwright from an absolute path on the original build machine
    (`/home/user/addictive-game/node_modules/playwright/index.mjs`).
  - `patch.sh`/`build.sh` expect `game-src/`, `harness/` and `orig/` directories, which are not
    in-tree, so the gallery harness cannot be rebuilt.
  - `heavy.mjs` writes into `prototypes/entities/shots/` and mutates the sim. It sets `hp = 1e9` on
    live non-boss enemies (above `maxHp`, which is exactly what the Bulwark `hp/maxHp` clamp must
    survive), sets `hp = maxHp = 1e9` on the ones it spawns, and scripts `killEnemy` calls. That is fine
    for a benchmark, never for committed code.
  - Copy `heavy.mjs` and `lib.mjs` to a scratch dir, point the import at your checkout's
    `node_modules/playwright/index.mjs`, and keep the outputs outside the repo.
- **Perfect dash.** The renderer's filled r = 90 `perfect` blast was the real "solid cyan disc" over
  the ship (review E6). It must go; EntityFx draws a thin ring.
- **The camera is still solo-style.** It follows P1 and ignores `world.zoom` until 3e, so in co-op a
  spread-out pilot can be off screen. Expected; do not fix it here.

## 11. Out of scope

- WebGL post-FX, bloom, shockwaves and the auto-quality ladder that drives `setCostTier` (3c). Only the
  hooks are added here.
- WarpGrid (3d). The grid starts its own fronts from events, so EntityFx pushes no ghost blast entries.
- The zoom-aware camera, `renderer.worldToScreen`, name tags, revive rings, edge indicators, the co-op
  HUD and removing `renderer.ts`/`hud.ts` from `PENDING_MIGRATION` (3e).
- A player-ship shatter on `death`. A natural follow-up using `fragmentsOf` on `SHIP_ART` hulls, but not
  requested.
- Removing the now-unused `'player'` and enemy shapes from `sprites.ts`.
- Co-op attract mode (`App.newAttractWorld` stays solo).
- Tinting projectiles or blades per pilot.
