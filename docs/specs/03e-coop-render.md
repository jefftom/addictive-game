# Co-op rendering pass and comms panel fade

Task 3e of `docs/HANDOFF.md`, the last step of the graphics chain (3a → 3e). Every step edits
`src/render/renderer.ts`, so this one lands **after 3a (galaxy), 3b (entity art), 3c (post-FX) and
3d (WarpGrid)**; their specs are `docs/specs/03a-galaxy.md` … `03d-grid.md`. The co-op simulation
(players, downs, revives, zoom, leash) is finished and tested. What is missing is its presentation:
a camera and HUD that know about more than one pilot, plus a small comms-panel readability fix that
applies to solo as well.

## 1. Goal

With 2–4 captains on one screen, the camera frames the whole squad: it follows the squad's centre
and smoothly zooms out (up to 1.45×) as the pilots spread. Every layer (galaxy, grid, sprites,
shockwaves, particles, damage numbers) stays glued together at any zoom. Each captain flies their own
vessel in their pilot colour and carries a small tag with a shape mark and `P1`…`P4`, so colour-blind
players can tell them apart. A downed captain shows as a translucent ghost ship inside a dashed revive
circle that fills as a teammate hovers nearby, labelled "FLY HERE TO REVIVE". The last captain
standing gets a warning callout and a halo. Captains pinned by the leash see a glow on that screen
edge, and an arrow points to anyone who somehow ends up off screen. The bottom of the screen holds one
compact panel per captain (HP, dash, shield, build, DOWN and revive progress). The shared XP, level,
timer, score and combo stay on top. The DOM toasts for downs, revives and last stand are replaced by
these in-world cues. In every mode, solo included, the story comms panel fades to about 30 % while an
enemy, enemy shot, boss or ship is underneath it, so it never hides a threat, and it comes back when
the area is clear. Solo looks and plays exactly as before. The simulation is untouched.

## 2. Starting point

- **Base:** the PR branch `claude/dazzling-faraday-2kxdhl` with tasks 1, 2 and 3a–3d merged (HANDOFF
  order). Work on a branch (for example `wip/wave3-coop-render`, to be created). Merge with a merge
  commit, no force-push. Use one or a few focused commits, all checks green at each.
- **Check the prerequisites first** (grep; these names come from the earlier specs' "Interfaces this
  step exposes"):
  - 3b, required: `src/render/entityfx.ts` exports `EntityFx` (with `drawPlayers`, `drawVessel`,
    `begin`, `warmPilots`), `pilotColors` and `DOWNED_ACCENT`. The renderer has `readonly fx`. If
    this is missing, stop: the pilot art, the accents and the ghost hull come from 3b.
  - 3c, expected: the renderer has `hudCtx`, `postfx`, the private `view(tw, th, s)` helper and
    `private camZoom = 1`. If 3c has not landed, create `view()` and `camZoom` exactly as
    `03c-postfx.md` §5 step 5 describes (2D only, `s = 1`), skip the post-FX checks, and note it in
    the HANDOFF.
  - 3d, expected: `renderer.grid` and the grid draw call that reads the world transform's centre.
    Without 3d, skip the grid checks.
- **No WIP branch and no prototype exist for this step.** Nothing needs fetching. The inputs are the
  in-tree design doc `docs/design/coop.md`, the 03a–03d specs and the current code.
- **Verified state of the code this step changes** (checked 2026-10-11 on PR head `a114403`; 3b/3c
  touch some of these lines, the facts stay true):
  - `Renderer.reset` puts the camera on `world.player`. `Renderer.draw` follows `world.player` with
    look-ahead 0.12 and `damp(7)`, uses `k = scale·dpr` and ignores `world.zoom`. 3b and 3d both
    record that the camera stays P1-follow "until 3e".
  - `Renderer.consume` places pickup/heart/core/cache, `levelup`, `dashready`, `heal`, `milestone`,
    `magnet`, `newbest` and `victory` feedback at `world.player`. It has **no** `downed`, `revived` or
    `laststand` case.
  - `src/render/hud.ts` `drawHud` is solo-only. It reads `world.player`, `world.stats` and
    `world.build`, and calls `world.hasRelic('shield')` without a pid.
  - `src/app.ts`:
    - `App.coopToasts` turns `downed`, `revived` and `laststand` into DOM toasts. It is called from
      `stepGame` (`if (this.coop) this.coopToasts(w.events)`).
    - `App.screenPos` duck-types an optional `worldToScreen` through the `Projecting` interface. It
      expects **device px**; its zoom-1 fallback is `(p.x − camX)·scale·dpr + w/2`, with no shake.
    - `App.newAttractWorld` is solo ("until the co-op renderer can show every pilot").
  - `tests/no-p1-alias.test.ts`: `PENDING_MIGRATION = {'src/render/renderer.ts', 'src/render/hud.ts'}`.
  - `e2e/coop.spec.ts` asserts `#toasts` contains `'P2 is down'` and `'back in the fight'`.
  - Sim API this step reads (all exist in `src/game/world.ts`):
    - `players`, `coop`, `zoom` (1 in solo), `viewHalfW/H` (base, set by `App.onResize`);
    - `isUp`, `teamCenter()` and `teamVelocity()` (reused scratch objects), `effHalfW/H`;
    - `reviveNeed(p)`, `maxSpan()` (scratch), `comboWindow()`, `hasRelic(id, pid)`,
      `pendingPicksFor(pid)`.
    - `Player` has `downed`, `reviveT` and `downs`.
    - Events: `downed {pid, x, y}`, `revived {pid, by, x, y}`, `laststand {pid}` (`src/game/types.ts`).
    - `PLAYER_COLORS` and `PLAYER_MARKS` live in `src/game/content/coop.ts`, not in `palette.ts` as
      coop.md says. So do `REVIVE_RADIUS`, `ZOOM_MAX`, `LEASH_EDGE` and `MAX_PLAYERS`.

## 3. Read first

1. `AGENTS.md`, then `docs/HANDOFF.md` §3e.
2. `docs/design/coop.md`. Its line numbers refer to commit `18b7adc`; map them by content.
   - §0 D8 and D10;
   - §2.2 (helpers), §2.5 (`downPlayer`), §2.7 (revive);
   - §3: the `src/render/renderer.ts`, `src/render/hud.ts`, `src/render/background.ts` and
     `src/app.ts` entries;
   - §4 (consumer API), §5.1–5.5 (camera, zoom, leash, grid coverage), §7 (HUD layout), §10 (the
     performance and readability rows).
3. `docs/specs/03b-entities.md`: §4 items 3 and 5, §5 step 4 (4a–4d) and "Interfaces this step
   exposes". `docs/specs/03c-postfx.md`: §4 items 1 and 10, §5 steps 4–8 and the interfaces.
   `docs/specs/03d-grid.md`: §5 "For 3e". `docs/specs/03a-galaxy.md` §5 interfaces.
4. Current code (after 3a–3d):
   - `src/render/renderer.ts` (`resize`, `reset`, `consume`, `view`, `draw`);
   - `src/render/hud.ts`;
   - `src/render/effects.ts` (`Callouts.add`, `FloatTexts.draw(ctx, scale)`, `Shake`);
   - `src/render/entityfx.ts` (`drawPlayers`, `drawPlayer`, `drawVessel`);
   - `src/app.ts` (`screenPos`, `Projecting`, `onResize`, `startRun`, `endRun`, `toTitle`,
     `coopToasts`, `stepGame`, `presentComms`);
   - `src/ui/comms.ts`, `src/ui/ui.ts` (`toast`, `pilotLabel`), `src/ui/style.css` (the "Comms" and
     "Toasts & tutorial" blocks, `--u`);
   - `src/core/input.ts` (`devicePos`, `read`, `readSlot`: mouse steering is in device px);
   - `tests/no-p1-alias.test.ts`, `e2e/coop.spec.ts`, `e2e/story.spec.ts`.

## 4. Owner decisions and constraints (non-negotiable)

1. **The sim stays bit-identical.** No edits under `src/game/`. `tests/golden.solo.test.ts` passes
   unchanged. Render and UI code only read sim state: never write `world.zoom` or `viewHalfW/H`, and
   never draw from `rng`, `spawnRng`, `lootRng` or `posRng`.
2. **Camera:** zoom-aware, following `world.teamCenter()` and applying `world.zoom` per coop.md §5.4
   (smooth, no jitter). Solo behaviour is unchanged: zoom 1, following the player with today's
   look-ahead and damping.
3. **One transform:** expose `renderer.worldToScreen(x, y)` returning **CSS px**, and use one view
   transform consistently in every layer: galaxy parallax, grid, post-FX shockwave anchors, particles,
   float text, telegraphs, offscreen culling, and the new overlays. Callouts and the sector card are
   screen-anchored and stay so. Check every layer at full zoom-out (`world.zoom` = `ZOOM_MAX`, where
   the world→screen scale is below 1×).
4. **Pilots:**
   - each captain is drawn with their vessel art in their `PLAYER_COLORS` accent (3b);
   - each is identified by their `PLAYER_MARKS` **shape**, not colour alone, with a small `P1`…`P4` +
     mark name tag;
   - downed captains show as a ghost ship with a revive-progress ring and a clear "fly here to
     revive" cue;
   - edge indicators (arrow + mark) for captains outside the view;
   - a last-stand cue for the final standing captain.
5. **HUD:** a co-op HUD per coop.md §7: per-pilot HP/shield/dash panels in pilot colours with marks
   and the downed state, plus the shared XP/level/score/timer/combo. It must fit 1280×720, 1920×1080
   and narrow/mobile screens. **The solo HUD must look exactly as today.**
6. **Replace `App.coopToasts`** with in-world callouts and HUD cues. Keep a DOM toast only where text
   is clearly better: the controller-disconnect toast and the squad-launch tip stay.
7. **Migrate `renderer.ts` and `hud.ts` off the P1 aliases** (`world.player/stats/build/rerolls/
   pendingCaches` → `world.players[pid]`, and pass the pid to pid-taking APIs). Remove both from
   `PENDING_MIGRATION`, so the guard then enforces them.
8. **Comms panel fade** (`src/ui/comms.ts`):
   - while any enemy, enemy bullet, boss or player ship is under the panel's screen rect, fade the
     panel to about 25–35 % opacity (use **0.3**) with a short CSS transition, and restore it when
     the area is clear;
   - **never hide it fully**;
   - cache the panel rect (refresh on resize and show), and test a few times per second, not every
     frame;
   - solo and co-op, mobile too.
9. **Accessibility:** reduced flashing (`Settings.flashes`) and screen shake 0 are respected by
   everything new. Mobile (Pixel 7) keeps working.
10. `AGENTS.md` hard rules apply: strict TypeScript, `npm run build:single`, never skip or loosen a
    test, original IP, code idiomatic to the surrounding files, update `docs/GAME_DESIGN.md`.
11. `e2e/coop.spec.ts` must pass. Its two toast assertions change because decision 6 legitimately
    changes that behaviour (§8).

**Spec decisions** (made here where the sources are silent or disagree; keep them unless the owner
says otherwise, and list them in the PR description):

- **S1.** `worldToScreen` maps through the **steady** camera (no shake). Drawing adds the shake
  offset, a pure translation, through the same `view()`. Mouse steering and DOM placement must not
  wobble. Solo mouse steering then stays exactly as today, because today's fallback ignores shake.
- **S2.** The renderer applies `world.zoom` **exactly** (`camZoom = world.zoom` in co-op), with no
  extra smoothing. The sim already damps it (out at rate 4, in at 1.2). The renderer has no
  interpolation between ticks, so positions step per tick as well. A lagging render zoom would also
  break the sim's "no pilot outside the view" guarantee (§5.2 `zNeed`).
- **S3.** Ships, name tags and damage numbers are drawn at `pilotScale = √camZoom` (coop.md §3, "Ships
  and tags are drawn at `mul = Math.sqrt(world.zoom)`"), so they stay readable when zoomed out.
  Revive circles and magnet hints keep their true world radius.
- **S4.** The low-HP red screen edge is **solo-only** (coop.md §3, renderer L576–584). In co-op, HP
  lives in the pilot's panel and the mini arc under their ship. This replaces 3c's interim rule (the
  most endangered pilot drives the edge).
- **S5.** Copy follows the shipped UI, which says "captain" (lobby, results, toasts), not coop.md's
  "pilot": `LAST CAPTAIN STANDING`.

## 5. Implementation plan

**Step 0. Baseline (commit the guard first).**
- Create `tests/hud.test.ts` (to be created) with the solo-HUD call-log guard (§8, test 1). Capture
  its file snapshot **from the unmodified `hud.ts`** and commit it on its own ("Add a call-log guard
  for the solo HUD"). From then on the snapshot file must never change.
- Record a perf baseline on this base build with the scenarios in §9 (renderer `consume` + `draw` JS
  mean/p95), and take before-shots of the solo HUD (title → run, 1280×720 and Pixel 7).

**Step 1. Camera math module.** Create `src/render/camera.ts` (to be created). It must be pure: no
DOM, and only a type import of `World`, so it is unit-testable in Node.
- `export interface View { k: number; ox: number; oy: number }`: device px per world unit, and the
  offset of the world origin.
- `export function viewOf(camX, camY, zoom, scale, dpr, tw, th, s, shakeX, shakeY): View`.
  - `k = scale·dpr·s / zoom`;
  - `ox = tw/2 − camX·k + shakeX·dpr·s`;
  - `oy = th/2 − camY·k + shakeY·dpr·s`;
  - `scale` is the renderer's CSS px per world unit, `s` its world render scale (3c), and shake is
    in CSS px.
  - At `zoom = 1, s = 1` this is exactly today's transform.
- `export function followCamera(cam: { camX: number; camY: number }, world: World, rdt: number, halfW: number, halfH: number, bottomPad: number): void`
  moves the camera one frame (the renderer passes itself; `camX`/`camY` stay its public fields, which
  3d's `grid.update` reads). `halfW/halfH` are the steady visible half extents in world units.
  - **Solo** (`!world.coop`): today's code verbatim, with `p = world.players[0]`:
    `tx = p.x + p.vx·0.12`, `ty = p.y + p.vy·0.12`, `cd = damp(7, rdt)`, `camX += (tx − camX)·cd`
    (same for y).
  - **Co-op** (§5.4):
    1. `c = teamCenter()`, `v = teamVelocity()` (copy the scalars).
    2. `tx = c.x + v.x·0.08`, `camX += (tx − camX)·damp(10, rdt)` (same for y).
    3. Clamp on each axis so every present pilot (`p.alive`, ghosts included) stays ≥ `CAM_INSET =
       30` world units inside: `camX = clamp(camX, maxX − (halfW − 30), minX + (halfW − 30))`.
    4. On y, the bottom margin is `30 + bottomPad`, so a pilot is not hidden under the HUD panel band.
    5. If that interval is inverted, retry with 30. If it is still inverted, use the bounding-box
       centre on that axis.
  - Loop `world.players` directly. Do not call `presentPlayers()`/`alivePlayers()`, which allocate.
- Export the constants `CAM_INSET = 30` and the solo/co-op look-ahead and damping values, named.

**Step 2. Renderer camera and the one transform** (`src/render/renderer.ts`).
- Imports: `viewOf`, `followCamera` from `./camera`; `ZOOM_MAX`, `PLAYER_COLORS`, `PLAYER_MARKS`,
  `REVIVE_RADIUS` from `../game/content/coop`.
- `reset(world)`: `const c = world.teamCenter(); this.camX = c.x; this.camY = c.y;` and
  `this.camZoom = world.coop ? clamp(world.zoom, 1, ZOOM_MAX) : 1`. Also reset the overlay state
  (step 5) and `hud.hpFlash` (step 6).
- `draw()`, replacing the camera block:
  - `this.camZoom = world.coop ? clamp(world.zoom, 1, ZOOM_MAX) : 1;`
  - `followCamera(this, world, rdt, this.cssW / 2 / this.scale * this.camZoom, this.cssH / 2 / this.scale * this.camZoom, pad)`,
    where `pad = !opts.attract && world.coop ? coopHudBand(this.ui) * this.camZoom / (this.scale * this.dpr) : 0`.
    `coopHudBand` (to be created) comes from step 6 and is in device px.
  - Do this before `view()` is computed.
- `view(tw, th, s)` (3c's private helper) becomes a thin wrapper:
  `viewOf(this.camX, this.camY, this.camZoom, this.scale, this.dpr, tw, th, s, this.shake.x, this.shake.y)`.
  Every world-space draw, the culling extents (`halfW = tw/2/k + 80` as today), `fx.begin(...)`
  (3b), `postfx.setView(k, ox, oy)` (3c), the grid (3d) and the overlay all use this one result.
- **Backdrop camera:** pass `bg.draw` the world transform's own centre, `bgCamX = (tw/2 − ox)/k`,
  `bgCamY = (th/2 − oy)/k`, as 3d already does for the grid. Today's `camX − shake.x / scale` is
  only right at zoom 1.
- `texts.draw(hud, Math.sqrt(this.camZoom))` instead of `texts.draw(hud, 1)` (S3).
- Low-HP screen edge (S4): compute 3c's `lowHp` from `world.players[0]` only when `!world.coop`, and
  0 in co-op (solo value and look unchanged).
- `this.fx.pilotScale = Math.sqrt(this.camZoom)` before `fx.drawPlayers(...)` (step 5a).
- **Public API** (to be created; it is the spec's interface for the app and comms):
  - `worldToScreen(x: number, y: number): [number, number]`: CSS px relative to the canvas
    (= viewport; `#game` is `position: fixed; inset: 0`). It is
    `viewOf(camX, camY, camZoom, scale, dpr, this.w, this.h, 1, 0, 0)` applied to `(x, y)`, then
    divided by `dpr`: the steady camera of the last `draw()` (S1).
  - `screenToWorld(cssX: number, cssY: number): [number, number]`: its exact inverse.
  - `get viewZoom(): number`: the zoom the view applies (`camZoom`), for tests and debugging.
- Leave `resize()`'s returned half extents alone (`cssW / 2 / scale`): `App.onResize` writes them
  into `world.viewHalfW/H`, which the sim's zoom and leash rely on.
- Never pass a zoom-dependent value to `sprites.setResolution` or `fx.setResolution` (3b §10).

**Step 3. App wiring** (`src/app.ts`).
- Delete the `Projecting` interface and the duck-typed fallback. Rewrite `screenPos(p)` as
  `const [x, y] = this.renderer.worldToScreen(p.x, p.y); return [x * this.renderer.dpr, y * this.renderer.dpr];`.
  `Input.read`/`readSlot` compare against `devicePos` (CSS px × dpr).

**Step 4. `consume()` migration and co-op cues.** Add a local
`const at = (pid: number) => world.players[pid] ?? world.players[0]!` and
`const coop = world.coop`. Solo must produce exactly today's feedback.

| Event | Change |
|---|---|
| `pickup` heart / core / cache | At `at(ev.pid)`. Co-op `cache` sub: `` `P${pid + 1} · Bonus upgrade` `` (solo `'Bonus upgrade'`). |
| `levelup` | Solo: ring at `players[0]` as today. Co-op: a ring on every present pilot (`p.alive`). |
| `dashready`, `heal` | At `at(ev.pid)`. |
| `milestone`, `magnet`, `newbest`, `victory` | At `world.teamCenter()` (copy x/y; solo returns the player's position). |
| `hurt` | Co-op: `addFlash('#ff2d55', 0.2)` (solo 0.35, unchanged); `hud.hpFlash[ev.pid] = 1`. |
| `shieldbreak`, `revive` | Co-op only: sub gets a `` `P${pid + 1} · ` `` prefix. |
| `downed` (new case) | `P.burst(ev.x, ev.y, DOWNED_ACCENT, 40, 260, 0.8, 3)`; `shake.add(0.4)`; callout `` `${mark} P${n} DOWN` `` in the pilot colour, size 0.9, sub `` `Fly over P${n} to revive` ``, life 2.0. |
| `revived` (new) | `P.ring(ev.x, ev.y, 34, color, 30)`; callout `` `${mark} P${n} BACK IN THE FIGHT` ``, size 0.8, sub `` `Revived by P${by + 1}` ``, life 1.6. |
| `laststand` (new) | Callout `'LAST CAPTAIN STANDING'`, `'#ff6b8a'`, size 0.9, sub `` `${mark} P${n} · revive your squad` ``, life 2.2. |

- `mark = PLAYER_MARKS[pid % 4]`, `color = PLAYER_COLORS[pid % 4]`, `n = pid + 1`.
- Every case keeps 3b's `fx.onEvent`, 3c's waves and 3d's `gridEvent` calls as they are.
- In a 2P game, `downed` and `laststand` arrive in the same tick. `Callouts.add` stacks them in two
  slots, which is intended.

**Step 5. Pilots.**
- **5a. Vessel scale** (`src/render/entityfx.ts`, 3b's file): add `pilotScale = 1` (to be created).
  In `drawPlayers`, draw each pilot through a view scaled about that pilot (`ps = pilotScale`):
  `k' = k·ps`, `ox' = ox + p.x·k·(1 − ps)`, `oy'` likewise. Use one reused scratch view object,
  and restore `this.v` afterwards. At `ps = 1` nothing changes. The ghost hull (`DOWNED_ACCENT`, alpha 0.35) stays
  3b's; do not draw a second one.
- **5b. Magnet hint** (world space, where today's P1 hint is, after `fx.drawPlayers`):
  - solo: today's code with `p = world.players[0]` and `p.stats.magnet`;
  - co-op: the same faint circle for every up pilot (`world.isUp(p)`) at `p.stats.magnet`.
- **5c. Overlay** (new module `src/render/pilots.ts`, to be created; class `PilotOverlay`, plus pure
  helpers). Draw it on `this.hudCtx` in device px after the damage numbers and before `drawHud`, and
  only when `!opts.attract && world.coop`. It is crisp, never bloomed (3c). The renderer passes it
  the shaken overlay view `this.view(this.w, this.h, 1)`; project each pilot with that `View` inline
  (no tuple allocations). Draw a mark with
  `drawPilotMark(ctx, pid, x, y, r, color)` (to be created): a vector ▲ ● ■ ◆ path, not a font
  glyph. Below, `ps = √camZoom` (S3) and `k` is the overlay view's scale. Elements:
  1. **Name tag**, above every present pilot at screen y − `(p.r + 16)·ps·k`:
     - mark (radius 4.5·ui) plus `P#` in `800 ${10·ui}px FONT_DISPLAY`, in the pilot colour;
     - an outline pass first (`strokeText`, `rgba(5,4,15,0.85)`, `lineWidth 3·ui`), no `shadowBlur`;
     - ghosts at alpha 0.6.
  2. **Mini HP arc** under up pilots below max HP:
     - a 120° arc centred under the ship at radius `(p.r + 7)·ps·k`;
     - track at 0.15 alpha;
     - fill proportional to `p.hp / p.stats.maxHp`, `PAL.hp` (`PAL.danger` below 30 %), `lineWidth 2.5·ui`.
  3. **Ghost revive ring** for every downed pilot:
     - a dashed circle at the **true** revive radius `REVIVE_RADIUS·k`, in the pilot colour at alpha
       0.4, `lineWidth 1.5·ui`, dash `[6·ui, 5·ui]`;
     - the dash rotates with `lineDashOffset = −time·20·ui`, static with reduced flashing;
     - a progress arc on the same radius, `lineWidth 3·ui`, from −π/2 clockwise by
       `2π·clamp(p.reviveT / world.reviveNeed(p), 0, 1)`;
     - a label 12·ui under the circle: `REVIVING nn%` while `reviveT` rose since last frame (keep the
       last value per pid), otherwise `FLY HERE TO REVIVE`, in `700 ${11·ui}px FONT_MONO`, pilot
       colour, outlined.
  4. **Last stand:** while `world.coop`, exactly one pilot is up and at least one alive pilot is
     downed:
     - a ring around the up pilot at `(p.r + 18)·ps·k`, `'#ff6b8a'`, `lineWidth 2·ui`;
     - alpha `0.35 + 0.25·sin(time·5)`, steady 0.45 with reduced flashing.
  5. **Leash glow** (coop.md §5.3/§7):
     - `leashEdges(world, p)` (to be created, pure) returns a bitmask of the sides on which `p` sits
       at the leash limit: others' bbox from `world.players` (alive, not `p`);
       `lo = oMaxX − maxSpan().x`, `hi = oMinX + maxSpan().x`; pinned if within 0.5 units; same on y.
     - For each pinned side, a 24·ui gradient strip on that screen edge in the pilot colour, alpha
       `0.24 + 0.06·sin(time·4)`, steady 0.22 with reduced flashing.
  6. **Edge indicator:**
     - `edgeIndicator(sx, sy, w, h, inset)` (to be created, pure) returns `null` when the point is
       inside the canvas inset by `inset = 10·ui`. Otherwise it returns the clamped point and the
       angle toward the pilot.
     - Draw a 12·ui chevron in the pilot colour plus the mark; ghosts at 0.6 alpha.
     - With the sim's zoom guarantee and the camera clamp this rarely fires (resize frames, extreme
       aspect ratios). It is the safety net.

**Step 6. HUD** (`src/render/hud.ts`).
- `HudState.hpFlash` becomes `number[]` (length `MAX_PLAYERS`); solo reads `[0]`. Migrate its three
  call sites in `renderer.ts`: the constructor, the `hurt` case, and the decay in `draw()`, which
  decays every entry.
- Keep `drawHud(ctx, world, w, h, ui, st)` as the only export the renderer calls. It dispatches
  `world.coop ? drawCoopHud(...) : drawSoloHud(...)` (both to be created, module-private).
- Split today's body into private pieces **in today's call order**, so canvas state (`textAlign`,
  `textBaseline`, `font`) carries over between pieces exactly as before:
  - `xpBar` (XP bar + flash);
  - `soloStatus` (LV, HP, dash, shield, build);
  - `topCentre` (timer, boss, next boss);
  - `topRight` (score, best, combo, combo break, overdrive);
  - `touchControls`;
  - `fpsLine` (incl. 3c's `fxLabel`).
- `drawSoloHud` = `xpBar → soloStatus → topCentre → topRight → touchControls → fpsLine`.
- Inside, `p = world.players[0]!`, `stats = p.stats`, `p.build`, `world.hasRelic('shield', p.pid)`,
  and the combo bar uses `world.comboWindow()` (identical in solo).
- `drawCoopHud` = `xpBar → coopTopLeft → topCentre → topRight → coopPanels → fpsLine`.
  - `coopTopLeft`: `LV n` exactly like solo, then `${n} CAPTAINS` (`600 ${10·ui}px FONT_MONO`,
    `PAL.textDim`) to its right.
  - The FPS line sits 8·ui above the panel row.
  - No touch block (the app already sets `hud.touch = false` in co-op).
- `export function coopPanelLayout(n, w, h, ui): { x: number; y: number; w: number; h: number; mode: 'full' | 'mid' | 'compact' }[]`
  (to be created, pure), per coop.md §7:
  - `m = 16ui`, `gap = 12ui`, `ph = 76ui`, `pw = min(250ui, (w − 2m − (n−1)·gap)/n)`, `y = h − m − ph`;
  - N = 2: the two corners; N = 3: left, centred, right; N = 4: four columns from `x = m`;
  - `mode`: `full` if `pw ≥ 180ui`, `mid` if `pw ≥ 120ui`, else `compact`.
  - `export function coopHudBand(ui: number): number` returns `m + ph` = 92·ui in device px (used
    by step 2; `noUnusedParameters` is on, so take only `ui`).
- Panel contents, per pilot:

| Row | `full` | `mid` | `compact` |
|---|---|---|---|
| Header | mark + `P#` (`800 12ui` display, pilot colour); ship name `SHIPS[ship].name` upper-case, dim, truncated with `…` via `measureText`; `◆n` gold if `p.pendingCaches > 0` | no ship name | no ship name |
| HP | bar `(pw − 16ui) × 10ui`, `PAL.hp`/`PAL.danger` < 30 %, text `ceil(hp)/max`; white flash `hpFlash[pid]` (×0.35 with reduced flashing) | same | text `ceil(hp)` only |
| Dash/shield | dash pips (7ui diamonds, solo style); `⬡` / `⬡ 12s` if `world.hasRelic('shield', pid)` | same | pips only |
| Build | weapons 18ui boxes with 2ui level pips, passives 13ui, relics `◆n` | weapons only | none |

- Panel look: background `rgba(10,8,30,0.62)`; border `1.5ui` in the pilot colour at 0.5 alpha;
  no `shadowBlur`.
- **Downed:** the panel at 0.5 alpha. The header adds `DOWN` (`'#ff6b8a'`). The HP row becomes a
  revive bar in the pilot colour (`reviveT / reviveNeed(p)`) with `REVIVING · 1.4s` (time left)
  or `GET CLOSE · 2.5s`.
- **Last stand:** the up pilot's border becomes `'#ff6b8a'`, pulsing; steady with reduced flashing.
- **Pilot under a panel:** draw that panel at 0.45 alpha when any present pilot's screen position
  is inside its rect grown by 12·ui. That is at most 4×4 rect tests.

**Step 7. Replace `App.coopToasts`.**
- Delete `coopToasts` and its call. Add `private announceCoop(events)` (to be created). For each
  `downed`, `revived` or `laststand` it calls `this.ui.announce(text)` with today's wording:
  - `'P2 is down. Fly over P2 to revive.'`
  - `'P2 is back in the fight, thanks to P1.'`
  - `'Last captain standing: P1.'`
  The visible cues now come from the renderer (step 4) and the HUD.
- `UI.announce(text: string)` (to be created, `src/ui/ui.ts`): appends a `<p>` to a screen-reader
  live region created in the `UI` constructor, `<div id="sr-announce" class="sr-only" role="status"
  aria-live="polite">`, and keeps the last 4 children. `#toasts` was the `aria-live` region these
  lines went to, so this keeps screen-reader parity. Appending (not replacing) matters because 2P
  `downed` + `laststand` arrive together.
- Keep the toasts for the controller disconnect (`onSlotLost`), the squad-launch tip in `startRun`,
  missions, achievements and the break reminder.
- **Bottom band in co-op:** `startRun` adds the class `coop-run` (to be created) to `document.body`
  for a squad. `endRun` and `toTitle` remove it.
  - In `src/ui/style.css`, `body.coop-run` raises `#toasts` (all orientations), and `.comms` and
    `body.comms-on #toasts` (landscape only), by `100 * var(--u)`. That is the panel band
    (16 + 76 HUD units) plus a gap. `--u` is the CSS twin of the canvas `ui` factor.
  - Scope the `.comms` rule to `@media (orientation: landscape)`: the portrait rule docks the panel
    at the top with `bottom: auto`, and a higher-specificity `bottom` would stretch it.

**Step 8. P1-alias migration.** Set `PENDING_MIGRATION` to an empty `new Set<string>()` and update its
comment ("Empty since the co-op rendering pass; keep the mechanism for future migrations"). Run
`npx vitest run tests/no-p1-alias.test.ts` and fix every reported line in `renderer.ts`/`hud.ts`. The
known ones are `reset`, the `consume` cases of step 4, the camera block, the magnet hint, and in
`hud.ts`: `world.player`, `world.stats`, `world.build`, `world.hasRelic('shield')`. Do not weaken
the regex or the `PID_METHODS` table.

**Step 9. Comms panel fade** (`src/ui/comms.ts`, `src/ui/style.css`, `src/app.ts`).
- Pure helpers in `comms.ts` (to be created; `World` as a type import only):
  - `export function gameplayUnder(world: Pick<World, 'enemies' | 'bullets' | 'players'>, minX, minY, maxX, maxY): boolean`.
    True if any non-dead enemy (bosses are in `world.enemies`), non-dead enemy bullet, or alive
    player (ghosts included) overlaps the world box by its radius (`x + r > minX && x − r < maxX && …`).
    Pickups and the player's own projectiles do not count. Early exit; no allocation.
  - `export class FadeGate { under: boolean; update(dt: number, probe: () => boolean): boolean; reset(): void }`.
    - It calls `probe` at most every **0.125 s** of real time, and at once after `reset()`.
    - `under` turns on at the first positive probe and turns off once **0.4 s** have passed without
      one (hysteresis, no flicker).
    - `update` returns true when `under` changed.
- `CommsPanel` additions:
  - `private gate = new FadeGate()`; `private rect: DOMRect | null = null`.
  - `mount`, `resume` and `clear` set `rect = null` and call `gate.reset()`. A `resize` and
    `orientationchange` listener (registered once in the constructor) and an `animationend` listener
    on `root` also set `rect = null`; the entrance animation moves the panel up to 12 px.
  - `updateFade(realDt: number, probe: (r: DOMRect) => boolean): void` (to be created):
    - when nothing is shown (`shownId === null`), it removes `under` and returns;
    - otherwise it reads `rect ??= root.getBoundingClientRect()` lazily, inflated by 6 CSS px. The
      read happens only when the rect is dirty, never per frame;
    - it runs the gate with `() => probe(rect)` and toggles the `under` class on `root` when the gate
      changes.
- `App.stepGame`, right after `this.presentComms()`: `this.comms.updateFade(realDt, (r) => { … })`.
  The probe un-projects the rect's corners with `renderer.screenToWorld(r.left, r.top)` /
  `(r.right, r.bottom)` (the same view as everything else; one projection per check, not one per
  entity) and returns `gameplayUnder(w, …)`.
- CSS, next to the comms block:
  - `.comms { transition: filter 0.18s ease-out; }`;
  - `.comms.under { filter: opacity(0.3); }`;
  - under `@media (prefers-reduced-motion: reduce)`: `transition: none`.
  - Use `filter: opacity()`, **not** `opacity`: the `comms-in`/`comms-out`/`comms-fade` keyframes
    animate `opacity` and would override it.
  - Never `visibility`, `display` or `hidden` for this. `pointer-events: none` stays.

**Step 10. Docs.**
- `docs/GAME_DESIGN.md`:
  - §3.5: a "Screen" bullet: squad camera and zoom-out to 1.45×, marks and tags, ghost + revive
    ring, leash edge glow, edge arrows, last stand, bottom pilot panels;
  - §5.6, the comms-panel row: it dims to 30 % while gameplay is under it, never hides;
  - §7: rows "Captain down (co-op)", "Revived", "Last captain standing".
- `docs/HANDOFF.md`: mark 3e done, list the interfaces below and the spec decisions S1–S5.

**Interfaces this step exposes (task 4 and later work use them):**
- `renderer.worldToScreen(x, y)` (CSS px, steady camera), `renderer.screenToWorld(cssX, cssY)`,
  `renderer.viewZoom`.
- `viewOf`, `followCamera` and `CAM_INSET` (`src/render/camera.ts`).
- `coopPanelLayout`, `coopHudBand` (`hud.ts`).
- `PilotOverlay`, `drawPilotMark`, `leashEdges`, `edgeIndicator` (`pilots.ts`).
- `EntityFx.pilotScale`.
- `UI.announce`, `#sr-announce`, `body.coop-run`.
- `gameplayUnder`, `FadeGate`, `CommsPanel.updateFade`, `.comms.under`.

## 6. Settings and save data

No new settings and no save changes. Existing mappings used by this step:
- `Settings.flashes` → `renderer.settings.flashes`, which makes these steady: the revive-ring dash
  rotation, the last-stand halo and border pulse, and the leash glow pulse. It also caps the panel
  HP flash at 0.35.
- `Settings.shake` scales the `downed` 0.4 trauma through `Shake.update` (0 = none).
- `prefers-reduced-motion` (`prefersReducedMotion()` in `comms.ts`, and the CSS media query): the
  comms fade switches instantly.

## 7. Accessibility, mobile, co-op and performance requirements

- **Colour-blind safety:** every per-pilot cue carries the vector mark as well as the colour: tags,
  panels, edge arrows, and the text of the down, revive and last-stand callouts.
- **Reduced flashing / shake 0:** as in §6. Nothing new flashes faster than 3 Hz. No new
  full-screen flash; co-op `hurt` uses a smaller flash.
- **Screen readers:** `#sr-announce` replaces the toasts' announcements. The comms panel keeps its
  own live region.
- **Mobile:**
  - Co-op on a phone needs a gamepad or `?coop=N`.
  - The co-op HUD must fit Pixel 7 portrait (Playwright's `Pixel 7` viewport is 412×839 CSS, dpr
    capped at 2, so `w` = 824 device px and `ui` = 1.44: N = 4 → `mid` panels of ≈ 126ui) and
    landscape (839×412: `full`).
  - The solo HUD, touch controls and the comms fade work on both e2e projects.
- **Co-op layout targets:** 1280×720 and 1920×1080 at N = 2, 3, 4. No panel overlaps another, the
  comms panel or the toasts. Text never leaves its panel.
- **Performance** (JS, headless Chromium; report mean and p95 from the §9 harness):
  - co-op overlay (tags, arcs, rings, glows, arrows) for 4 pilots: ≤ 0.25 ms/frame mean at 1080p;
  - co-op HUD with 4 panels: ≤ 0.4 ms/frame mean;
  - solo HUD within ±0.05 ms of the baseline;
  - camera follow: ≤ 0.02 ms, zero allocations per frame;
  - comms occlusion probe: ≤ 0.05 ms per check at 600 enemies + 400 bullets, at most 8 checks/s,
    and no layout reads except after invalidation;
  - total renderer `consume` + `draw` at `?coop=4&autoplay` in a busy late-game fight: at most
    **+1.0 ms mean** over the Step 0 baseline;
  - avoid `shadowBlur` on anything new drawn per frame.

## 8. Tests to add or update

1. **`tests/hud.test.ts`** (to be created, Step 0). A recording `CanvasRenderingContext2D`, built as a
   `Proxy` that:
   - logs every method call and property set, with numbers rounded to 3 decimals;
   - stubs `measureText` as `{ width: chars × px × 0.6 }`;
   - logs gradients with their stops.
   - **Solo guard:** build solo worlds explicitly. Do not simulate, so balance changes cannot move
     the log. Use `new World(makeRunConfig({ seed: 11 }))`, then `w.addWeapon(id, 0)`, passives and
     relics on `players[0].build`, and fixed `hp`, `xp`, `score`, `time`, `combo`, `comboTimer`,
     `overdriveT`.
   - Cover four states: plain; touch with an active stick; low HP + `hpFlash` + shield relic +
     combo break + overdrive + a boss (`w.boss` set to an enemy object with `kind: 'warden'`) +
     beating the best; and Show FPS.
   - `await expect(log).toMatchFileSnapshot('./__snapshots__/hud.solo.log')`. Captured once from
     the unmodified `hud.ts` and committed. **Never re-record it** (`-u`) to pass. CI does not
     write snapshots.
   - **Co-op:** `coopPanelLayout` for N = 2/3/4 at (1280, 720, 0.947), (1920, 1080, 1.35),
     (824, 1678, 1.44) (Pixel 7 portrait), (1678, 824, 1.44) and (720, 1480, 1.44):
     - inside `[0, w]`, no overlaps;
     - N = 2 in the corners, N = 3 middle centred within 1 px;
     - modes as computed in §7.
   - `drawHud` on a 4-pilot world (one downed, one with the shield relic, one pending cache) at each
     size: no throw; every `fillRect`/`strokeRect` inside the canvas; every `fillText` anchor inside
     its panel or the top strip.
2. **`tests/camera.test.ts`** (to be created):
   - `viewOf` at zoom 1, s 1 equals today's formula;
   - CSS project/unproject round trip at zoom 1.45 and s 0.75 (error < 1e-9);
   - `followCamera` solo equals the old inline code for 30 frames of varying `rdt` (exact `===`);
   - co-op: it converges to `teamCenter + 0.08·teamVelocity`;
   - with pilots at the leash corners and the camera started 2000 units away, one frame at
     `rdt = 0` puts every present pilot ≥ 30 units inside;
   - the inverted interval falls back to the bbox centre; `bottomPad` applies when it fits;
   - the world is not mutated (JSON of `players` and `zoom` before = after).
3. **`tests/pilots.test.ts`** (to be created):
   - `leashEdges`: pilots placed at `maxSpan()` apart → the left one is pinned left and the right
     one pinned right; at half span → 0;
   - `edgeIndicator`: inside → null; each side and each corner → a clamped point and the right angle.
4. **`tests/comms.test.ts`** (to be created; pure parts only, Node has no DOM):
   - `gameplayUnder`: an enemy, a bullet, a player and a downed ghost each count; dead ones,
     pickups and projectiles do not; a radius overlap at the edge counts;
   - `FadeGate`: probe throttling (≤ ⌈T/0.125⌉ + 1 calls over T), turns on at once, holds 0.4 s,
     `reset()` re-probes at once.
5. **`tests/no-p1-alias.test.ts`:** only `PENDING_MIGRATION` (now empty) and its comment change.
6. **`e2e/coop.spec.ts`** ("two keyboard pilots join…"): replace
   `expect(page.locator('#toasts')).toContainText('P2 is down')` with:
   - `#sr-announce` toContainText `'P2 is down'`;
   - a poll of `shardstorm.renderer.callouts.items.map(c => c.text)` containing `'● P2 DOWN'`;
   - `#toasts` not.toContainText `'is down'`.
   For the revive, use `#sr-announce` `'P2 is back in the fight'`. Nothing else in the spec changes.
7. **`e2e/coop-render.spec.ts`** (to be created; desktop project only, like `coop.spec.ts`; reuse
   its `SEED_SAVE`/`onWorld` pattern):
   1. `?coop=4&autoplay`: set every pilot's `invuln = 1e9`, then pin the pilots to the four corners
      of the `maxSpan()` box every rAF for 2 s.
      - Expect `world.zoom > 1.35` and `renderer.viewZoom` equal to `world.zoom` within 1e-9
        (`page.evaluate` runs between frames, after the frame's update and draw).
      - Every pilot's `worldToScreen` lies within the viewport, at least `30·scale/zoom` CSS px
        from the edges.
      - The `screenToWorld(worldToScreen(p))` round trip is within 0.01.
   2. `?coop=4` (P1/P2 idle keyboards, P3/P4 bots; all `invuln = 1e9` first). Down P2 with the hurt
      recipe from `coop.spec.ts`: callout `'● P2 DOWN'`, `#sr-announce` `'P2 is down'`, no last-stand
      callout (three are still up). Down P3 and P4 → `'LAST CAPTAIN STANDING'`. Pin P1 10 units from
      P2 every rAF → `'● P2 BACK IN THE FIGHT'` within 4 s. No console errors.
   3. Under `test.use({ deviceScaleFactor: 2 })`: `?coop=2`. Press the mouse 200 CSS px to the
      right of P1's `worldToScreen` and hold it for 0.6 s → P1.x grows by more than 40 and P2 does
      not move. At dpr 1 a CSS/device mix-up in `screenPos` would go unnoticed.
   4. `?autoplay` solo: `world.coop === false`, `viewZoom === 1`, and P1 projects within 25 % of the
      viewport centre.
8. **`e2e/story.spec.ts`**, new test "the comms panel fades while gameplay is under it, and never
   hides" (both projects):
   - Start a run as "a comms line appears…" does, and set the pilot's `invuln = 1e9`.
   - Every rAF, re-pin a spawned `drifter` (`w.spawnEnemy`, `hp = maxHp = 1e9`) to
     `screenToWorld` of the `#comms` rect centre.
   - Expect the class `under` within 1.5 s, a computed `filter` containing `opacity(0.3`, and
     `toBeVisible()`.
   - Then stop pinning and clear `w.enemies.length = 0; w.bullets.length = 0` every rAF → `under`
     gone within 2 s.
9. **Must not change:**
   - `tests/golden.solo.test.ts`;
   - `tests/determinism.guard.test.ts` (never import `src/render/*` or `src/ui/*` from `src/game/*`);
   - `e2e/smoke.spec.ts`;
   - the rest of `e2e/coop.spec.ts` and `e2e/story.spec.ts`;
   - anything under `src/game/`; the save format.

## 9. Acceptance checklist

- `npm run typecheck`, `npm test`, `npm run build` and `npm run build:single`. Then open
  `dist-single/shardstorm.html` from `file://` with `?coop=2&autoplay`: tags, panels, no console
  errors. `E2E_PORT=<free port> npm run e2e` (desktop and mobile green). `xvfb-run -a npm run
  desktop:smoke` if Electron is installed.
- `git diff --stat <merge-base>..HEAD -- src/game tests/golden.solo.test.ts` is empty.
  `tests/__snapshots__/hud.solo.log` is unchanged since its own commit.
- `grep -n PENDING_MIGRATION tests/no-p1-alias.test.ts` shows an empty set.
- **Screenshots**, outside the repo:
  - Build with `npx vite build --outDir <scratch>/dist`. Serve with
    `npx vite preview --outDir <scratch>/dist --port <port> --strictPort` in the background, and
    kill only that process.
  - Drive with `import { chromium } from '<repo>/node_modules/playwright/index.mjs'`.
  - Look at every shot and iterate.
  1. `?coop=2&autoplay` and `?coop=4&autoplay` early: four tinted ships, tags and marks, bottom
     panels.
  2. `?coop=4&autoplay` spread to the leash corners (recipe of e2e 7.1) at `ZOOM_MAX`:
     - the galaxy fills the screen, the grid is under the sprites;
     - a bomb (`w.bomb(0)`) shockwave sits on its blast;
     - particles and damage numbers line up;
     - also with `?fx=0` (2D path).
  3. A downed pilot: the ring at 0 %, mid-revive (move P1 within 40 units), the revived callout.
  4. Last stand: 2P (down P2), and 4P with three down.
  5. Leash glow: `?coop=2`, hold `KeyD` and `ArrowLeft` until pinned.
  6. The co-op HUD at 1280×720, 1920×1080, Pixel 7 portrait and landscape (`?coop=4`), with one
     downed panel.
  7. The solo HUD before/after at the same state (Step 0 shots).
  8. The comms panel dimmed over enemies (solo desktop, Pixel 7 portrait) and raised above the
     co-op panels.
  9. Reduced flashing + shake 0 (seed `settings: { flashes: false, shake: 0 }`) for 3–4.
  - The off-screen arrow only if you can produce it without adding debug code. Its logic is
    unit-tested.
- **Performance** (§7 budgets):
  - A Playwright scratch script wraps `app.renderer.consume`/`draw`, `PilotOverlay.draw` and
    `comms.updateFade` with `performance.now()` accumulators over 600 frames at 1920×1080.
  - Scenarios: solo `?autoplay&warp=240`, and `?coop=4&autoplay&warp=240` with every pilot set
    invulnerable right after load (retry if the squad wiped during the warp).
  - Run the same script on the Step 0 baseline build and report both.
  - Headless raster is software; report JS-side numbers.

## 10. Pitfalls and known issues

- **CSS vs device px.** `Input` steers in device px. The old `Projecting` shim would silently accept
  a CSS-px `worldToScreen` and steer the mouse wrong by the dpr factor on HiDPI screens. Delete the
  shim and convert in `screenPos`. e2e 7.3 uses dpr 2 for this reason.
- **The backdrop shake offset** `camX − shake.x / scale` is wrong once zoomed: the galaxy would
  wobble against the sprites. Derive the backdrop camera from the view (step 2).
- **Scratch objects:** `teamCenter()`, `teamVelocity()` and `maxSpan()` return reused objects. Copy
  the scalars and never keep the reference across a sim update. `presentPlayers()` and
  `alivePlayers()` allocate: do not call them per frame.
- **The sim's zoom maths assumes** that the visible half extents are `viewHalfW·zoom`. Keep
  `resize()`'s return independent of zoom and of 3c's `worldScale`, and pass the steady extents to
  `followCamera`.
- **The HUD band vs the leash:** at 1280×720 (scale ≈ 1.055 CSS px/unit, `ui` ≈ 0.947) and full
  zoom-out, the 92ui panel band is about 120 world units tall. The view is about 990 units high and
  the leash allows a span of about 850, so there are only about 140 units of vertical slack, while
  30 + 30 + 120 are needed. With the squad fully spread vertically the bottom margin cannot fit.
  That is why the camera falls back to the symmetric margin and the panels go translucent over a
  pilot.
- **Canvas state carries across the split HUD pieces** (`textAlign`/`textBaseline` set by one piece
  are used by the next). Keep the call order. The snapshot test catches drift.
- **The `no-p1-alias` regex** also matches any local named `w` or `world` followed by `.player`,
  `.stats` or `.build`, and `this.stats`. The pid checker flags `world.hasRelic('shield')`.
- **Comms CSS:**
  - the keyframes animate `opacity`, hence `filter: opacity()`;
  - `translate: -50% 0` makes `offsetLeft` wrong, hence `getBoundingClientRect`;
  - the portrait top-dock uses `bottom: auto`, hence the landscape-scoped `coop-run` rule.
- **Callouts dedupe by identical text and stack by slot.** Different pilots get different texts by
  design. The canvas fonts may lack ▲●■◆: callouts use the glyph inside text (fallback fonts render
  it), while everything else uses the vector `drawPilotMark`.
- **Do not double-draw the ghost:** 3b already draws the downed hull. 3e adds only the ring, tag and
  label.
- **Sprite resolution:** never tie `setResolution` to the zoom. `pilotScale` changes the transform,
  not the bake.
- **The attract and results screens** draw a solo world: `camZoom` returns to 1 by itself. The HUD
  and overlay are skipped in attract.
- **Bots in `?coop=N`:** with `?autoplay` every pilot is a bot. Without it, P1/P2 are the idle
  keyboards: set `invuln` when staging shots.

## 11. Out of scope

- Audio cues for `downed`/`revived`/`laststand` (coop.md §3 `audio.ts` entry). Nothing plays them
  today. Suggest a follow-up.
- A co-op attract mode (coop.md's optional 2P demo); `App.newAttractWorld` stays solo.
- Tinting blades or projectiles per pilot; parallel level-up picks.
- Any sim change (zoom, leash, revive rules) and co-op balance (HANDOFF task 4).
- Comms panel copy, or adding marks to the DOM `comms-tag`.
- Steam store assets, README.
