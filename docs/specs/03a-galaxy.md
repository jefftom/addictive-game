# Galaxy sector backdrops (finish integration)

Task 3a of `docs/HANDOFF.md` (first step of the graphics chain 3a → 3e; every step edits
`src/render/renderer.ts`, so they land in order). Most of the code already exists on
`wip/wave3-gfx`. This task is mostly: merge it, fix the gaps listed in §2, add the missing tests,
verify, and document. Do **not** re-port the prototype from scratch.

## 1. Goal

Each of the four sectors of a run has its own painted, procedural galaxy backdrop instead of the
old generic violet clouds:
1. **The Turquoise Whorl**: teal spiral galaxy, slate-blue/teal gas.
2. **The Garnet Nebula**: ringed gas giant, ember and crimson gas.
3. **The Amethyst Abyss**: black hole, indigo and violet gas.
4. **The Gilded Throne**: spinning vortex, bronze and gold gas.

The colours are rich, but the backdrop stays darker than every gameplay sprite, so a 300-enemy
fight reads as well as before. When a capital ship falls (or the next one is about to arrive, or
10:00 is about to be reached), the backdrop plays a ~2.2 s hyperspace warp: the old sector zooms
and darkens, star streaks fly in the new sector's tint, a punch, and the new sector settles in.
The warp comes with an audio riser and a boom, and a short sector title card ("SECTOR TWO / THE
GARNET NEBULA / past the First Gate"). The title screen shows sector 1 behind the menu. The
simulation is untouched: same runs, same golden master.

## 2. Starting point

- **Merge target:** the PR branch `claude/dazzling-faraday-2kxdhl`, after tasks 1 (`wip/fix-dmath`)
  and 2 (`wip/wave3-platform`) have been merged into it (HANDOFF order). If they have not landed
  yet you may still start from the PR head; the only overlap is described below.
- **Source:** `origin/wip/wave3-gfx` (`wave3/gfx` on the original machine). Head `df7a114`
  ("WIP (paused, unverified): galaxy sector backdrop integration"), one commit on `3d3e601`, which
  is already in the PR branch history.
- **How to get it:** `git fetch origin wip/wave3-gfx`, then
  `git merge --no-ff origin/wip/wave3-gfx` (merge commit, no rebase, no force-push). If you cannot
  fetch other branches, ask the owner for `git bundle create gfx.bundle 3d3e601..origin/wip/wave3-gfx`
  (then `git bundle list-heads gfx.bundle` and `git fetch gfx.bundle <ref>:refs/heads/wave3-gfx`)
  or for `git format-patch 3d3e601..origin/wip/wave3-gfx`. Last resort: rebuild it from
  `prototypes/galaxy/galaxy.ts` with Appendix A.
- **Files on the branch** (`git diff --stat 3d3e601 origin/wip/wave3-gfx`): `src/render/galaxy.ts`
  (new, 2,828 lines), `src/render/galaxy.worker.ts` (new), `src/render/background.ts`,
  `src/render/renderer.ts`, `src/render/effects.ts`, `src/audio/audio.ts`, `src/app.ts`.
  Nothing under `src/game/`, `tests/` or `e2e/`.
- **Expected conflicts:** with task 2 merged, exactly one, in the `src/app.ts` import block. Keep
  the platform imports (`PlatformLink, type PresenceSnapshot` from `./platform/link`;
  `platform as currentPlatform, type Platform` from `./platform/platform`), add
  `import type { GalaxyEvent } from './render/galaxy';`, drop `import { detectBridge } ...`
  (unused after task 2; `noUnusedLocals` fails otherwise). Everything else auto-merges. No textual
  overlap with task 1 or with the PR head commits after `3d3e601`.

**State verified on 2026-10-11** (Linux x64, Node 22, a clean export of `df7a114`; headless
Chromium = SwiftShader software raster, so timings are pessimistic and JS+raster are both on the
CPU):
- `npx tsc --noEmit`: clean.
- `npx vitest run`: 290 tests, **289 pass, 1 fails**: `tests/no-p1-alias.test.ts` flags
  `src/render/galaxy.ts` `this.stats.set(...)` in `GalaxyBackdrop.onWorker` and `GalaxyBackdrop.step`
  (the guard's regex `\bthis\.(?:player|stats|build)\b` matches galaxy's own generation-timing
  Map). `tests/golden.solo.test.ts` passes unchanged.
- `npm run build:single`: works; `dist-single/shardstorm.html` 293,607 → 369,235 bytes (main JS
  gzip 84.3 → 114.9 KB; the worker is inlined as a string, so the galaxy code is in the bundle
  twice). Opened via `file://` in Chromium: the worker runs (`usesWorker === true`), sector 0 is
  ready ≈2.3 s after navigation at 1920×1080, no console errors.
- A forced warp (sim clock set to 2.5 s before the Hydra, probe only): `warp-spool` → `warp-tunnel`
  (+0.65 s) → `warp-punch` (+1.2 s) → `warp-done` (+2.2 s), the card shows, `world.sector` goes
  0 → 1 at 6:00 from the sim itself.
- Electron (`node scripts/desktop-smoke.mjs` under xvfb, base `desktop/main.cjs`): **FAILS**
  "no renderer console errors": *Creating a worker from 'blob:app://game/…' violates … "script-src
  'self'"* (CSP has no `worker-src`). Adding `"worker-src 'self' blob:"` to `CSP` made it pass.
- Not run: `npm run e2e`, listening tests of the audio, any screenshot set except the probes above.

**Requirement status on the branch:**

| Requirement | Status |
|---|---|
| `galaxy.ts` + inline worker + chunked fallback, `build:single` | Done and verified (`background.ts` `makeGalaxyWorker` uses `./galaxy.worker?worker&inline`; `GalaxyBackdrop` falls back on throw or `onerror` → `dropWorker`; the single file runs the worker from `file://`) |
| Sector change only from `world.sector` / `{ t: 'sector' }`, no sim changes | Done (`Renderer.consume` case `'sector'`; no `src/game` diff; golden passes) |
| Warp anticipates forced changes, render-side | Done (`Renderer.anticipateSector`, `WARP_LEAD = 2.6`), **no test** |
| Colour push per sector | Done in code (new palettes, OKLab lightness budget `okMax`); **no automated check, no before/after shots** |
| OKLab camouflage check + luminance budget | **Missing in repo** (only the prototype harness, which no longer compiles against the WIP). A probe of the WIP on 2026-10-11 passes (numbers in §7) |
| Warp audio riser + boom | Done (`AudioEngine.warpRiser`, `warpBoom`), not listened to |
| Sector title card | Partial: `SectorCard` in `effects.ts` works but **collides with the boss WARNING callout** on forced warps and with the HUD boss bar on a short landscape phone (verified screenshots) |
| Story comms not duplicated | Done (comms already come from `StoryRunLink.frame` → `signal({ kind: 'sector' })`) |
| Title screen shows sector 1 | Done (`App.newAttractWorld` → `Renderer.reset` → `setSector(world.sector)`; requested at boot) |
| Reduced motion → reduced flashing | Done (`Renderer.draw` sets `galaxy.animate = galaxy.flashes = settings.flashes`) |
| Co-op zoom coverage | Backdrop is screen-space and covers at any `k` (probe: 0 uncovered px at `k / ZOOM_MAX`); renderer is not zoom-aware yet (task 3e). **No test** |
| Electron worker | **Broken** (CSP, see above) |
| `no-p1-alias` | **Failing** |
| Card/warp behind pause, level-up and victory screens | **Missing** (keeps running underneath) |
| `docs/GAME_DESIGN.md`, `docs/HANDOFF.md` | **Not updated** |

## 3. Read first

1. `AGENTS.md`, then `docs/HANDOFF.md` §3 and §3a.
2. `docs/design/galaxy.md`: §1 (what the review changed), §2 (API), §3 (integration), §4–§6
   (looks, performance, readability). Its `plan/galaxy/` paths are `prototypes/galaxy/` in-tree;
   its §7 screenshot paths and `/tmp/...` paths exist only on the original build machine. **§3.4
   (sim-side sector timing, spawn calm, bullet clear) and §3.5's `sectorForRun` are overridden by
   §4 below.**
3. The branch diff: `git diff 3d3e601 origin/wip/wave3-gfx -- src/app.ts src/audio src/render/background.ts src/render/effects.ts src/render/renderer.ts`,
   and `diff prototypes/galaxy/galaxy.ts <(git show origin/wip/wave3-gfx:src/render/galaxy.ts)`
   (the WIP's changes to the prototype; summarised in Appendix A).
4. Current code: `src/game/world.ts` (`sector` field, `updateSector`, `zoom`), `src/game/content/enemies.ts`
   (`BOSS_SCHEDULE`, `VICTORY_TIME`), `src/game/content/coop.ts` (`ZOOM_MAX`, `PLAYER_COLORS`),
   `src/story/director.ts` (`sectorInfo`, `queueSector`), `src/story/runlink.ts`, `src/render/effects.ts`
   (`Callouts`), `src/app.ts` (`stepGame`, `stepAttract`, `newAttractWorld`, `endRun`, `toTitle`),
   `tests/no-p1-alias.test.ts`, `e2e/smoke.spec.ts`, `desktop/main.cjs` (`CSP`), `scripts/desktop-smoke.mjs`.
5. Before shots (the greyish prototype): `git show origin/wip/prototypes:galaxy/shots/sector-N.png`
   (N = 1..4), `galaxy/shots/warp-3-p42.png`, `gfx/review/galaxy-sectors.jpg`.
6. Reference only, do not port: `prototypes/galaxy/integration/*.patch` (against an older base;
   `world.patch`, `director.patch`, `types.patch` are sim changes the owner rejected),
   `prototypes/galaxy/harness.ts` and `tools/*.mjs` (absolute paths of the original machine,
   e.g. `/home/user/addictive-game/src/...` and `plan/galaxy/...`; the harness also reads
   `SECTORS[].name` and `backdrop.stats`, which the WIP removed/renames).

## 4. Owner decisions and constraints

These override `docs/design/galaxy.md`.
1. **Sector timing comes only from the sim's existing state:** `world.sector` (0–3) and the
   `{ t: 'sector', index }` event pushed by `World.updateSector` (a sector is left when its boss
   dies or when the next boss is due, the last at `VICTORY_TIME`). Do not port the sim parts of
   the prototype (no spawn calm, no enemy-bullet clear, no new timing, no new event fields). The
   warp is purely visual; `tests/golden.solo.test.ts` passes **unchanged** and `src/game/` has no
   diff. Anticipating a boss entrance is allowed render-side only, from `world.time` and
   `BOSS_SCHEDULE`, without writing sim state.
2. **Colour:** each sector has a rich, distinct hue identity, noticeably beyond the greyish
   prototype (suggested: 1 deep teal/slate-blue, 2 ember/crimson, 3 indigo/violet, 4 bronze/gold;
   the WIP already does this). Keep (a) the OKLab camouflage check passing for **all** gameplay
   colours in the central play box and (b) the luminance budget: the backdrop stays darker than
   every gameplay sprite's dim glow. Deliver before/after comparison shots.
3. **Worker inline** (`?worker&inline`) so `npm run build:single` yields one self-contained HTML
   that works from `file://`; keep the chunked main-thread fallback (no Worker, or a worker error).
4. **Warp cues:** audio riser on `warp-spool`, boom on `warp-punch` (procedural, through the SFX
   bus so the volume settings apply), and a brief sector title card in the callout style, with the
   names from `STORY.sectors` (`sectorInfo`). Story comms already react to `'sector'`; do not add
   a second arrival sequence.
5. **Title screen** (attract mode) shows the sector-1 galaxy (index 0); generation starts at boot,
   off-thread.
6. **Reduced motion** maps to the existing reduced-flashing setting (`Settings.flashes`); no new
   settings UI.
7. **Co-op zoom:** the backdrop must fill the screen with correct parallax at any zoom
   (`world.zoom` from 1 up to `ZOOM_MAX` = 1.45), with the zoom-aware `k = scale·dpr / zoom` that
   task 3e introduces.
8. **`tests/no-p1-alias.test.ts` is not touched.** Rename galaxy's field instead.
9. From the design (§3.3): no renderer-level full-screen flash on `warp-punch` (the punch is
   drawn by the backdrop, *under* the sprites). Do not port capture-only code (`?god`, `?seed`,
   `?legacybg`, `debugBgOnly`, `__galaxyEvents`).
10. `AGENTS.md` hard rules: render code reads sim state but never mutates it or draws from the
    sim RNG streams (`rng`, `spawnRng`, `lootRng`, `posRng`); strict TS; never skip or loosen a
    test; respect reduced flashing and screen shake (0 = none); Pixel 7 keeps working; original IP;
    code idiomatic to the surrounding files; update `docs/GAME_DESIGN.md`.

## 5. Implementation plan

**Step 1. Merge** `origin/wip/wave3-gfx` (§2). Run `npm ci`, `npm run typecheck`, `npm test`:
expect only the `no-p1-alias` failure.

**Step 2. Fix the guard failure.** In `src/render/galaxy.ts`, rename `GalaxyBackdrop.stats` to
`genStats` (declaration plus the two `this.stats.set(...)` in `onWorker` and `step`; keep the doc
comment). `grep -n "this\.stats" src/render/galaxy.ts` must print nothing afterwards. Do not edit the
guard or its `PENDING_MIGRATION` list. Also avoid `this.player` / `this.build` field names in any
new render code (same regex).

**Step 3. Electron worker.** In `desktop/main.cjs` `CSP`, add `"worker-src 'self' blob:"` after
`script-src` (Vite's inline worker is a classic worker from a Blob URL; its fallback is a `data:`
URL, which this still blocks, so the game then uses the chunked fallback). Add a check to
`scripts/desktop-smoke.mjs` after the title screen is visible, e.g.
`check('galaxy backdrop generates in a worker', await page.evaluate(() => window.shardstorm.renderer.bg.galaxy.usesWorker))`
plus `waitForFunction(() => window.shardstorm.renderer.bg.galaxy.isReady(0))`. This change
triggers `.github/workflows/desktop.yml` (it watches `desktop/**` and `scripts/desktop-smoke.mjs`),
whose macOS job needs task 1 merged.

**Step 4. Readability and colour-identity tests** (`tests/galaxy.test.ts`, to be created; §8).
`generateSectorSync(index, quality)` is DOM-free and its `images[0]` is the nebula tile
(`eachImage` visits the tile first), so this runs in vitest's node environment. Only retune
colours if a check fails; if you retune, edit only the `SECTORS[i].nebula` / `wisps` / `center`
colour fields and `okMax`/`satCap`, re-run the checks and the shots.

**Step 5. Sector card layout.** Required outcome: the card never overlaps the HUD top strip
(timer, boss name and bar), the boss `WARNING` callout (arrives 1.4 s after the punch of an
anticipated warp) or `BOSS DESTROYED` (on screen 0.8 s after the punch of a kill warp), at
1280×720, 1920×1080, Pixel 7 portrait (412×915 CSS) and Pixel 7 landscape (863×360 CSS in
Playwright's `Pixel 7 landscape`). Recommended approach: in landscape, draw the card at the top
of the callout area (`h * 0.3`, the `Callouts.draw` base) and push the callout stack down by the
card's height while the card is visible (e.g. an optional `top` offset argument to
`Callouts.draw`, to be created); keep the WIP's portrait position (`h * 0.64`, below the ship,
clear of the top-docked comms panel). Keep the WIP's width clamp for long names and the
`outBack` entrance. Card colour stays `SECTORS[i].warpTint`.

**Step 6. Freeze under modals.** While the run is covered by a modal (`App` state `'paused'`,
`'levelup'` (also cache picks) or `'victory'`), the sector card's life must not tick, and the
warp clock should hold too (otherwise the boom plays over the pause menu and the card runs out
behind it; the final warp's card would otherwise expire behind the victory screen instead of
greeting Overtime). Suggested: `Renderer.draw` opts gain `modal?: boolean` (to be created); when
true call `this.bg.galaxy.update(0)` (still pumps fallback generation and pending swaps) and
`this.sectorCard.update(0)`. `App.stepGame` passes
`modal: this.state === 'paused' || this.state === 'levelup' || this.state === 'victory'`.
Hitstop and slow-mo keep real-time warps (design §3.3). The already scheduled riser may finish
early if a pause lands mid-spool; that is acceptable.

**Step 7. Make the anticipation testable.** Move the rule out of `Renderer.anticipateSector` into
a pure helper, e.g. `src/render/sectorwarp.ts` (to be created) exporting `WARP_LEAD` and
`anticipatedSector(sector: number, time: number, lead = WARP_LEAD): number | null` (returns
`sector + 1` once `time >= (BOSS_SCHEDULE[sector + 1]?.at ?? VICTORY_TIME) - lead` for
`sector < BOSS_SCHEDULE.length`, else `null`). Keep it out of `galaxy.ts`, which must stay
import-free because it doubles as the worker body. Keep `WARP_LEAD` (2.6 s) greater than the warp
duration (2.2 s) so the warp is done before the forced change.

**Step 8. Results → title polish (optional).** After a run in sector 3/4, `endRun` →
`newAttractWorld` → `reset` → `setSector(0)` with sector 0 usually evicted (`keep = 2`): the old
sector shows until sector 0 regenerates (~1 s), then hard-cuts. Acceptable; if you fix it, fade
through the void (`fadeIn`) rather than warping (no riser/boom on the results screen).

**Step 9. Docs.** `docs/GAME_DESIGN.md` §5.5 (the paragraph ending "…and the Gilded Throne."):
add that the sector also changes when the next capital ship arrives (or at 10:00), that the warp
is presentation-only (2.2 s, started 2.6 s early for forced changes) with riser, boom and title
card, and in the accessibility bullets that reduced flashing makes the backdrop static and softens
the warp punch. In `docs/HANDOFF.md`, mark 3a done and record the hooks below for 3c/3d/3e.

**Interfaces this step exposes (later steps consume them; keep them stable):**
- `renderer.bg: Background` (public) and `renderer.bg.galaxy: GalaxyBackdrop`.
- `Background.draw(ctx, camX, camY, k, w, h, time, beat, tint)`: `k` is the world→device scale;
  3e passes the zoom-aware one. Galaxy draws screen-space and opaque (it replaces the base fill),
  so 3c can draw it into an offscreen world canvas by passing that canvas's context.
- `galaxy.warpFx: WarpFx` (`active`, `phase`, `progress`, `holding`, `stretch`, `gridAlpha`,
  `tint`) and `SECTORS[galaxy.sector].gridRGB`: 3d's WarpGrid takes its tint from `gridRGB` and
  multiplies its alpha by `gridAlpha`. 3c caps galaxy punch + post-FX flash: the punch is the
  first 0.1 s after `warp-punch` (`progress` just past 0.55), at most 0.35 alpha (0.09 with
  reduced flashing). Adding a `punch` strength field to `WarpFx` now is welcome but optional.
- `renderer.onGalaxy: ((e: GalaxyEvent) => void) | null` and `renderer.showSectorCard(index, title, subtitle)`.
- `GalaxyEvent`: `ready`, `warp-spool` (with `punchIn` seconds), `warp-tunnel`, `warp-punch`, `warp-done`.

## 6. Settings and save data

No new settings and no save changes. Mappings (all existing):
- `Settings.flashes` (reduced flashing) → `renderer.settings.flashes` (`App.applySettings`) →
  `galaxy.animate` (vortex core spin, beat glows, comets off) and `galaxy.flashes` (punch flash
  0.35 → 0.09 alpha, arrival overshoot 0.7 → 0.25).
- `Settings.shake` scales the 0.25 trauma `Renderer.onGalaxyEvent` adds on `warp-punch`
  (`Shake.update(dt, intensity)`; 0 = none).
- `Settings.sfx`/`master` apply because `tone`/`noiseBurst` route into the `sfx` bus.
- Optional (no UI): also honour `matchMedia('(prefers-reduced-motion: reduce)')` for
  `galaxy.animate`, mirroring `src/ui/style.css`.

## 7. Accessibility, mobile, co-op and performance requirements

- **Readability (owner's check):** backdrop-only render (galaxy + stars + grid, beat 0.5), central
  40% box, every gameplay colour C at glow strength 0.3·C: share of box pixels within OKLab ΔE
  < 0.05 of it must be **< 0.5%**, for every sector, at 1280×720 and 1920×1080, over at least 4
  camera positions. Colour list = `PAL` hex entries, `GEM_TIERS`, every `ENEMIES[k].color`,
  `WEAPONS[k].color` and **`PLAYER_COLORS`** (co-op; the prototype list missed them). WIP probe:
  worst 0.408% (sector 1 vs P3 `#5aa8ff`, 720p), others ≤ 0.25%.
- **Luminance budget:** central-box OKLab L P99 < 0.27 (the darkest gameplay glow, Void Heart
  `#9d4dff` × 0.3, is L 0.270). WIP probe: P99 0.198–0.244.
- **Reduced flashing:** punch ≤ 0.09 alpha, no comets/spin/beat glows; consider halving the
  tunnel streak alpha too (your call, note it). **Shake 0:** no warp shake.
- **Mobile (Pixel 7):** portrait `backdropRef = min(h, 0.8·w)` → quality ≈ 0.61; the card sits at
  `h * 0.64`; landscape per Step 5. Touch input unaffected (no new DOM). Check no frame hitch at
  the warp on the mobile e2e project.
- **Co-op:** 0 uncovered pixels at `k` and at `k / ZOOM_MAX`, in every sector and in each warp
  phase (WIP probe: 0). Parallax scales with `k` by construction. Stars/grid draw `2.1×` more
  cells at zoom 1.45: report their cost.
- **Performance budgets** (headless Chromium/SwiftShader, JS time of the call incl. a 1-px
  `getImageData` flush, median of 3×30 frames; WIP measured values in brackets):
  - `galaxy.draw` only: ≤ 2.0 ms/frame at 1920×1080 [1.23–1.87], ≤ 1.3 ms at 1280×720 [0.95–1.2].
  - Whole `Background.draw`: must stay well under the legacy background: 1080p [3.2–3.6 ms vs
    legacy 8.95], 720p [0.85–1.25 vs 4.31].
  - Warp, average `Background.draw` over the whole warp: ≤ 9 ms at 1080p [7.8–8.6], ≤ 5 ms at
    720p [4.1–4.3]; report the worst frame [19.5–23.9 ms at 1080p].
  - Generation never blocks the main thread (worker): no main-thread frame > 33 ms caused by it;
    sector 0 ready ≤ 3 s after load at 1080p.
  - Memory (`galaxy.memoryBytes()`): ≤ 32 MB at 1080p [29.7], ≤ 14 MB at 720p [13.4].
  - Report `dist-single/shardstorm.html` size [369,235 bytes].

## 8. Tests to add or update

**`tests/galaxy.test.ts` (to be created, vitest/node):**
1. Generate all four sectors once (`generateSectorSync(i, 0.5)` in `beforeAll`; ~0.3–0.45 s each;
   the 30 s `testTimeout` in `vite.config.ts` is plenty). Convert tile pixels (stride 2) to OKLab
   (write the sRGB→OKLab conversion in the test; the WIP's `okL` in `galaxy.ts` is private).
2. **Camouflage:** for each sector and each gameplay colour (list in §7, imported from
   `src/render/palette`, `src/game/content/enemies`, `src/game/content/weapons`,
   `src/game/content/coop`; skip non-`#rrggbb` entries such as `PAL.grid`), the share of tile
   pixels within ΔE 0.05 of the 0.3× glow is < 0.5% (whole tile, stricter than the box, because
   any part can scroll into the centre). WIP: worst 0.113%.
3. **Luminance:** tile OKLab L P99 < min glow L over the colour list (WIP: P99 0.199–0.216 vs
   0.270).
4. **Colour identity (guards the owner's colour push):** per sector, chroma P95 ≥ 0.035 (WIP
   0.042–0.087; greyish prototype 0.013–0.023) and the share of pixels with chroma > 0.02 ≥ 40%
   (WIP 48–100%; prototype 0–35%); the mean hues (OKLab `atan2` of the mean `(a, b)` over pixels
   with chroma > 0.02) of the four tiles are pairwise ≥ 35° apart (WIP 240°/21°/287°/68°). The
   share and hue figures were measured at quality 0.25 (chroma P95 is the same at 0.5): confirm
   them at the test's quality before fixing the thresholds. If the owner later approves a
   different look, update the thresholds with a comment, never delete the check.
5. `SECTORS.length === STORY.sectors.length` (card names come from the story script).
6. `anticipatedSector` (Step 7): sector s is forced out when boss s + 1 arrives (or at
   `VICTORY_TIME` for s = 2), so with the default lead: `null` just before and `s + 1` at
   357.4 s (s = 0), 537.4 s (s = 1), 597.4 s (s = 2); always `null` for s = 3.

**`e2e/galaxy.spec.ts` (to be created, runs in both Playwright projects):** use `skipIntro` from
`e2e/helpers.ts` and the error tracking pattern of `e2e/smoke.spec.ts`.
1. Title: `renderer.bg.galaxy.isReady(0)` within 10 s, `usesWorker === true`, `sector === 0`,
   no console errors.
2. Coverage: for each sector (`galaxy.prepare(i); galaxy.setSector(i, { sync: true })`) and
   `k ∈ { scale·dpr, scale·dpr / ZOOM_MAX }` (import `ZOOM_MAX` from `../src/game/content/coop`,
   as `e2e/story.spec.ts` imports `STORY`): fill `renderer.ctx` with `#ff00ff`, call
   `galaxy.draw(...)`, assert zero `#ff00ff` pixels; repeat for warp previews
   (`setWarpPreview(0, 1, p)` for p ∈ {0.15, 0.42, 0.56, 0.8}, then `clearWarp()`). These are
   sync tools (block ~0.3–0.8 s each); fine in a test.
3. Warp is render-only: start a run, wrap `renderer.onGalaxy` to log `e.t`, call
   `renderer.consume([{ t: 'sector', index: 1 }], app.world)`, poll until `warp-done`; assert the
   order spool → tunnel → punch → done, that the card was visible after the punch (today
   `renderer.sectorCard.card !== null`; adapt after Step 5), and that
   `app.world.sector` is still 0 (the renderer did not touch the sim).

**Update:** `scripts/desktop-smoke.mjs` (Step 3). **Must not change:** `tests/golden.solo.test.ts`,
`tests/no-p1-alias.test.ts`, task 1's `tests/determinism.guard.test.ts`, and the `e2e/smoke.spec.ts`
canvas check (task 3c changes it). Never import `src/render/*` from `src/game/*` (it would enter
the determinism guard's import closure; `galaxy.ts` uses `Math.pow/cbrt/exp`, which is fine
render-side).

## 9. Acceptance checklist

Commands (all must pass):
- `npm ci`, `npm run typecheck`, `npm test` (incl. golden and both guards).
- `npm run build`, `npm run build:single`; open `dist-single/shardstorm.html` from `file://`:
  galaxy loads with the worker.
- `npm run e2e` (set `E2E_PORT` if 4173 is busy), desktop and mobile projects.
- `xvfb-run npm run desktop:smoke` on Linux: all checks, incl. the new worker check.
- `git diff <PR head before the merge> -- src/game tests/golden.solo.test.ts` is empty.

Screenshots (build, serve with `npx vite preview --port <port>`, drive with Playwright; keep shots
out of the repo; look at every one):
- Each sector in real play at 1920×1080 and 1280×720: `?autoplay&warp=N`, and for screenshots
  only, force the backdrop with `app.renderer.bg.galaxy.setSector(i, { sync: true })` (render
  state, not sim). Side by side with the prototype shots (`origin/wip/prototypes:galaxy/shots/sector-N.png`)
  as before/after.
- A warp in each phase (spool, tunnel, punch, arrival), a kill warp with BOSS DESTROYED, and a
  forced warp with the next boss's WARNING: no text overlap (Step 5), also on Pixel 7 portrait and
  landscape. A forced change only happens when the previous boss is still alive (a bot usually
  kills the Warden before 6:00), so stage the layout render-side: `galaxy.setSector(1, { warp: true })`,
  then ~1.4 s after `warp-punch` call `renderer.consume([{ t: 'boss', name: 'The Hydra', title: 'It Hunts in Spirals' }], app.world)`
  (and `{ t: 'bossdead', x, y, name }` right at the spool for the kill case). Also catch a natural
  one if it occurs (e.g. the 9:57 warp with `?autoplay&warp=590` when the Void Heart survives).
- The title screen (sector 1, index 0), the results screen after a sector-3+ run.
- A dense fight with `world.enemies.length >= 300` (log it; e.g. `?autoplay&warp=530`–`590`) in
  sectors 2 and 3: bullets (`#ff4f7a`) and warm enemies must read on the crimson and violet gas.
- Reduced flashing on (static backdrop, soft punch) and shake 0.
- `?coop=4&autoplay` (camera still follows P1 until 3e) plus the e2e coverage test at `k / ZOOM_MAX`.

Numbers to report: §7 budgets (galaxy-only and whole-background per sector, warp average and
worst, legacy for comparison at 720p and 1080p), camouflage worst and luminance P99 per sector at
both sizes, sector-0 ready time, memory, single-file size.

## 10. Pitfalls and known issues

- **The P1-alias regex** catches any `this.stats` / `this.player` / `this.build` in `src/`, even
  unrelated fields (that is the known failure).
- **Worker bundling:** use only `import GalaxyWorker from './galaxy.worker?worker&inline'`. The
  design doc's `new Worker(new URL('./galaxy.worker.ts', import.meta.url), { type: 'module' })`
  breaks `build:single` (`scripts/build-single.mjs` inlines only the entry chunk) and `file://`.
  The inline worker is a classic IIFE: do not pass `{ type: 'module' }`.
- **Electron CSP** blocks Blob workers silently except for a console error; the fallback then hides
  the bug (chunked generation, worst frames 22–42 ms at 1080p). The smoke check catches it.
- **Overlaps:** WARNING (sector forced as the boss arrives) and BOSS DESTROYED (kill warp) always
  coincide with the card in time; only layout separates them. Mission toasts can also appear.
- **Tightest colour:** sector 1's blue wisps/gas (`wisps.b '#3a5cc0'`, `nebula.alt '#0a2a52'`)
  vs co-op P3 `#5aa8ff` (0.408% of the 0.5% limit). Push sector 1 towards teal, not blue, if it
  fails. Sector 2's crimson sits under warm enemies and pink bullets: judge it in a real
  barrage, not only by the metric.
- `prepare`, `setSector(i, { sync: true })` and `setWarpPreview` generate synchronously on the
  main thread (0.3–0.85 s): tools and tests only, never in game code.
- **Generation** is 0.47–0.74 s per sector at 1080p (above the design's 400 ms goal) but off-thread
  with a long lead (`setSector(i)` prewarms `i + 1`; the WIP defers that to `warp-done` because the
  warp pins both ends and `keep = 2` would evict it at once).
- **SwiftShader:** each `stroke()` has ~1.2 ms fixed cost; keep streaks and star streaks batched
  (one path per layer). The renderer's stars + grid cost ~2 ms at 1080p today (3d replaces the grid).
  Sector 4's vortex is the most expensive; the design's lever is its size (1.22 → ~1.1).
- **Portrait:** the tile is drawn magnified (×1.85 on a Pixel 7) to cover the tall screen; softer
  and a non-1:1 blit. Acceptable; measure it on the mobile project.
- **Multiple sector events in one frame** (two thresholds passed at once) restart the warp towards
  the later sector; `?warp=N` fast-forward clears events and `reset()` shows the current sector
  without a warp, then the anticipation may start a warp on the next frame if inside the lead.
- **Quitting mid-warp:** `reset()` cancels the warp; a riser already scheduled finishes on the
  results screen (harmless).
- The prototype harness and tools do not run as-is (absolute paths, `SECTORS[].name`, `.stats`).
  Port the colour check into tests instead of reviving the harness.

## 11. Out of scope

- WebGL post-FX, bloom and the combined flash cap (3c); WarpGrid (3d); the zoom-aware camera,
  `renderer.worldToScreen`, P1-alias migration of `renderer.ts`/`hud.ts` (3e); entity art (3b).
- Any sim change: spawn calm, bullet clear, new event fields, sector timing.
- Baking sectors at build time for Steam (design §1 "Baking for Steam"), orbit-line accents,
  new settings UI, story text changes.

## Appendix A. What the WIP changed relative to `prototypes/galaxy/galaxy.ts` (rebuild only)

If the branch cannot be obtained, copy `prototypes/galaxy/galaxy.ts` to `src/render/galaxy.ts` and
`prototypes/galaxy/integration/galaxy.worker.ts` to `src/render/galaxy.worker.ts`, then apply:
- **Palettes** (`SECTORS[i].nebula` / `wisps`; `satCap` 0.24 everywhere; `lumMax` replaced by `okMax`):
  - S1: void `#010509` deep `#03121a` mid `#043a42` alt `#0a2a52` hi `#0f7072` rim `#7fe8ec`,
    `okMax` 0.215; wisps a `#16b4aa` b `#3a5cc0`; spiral anchor `ax 0.8, ay 0.19`.
  - S2: void `#070203` deep `#180508` mid `#440c16` alt `#4a1a08` hi `#7a2418` rim `#ffa080`,
    `okMax` 0.205; wisps a `#d8501c` b `#a01c3c`.
  - S3: void `#030210` deep `#0a0626` mid `#1c1252` alt `#300e4c` hi `#3c2c8c` rim `#b0a0ff`,
    `okMax` 0.2; wisps a `#5a40d0` b `#8a2ab0`.
  - S4: void `#060402` deep `#170e03` mid `#4a320c` alt `#3c1e0a` hi `#82601a` rim `#ffd88a`,
    `okMax` 0.215; wisps a `#d8a030` b `#a05a20`; vortex `dark #080603 mid #5c4422 hi #f6c460`.
- **Budget:** in the tile finalise pass, replace the Rec.709 luma soft-knee with an OKLab L
  soft-knee (knee `0.7·okMax`, asymptote `okMax`), hue-preserving: scale linear-light RGB by
  `(Lt/L)^3` (helpers `toLinear`, `toSrgb`, `okL`).
- Remove `SectorDef.name`/`tagline`, `SECTOR_FORCE_AT`, `sectorForRun` (names come from
  `sectorInfo`; timing from the sim). `INWARD` 0.05 → 0.025.
- `export function backdropRef(w, h) = min(h, 0.8·w)`; use it instead of `h` for quality, draw
  scale, the drift clamp and planet periods; anchors keep their distance from the nearest top or
  bottom edge (`ay < 0.5 ? ay·ref : h − (1 − ay)·ref`); tile scale `max(ref, h/1.5) / 1080 / tileRs`;
  comet speed/length scale with `1080·bs`.
- Planets fade to 0.2 alpha over `PLAY_ELLIPSE` (`smoothstep(1.05, 1.9, q)` of the normalised
  ellipse distance).
- `GalaxyOptions.flashes` / `GalaxyBackdrop.flashes` (punch alpha 0.35 → 0.09, overshoot 0.7 →
  0.25); `warp-spool` carries `punchIn = WARP_TUNNEL · dur`; `setSector` returns early when already
  at or warping to `i` (clearing `pendingSwap`), reuses the flash sprite for the same tint, and
  prewarms `i + 1` at `warp-done` instead of at spool.
- Other files: as in §2's table and §5 (`Background` constructor/`makeGalaxyWorker`/star streaks/
  grid `gridRGB × gridAlpha`; `Renderer` `bg` public, `onGalaxy`, `onGalaxyEvent`, `sectorCard`,
  `showSectorCard`, `anticipateSector`, `'sector'` case, `galaxy.update(rdt)` at the top of
  `draw`; `SectorCard` in `effects.ts`; `AudioEngine.warpRiser(dur)` / `warpBoom()` and a
  `noiseBurst` `attack` option; `App.onGalaxy`).
