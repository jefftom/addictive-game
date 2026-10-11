# Merge the platform wiring and bundled fonts

Task 2 of `docs/HANDOFF.md`. Most of the code is already written on `wip/wave3-platform`. This task
is mostly merging, verifying and fixing two small gaps (plus docs). Do **not** re-implement work that the
branch already has.

## 1. Goal

The web game behaves exactly as before for players. Saves stay in the same localStorage key, the
look is the same and there are no new controls. The only differences are that the game no longer
contacts Google Fonts and works fully offline. The Steam desktop build becomes a real Steam game:
- saves go to the Auto-Cloud save file;
- earned achievements reach Steam, with retries;
- friends see rich presence (menu, shipyard, a run with sector/clock/ship/pilots, a boss fight,
  victory, Overtime, results);
- the title screen has **Quit to desktop**, and Settings has a **Fullscreen** switch that stays in
  step with F11 / Alt+Enter and is locked on with Steam Deck.

## 2. Starting point

- **Merge target:** the PR branch `claude/dazzling-faraday-2kxdhl`, **after task 1**
  (`wip/fix-dmath`, see `docs/specs/01-*` if present) has been merged into it. The reason for this
  order: `.github/workflows/desktop.yml` triggers on `src/platform/**`, `desktop/**` and
  `scripts/desktop-smoke.mjs`, and runs `npm run check` (including the golden master) on macOS. That
  job can only go green once task 1 has landed.
- **Source:** `origin/wip/wave3-platform` (`wave3/platform` on the original machine). Its head is
  `361c4c1`, and it has two commits on top of `3d3e601`:
  - `0681721` Bundle the fonts locally instead of loading Google Fonts
  - `361c4c1` Wire the platform layer into the game (web and Steam desktop)
- **How to get it:** run `git fetch origin wip/wave3-platform`. If you cannot fetch other branches,
  ask the owner for a bundle: `git bundle create platform.bundle 3d3e601..origin/wip/wave3-platform`.
  `3d3e601` is already in the PR branch history, so `git bundle list-heads platform.bundle` and
  `git fetch platform.bundle <listed ref>:refs/heads/wave3-platform` work. Alternatively,
  ask for `git format-patch --binary 3d3e601..origin/wip/wave3-platform` (the fonts are binary).
  Only as a last resort, rebuild it from §5 and Appendix A.
- **State verified on 2026-10-11** (Linux x64, Node 22). The tree used was PR head `df057a4` (before
  the `testTimeout` commit `a114403`, which changes only `vite.config.ts` `test`), plus
  the files changed on `wip/fix-dmath` (`2980d33`), plus the files changed on `wip/wave3-platform`.
  That is the post-task-1 merge result, because the two branches touch no common file.
  - `npx tsc --noEmit` is clean.
  - `npx vitest run`: 17 files, **339/339 passed**. This includes `tests/golden.solo.test.ts` and
    task 1's `tests/determinism.guard.test.ts`.
  - `npm run steam:achievements -- --check` reports "up to date".
  - `npm run build:single` succeeds. `dist-single/shardstorm.html` went from **293.5 KB to
    391.9 KB** (300,574 to 401,337 bytes; gzip 98.6 KB to 172.0 KB). About 90 KB of that is the
    base64 fonts and about 9 KB is the platform JS. `dist/` gains six `.woff2` files (67.6 KB in
    total) and `licenses/fonts-OFL.txt`.
  - `node scripts/desktop-smoke.mjs` (Electron 44.6.0 under xvfb, no Steam client):
    **47/47 checks passed**.
- **Not yet verified:**
  - `npm run e2e` in both projects (desktop and mobile);
  - the before/after font comparison (the earlier screenshots exist only on the original build
    machine);
  - the desktop CI jobs on Windows and macOS;
  - a real Steam client (owner, `docs/STEAM.md` §12).
- **Expected merge conflicts:**
  - PR head `a114403` (`df057a4` plus "Give simulation-heavy tests a realistic timeout"): **none**.
    `git merge-tree` shows no conflict markers. The only file changed on both sides is
    `vite.config.ts`, and it auto-merges: `test.testTimeout` and the platform's `build` and
    `plugins` changes are separate hunks. Keep both.
  - Task 1 (`wip/fix-dmath`): **none textual**. On the semantic side, `src/meta/save.ts` now
    imports `src/platform/platform.ts` at runtime. The sim reaches `save.ts` only through
    `import type` (`src/meta/daily.ts`), so the platform layer stays outside the determinism guard's
    import closure. The verified run above confirms this.
  - Task 3a (`wip/wave3-gfx`), if it lands first: **one conflict, in the `src/app.ts` import
    block**. Keep `import type { GalaxyEvent } from './render/galaxy';` and the platform branch's
    two imports (`PlatformLink, type PresenceSnapshot` from `./platform/link`;
    `platform as currentPlatform, type Platform` from `./platform/platform`). Drop
    `import { detectBridge } ...`, because its only use (`allowCtrlDash`) is replaced and
    `noUnusedLocals` would fail. The rest of `app.ts` (the constructor's `renderer.onGalaxy` line,
    `onGalaxy()`) merges automatically.

## 3. Read first

1. `AGENTS.md`: commands and hard rules.
2. `docs/HANDOFF.md` §2.
3. `docs/design/steam.md`: §2.4 (preload bridge), §2.5 (rich presence), §2.6 (saves and
   Auto-Cloud), §2.7 (window settings), §5 rows 1 and 11 (Steam Deck), §11 (open risks).
4. The branch diff: `git diff 3d3e601 origin/wip/wave3-platform --stat`, then
   `git show 0681721` and `git show 361c4c1`.
5. On the branch, `docs/STEAM.md` §1 (Window, Fonts), §6, §7 (presence table), §8 (Cloud), §11
   row 11 and §16 "How the game uses the platform layer".
6. `src/platform/platform.ts` (the `Platform` and `DesktopBridge` contracts), `src/platform/link.ts`,
   `src/platform/storage.ts` (`createMirroredStorage`), `desktop/main.cjs`, `desktop/steam.cjs`
   (achievement queue), `scripts/desktop-smoke.mjs`.

## 4. Owner decisions and constraints

1. Initialise the platform at boot with `initPlatform()`, before the App exists. The platform layer
   picks web or desktop. `window.shardstorm` must remain the `App`.
2. Web saves: same localStorage key `shardstorm.save` (`SAVE_KEY` in `src/meta/save.ts`, mirrored
   by `DEFAULT_SAVE_KEY` in `src/platform/storage.ts`). Existing saves and the e2e seeding in
   `e2e/helpers.ts` (`skipIntro`) must keep working.
3. Desktop saves go through the bridge file for Steam Auto-Cloud (steam.md §2.6):
   - the file is the source of truth at boot;
   - an old localStorage save is migrated to the file once;
   - writes look synchronous to the game;
   - nothing is lost on quit: flush on unload and on the shell's quit and close path.
4. Achievements: every unlock is reported (Steam names through `src/platform/achievements.ts`).
   Failures are queued and retried (`desktop/steam.cjs`). On startup, everything already earned is
   re-synced once (idempotent).
5. Rich presence on state changes per steam.md §2.5, throttled, and a no-op on the web.
6. Desktop-only UI: **Quit to desktop** on the title screen, and a **Fullscreen** toggle in Settings
   that applies through the bridge, is persisted, follows F11, and is hidden on the web. Steam Deck
   starts fullscreen.
7. Self-host Chakra Petch (400–700), Kode Mono (400–700) and Tektur (500–900):
   - latin subset, WOFF2, with the SIL OFL licence text;
   - `@font-face` in `src/ui/style.css` with `font-display: swap` and the **same family names**;
   - no Google preconnect/link, and no Google hosts in the desktop CSP;
   - `build` and `build:single` include them, and the single-file size is reported.
8. Hard rules from `AGENTS.md` apply:
   - the sim stays bit-identical: `tests/golden.solo.test.ts` is unchanged from what task 1
     committed;
   - strict TypeScript;
   - no skipped or loosened tests;
   - accessibility settings respected;
   - mobile (Pixel 7) keeps working;
   - original IP only;
   - do not touch `src/render/*` in this task.
9. Merge with a merge commit into the PR branch. No force-push, no rebase of the PR branch.

## 5. Implementation plan

### 5.1 Merge
1. On the PR branch, after task 1: `git merge --no-ff origin/wip/wave3-platform`. It should apply
   without conflicts (see §2 if task 3a landed first).
2. Run `npm ci` (the branch adds no npm dependency; the fonts are vendored), then
   `npm run typecheck` and `npm test`.

### 5.2 What the branch does (review it; do not rewrite)

**Fonts (`0681721`)**
- `src/assets/fonts/`:
  - `chakra-petch-latin-{400,500,600,700}-normal.woff2`
  - `kode-mono-latin-wght-normal.woff2` (variable)
  - `tektur-latin-wght-normal.woff2` (variable)
  - `OFL.txt` (copyrights for the three projects + OFL 1.1)
- `src/ui/style.css`: six `@font-face` rules at the top, with the latin `unicode-range` and
  `font-display: swap`.
- `index.html`: the three Google Fonts `<link>`s are removed.
- `vite.config.ts`:
  - `assetsInlineLimit` becomes a function, so `.woff2` files are never inlined and stay
    cacheable;
  - plugin `shardstorm-font-licence` emits `licenses/fonts-OFL.txt` in `generateBundle`.
- `scripts/build-single.mjs`:
  - `inlineFonts()` rewrites `url(./x.woff2)` into `data:font/woff2;base64` URLs;
  - it throws if any relative `url(./` is left in the CSS;
  - the embed output no longer copies font links.
- `desktop/main.cjs` `CSP`: `style-src 'self' 'unsafe-inline'`, `font-src 'self'`, no remote host.
- `playwright.config.ts`: `ignoreHTTPSErrors` is removed.
- `README.md` credits and `docs/STEAM.md` are updated.

**Platform wiring (`361c4c1`)**
- `src/main.ts`:
  - `startPlatform()` races `initPlatform()` against `PLATFORM_INIT_TIMEOUT_MS = 4000` and logs a
    warning on timeout or error;
  - `boot()` is now `async` and creates `new App(canvas, ui, p)` only after that;
  - on desktop only, it calls `p.flush()` on `pagehide`, `beforeunload` and on `visibilitychange`
    when the page becomes hidden.
- `src/meta/save.ts` `storage()` returns `platform().storage`. `loadSave`, `writeSave` and
  `clearSave` keep their signatures.
- `src/platform/storage.ts`: unchanged apart from a comment. The pre-existing
  `createMirroredStorage` does the following:
  - `hydrate()` returns `'file' | 'migrated-local' | 'empty' | 'error'`;
  - writes of the save key are debounced by 500 ms to the file;
  - `removeItem` writes `CLEARED_SAVE = '{}'`;
  - `flush()`.
  `safeStorage` falls back to memory when localStorage throws.
- `src/platform/platform.ts`:
  - `Platform` gains `setFullscreen(on)` and `onFullscreenChange(fn)`;
  - `DesktopBridge` gains an optional `onFullscreenChange?`;
  - `platform()`, `initPlatform()` and `setPlatformForTests()` already existed.
- `src/platform/desktop.ts`:
  - `createDesktopPlatform` subscribes `bridge.onFullscreenChange`;
  - `applyFullscreen()` backs `toggleFullscreen` and `setFullscreen`;
  - `flush()` sends presence, then the save file, then `bridge.achievements.flush()` (retries
    queued unlocks and stores stats);
  - `quit()` flushes first.
- `src/platform/web.ts`: `setFullscreen` uses the Fullscreen API and `fullscreenchange`. The web
  platform's `canQuit` is `false`.
- `src/platform/link.ts` (new):
  - `PresenceState` mirrors `State` in `src/app.ts`;
  - `PresenceSnapshot` is the read-only view the App passes in;
  - `presenceFor()` maps it:
    - title → menu, or hangar when the screen is `hangar`/`workshop`;
    - lobby → hangar;
    - results → results with `lastPlayers`;
    - otherwise → `runPresence(...)`, with the sector clamped to 1–4 from `world.sector + 1`;
  - `PRESENCE_EVERY = 1` (s);
  - `PlatformLink` has `syncAchievements(earned)` (once per session), `unlocked(defs)`,
    `runEnded()` (calls `platform.flush()`), `presenceDue(realDt)` and `setPresence(snapshot)`.
- `src/platform/presence.ts`:
  - new mode `'boss'` with `Presence.boss?: BossId`;
  - `sanitizePresence` turns an unknown boss into `'run'`;
  - `runPresence` priority is overtime > victory > boss > run;
  - the throttle (`createPresenceThrottle`, default 10 000 ms) is unchanged: mode changes are sent
    at once, same-mode updates at most every 10 s.
- `desktop/validate.cjs`:
  - `BOSS_IDS`;
  - `'boss'` in `PRESENCE_MODES` and `PRESENCE_TOKENS` (`#Status_Boss`);
  - `'boss'` in `PRESENCE_KEYS`;
  - `presenceToSteam` sends `boss` only for a known id, and otherwise falls back to `#Status_Run`.
- `steam/rich_presence_english.vdf`: `#Status_Boss`, `#Boss_warden`, `#Boss_hydra`,
  `#Boss_voidheart` (the final boss is not named).
- `desktop/main.cjs`: sends `ss:fullscreen` on the window's `enter-full-screen` and
  `leave-full-screen` events. `desktop/preload.cjs` exposes `onFullscreenChange(fn)`.
- `src/app.ts` (`App`):
  - constructor: `platform: Platform = currentPlatform()`, `this.link = new PlatformLink(platform)`;
  - after `loadSave()`, `link.syncAchievements(Object.keys(save.achievements))`;
  - `input.allowCtrlDash = platform.kind === 'desktop'`;
  - `new UI(..., this.desktopUi())`;
  - `platform.onFullscreenChange((on) => this.ui.fullscreenChanged(on))`;
  - `desktopUi()` returns null unless `platform.canQuit`;
  - `presenceSnapshot()` is read-only and uses `world.players[0]`, never the P1 aliases;
  - `endRun()`: `link.unlocked(summary.achievements)`, `link.runEnded()`, `lastRunPlayers`;
  - `buy()` (Workshop): `link.unlocked(unlocked)`;
  - the `frame` loop: `if (link.presenceDue(realDt)) link.setPresence(this.presenceSnapshot())`,
    on real time only.
- `src/ui/ui.ts`:
  - `DesktopUi` interface;
  - the `UI` constructor takes a third parameter, `desktop: DesktopUi | null = null`;
  - `showTitle()` adds `[data-act="quit"]` "Quit to desktop" (Settings loses `wide` on desktop);
  - `showSettings()` adds `#set-fullscreen` after the Screen shake slider. It is excluded from
    `settingsChanged`, disabled and checked on Steam Deck;
  - `fullscreenChanged(on)`.
- `src/ui/style.css`: `#set-fullscreen:disabled`.
- Docs: `docs/GAME_DESIGN.md` (Platform, save, platform layer, fonts), `docs/STEAM.md` and
  `README.md`.

### 5.3 Fixes to make in this task (small; each is a gap against the owner brief or the branch's own design)
1. **Steam Deck lock is UI-only.** In `desktop/main.cjs`, `setFullscreen(on)` (called by IPC
   `win:fullscreen` and by the `before-input-event` F11/Alt+Enter handler) ignores `steamDeck`. A key
   press on a Deck therefore leaves fullscreen while Settings shows the switch checked and disabled,
   and `UI.fullscreenChanged` skips disabled toggles.
   - Fix: when `steamDeck` is true, `setFullscreen` keeps the window fullscreen, returns `true` and
     does not overwrite `settings.fullscreen`.
   - Add a check to launch 3 of `scripts/desktop-smoke.mjs`: send F11 with `wc.sendInputEvent`, as
     launch 1 does, and assert the window is still fullscreen.
2. **The single-file build ships the fonts without their licence.** `licenses/fonts-OFL.txt` exists
   only in `dist/` (and therefore in the desktop build). In `scripts/build-single.mjs`, append the
   text of `src/assets/fonts/OFL.txt` as an HTML comment to both `shardstorm.html` and `embed.html`
   (about 5 KB).
   - Make the script throw if the file is missing.
   - Escape any `--` in the text, because `--` is not allowed inside an HTML comment.
3. **Docs:** after merging, update `docs/HANDOFF.md`:
   - the branch table: `wip/wave3-platform` merged;
   - task 2: done, with the numbers from §9.
   Also update `docs/STEAM.md` §11 row 1 if fix 1 changes its wording.

### 5.4 Interfaces later tasks rely on (keep stable)
- `App` keeps a private field named `platform`. `scripts/desktop-smoke.mjs` reads
  `window.shardstorm.platform.hydrated()`.
- `platform()` / `setPlatformForTests()` (tests), `Platform.flush()`, `PlatformLink`.
- `UI` constructor third parameter, and `#set-fullscreen` / `[data-act="quit"]` selectors (used by
  e2e and the smoke).
- Task 3c adds an "Enhanced graphics" setting and task 3d adds a "Grid motion" slider, both in
  `showSettings()`. Put them with the visual settings. Leave `#set-fullscreen` as the only setting
  excluded from `settingsChanged`.

## 6. Settings and save data

- **No new `SaveData` or `Settings` fields** and no save migration.
  - The web save is unchanged (`shardstorm.save`).
  - Desktop: `<userData>/save/shardstorm-save.json` plus `.bak`, written atomically by
    `desktop/savefile.cjs`. userData is pinned by `app.setName('SHARDSTORM')`; tests override it
    with `SHARDSTORM_USER_DATA`.
  - Reset progress writes `{}`, which the next boot reads as a fresh save.
- **Fullscreen is window state, not save data.** It lives in `<userData>/desktop-settings.json`
  (`{"fullscreen": boolean}`, default `true`, see `loadSettings()` in `desktop/main.cjs`). That file
  is machine-specific and not cloud-synced. `--windowed` / `SHARDSTORM_WINDOWED=1` force a window;
  Steam Deck (`SteamDeck=1` or the Steam API) forces fullscreen.
- **UI placement:**
  - title menu: "Quit to desktop" sits next to Settings (desktop only);
  - Settings: "Fullscreen" sits after "Screen shake", with the hint "Also F11 or Alt+Enter", or
    "Always on with Steam Deck" (shown checked and disabled).
  - The web shows neither.

## 7. Accessibility, mobile, co-op and performance

- **Accessibility:**
  - new controls must be reachable by keyboard and gamepad focus, like the other `.btn` and
    `.toggle` controls;
  - the disabled Deck toggle stays readable (opacity 0.5);
  - no new flashing or screen shake.
- **Mobile:** the web build adds no control. Run the e2e mobile (Pixel 7) project.
- **Co-op:**
  - presence reports `players: world.players.length` and P1's ship (`world.players[0].ship`);
  - more than one pilot also sets `steam_player_group_size` in `presenceToSteam`;
  - no new P1-alias use (`tests/no-p1-alias.test.ts` is unchanged).
- **Determinism:**
  - presence and saves read sim state only, and run on real frame time (`realDt`);
  - nothing draws from sim RNG streams;
  - the golden master is untouched.
- **Budgets:**
  - presence is evaluated at most once per second (`PRESENCE_EVERY`), and at most one
    same-mode update every 10 s reaches Steam;
  - desktop save mirroring is debounced by 500 ms;
  - the 4 s boot timeout is the worst-case start delay with a broken bridge;
  - fonts add 67.6 KB of WOFF2, loaded lazily per face;
  - the single file grows by about 98 KB (target: at most 400 KB raw for `shardstorm.html`;
    report it).

## 8. Tests

- **Already on the branch (keep; they must pass):**
  - `tests/platform.test.ts`: suites "save routing through the platform", "platform link (what the
    App reports)", "rich presence mapping (steam.md 2.5)" and "fullscreen", plus the existing
    "web bundle isolation".
  - `tests/desktop.test.ts`: boss presence, and every validator token exists in the VDF.
  - `tests/fonts.test.ts` (new): no third-party host in `index.html`, the three families come from
    local files with `swap` and the OFL licence, and the desktop CSP allows no remote host.
  - `e2e/smoke.spec.ts`: "the web build uses its bundled fonts, makes no third-party requests and
    has no desktop-only controls".
  - `scripts/desktop-smoke.mjs`: 47 checks across 3 launches (fresh profile, file hydration and
    close flush, migration and Steam Deck).
- **Add:**
  - the Deck F11 check from §5.3 (the smoke goes to 48 checks);
  - optionally, a `tests/fonts.test.ts` case that reads `scripts/build-single.mjs` and asserts it
    references `OFL.txt`.
- **Must NOT change:**
  - `tests/golden.solo.test.ts` (byte-identical to the post-task-1 version);
  - `tests/determinism.guard.test.ts`;
  - `PENDING_MIGRATION` in `tests/no-p1-alias.test.ts`;
  - the "web bundle isolation" regex;
  - the smoke check "web bundle has no steamworks/electron imports".

## 9. Acceptance checklist

Run each of these and report the results:
- [ ] `npm ci && npm run typecheck && npm test`: all pass. Report the count (expect at least 339).
- [ ] `git diff <pre-merge PR head> HEAD -- tests/golden.solo.test.ts` is empty.
- [ ] `npm run build:single`: report the `shardstorm.html` and `embed.html` sizes, and confirm the
      OFL comment is present.
- [ ] `npm run e2e`: the desktop and mobile projects both pass. Use `E2E_PORT=<free port>` and make
      sure nothing else listens there (`reuseExistingServer` would otherwise test a stale build).
- [ ] `npm run desktop:smoke` on Linux: "DESKTOP SMOKE: 48 checks passed". The script re-runs
      itself under `xvfb-run -a` when `DISPLAY` is unset.
- [ ] `npm run steam:achievements -- --check`: "up to date".
- [ ] **Fonts render the same as before.** Build the pre-merge commit and the merge into separate
      out dirs (`npx vite build --outDir <tmp>/before` and `.../after`), and serve each with
      `npx vite preview --outDir <dir> --port <p> --strictPort`.
      - Screenshot the title, Settings and a run at 1280x720 and on Pixel 7. For the run, open
        `/?autoplay&warp=30` and click `#screen-title [data-act="play"]`; the warp applies when the
        run starts.
      - Compare logo (Tektur 900), menu (Chakra Petch) and HUD/meta numbers (Kode Mono).
      - The "before" build needs internet access to fonts.googleapis.com. If that is blocked, say
        so, and rely on the after screenshots plus the e2e font test.
- [ ] Optional Electron screenshots: title and Settings, normal and with `SteamDeck=1`. Use a
      throwaway Playwright `_electron` script that you do not commit.
- [ ] After pushing, CI: `ci` (Linux e2e) and `desktop` (Windows/macOS/Linux check, achievements
      check, Linux smoke, packaging) are green.

## 10. Pitfalls and known issues

1. **Init race.** Never create the `App` before `startPlatform()` resolves: desktop hydration must
   run before `loadSave()`. Two rare data-loss paths remain open:
   - if init times out (4 s) or `hydrate()` returns `'error'`, the App runs on the localStorage
     copy, and its next write overwrites the cloud file;
   - if hydration completes after the timeout, it overwrites localStorage under a running App.

   Do not change this without asking the owner. Mention it in the PR description.
2. **Determinism closure.** Keep every sim-side import of `src/meta/save.ts` type-only. A runtime
   import would pull `src/platform/*` into the closure that `tests/determinism.guard.test.ts` scans.
3. **Web bundle string check.** The desktop smoke greps the built JS for
   `/steamworks|require\(["']electron["']\)/`, which is case-sensitive. Never put a lowercase
   "steamworks" string in runtime code under `src/`. Comments are stripped, and "Steamworks" is fine.
4. **Font subset.** Only the latin `unicode-range` is bundled. UI symbols used in the code still
   fall back to system fonts: ◈ ★ ▲ ● ■ ◆ ─ ░▒▓ ✓, and Greek ω ϟ in `src/story/script.ts` and
   `src/game/content/*`. The old Google CSS also served latin-ext and other per-family subsets.
   *Unverified* whether any of these glyphs used to render in a game font. If a visible difference
   shows up, report it; do not add subsets without the owner.
5. **Canvas text.** `src/render/palette.ts` (`FONT_DISPLAY`, `FONT_BODY`, `FONT_MONO`) uses the same
   families. Faces load lazily, so the first frames may draw in a fallback font. This is the same
   as before; do not add preloads in this task.
6. **Interaction with task 3a (inline galaxy worker).**
   - The desktop `CSP` has no `worker-src`, so a `blob:` worker is blocked there and the galaxy
     uses its main-thread fallback. Task 3a must add `worker-src 'self' blob:`; that is not this
     task.
   - The e2e font test and the desktop smoke count every non-origin URL as remote. If `blob:`
     worker URLs appear, exclude `blob:` (like `data:`), and never allow `http(s):`.
7. **`scripts/build-single.mjs` throws on any relative `url(./` left in the CSS.** A later task that
   adds a CSS asset must inline it there too.
8. **Deliberate deviations from steam.md; keep them:**
   - presence time is `m:ss` (`TIME_RE` in `desktop/validate.cjs`) rather than `04:12`;
   - extra `boss` and `overtime` modes;
   - F11 / Alt+Enter are handled in main (`before-input-event`) rather than the renderer;
   - macOS Ctrl+Cmd+F comes from the app menu.

   The new VDF tokens must be uploaded in Steamworks by the owner (`docs/STEAM.md` §7).
9. **Quit placement.** steam.md §5 row 11 says "Quit from the pause menu". The branch puts "Quit to
   desktop" only on the title screen, and docs/STEAM.md §11 row 11 says "end the run from the pause
   menu first". The owner brief asked only for the title screen, so this is an **open question for
   the owner**; do not add it unasked. The button has no confirmation dialog, but nothing is lost
   because it flushes first.
10. **Electron binary.** `npm ci` downloads it in a postinstall step. If it is missing, run
    `node node_modules/electron/install.js`; if there is no network, rely on the CI Linux smoke.
    Install xvfb with `sudo apt-get install -y xvfb`. Do not use `--ozone-platform=headless`: it
    crashes with Electron 44 (steam.md §10, run C).
11. **Old tooling paths.** Prototype tool scripts in `prototypes/*/tools/` use absolute paths from
    the original build machine and do not apply here.

## 11. Out of scope

- Real Steam client testing (owner, `docs/STEAM.md` §12).
- Leaderboards (steamworks.js has none).
- The UI-scale setting and the gamepad audit (steam.md §5 rows 2–4).
- Pause-on-blur with `backgroundThrottling:false` (steam.md §2.7).
- A "Quit to desktop" in the pause menu (pitfall 9).
- Store assets.
- Any `src/render/*` change.

## Appendix A: rebuilding without the branch (last resort)

- **Fonts:** take them from npm, version 5.3.0, from each package's `files/` directory, and verify
  the SHA-256 hashes below. The OFL text is each package's `LICENSE`, with a header naming the files
  and the copyrights: Chakra Petch 2018, Kode Mono 2023, Tektur 2023.

  | Package | File | SHA-256 |
  |---|---|---|
  | `@fontsource/chakra-petch` | `chakra-petch-latin-400-normal.woff2` | `7d75be85dd1627e27ec151e9a3701e661bc4f8c2a93611bdd92f3a05d6bbd942` |
  | `@fontsource/chakra-petch` | `chakra-petch-latin-500-normal.woff2` | `36ad966cb653de70ba37355c41003b02de8940b2df6cbcd46480a6ad8cadd65d` |
  | `@fontsource/chakra-petch` | `chakra-petch-latin-600-normal.woff2` | `a5888696e9eb1b4bbbecc8eb3922b8369f49d4bddb72263e033cbd17f399be76` |
  | `@fontsource/chakra-petch` | `chakra-petch-latin-700-normal.woff2` | `ce5095dc1cb200aaa939e38067a0677018d10e9f26ec38cdcf1557ac524fc775` |
  | `@fontsource-variable/kode-mono` | `kode-mono-latin-wght-normal.woff2` (`font-weight: 400 700`) | `41841fe357f8609fef1ba3a4803344fb158154fd977a956a3a77573c3d5a7fba` |
  | `@fontsource-variable/tektur` | `tektur-latin-wght-normal.woff2` (`font-weight: 500 900`) | `2c4e3f0723427b12e30b10fd233c362244963124ecbdd3a3cba40dcf78c3f22e` |

- **Code:** implement exactly the units listed in §5.2, with the same names. The pre-existing
  modules are on the PR branch: `src/platform/{platform,desktop,web,storage,presence,achievements}.ts`
  and `desktop/*.cjs`. Then write the tests in §8 and the smoke checks listed in
  `docs/STEAM.md` / README ("title screen, bundled fonts, fullscreen setting and F11, a run, save
  file and its migration, quit flush, Steam Deck, no-Steam fallback").
