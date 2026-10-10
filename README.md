# SHARDSTORM

A neon arena-survival roguelite built around "one more run".

You captain one small starship of the **Allied Beacon Fleet** against **the Shardstorm**, a crystal armada led by an overlord who writes poetry. Your guns fire on their own. You steer, **dash straight through the swarm**, and chain kills into a combo multiplier. Pick one of three upgrades every level, evolve your weapons, take down three capital ships, and hold the line for 10:00. Every run, win or lose, earns cores, rank and mission progress, so you always come back a little stronger. Your bridge crew talks you through it on comms, and the Ship's Log fills in the story as you go.

- **Runs:** 2–10 minutes; restart in under a second
- **Platforms:** any modern browser on desktop or mobile, with keyboard, mouse, touch or gamepad
- **Size:** about 50 KB gzipped, no runtime dependencies; all art and audio are generated in code

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
| `npm run build` | Production build to `dist/` |
| `npm run build:single` | Self-contained `dist-single/shardstorm.html` |
| `npm run desktop:dev` | Build, then run the game in the Electron desktop shell |
| `npm run desktop:smoke` | Build, then drive the real Electron window with Playwright (title screen, a run, save file, no-Steam fallback) |
| `npm run desktop:pack` | Unpacked desktop build for this OS in `release/` |
| `npm run desktop:dist` | Release check (typecheck, tests, achievement table) + unpacked desktop build for this OS |
| `npm run steam:achievements` | Regenerate `steam/achievements.json` from `src/meta/achievements.ts` |

Debug URL parameters: `?autoplay` lets the bot play the real game, and `?warp=180` fast-forwards a new run by 180 seconds (useful for inspecting bosses).

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
```

The simulation in `src/game/` never touches the DOM or canvas. It runs at a fixed 60 Hz, is fully deterministic for a seed and input sequence, and reports what happened as **events**. The renderer and audio turn those events into feedback. The same code runs in the browser, the unit tests and the balance simulator.

### Balance simulation

`npm run sim` plays batches of runs with a steering bot for three profiles (fresh save, clumsy fresh save, veteran save) and prints survival times, level pacing, enemy density and boss kills. The current tuning targets:

| Metric | Target | Bot result (16 runs per profile) |
| --- | --- | --- |
| First level-up | ≤ 8 s | ~3.5 s |
| Level at 1:00 | 4–6 | 6–7 |
| Fresh save beats the Warden (3:00) | roughly 30–60% | 31% (clumsy bot) – 62% (competent bot) |
| Fresh-save median survival | 2:30–6:30 | 3:46 (clumsy) – 6:16 (competent) |
| Veteran save (rank 8, half workshop) | usually reaches 10:00 | median 10:00+, 14/16 beat a boss |

Outcomes are bimodal: a fresh run either falls to the Warden or snowballs past it. So the Warden win rate is a steadier measure than the median.

The bot is not a human. These numbers are a baseline for tuning, not a substitute for playtesting.

## Deploying

- **GitHub Pages:** `.github/workflows/deploy.yml` builds and publishes on every push to `main`. One-time setup: **Settings → Pages → Source: GitHub Actions**.
- **Anywhere else:** upload `dist/` (relative paths, so any sub-path works) or the single `dist-single/shardstorm.html`.

- **Steam (desktop):** an Electron shell with Steamworks (achievements, rich presence, Auto-Cloud saves, overlay). See [docs/STEAM.md](docs/STEAM.md) for the full release guide and [steam/README.md](steam/README.md) for the SteamPipe files. `.github/workflows/desktop.yml` builds unpacked Windows, macOS and Linux apps; its Steam upload job is off by default.

CI (`.github/workflows/ci.yml`) runs typecheck, unit tests, build and the Playwright tests on every PR, and attaches the single-file build as a downloadable artifact.

## Credits

Everything visual and audible is procedural, with no image or audio assets. Fonts: [Tektur](https://fonts.google.com/specimen/Tektur), [Chakra Petch](https://fonts.google.com/specimen/Chakra+Petch) and [Kode Mono](https://fonts.google.com/specimen/Kode+Mono) (SIL Open Font License), bundled in `src/assets/fonts/` (latin subset, from the [Fontsource](https://fontsource.org) packages), so the game makes no third-party requests and works offline. Their licence ships with every build as `licenses/fonts-OFL.txt`.
