# AGENTS.md: working on SHARDSTORM

SHARDSTORM is a neon arena-survival roguelite. You captain a starship of the (original) Allied
Beacon Fleet against a crystalline alien armada: survive 10:00, chain combos, pick upgrades,
beat three capital-ship bosses. Web (Vite) + Steam desktop (Electron). 1–4 player local co-op.
A deliberately cheesy story with crew comms.

**Start with `docs/HANDOFF.md`**: current state, open branches and the prioritised task list.

## Stack and commands

TypeScript (strict) + Vite, no runtime dependencies, Canvas 2D. Node 22.

```bash
npm ci
npx playwright install --with-deps chromium   # once, for e2e
npm run typecheck          # tsc --noEmit
npm test                   # vitest (unit + golden master + guards)
npm run e2e                # Playwright, desktop + mobile projects (builds and serves on :4173; E2E_PORT overrides)
npm run build              # dist/
npm run build:single       # dist-single/shardstorm.html (one self-contained file; must keep working)
npm run sim                # long balance simulations (slow)
npm run desktop:smoke      # Electron smoke test (needs a display: xvfb-run on Linux)
npm run steam:achievements # regenerate steam/achievements.json after changing achievements
```

Debug URL params: `?autoplay` (bot drives the title demo / runs), `?warp=N` (fast-forward N sim seconds),
`?coop=N` (start N-pilot co-op with bots), `?bots`. `window.shardstorm` is the `App`
(`app.world`, `app.renderer`, `app.ui`).

## Architecture

- `src/game/` deterministic fixed-step 60 Hz simulation. `World` (`world.ts`) holds the state; each tick
  pushes `GameEvent`s (`types.ts`) into `world.events`, which the renderer, audio and story consume.
  Seeded RNG streams in `src/core/rng.ts`. Content tables in `src/game/content/`. Bot in `bot.ts`.
- `src/render/` renderer (camera, draw order, `consume(events)`), sprites, particles, effects, background, HUD.
- `src/app.ts` app state machine and loop; `src/ui/` DOM screens (`ui.ts`, `comms.ts`, `lobby.ts`, `crawl.ts`).
- `src/meta/` saves, progression, achievements, missions, daily run. `src/story/` story script and director.
- `src/platform/` web/desktop platform layer; `desktop/` Electron main/preload; `steam/` SteamPipe files.
- Docs: `docs/GAME_DESIGN.md`, `docs/STEAM.md`, `docs/HANDOFF.md`.

## Hard rules

1. **The simulation is deterministic.** `tests/golden.solo.test.ts` replays fixed seeds and must stay
   bit-identical. Never edit or re-record it to make a change pass; re-capture only for a deliberate gameplay
   change, and say so in its header comment. Rendering/UI code may read sim state but must not mutate it or
   draw from the sim RNG streams.
2. **Co-op:** players live in `world.players[pid]`. `tests/no-p1-alias.test.ts` forbids new uses of the P1
   aliases (`world.player/stats/build/rerolls/pendingCaches`) outside its `PENDING_MIGRATION` list.
3. Strict TypeScript must stay clean; keep `npm run build:single` working (workers inline via `?worker&inline`).
4. Never skip, disable or loosen a test to get green. If behaviour legitimately changes, update the test.
5. Respect accessibility settings in anything new: reduced flashing and screen shake (0 = none).
   Keep touch/mobile (e.g. Pixel 7 viewport) working.
6. **Original IP only.** The fleet, ships, aliens and story are our own. No names, logos, catchphrases or
   recognisable silhouettes from any existing franchise.
7. Keep code idiomatic to the surrounding files (comment density, naming); update `docs/GAME_DESIGN.md` when
   the design changes.
