# Releasing SHARDSTORM on Steam

This guide covers the desktop build: what is already in the repo, what only the owner can do in
Steamworks, and how to build and upload a release. Items marked **[check in Steamworks]** come from
Valve's partner documentation and could not be verified from the build sandbox. Confirm them in
the Steamworks UI before relying on them.

- [1. What is in the repo](#1-what-is-in-the-repo)
- [2. Owner checklist (in order)](#2-owner-checklist-in-order)
- [3. Steamworks account, fee and AppID](#3-steamworks-account-fee-and-appid)
- [4. Wire the AppID into the repo](#4-wire-the-appid-into-the-repo)
- [5. Store page and art](#5-store-page-and-art)
- [6. Achievements](#6-achievements)
- [7. Rich presence](#7-rich-presence)
- [8. Steam Cloud (Auto-Cloud)](#8-steam-cloud-auto-cloud)
- [9. Controllers and Remote Play Together](#9-controllers-and-remote-play-together)
- [10. Installation, launch options and the Linux runtime](#10-installation-launch-options-and-the-linux-runtime)
- [11. Steam Deck checklist](#11-steam-deck-checklist)
- [12. Testing with a real Steam client](#12-testing-with-a-real-steam-client)
- [13. Building and uploading (SteamPipe and CI)](#13-building-and-uploading-steampipe-and-ci)
- [14. Review and release](#14-review-and-release)
- [15. Known limitations](#15-known-limitations)
- [16. How the game uses the platform layer](#16-how-the-game-uses-the-platform-layer)
- [17. Troubleshooting](#17-troubleshooting)

---

## 1. What is in the repo

```
desktop/main.cjs        Electron main: window, app:// protocol, IPC, quit/flush, single instance
desktop/preload.cjs     sandboxed bridge -> window.shardstormDesktop (frozen, minimal)
desktop/steam.cjs       the ONLY module that loads steamworks.js; never throws, no-op without Steam
desktop/savefile.cjs    atomic JSON save in <userData>/save/ (Auto-Cloud syncs this folder)
desktop/validate.cjs    validation of every renderer request (allowlists, sizes, formats)
desktop/build-flags.json  {"steamRelease": false, "steamAppId": 0}; CI stamps the real values
src/platform/           web/desktop platform layer the game runs on (saves, achievements, presence)
steam/                  achievements.json, rich presence tokens, SteamPipe VDFs, dev steam_appid.txt
electron-builder.yml    unpacked Windows / macOS (universal) / Linux builds, asar, fuses, no updater
.github/workflows/desktop.yml  matrix build + optional manual Steam upload
scripts/desktop-smoke.mjs      launches the real app with Playwright and checks it end to end
```

**Library:** [steamworks.js](https://github.com/ceifa/steamworks.js) 0.4.0 (MIT), pinned. It ships
prebuilt N-API binaries for Windows x64, Linux x64 and macOS x64/arm64 and loads under Electron 44
without a rebuild.

**Supported Steam features:** achievements, rich presence, overlay, Steam Deck detection, player
name, game language, build id, Auto-Cloud saves (no API needed), Remote Play Together (no API
needed). Integer stats exist in the library but are not used yet.

**Not supported by steamworks.js 0.4.0:** leaderboards, float stats, an "overlay opened" event, a
"stats received" event, the Remote Play API. The bridge reports `leaderboards.supported = false`, so
the game keeps its local Records and Daily Run. If Steam leaderboards become a priority, swap the
backend in `desktop/steam.cjs` for `steamworks-ffi-node`; nothing else changes.

**Security model:** the renderer runs with `contextIsolation`, `sandbox` and no Node. It can only
call the frozen `window.shardstormDesktop` API. The main process re-validates every call: achievement
names against `steam/achievements.json`, rich presence against fixed keys and values, saves must be
JSON objects of at most 1 MiB, and only pages served from `app://game/` may call it. The packaged app
sets the Electron fuses `RunAsNode`, `NODE_OPTIONS`, `--inspect`, and file-protocol privileges off,
and turns asar integrity and asar-only loading on.

**Window:** fullscreen by default (locked on Steam Deck unless the developer windowed override is used).
The **Fullscreen** switch in Settings, F11 or Alt+Enter toggle it, and the choice is remembered in
`<userData>/desktop-settings.json` (machine-specific, so it is not part of the cloud save). On Steam
Deck the switch is shown locked on. Launch with `--windowed` (or `SHARDSTORM_WINDOWED=1`) to force a
window. macOS Ctrl+Cmd+F and the native green button also toggle fullscreen and update the switch,
but those native changes currently are not persisted. No menu bar on Windows and Linux.
The title screen has **Quit to desktop**.

**Fonts:** Tektur, Chakra Petch and Kode Mono are bundled (`src/assets/fonts/`, latin WOFF2), so the
game never contacts a third-party host and the CSP allows only the app's own files.

**Logs:** `<userData>/logs/main.log`, rewritten on every launch. Ask players for it in bug reports.

`<userData>` is `%APPDATA%\SHARDSTORM` on Windows, `~/Library/Application Support/SHARDSTORM` on
macOS and `~/.config/SHARDSTORM` on Linux.

---

## 2. Owner checklist (in order)

1. Steamworks partner account, Steam Direct fee, AppID ([section 3](#3-steamworks-account-fee-and-appid)).
2. Put the AppID and depot IDs into the repo and CI ([section 4](#4-wire-the-appid-into-the-repo)).
3. Store page, art, "Coming Soon" for at least two weeks ([section 5](#5-store-page-and-art)).
4. Achievements, rich presence, Auto-Cloud, controller and Remote Play settings ([sections 6-9](#6-achievements)).
5. Depots, launch options, Linux runtime ([section 10](#10-installation-launch-options-and-the-linux-runtime)).
6. Test on a machine with a Steam client, then on a Steam Deck ([sections 11-12](#11-steam-deck-checklist)).
7. Upload a build to a beta branch, then submit for review ([sections 13-14](#13-building-and-uploading-steampipe-and-ci)).
8. Optional: code signing for Windows and macOS ([section 13.4](#134-code-signing-optional)).

Every change in the Steamworks UI must be **published** (Publish tab) before Steam clients see it.

---

## 3. Steamworks account, fee and AppID

1. Sign up at **partner.steamgames.com** as a company or individual. You need legal details, bank
   information, a tax interview (W-8/W-9) and identity verification.
2. Pay the **Steam Direct fee: USD 100 per app**. It is recoupable after USD 1,000 of adjusted gross
   revenue. **[check in Steamworks]** There is a 30-day wait after your first payment before the
   first release.
3. The fee creates the **AppID** and default **depot IDs**. Find them under
   Steamworks > your app > SteamPipe > Depots. Create three depots if they do not exist: Windows,
   macOS, Linux + SteamOS, and set each depot's OS filter.

---

## 4. Wire the AppID into the repo

| Where | What to set |
| --- | --- |
| `steam/app_build.vdf` | `"AppID"` and the three depot IDs (replace `1234560` and `1234561..3`) |
| `steam/depot_build_*.vdf` | `"DepotID"` in each file |
| GitHub > Settings > Secrets and variables > Actions > **Variables** | `STEAM_APP_ID`, `STEAM_FIRST_DEPOT_ID` (the Windows depot; macOS and Linux must be +1 and +2, or edit the workflow), `STEAM_DEPLOY_ENABLED` = `true` once you want CI uploads |
| GitHub > **Secrets** | `STEAM_USERNAME`, `STEAM_CONFIG_VDF` ([section 13.3](#133-ci-upload-github-actions)) |
| GitHub > Settings > Environments | create `steam` with required reviewers |
| `steam/steam_appid.txt` | optional: your real AppID instead of 480 for local testing |

How the shell finds the AppID at runtime, first match wins: `SHARDSTORM_STEAM_APPID` env,
`SteamAppId` env (Steam sets it when it launches the game), `desktop/build-flags.json`
(`steamAppId`, stamped by CI from `vars.STEAM_APP_ID`), then `steam_appid.txt` (repo `steam/` folder
in dev only, the working directory, or next to the executable).

When CI stamps `"steamRelease": true`, a packaged build that is started outside Steam relaunches
itself through the Steam client (`restartAppIfNecessary`). Dev runs and non-Steam builds never do
this, because outside a release it can try to exec `steam.sh`.

---

## 5. Store page and art

Fill in Steamworks > Store page: short and long description, tags, system requirements, price and
the content survey. Tick these features **[check in Steamworks]**: Single-player, Shared/Split Screen
Co-op, Remote Play Together (and Remote Play on TV / Phone / Tablet), Steam Achievements, Steam
Cloud, Full Controller Support. Complete the **IARC** age-rating questionnaire (free).

The store page must be public as **Coming Soon for at least two weeks** before release, and goes
through **store page review** (about 3-5 business days) **[check in Steamworks]**.

Art sizes (2024-2025 Steam asset spec; the upload pages reject wrong sizes) **[check in Steamworks]**:

| Asset | Size (px) | Notes |
| --- | --- | --- |
| Header capsule | 920 x 430 | logo plus key art |
| Small capsule | 462 x 174 | logo must stay readable |
| Main capsule | 1232 x 706 | front-page carousel |
| Vertical capsule | 748 x 896 | sale pages |
| Page background | 1438 x 810 | optional, low contrast |
| Library capsule | 600 x 900 | library grid |
| Library header | 920 x 430 | |
| Library hero | 3840 x 1240 | no text or logo; keep the centre ~860 x 380 clear |
| Library logo | up to 1280 x 720 | transparent PNG, placed over the hero |
| Screenshots | 1920 x 1080 (16:9), at least 5 | show co-op, bosses, the four sectors |
| Trailer | 1920 x 1080 MP4, 5000+ kbps | optional but recommended |
| Community icon | 184 x 184 | JPG |
| Achievement icons | 256 x 256 | 2 per achievement (earned + grey): 46 files for 23 achievements |
| App icons | `build/icon.png` 1024 x 1024, `build/icon.ico` (16/32/48/256), `build/icon.icns` | picked up by electron-builder automatically |

---

## 6. Achievements

Steamworks > Stats & Achievements > Achievements. Create one entry per row of
`steam/achievements.json` (23 entries: the 21 game achievements plus the co-op `ACH_SQUAD` and
`ACH_MEDIC`):

- **API Name**: the `apiName` column, exactly (for example `ACH_FIRST_RUN`). The game unlocks by this name.
- **Display name / Description**: the `displayName` and `description` columns.
- **Hidden**: the `hidden` column (only the final boss, `ACH_VOIDHEART`, is hidden).
- **Icons**: 256 x 256 earned and unearned.
- No stat-based progress is configured; the game unlocks achievements directly.

Then **Publish**. If an achievement changes in `src/meta/achievements.ts`, run
`npm run steam:achievements`, commit the JSON, and update Steamworks. The desktop main process
refuses any API name that is not in the JSON.

How unlocking behaves: the game reports every achievement as it is earned (end of a run, Workshop
purchases). An unlock that Steam rejects (for example because the player's stats have not arrived yet
just after launch) is queued and retried every 2 seconds for up to 60 seconds, and again at the end
of each run and before quitting. At startup the game re-syncs everything the local save has earned,
once per session, which also covers offline play, non-Steam launches and achievements earned before
the Steam release. Steam skips the ones it already has.

---

## 7. Rich presence

Upload `steam/rich_presence_english.vdf` in Steamworks > Community > Rich Presence and publish.
Friends then see, for example, "The Garnet Nebula · 4:12 · the Already Gone · 3 pilot(s)". Without
the uploaded file they only see "Playing SHARDSTORM". The game sends at most one update every 10
seconds, plus one on every mode change. With more than one local pilot it also sets
`steam_player_group_size`, which groups the players in the friends list.

| Where the player is | `steam_display` | Other keys |
| --- | --- | --- |
| Title screen, Records, Settings, Ship's Log | `#Status_Menu` | |
| Hangar, Workshop, co-op lobby | `#Status_Hangar` | |
| In a run (solo or co-op, also paused or on a level-up) | `#Status_Run` | `sector`, `time`, `ship`, `players` |
| A capital ship is on the field | `#Status_Boss` | `boss` (`warden`, `hydra`, `voidheart`) and the run keys |
| The 10:00 victory screen | `#Status_Victory` | run keys |
| Overtime | `#Status_Overtime` | run keys |
| Results screen | `#Status_Results` | `ship`, `players` |

`ship` is P1's ship in co-op. The final boss's token is worded without its name, so friends'
lists do not spoil it (its achievement is hidden for the same reason).

---

## 8. Steam Cloud (Auto-Cloud)

The desktop save is `<userData>/save/shardstorm-save.json` (plus a `.bak`), written atomically.
The game itself still reads and writes its save synchronously; on desktop the platform layer adds:

- **Boot:** before the game loads its save, the file is copied into the renderer's storage. The file
  is the source of truth, so a save Steam synced from another machine wins.
- **Migration:** if there is no file yet but the renderer's localStorage has a save (a desktop build
  from before the save file), that save is written to the file once, so it reaches the cloud.
- **Writes:** every save is mirrored to the file 500 ms later (debounced). The end of a run writes it
  at once, and so do quitting (Quit to desktop, closing the window, Steam's "Exit game": the shell
  waits up to 500 ms for the game to flush), hiding the window and unloading the page.
- **Reset progress** writes `{}` to the file (Auto-Cloud syncs a file, not a deletion); the next boot
  reads that as a fresh save.
Configure Steamworks > Application > Steam Cloud **[check in Steamworks: root names]**:

- Byte quota: **1 MB** per user; number of files: **4**.
- Auto-Cloud root paths:

| Root | Subdirectory | Pattern | OS |
| --- | --- | --- | --- |
| `WinAppDataRoaming` | `SHARDSTORM/save` | `*` | Windows |
| `MacAppSupport` (root override) | `SHARDSTORM/save` | `*` | macOS |
| `LinuxXdgConfigHome` (root override) | `SHARDSTORM/save` | `*` | Linux |

Only the `save/` subfolder: `<userData>` also holds Chromium caches that must never be synced.
Steam resolves cloud conflicts with its own dialog before the game starts, so the game has no
conflict UI. Under Proton the Windows root maps inside the prefix and still syncs.

---

## 9. Controllers and Remote Play Together

- **Controllers:** the game reads pads through the browser Gamepad API. In Steamworks > Steam Input,
  choose the **Gamepad** default template and opt in to Xbox, PlayStation, Switch and generic
  controllers. Fill in the controller survey as **Full Controller Support**.
- **Remote Play Together:** leave Remote Play enabled (Steamworks > Application > Remote Play) and
  tick the Remote Play categories on the store page. Guests' pads appear on the host as extra
  gamepads, so local co-op works over Remote Play with no code. Guests' keyboards share the host's
  single keyboard, so at most one keyboard player.

---

## 10. Installation, launch options and the Linux runtime

Steamworks > Installation > General > Launch Options **[check in Steamworks]**:

| OS | Executable | Arguments |
| --- | --- | --- |
| Windows | `SHARDSTORM.exe` | |
| macOS | `SHARDSTORM.app` | |
| Linux + SteamOS | `shardstorm` | `--no-sandbox` |

Optional extra launch option "Play without Steam overlay" with argument `--no-steam-overlay`, for
players whose GPU drivers misbehave with the overlay.

Linux: choose the **Steam Linux Runtime 3.0 (sniper)** in Steamworks > Installation > Linux Runtime.
`--no-sandbox` is needed because Chromium's own sandbox cannot start inside Steam's
pressure-vessel container; the renderer stays isolated by `contextIsolation` and the IPC validation,
and the app only loads its own files. Fallback if the native Linux build has trouble on Deck: force
Proton for the app (Steamworks > Steam Deck compatibility) and it runs the Windows build.

---

## 11. Steam Deck checklist

| # | Check | Status in the code |
| --- | --- | --- |
| 1 | Runs at 1280 x 800 and handles 1280 x 720 | window is 1280 x 800; fullscreen forced on Deck (`SteamDeck=1` or the Steam API), including F11/Alt+Enter and bridge requests; the Settings switch is locked on and the machine's saved windowed preference is preserved. The developer windowed override bypasses the lock. |
| 2 | Every screen works with a gamepad alone (title, hangar, workshop, records, settings, level-up, pause, results, story, co-op join) | audit needed |
| 3 | Controller glyphs when a pad is in use; no "press Enter / click" prompts | audit needed |
| 4 | Smallest text at least 9 px at 1280 x 800 (Valve recommends 12 px) | audit needed |
| 5 | No launcher, no external browser, no account login | yes: the app opens straight into the game, external links open only `https://` URLs |
| 6 | On-screen keyboard for text entry | no text entry today |
| 7 | Default controller config set in Steamworks | owner ([section 9](#9-controllers-and-remote-play-together)) |
| 8 | At least 30 fps sustained by default | measure on hardware; consider a "reduced effects" default on Deck |
| 9 | Suspend / resume | the game pauses on blur; verify on hardware |
| 10 | Native Linux under sniper with `--no-sandbox`, Proton fallback | test both on hardware |
| 11 | Quit from the game and from Steam's "Exit game" | "Quit to desktop" on the title screen (end the run from the pause menu first), the window close and `SIGTERM` all flush the save first |
| 12 | Submit for Deck review | owner, in Steamworks > Steam Deck compatibility |

---

## 12. Testing with a real Steam client

The CI and the sandbox have no Steam client, so these must be checked on a developer machine:

1. Install and log in to Steam. AppID 480 (Spacewar) is free to every account.
2. `npm ci && npm run desktop:dev`. `steam/steam_appid.txt` (480) is picked up in dev. The log should
   say `steam: initialised (app 480)`. Shift+Tab should open the overlay (most reliable on Windows).
3. Spacewar has its own achievements (`ACH_WIN_ONE_GAME`, ...), not ours, so our unlocks will be
   refused by Steam on 480. To test real achievements, rich presence and Auto-Cloud, use your own
   AppID once the achievements are published, and own a copy (Steamworks gives developer keys).
4. Check: the achievement toast appears; it is still unlocked after a restart; rich presence shows
   in a friend's list; the save syncs to a second machine; `shardstorm-save.json` appears in the
   Auto-Cloud folder.

Environment switches for testing: `SHARDSTORM_NO_STEAM=1` (or `--no-steam`) skips Steam,
`SHARDSTORM_NO_OVERLAY=1` (or `--no-steam-overlay`) skips the overlay, `SHARDSTORM_WINDOWED=1`
starts windowed, `SHARDSTORM_USER_DATA=<dir>` uses a throwaway profile.

---

## 13. Building and uploading (SteamPipe and CI)

### 13.1 Local build

```bash
npm ci
npm run desktop:smoke   # optional: real-window smoke test (Linux needs xvfb-run without a display)
npm run desktop:dist    # typecheck + tests + web build + achievement check + unpacked app in release/
```

Build each OS on that OS: Windows gives `release/win-unpacked/`, macOS gives
`release/mac-universal/` (x64 + arm64), Linux gives `release/linux-unpacked/`. The packaged app
contains only `dist/`, `desktop/`, `steam/achievements.json`, `package.json` and steamworks.js
(binaries for that OS only, unpacked from the asar). It does **not** contain `steam_appid.txt`.

### 13.2 Manual upload

1. Install [steamcmd](https://developer.valvesoftware.com/wiki/SteamCMD) and create a **dedicated
   builder account** with only build/upload permissions for this app.
2. Put the three unpacked folders into `release/` (build them or download the CI artifacts and
   `tar -xzf` them there).
3. Fill in the real IDs in `steam/*.vdf`, then:
   `steamcmd +login <builder> +run_app_build "$(pwd)/steam/app_build.vdf" +quit`
4. In Steamworks > SteamPipe > Builds, set the new build live on a **beta** branch first. Promote
   it to `default` only after testing.

Upload macOS and Linux depots from macOS or Linux; content uploaded from Windows loses the
executable bits.

### 13.3 CI upload (GitHub Actions)

`.github/workflows/desktop.yml` runs on version tags, on pull requests that touch the desktop files,
and by hand. It builds all three OSes (`npm run check`, the achievement-table check, a Playwright
desktop smoke test on Linux, electron-builder, a packaged smoke run) and uploads
`win-unpacked.tar.gz`, `mac-universal.tar.gz` and `linux-unpacked.tar.gz` as artifacts.

The **deploy** job is off by default. It runs only when you start the workflow by hand with
**deploy = true** and the variable `STEAM_DEPLOY_ENABLED` is `true`, and it waits for approval in
the `steam` environment. It uses `game-ci/steam-deploy` v3.2.1 (pinned by SHA) and sets the build
live on the branch you name (default `beta`; `default` is refused).

One-time setup for `STEAM_CONFIG_VDF`: on any machine run `steamcmd +login <builder>` and finish
Steam Guard, then base64-encode `config/config.vdf` from the steamcmd folder and store it as the
secret. It expires from time to time; repeat when the job fails to log in.

### 13.4 Code signing (optional)

Steam does not require it, but it avoids SmartScreen and Gatekeeper warnings for anyone who starts
the game outside Steam.

- Windows: an Authenticode certificate; set `CSC_LINK` and `CSC_KEY_PASSWORD` secrets and remove
  `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` from the workflow.
- macOS: an Apple Developer ID (USD 99/year); set `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`,
  `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` and enable notarisation in `electron-builder.yml`.

---

## 14. Review and release

1. Upload a build and set it live on the `default` branch (Steamworks > SteamPipe > Builds).
2. Complete the release checklist in Steamworks (store page, build, achievements, pricing).
3. **Mark as ready for review.** Valve tests the build (about 3-5 business days) **[check in Steamworks]**.
4. Request the **Steam Deck compatibility review**.
5. Set price, regional pricing, launch discount and release date, then press **Release**.
6. Licences: ship credits including the MIT licence of steamworks.js, Electron/Chromium
   (`LICENSES.chromium.html` is already in every build), the Steamworks SDK redistributable terms,
   and the bundled fonts' SIL OFL (already shipped as `dist/licenses/fonts-OFL.txt`).

---

## 15. Known limitations

- **No Steam leaderboards** (library limitation). Local Records and the Daily Run stay in-game.
- **No overlay-opened event**: the game cannot pause itself when Shift+Tab opens the overlay. It
  still pauses when the window loses focus.
- The overlay in Electron is reliable on Windows; on macOS and Linux it is unreliable. On Steam
  Deck, Steam's own UI works regardless.
- The overlay switch `--in-process-gpu` means a GPU crash takes the whole game down instead of
  restarting the GPU process.
- steamworks.js has had no npm release since 2024-08. It is pinned to 0.4.0 and the lockfile
  integrity hash is checked by `npm ci`.

---

## 16. How the game uses the platform layer

`src/platform/` is the only way the game reaches Electron or Steam, and everything in it is a safe
no-op in the browser build. Nothing under `src/` may import `electron` or `steamworks.js` (a unit
test enforces it).

| Where | What it does |
| --- | --- |
| `src/main.ts` | `await initPlatform()` before the App is created (desktop: copies the save file into storage, fetches platform info; gives up after 4 s so a broken bridge cannot stop the game). Flushes pending saves on `pagehide`, `beforeunload` and when the page is hidden. |
| `src/meta/save.ts` | `loadSave` / `writeSave` / `clearSave` use `platform().storage` (localStorage under `shardstorm.save` on both builds; the desktop one also mirrors to the save file). |
| `src/platform/link.ts` | `PlatformLink`, owned by the App: startup achievement re-sync (once), newly earned achievements, the end-of-run flush, and rich presence (`presenceFor` maps the App state to the table in [section 7](#7-rich-presence); re-evaluated once a second, throttled to Steam). |
| `src/app.ts` / `src/ui/ui.ts` | "Quit to desktop" on the title screen and the Fullscreen switch in Settings, only when the platform can quit (desktop). F11 and Alt+Enter are handled by the shell, which reports the new state so the switch follows. |

Steam leaderboards stay hidden (`platform().leaderboardsSupported` is false with steamworks.js).

## 17. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Log says `steam: unavailable ... steamclient.so` | No Steam client running, or not logged in. Expected outside Steam; the game runs normally. |
| Log says `module-unavailable: Unsupported OS` | linux-arm64 or win-arm64: steamworks.js has no binaries there. The game runs without Steam. |
| Achievements never unlock on AppID 480 | 480 has Spacewar's achievements, not ours. Use the real AppID. |
| Game closes right after launching outside Steam | Expected in a Steam release build: it relaunches through Steam. Start it from the Steam library. |
| Black window or GPU crash on Linux | Try `--no-steam-overlay`. Under xvfb (CI) use `xvfb-run -a`; `--ozone-platform=headless` crashes Electron 44. |
| `SetLive` to `default` refused in CI | By design. Promote the build by hand in Steamworks. |
