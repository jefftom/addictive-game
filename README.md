# SHARDSTORM

A neon arena-survival roguelite built around "one more run".

You captain one small starship of the **Allied Beacon Fleet** against **the Shardstorm**, a crystal armada led by an overlord who writes poetry. Your guns fire on their own. You steer, **dash straight through the swarm**, and chain kills into a combo multiplier. Pick one of three upgrades every level, evolve your weapons, take down three capital ships, and hold the line for 10:00. Every run, win or lose, earns cores, rank and mission progress, so you always come back a little stronger. Your bridge crew talks you through it on comms, and the Ship's Log fills in the story as you go.

- **Runs:** 2–10 minutes; restart in under a second
- **Platforms:** any modern browser on desktop or mobile, with keyboard, mouse, touch or gamepad
- **Web size:** about 235 KiB gzipped (588,528 bytes uncompressed / 240,861 gzip bytes for the verified standalone HTML), including bundled fonts; all art and audio are generated in code

## Play

```bash
npm install
npm run dev        # http://localhost:5173
```

Or build a single self-contained file you can open straight from disk:

```bash
npm run build:single   # → dist-single/shardstorm.html
```

### Controls

| Action | Keyboard / mouse | Gamepad | Touch |
| --- | --- | --- | --- |
| Move | WASD / arrows, or hold left mouse | Left stick / d-pad | Drag anywhere |
| Dash | Space / Shift / right-click | A / RB | DASH button or a second finger |
| Pause | Esc / P | Start | ❚❚ button |
| Pick upgrade | 1 / 2 / 3, or arrows + Enter | D-pad + A | Tap |
| Reroll | R | X | Tap |

**Tip:** dashing through an enemy or bullet is a **perfect dash**. It triggers slow motion, refunds half your dash cooldown and adds +3 combo.

## What keeps you playing

The full reasoning is in [docs/GAME_DESIGN.md](docs/GAME_DESIGN.md). In short, there are nested loops, so a goal is always seconds, minutes or runs away:

| Loop | Time scale | Hook |
| --- | --- | --- |
| Kill → shard → XP | seconds | Chimes rise in pitch as you collect, plus hit-stop and particles |
| Combo multiplier | 10–60 s | ×2 … ×10 score; milestones at 50/100/200; a hit halves it |
| Level-up cards | 15–40 s | Variable rewards: rare relics and gold evolution cards |
| Bosses at 3:00 / 6:00 / 9:00 | minutes | A "WARNING" banner, then a clear goal to beat |
| Missions, rank, workshop | runs | Every run pays out; "312 short of your best" framing |
| Daily Run + streak | days | Same seed for everyone each day; streak bonus cores |
| Ship's Log + crew comms | runs | Story chapters unlock across the meta arc; the crew reacts to your play |

There are also guardrails: no real money, ads, loot boxes or energy timers; streaks only add bonuses; an optional break reminder; and a reduced-flashing setting.

## Development

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm test` | Unit tests (Vitest): RNG, grid, combat rules, determinism, upgrades, saves, missions, daily streaks |
| `npm run e2e` | Playwright smoke and story tests on desktop and mobile viewports (set `E2E_PORT` if 4173 is taken) |
| `npm run sim` | Headless balance report: a bot plays dozens of runs ([details](#balance-simulation)) |
| `npm run qa:shots` | Composed visual matrix and `qa-shots/index.html` contact sheet |
| `npm run perf:bench` | Three alternating runs per scenario, layer timings and heap in `qa-shots/perf.json` |
| `npm run store:assets` | Steam capsules, gameplay screenshots and icons at native sizes in `store-assets/` |
| `npm run build` | Production build to `dist/` |
| `npm run build:single` | Self-contained `dist-single/shardstorm.html` |
| `npm run desktop:dev` | Build, then run the game in the Electron desktop shell |
| `npm run desktop:smoke` | Build, then drive the real Electron window with Playwright (title screen, bundled fonts, fullscreen setting and F11, a run, save file and its migration, quit flush, Steam Deck, no-Steam fallback) |
| `npm run desktop:pack` | Unpacked desktop build for this OS in `release/` |
| `npm run desktop:dist` | Release check (typecheck, tests, achievement table) + unpacked desktop build for this OS |
| `npm run steam:achievements` | Regenerate `steam/achievements.json` from `src/meta/achievements.ts` |

Debug URL parameters: `?autoplay` lets the bot play the real game, and `?warp=180` fast-forwards a new run by 180 seconds (useful for inspecting bosses). `?coop=N&autoplay` starts 2–4 bot captains; `?bots` enables lobby bot slots. `?seed=N` repeats the run and bot streams for an unsigned 32-bit seed and is ignored for Daily Runs. `?fx=0` forces plain 2D; `?fxq=N` pins enhanced graphics at quality 0–3 instead of using the automatic quality ladder.

### Project layout

```
src/
  core/      rng (seeded streams), math, spatial grid, input (kbd/mouse/touch/gamepad)
  game/      the simulation: world, weapons, enemy AI, director, upgrades, stats, bot
    content/ data tables: enemies, weapons, passives & relics, ships, workshop
  meta/      save/migration, progression & rewards, missions, achievements, rank, daily
  render/    canvas renderer, glow sprites, particles, effects, HUD, background
  audio/     procedural WebAudio SFX and music sequencer
  story/     story script, StoryDirector (paced comms), Ship's Log unlocks, run-to-director glue
  ui/        DOM menus, level-up cards, results screen, comms panel, opening crawl, styles
  platform/  web vs desktop (Steam) platform layer: saves, achievements, rich presence
desktop/     Electron main process, sandboxed preload bridge, Steamworks wrapper, atomic save file
steam/       SteamPipe VDF templates, achievements table, rich presence tokens, dev steam_appid.txt
tests/       unit tests + balance simulation (*.sim.ts)
e2e/         Playwright smoke tests
scripts/     builds, desktop smoke, visual QA, performance and store-asset tools
docs/specs/  ordered implementation and verification contracts
prototypes/  reviewed visual prototypes and integration notes
```

The simulation in `src/game/` never touches the DOM or canvas. It runs at a fixed 60 Hz, uses deterministic math for the same seed and input sequence on every CPU and browser, and reports what happened as **events**. The renderer and audio turn those events into feedback. The same code runs in the browser, the unit tests and the balance simulator.

### Balance simulation

`npm run sim` prints survival, level pacing, enemy density, Warden/10:00 rates, and co-op fight durations. Fresh solo, 2P, 3P and 4P profiles share `SIM_SEED_BASE + i`; the default base is 1000. `SIM_RUNS`, `SIM_SKILL` and `SIM_ONLY` select the batch. Veteran profiles use base + 1000.

Final confirmation: **48 runs per squad per block**, rank 1, skill 0.6, alternating Spark/Vanguard in co-op, 660-second ceiling. Only rows 3 and 4 were tuned; solo, 2P, revive rules and the golden master are unchanged.

**Seeds 1000–1047**

| Squad | Median survival (s) | Warden killed | Reached 10:00 | Level at 1:00 | Warden fight (s) | Downs / revives |
|---|---|---|---|---|---|---|
| 1P | 374.3 | 28/48 (58.3%) | 9/48 (18.8%) | 6 | 50.3 | 0 / 0 |
| 2P | 402.1 | 37/48 (77.1%) | 14/48 (29.2%) | 5.5 | 63.2 | 2 / 1 |
| 3P | 412.5 | 35/48 (72.9%) | 10/48 (20.8%) | 6 | 72.7 | 5 / 3.5 |
| 4P | 435.8 | 34/48 (70.8%) | 12/48 (25.0%) | 6 | 93.2 | 9 / 6.5 |

**Held-out seeds 5000–5047**

| Squad | Median survival (s) | Warden killed | Reached 10:00 | Level at 1:00 | Warden fight (s) | Downs / revives |
|---|---|---|---|---|---|---|
| 1P | 343.6 | 20/48 (41.7%) | 8/48 (16.7%) | 6 | 32.3 | 0 / 0 |
| 2P | 421.1 | 35/48 (72.9%) | 10/48 (20.8%) | 6 | 59.6 | 2 / 1 |
| 3P | 398.8 | 30/48 (62.5%) | 4/48 (8.3%) | 6 | 77.6 | 5 / 3 |
| 4P | 415.7 | 38/48 (79.2%) | 10/48 (20.8%) | 6 | 94.1 | 8 / 5 |

The main quantitative bands pass. Held-out rate bands pass with the specified 5-point slack, but the 4P median Warden fight is 94.08 s versus a limit of 89.40 s (1.58× 2P). Outcome difficulty is not strictly monotone: 4P reaches 10:00 in 12/48 main seeds versus 3P's 10/48, and on held-out seeds 4P beats the Warden in 38/48 versus 3P's 30/48 and reaches 10:00 in 10/48 versus 4/48. Multiplier rows are monotone. The 4P hard total cap passes at 598 ≤ 600; scheduled bosses still exceed the regular-enemy row cap (also true in frozen solo/2P). These are disclosed balance acceptance gaps, not an all-bands pass. Trial 14 shortened fights but worsened the main 10:00 rate, so trial 13 is the documented playtest candidate; solo/2P and shared revive mechanics stay unchanged.

The targets are 3P/4P Warden rates within 15 percentage points of 2P and 40–75%, 10:00 rates within 10 points, and median survival within 60 seconds; held-out rate bands allow 5 extra points. Fight duration should be at most 1.5× 2P. See the [full verification and iteration receipts](docs/verification/04-verify-and-ship.md). Outcomes are bimodal, so rates matter more than medians. Bots revive differently from people: a short real 3–4-player session remains necessary.

## Deploying

- **GitHub Pages:** `.github/workflows/deploy.yml` builds and publishes on every push to `main`. One-time setup: **Settings → Pages → Source: GitHub Actions**.
- **Anywhere else:** upload `dist/` (relative paths, so any sub-path works) or the single `dist-single/shardstorm.html`.

- **Steam (desktop):** an Electron shell with Steamworks (achievements, rich presence, Auto-Cloud saves, overlay, a fullscreen setting and "Quit to desktop"); without a Steam client it runs the same game with saves in a local file. See [docs/STEAM.md](docs/STEAM.md) for the full release guide and [steam/README.md](steam/README.md) for the SteamPipe files. `.github/workflows/desktop.yml` builds unpacked Windows, macOS and Linux apps; its Steam upload job is off by default.

CI (`.github/workflows/ci.yml`) runs typecheck, unit tests, build and the Playwright tests on every PR, and attaches the single-file build as a downloadable artifact.

## Credits

Deterministic math in `src/core/dmath.ts` is based on [fdlibm](https://netlib.org/fdlibm/), Copyright (C) 1993 Sun Microsystems, Inc.; its permission notice is preserved in that file. The `scalbn` routine follows musl (MIT attribution pending owner confirmation).

Everything visual and audible is procedural, with no image or audio assets. Fonts: [Tektur](https://fonts.google.com/specimen/Tektur), [Chakra Petch](https://fonts.google.com/specimen/Chakra+Petch) and [Kode Mono](https://fonts.google.com/specimen/Kode+Mono) (SIL Open Font License), bundled in `src/assets/fonts/` (latin subset, from the [Fontsource](https://fontsource.org) packages), so the game makes no third-party requests and works offline. Their licence ships with every build as `licenses/fonts-OFL.txt`.
