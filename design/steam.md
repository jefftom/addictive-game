# SHARDSTORM on Steam: Electron desktop build and Steamworks integration (verified spec)

Status: research and design only. Nothing in `/home/user/addictive-game` was modified.
Verified on 2026-10-07 in a Linux x64 container (no Steam client installed).

Labels used in this file:
- **[VERIFIED]**: I ran or read it here (package files, smoke runs, packaged build).
- **[DOCS]**: Valve or Steamworks partner knowledge that could not be checked from this sandbox, because partner.steamgames.com is blocked. Check it in the Steamworks UI before relying on it.

---

## 0. TL;DR

| Topic | Finding |
|---|---|
| Library | `steamworks.js@0.4.0` (MIT). It is the latest npm release, published 2024-08-06, and the only one on the `latest` tag. Upstream `main` was last touched 2025-09-07 and adds only `achievement.names()` and `cloud.setEnabledForApp()`. The project is slow-moving. [VERIFIED] |
| Native binaries | N-API (napi-rs 2.16.8) prebuilt binaries for **win32-x64, linux-x64 (gnu), darwin-x64, darwin-arm64**. There are no linux-arm64 or win-arm64 binaries. `index.js` **throws on require** for any other platform/arch. Each `.node` sits next to `libsteam_api` (`RUNPATH $ORIGIN` on Linux, `@loader_path` on macOS, universal i386/x86_64/arm64 dylib). [VERIFIED] |
| Electron compat | Loads and runs under **Electron 44.6.0** (Node 24.21.0, ABI 149, N-API 10, Chrome 152), both from `node_modules` and from a **packaged asar build**. No rebuild is needed. [VERIFIED] |
| **Leaderboards** | **NOT SUPPORTED.** There are no leaderboard functions in the `.d.ts`, the upstream Rust source has no leaderboard symbols, and the `.node` binary contains no `leaderboard` strings. [VERIFIED] |
| Stats | **Integer stats only** (`getInt/setInt/store/resetAll`). There are no float or avg-rate stats and no global stats. [VERIFIED] |
| Rich presence | Only `localplayer.setRichPresence(key, value?)`. [VERIFIED] |
| Overlay | `electronEnableSteamOverlay()` appends `--in-process-gpu` and `--disable-direct-composition`, then calls `webContents.invalidate()` on every window at 60 Hz. **No `GameOverlayActivated` callback is exposed**, so the game cannot auto-pause when the overlay opens. [VERIFIED] |
| Callbacks | `init()` starts `setInterval(runCallbacks, 1000/30)` by itself. `callback.register()` exposes only 10 callbacks (persona, servers, lobby, P2P, GameLobbyJoinRequested, MicroTxn). **There is no UserStatsReceived and no overlay callback.** [VERIFIED] |
| No-Steam behaviour | `require('steamworks.js')` **succeeds**. `init(480)` **throws a clean `Error` within 1 ms** (`"Failed to load module '/root/.steam/sdk64/steamclient.so'"`, `code: 'GenericFailure'`). The app keeps running and exits with code 0. [VERIFIED] |
| **Surprise: restartAppIfNecessary** | Without a running Steam client and without `steam_appid.txt`, `restartAppIfNecessary(480)` returned **`true`** and **tried to exec `~/.steam/root/steam.sh`**. With `steam_appid.txt` in the CWD it returned `false`. It must be gated so it only runs in Steam release builds. [VERIFIED] |
| **Surprise: early achievements** | `init()` calls `RequestCurrentStats()` but exposes no "stats received" event. `achievement.activate()` (which calls `SetAchievement` then `StoreStats`) can return `false` if it runs before the stats arrive. The bridge must queue and retry. [VERIFIED in source] |
| electron-builder | 26.15.3 (`latest`). It **auto-unpacks the native module from asar**. It **excludes `.dll` when packaging for non-Windows targets** (by design), and writes `resources/app-update.yml` unless `publish: null` is set. With `publish: null` the file is gone. [VERIFIED] |
| Headless CI | `xvfb-run -a electron . --no-sandbox` works. `--ozone-platform=headless` **SIGSEGVs in the GPU process with Electron 44 in this container, even with no steamworks loaded**, so use xvfb in CI. [VERIFIED] |
| Alternative lib | `steamworks-ffi-node@0.11.3` (koffi FFI, last modified 2026-09-24). It **has leaderboards, float stats, rich presence and an experimental native overlay**. It does **not** bundle the Steamworks SDK (Valve licence): you download the SDK `redistributable_bin` from the partner site yourself. It also has a postinstall script. Recommendation: keep it in reserve (see section 2.3). [VERIFIED by reading its package] |

---

## 1. Verified API surface: steamworks.js 0.4.0

Source: `vendor/steamworks-pkg/package/{index.d.ts,client.d.ts,callbacks.d.ts,index.js}`.

### 1.1 Top-level (`index.js` / `index.d.ts`)

| Export | Signature | Notes |
|---|---|---|
| `init` | `init(appId?: number): Omit<Client,'init'\|'runCallbacks'>` | Throws on failure. With no `appId`, the SDK looks for `steam_appid.txt` in the **process CWD** [VERIFIED: it was found next to the packaged exe when CWD was the exe dir]. Starts a 30 Hz `runCallbacks` interval. Calling it again drops and recreates the client. |
| `restartAppIfNecessary` | `(appId: number): boolean` | Returns `true` means "quit now, Steam will relaunch you". See the surprise in section 0. |
| `electronEnableSteamOverlay` | `(disableEachFrameInvalidation?: boolean): void` | Must run **before `app.ready`**, because the command-line switches only take effect then. |
| `SteamCallback` | enum | Same as `client.callback.SteamCallback`. |

### 1.2 Client namespaces (`client.d.ts`)

| Namespace | Functions | Useful for SHARDSTORM? |
|---|---|---|
| `achievement` | `activate(name): boolean`, `isActivated(name): boolean`, `clear(name): boolean` (upstream main also has `names()`, not yet released) | **Yes**: the 21 achievements |
| `stats` | `getInt(name): number\|null`, `setInt(name, v): boolean`, `store(): boolean`, `resetAll(achievementsToo): boolean` | Optional: total kills, runs, victories (int only) |
| **leaderboards** | **does not exist** | Daily-run boards are not possible with this lib |
| `localplayer` | `getSteamId(): {steamId64: bigint, steamId32, accountId}`, `getName()`, `getLevel()`, `getIpCountry()`, `setRichPresence(key, value?)` | **Yes**: name on the title screen, rich presence |
| `overlay` | `activateDialog(Dialog)`, `activateDialogToUser(Dialog, steamId64)`, `activateInviteDialog(lobbyId)`, `activateToWebPage(url)`, `activateToStore(appId, StoreFlag)`; `Dialog = Friends, Community, Players, Settings, OfficialGameGroup, Stats, Achievements` | Optional: an "Achievements" button and a store link for a future DLC or soundtrack |
| `cloud` | `isEnabledForAccount()`, `isEnabledForApp()`, `readFile(name): string`, `writeFile(name, content): boolean`, `deleteFile`, `fileExists`, `listFiles(): FileInfo[]` | Not needed: we use **Auto-Cloud** (section 2.6). Kept as a fallback. |
| `input` | `init()`, `getControllers(): Controller[]`, `getActionSet`, `getDigitalAction`, `getAnalogAction`, `shutdown()`; `Controller.activateActionSet / isDigitalActionPressed / getAnalogActionVector / getType / getHandle`; `InputType` includes `SteamDeckController`, `PS5Controller` and others | **Do not use.** It needs an IGA action manifest. Use the browser Gamepad API plus Steam Input "gamepad emulation" instead. `getType()` could pick button glyphs but is not needed. |
| `matchmaking` | `createLobby(LobbyType, max)`, `joinLobby(id)`, `getLobbies()`, `Lobby{join, leave, openInviteDialog, getMembers, getOwner, setJoinable, get/set/deleteData, getFullData, mergeFullData, ...}` | Not in scope. Online play comes from Remote Play Together. |
| `networking` | `sendP2PPacket(steamId64, SendType, Buffer)`, `isP2PPacketAvailable()`, `readP2PPacket(size)`, `acceptP2PSession(steamId64)`. These use the **old ISteamNetworking** P2P API (deprecated by Valve, but still works). | Not in scope |
| `apps` | `isSubscribed[App]`, `isAppInstalled`, `isDlcInstalled`, `isSubscribedFromFreeWeekend`, `isVacBanned`, `isCybercafe`, `isLowViolence`, `appBuildId()`, `appInstallDir`, `appOwner`, `availableGameLanguages()`, **`currentGameLanguage()`**, `currentBetaName()` | `currentGameLanguage()` (future localisation), `appBuildId()` (bug reports) |
| `auth` | `getSessionTicketWithSteamId`, `getSessionTicketWithIp`, `getAuthTicketForWebApi` → `Ticket{cancel, getBytes}` | Only needed if an online leaderboard server is built later (Web API ticket) |
| `utils` | `getAppId()`, `getServerRealTime()`, **`isSteamRunningOnSteamDeck()`**, `showGamepadTextInput(...)`, `showFloatingGamepadTextInput(...)` | **Yes**: Deck detection, and the on-screen keyboard if any text entry is added |
| `workshop` | Full UGC create, update, subscribe and query | Not in scope |
| `callback` | `register(SteamCallback, handler): Handle{disconnect()}`. Callbacks: `PersonaStateChange, SteamServersConnected, SteamServersDisconnected, SteamServerConnectFailure, LobbyDataUpdate, LobbyChatUpdate, P2PSessionRequest, P2PSessionConnectFail, GameLobbyJoinRequested, MicroTxnAuthorizationResponse` | No overlay-activated or stats-received callbacks |

Bundled SDK interfaces: `SteamClient021`, `SteamUser023`, `SteamUtils010`, `SteamFriends017`, `SteamInput006`, `SteamNetworkingSockets012`. That points to roughly Steamworks SDK 1.58/1.59 (an inference from interface versions). There is **no ISteamRemotePlay** (no Remote Play session API) and **no ISteamTimeline**.

### 1.3 Steamworks feature matrix for SHARDSTORM

| Feature | Plan | Status |
|---|---|---|
| Achievements (21) | `achievement.activate(id)`, using the same API names as `src/meta/achievements.ts` ids (`first_run`, `survive3`, ..., `nightmare`) | Supported |
| Stats | Optional int stats (`kills_total`, `runs`, `victories`, `best_combo`) | Supported (int only) |
| Leaderboards | **Not at launch.** Local records and the Daily Run stay in-game. See section 2.3 for adding them later. | **Not supported** |
| Rich presence | `steam_display` plus tokens | Supported |
| Cloud saves | Steam **Auto-Cloud** over a JSON file in `userData/save/` | No API needed |
| Overlay | `electronEnableSteamOverlay()` only when Steam init succeeded | Works with caveats (section 3.3) |
| Controller | Gamepad API (already in `src/core/input.ts`) plus Steam Input gamepad emulation | No API needed |
| Remote Play Together | Steamworks setting plus local co-op | No API needed |

---

## 2. Recommended architecture

### 2.1 Process layout

```
SHARDSTORM.exe (Electron main process, Node)
 ├─ desktop/main.cjs      app lifecycle, window, app:// protocol, IPC handlers
 ├─ desktop/steam.cjs     the ONLY module that requires steamworks.js; never throws
 ├─ desktop/savefile.cjs  atomic JSON save in userData/save/
 └─ BrowserWindow (renderer, sandboxed, contextIsolation)
      ├─ desktop/preload.cjs   contextBridge → window.shardstormDesktop
      └─ app://game/index.html  the unchanged Vite build (dist/)
```

- Steamworks lives **only in the main process**. The steamworks.js README suggests `nodeIntegration: true, contextIsolation: false` so the renderer can call it. **Do not do that.** Proxy a small allowlisted API over IPC instead. This was verified: a sandboxed CJS preload with `contextBridge` plus `ipcRenderer.invoke` works on Electron 44, and `typeof require === 'undefined'` in the renderer.
- Serve the game from a **custom privileged scheme `app://game/`** instead of `file://`. This gives a stable, unique origin for `localStorage`, makes a strict CSP enforceable, and lets module scripts work. [VERIFIED: `origin=app://game`, `localStorage` persisted across two launches, `navigator.getGamepads` and `AudioContext` available]. `vite.config.ts` already uses `base: './'`, so `dist/` works unchanged.
- The web build keeps working. Every desktop call goes through `src/platform/desktop.ts`, which checks `window.shardstormDesktop` and falls back to browser behaviour.

### 2.2 `desktop/steam.cjs`: init sequence and graceful fallback

```js
// Called from main.cjs BEFORE app.whenReady()
const STEAM_APP_ID = Number(process.env.SHARDSTORM_STEAM_APPID || 0) || 0; // set by build: real AppID
const IS_STEAM_BUILD = process.env.SHARDSTORM_DIST === 'steam' || require('./build-flags.json').steam;

let sw = null, client = null, status = { steam: false, reason: 'not-attempted' };
try { sw = require('steamworks.js'); }                 // throws only on unsupported OS/arch
catch (e) { status = { steam: false, reason: 'module-unavailable' }; }

if (sw && IS_STEAM_BUILD && app.isPackaged && STEAM_APP_ID) {
  // Release only. Verified: returns true and execs steam.sh if not launched by Steam.
  try { if (sw.restartAppIfNecessary(STEAM_APP_ID)) { app.exit(0); } } catch {}
}
if (sw) {
  try { client = sw.init(STEAM_APP_ID || undefined); status = { steam: true }; }
  catch (e) { status = { steam: false, reason: String(e.message).slice(0, 200) }; } // verified: clean Error
}
if (client && !process.env.SHARDSTORM_NO_OVERLAY) {
  sw.electronEnableSteamOverlay();   // must be before app ready; only when Steam is really there
}
```

Rules:
- Every exported function is wrapped in `try/catch` and returns `false` or `null` when `client` is null. The renderer never learns more than `{steam:false}`.
- **Achievement queue:** `unlock(id)` stores the id in a `pending` Set and calls `activate`. Anything still pending is retried every 2 s for up to 60 s, then again at the end of each run. On startup, after a 3 s delay, run a **re-sync**: for every id the local save already marks as earned, if `!isActivated(id)` then `activate(id)`. This covers stats not yet received at call time, offline play, and players who earned achievements before the Steam release.
- `restartAppIfNecessary` runs only when `app.isPackaged && IS_STEAM_BUILD`. It never runs in dev or for itch/web.
- `before-quit`: there is no explicit SteamAPI_Shutdown in the JS API (the client drops at process exit). Call `stats.store()` once before quitting.

### 2.3 Leaderboards decision

Options, in order of preference:
1. **Launch without Steam leaderboards.** Keep local Records and the Daily Run. The bridge exposes `leaderboards: { supported: false }`, so the UI can hide them.
2. **Post-launch: swap the backend for `steamworks-ffi-node`.** It has `findOrCreateLeaderboard`, `uploadScore`, `downloadLeaderboardEntries(ForUsers)`, `attachLeaderboardUGC`, float stats and rich presence. The cost is shipping Valve's `redistributable_bin` yourself (downloaded from the partner site, not npm), relying on FFI (koffi), and having a younger codebase. Because everything sits behind `steam.cjs`, the swap touches one file.
3. Fork steamworks.js and add leaderboards. The underlying steamworks-rs crate supports them, but this means owning a Rust and N-API CI for four targets. Not recommended.

### 2.4 Preload bridge: `window.shardstormDesktop`

`desktop/preload.cjs` (must be CommonJS, because sandboxed preloads cannot use ESM):

```js
const { contextBridge, ipcRenderer } = require('electron');
const inv = (ch, ...a) => ipcRenderer.invoke(`ss:${ch}`, ...a);
contextBridge.exposeInMainWorld('shardstormDesktop', Object.freeze({
  apiVersion: 1,
  getPlatform: () => inv('platform'),                // PlatformInfo
  achievements: Object.freeze({
    unlock: (id) => inv('ach:unlock', id),           // Promise<boolean> (queued if Steam not ready)
    isUnlocked: (id) => inv('ach:is', id),
    sync: (ids) => inv('ach:sync', ids),              // ids the local save says are earned
    openOverlay: () => inv('overlay:achievements'),
  }),
  presence: Object.freeze({
    set: (p) => inv('presence:set', p),              // {mode, sector?, ship?, players?, time?}
    clear: () => inv('presence:clear'),
  }),
  leaderboards: Object.freeze({ supported: false }),  // steamworks.js has none (verified)
  save: Object.freeze({
    read: () => inv('save:read'),                    // Promise<string|null>
    write: (json) => inv('save:write', json),        // Promise<boolean>, atomic
  }),
  setFullscreen: (on) => inv('win:fullscreen', on),  // on undefined = toggle; returns new state
  quit: () => inv('app:quit'),
}));
```

TypeScript contract (`src/platform/desktop.d.ts`):

```ts
export interface PlatformInfo {
  os: 'win32' | 'darwin' | 'linux';
  appVersion: string; electron: string;
  steam: boolean; steamDeck: boolean;     // utils.isSteamRunningOnSteamDeck() || env SteamDeck==='1'
  playerName: string | null;              // localplayer.getName() when steam
  language: string | null;                // apps.currentGameLanguage()
  buildId: number | null;                 // apps.appBuildId()
}
```

Main-process IPC validation (do not trust the renderer):
- `ach:*`: `id` must be a string in the hard-coded allowlist of the 21 ids, imported from a generated `desktop/achievements.json` that a unit test checks against `src/meta/achievements.ts`.
- `presence:set`: allow only the keys `mode` (one of `menu|hangar|run|victory|results`), `sector` (int 1-4), `ship` (one of the 5 ship ids), `players` (int 1-4), `time` (`mm:ss`). Map these to Steam keys in main. Never pass through arbitrary strings.
- `save:write`: must be a string of at most 1 MiB that passes `JSON.parse`. Otherwise reject.
- Every handler checks `event.senderFrame.url.startsWith('app://game/')`.

### 2.5 Rich presence mapping

Keys set from main: `steam_display`, `sector`, `ship`, `players`, `time`.
- Menu: `steam_display = "#Status_Menu"`
- In a run: `steam_display = "#Status_Run"`, `sector = "2"`, `ship = "tempest"`, `players = "3"`, `time = "04:12"`. Throttle to once every 10 s.
- Victory or Overtime: `#Status_Victory` / `#Status_Overtime`.

Rich presence localisation file, uploaded in Steamworks → Community → Rich Presence [DOCS]:

```
"lang"
{
  "english"
  {
    "tokens"
    {
      "#Status_Menu"      "Tuning ships in the Hangar"
      "#Status_Run"       "{#Sector_%sector%} · %time% · {#Ship_%ship%} · %players%P"
      "#Status_Victory"   "Survived the Storm!"
      "#Status_Overtime"  "In Overtime ({#Ship_%ship%})"
      "#Sector_1" "Sector 1"  "#Sector_2" "Sector 2"  "#Sector_3" "Sector 3"  "#Sector_4" "Sector 4"
      "#Ship_spark" "Spark" "#Ship_vanguard" "Vanguard" "#Ship_tempest" "Tempest" "#Ship_bastion" "Bastion" "#Ship_phantom" "Phantom"
    }
  }
}
```

The sector names should come from the story bible; the ones above are placeholders. Without `steam_display` plus an uploaded token file, friends only see "Playing SHARDSTORM" [DOCS].

### 2.6 Saves and Steam Auto-Cloud

- File: `path.join(app.getPath('userData'), 'save', 'shardstorm-save.json')` plus `shardstorm-save.json.bak`.
- **Pin the userData name** before ready: `app.setName('SHARDSTORM')`, or `app.setPath('userData', path.join(app.getPath('appData'), 'SHARDSTORM'))`. [VERIFIED: `app.setName` controls the dir, e.g. `~/.config/SHARDSTORM-protosmoke` on Linux.]
- Use the `save/` **subfolder** because `userData` also holds Chromium caches (`Cache/`, `GPUCache/`, `Local Storage/`, ...). Those must never be cloud-synced.
- Atomic write: `writeFile(tmp)` → `fsync` → copy the current file to `.bak` → `rename(tmp, file)`. Read: try the main file, fall back to `.bak`, and if both are bad return `null`.
- Renderer integration (small change in `src/meta/save.ts` / boot):
  1. At boot, if `shardstormDesktop` exists, `await save.read()`. If it returns JSON, write it into `localStorage['shardstorm.save']` **before** `loadSave()` runs. The file is the source of truth on desktop.
  2. After every `saveSave()` call, run a debounced (500 ms) `shardstormDesktop.save.write(JSON.stringify(save))`, and flush on `visibilitychange`/`pagehide` and before `quit()`.
  3. Main also flushes on `before-quit`. It asks the renderer through `webContents.send('ss:flush')` and waits up to 500 ms.
- **Auto-Cloud settings** (Steamworks → Application → Steam Cloud) [DOCS: root names to confirm in UI]:

| Root | Subdirectory | Pattern | OS |
|---|---|---|---|
| `WinAppDataRoaming` | `SHARDSTORM/save` | `*.json` | Windows |
| Root override → `MacAppSupport` | `SHARDSTORM/save` | | macOS |
| Root override → `LinuxXdgConfigHome` | `SHARDSTORM/save` | | Linux |

  Set the byte quota to 1 MB and the file count to 4. Under Proton on the Deck, the Windows root maps inside the prefix and still syncs.
- Steam resolves cloud conflicts with its own dialog **before** the game launches, so the game needs no conflict UI.

### 2.7 `desktop/main.cjs` window and security settings

```js
const { app, BrowserWindow, protocol, net, Menu, shell, session } = require('electron');
protocol.registerSchemesAsPrivileged([{ scheme: 'app',
  privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.setName('SHARDSTORM');
// steam.cjs init (section 2.2) here, before ready
app.whenReady().then(() => {
  const root = path.join(__dirname, '..', 'dist');
  protocol.handle('app', (req) => {
    const u = new URL(req.url);
    const p = path.normalize(path.join(root, decodeURIComponent(u.pathname)));
    if (u.host !== 'game' || !p.startsWith(root)) return new Response('', { status: 403 });
    return net.fetch(pathToFileURL(p).toString());
  });
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === 'fullscreen'));
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);
  const steamDeck = steam.isDeck();
  const win = new BrowserWindow({
    width: 1280, height: 800, minWidth: 960, minHeight: 600,
    fullscreen: steamDeck || settings.fullscreen, backgroundColor: '#05060d', show: false,
    autoHideMenuBar: true, title: 'SHARDSTORM',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true, sandbox: true, nodeIntegration: false,
      nodeIntegrationInSubFrames: false, webviewTag: false, spellcheck: false,
      devTools: !app.isPackaged,
      autoplayPolicy: 'no-user-gesture-required',   // music can start on the title screen
      backgroundThrottling: false,                   // fixed-step sim keeps time when unfocused
    },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('app://game/')) e.preventDefault(); });
  win.loadURL('app://game/index.html');
});
app.on('window-all-closed', () => app.quit());   // also on macOS: it is a game
```

- Add a CSP meta tag to `index.html` for the desktop build: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; connect-src 'self'`. Without one, Electron prints an "Insecure Content-Security-Policy" warning in dev [VERIFIED].
- Keyboard shortcuts handled in the renderer and forwarded to `setFullscreen()`: `F11`, `Alt+Enter`, and on macOS `Ctrl+Cmd+F`.
- Electron fuses (`@electron/fuses`, run in `afterPack`): `RunAsNode=false`, `EnableNodeOptionsEnvironmentVariable=false`, `EnableNodeCliInspectArguments=false`, `EnableEmbeddedAsarIntegrityValidation=true`, `OnlyLoadAppFromAsar=true`.
- `backgroundThrottling:false`: confirm that the pause-on-blur logic in `app.ts` still pauses the run. Players expect the game to pause when it loses focus.

---

## 3. Steam overlay in Electron

### 3.1 What the helper does [VERIFIED from index.js]
- `app.commandLine.appendSwitch('in-process-gpu')` moves the GPU thread into the browser process. That is the process Steam injects `GameOverlayRenderer64.dll` / `gameoverlayrenderer.so` into, so it can hook Present/SwapBuffers.
- `app.commandLine.appendSwitch('disable-direct-composition')` (Windows) makes Chromium present through a swap chain that the overlay can hook.
- By default it also runs a 60 Hz `webContents.invalidate()` loop per window (`isPainting()` is only meaningful for offscreen rendering), so the overlay keeps redrawing over static frames.

### 3.2 Recommendation
- Call `electronEnableSteamOverlay()` **only after a successful `init()`** and before `app.ready`. Both calls happen synchronously at the top of `main.cjs`, which is what the code in section 2.2 does.
- Keep the frame invalidator. SHARDSTORM menus are DOM over an animated canvas, but the invalidator is cheap and protects static screens.
- Provide the `SHARDSTORM_NO_OVERLAY=1` escape hatch, and document a `--no-steam-overlay` launch option in Steamworks for players with GPU issues.

### 3.3 Known quirks and risks
- `in-process-gpu` means a GPU process crash takes down the whole app, with no Chromium GPU-process restart.
- **No overlay-activated callback**, so the game cannot pause when Shift+Tab opens the overlay. Mitigation: the game already pauses on `blur`, and the overlay does not blur the window. Accept the gap, or use `steamworks-ffi-node` later.
- Linux and macOS overlay support with Electron is unreliable (community reports, [DOCS]). On Steam Deck, Steam's own UI (the "..." button and QAM) works regardless, because gamescope draws it outside the game.
- The overlay cannot be tested without a Steam client and an AppID that owns it. Use AppID 480 (Spacewar) with a running Steam client on a dev machine.

---

## 4. Packaging: electron-builder for SteamPipe

### 4.1 Repo additions (next phase, not done here)
```
desktop/main.cjs  desktop/preload.cjs  desktop/steam.cjs  desktop/savefile.cjs  desktop/build-flags.json
electron-builder.yml
steam/app_build.vdf  steam/depot_build_{win,mac,linux}.vdf  steam/rich_presence_english.vdf
build/icon.png (1024x1024)  build/icon.ico  build/icon.icns
```
`package.json` changes:
- add `"main": "desktop/main.cjs"`;
- add `dependencies: { "steamworks.js": "0.4.0" }` (exact pin);
- add `devDependencies: electron, electron-builder, @electron/fuses`;
- add scripts `desktop:dev` (`vite build && electron .`) and `desktop:dist` (`vite build && electron-builder --dir`).

Keep `"type": "module"`. That is why desktop files use `.cjs`.

### 4.2 `electron-builder.yml` (template)

```yaml
appId: com.shardstorm.game            # placeholder reverse-DNS
productName: SHARDSTORM
copyright: "Copyright © 2026 <Owner>"
directories:
  output: release                      # NOT "dist": that is Vite's output dir
  buildResources: build
files:
  - dist/**
  - desktop/**
  - package.json
  - "!**/*.map"
  - "!node_modules/@types/**"
  - "!node_modules/undici-types/**"
asar: true                             # OK: verified the .node is auto-unpacked
asarUnpack:
  - node_modules/steamworks.js/**      # explicit, belt and braces
npmRebuild: false                      # N-API prebuilt binaries, nothing to rebuild (verified)
publish: null                          # no auto-updater; Steam is the updater (verified: drops app-update.yml)
electronFuses:                         # key + all 5 sub-keys verified present in electron-builder 26.15.3 scheme.json
  runAsNode: false
  enableNodeOptionsEnvironmentVariable: false
  enableNodeCliInspectArguments: false
  enableEmbeddedAsarIntegrityValidation: true
  onlyLoadAppFromAsar: true
win:
  target: [{ target: dir, arch: [x64] }]
  icon: build/icon.ico
  files: ["!node_modules/steamworks.js/dist/{osx,linux64}/**", "!node_modules/steamworks.js/dist/win64/*.lib"]
  extraFiles: [{ from: node_modules/steamworks.js/dist/win64/steam_api64.dll, to: steam_api64.dll }]
  signAndEditExecutable: true          # sets exe icon/version info; code signing optional for Steam
mac:
  target: [{ target: dir, arch: [universal] }]
  category: public.app-category.action-games
  icon: build/icon.icns
  x64ArchFiles: "**/node_modules/steamworks.js/dist/osx/*"   # identical Mach-O files in both arch trees
  files: ["!node_modules/steamworks.js/dist/{win64,linux64}/**"]
  hardenedRuntime: true
  # identity/notarize: set when the owner has an Apple Developer ID (see section 9)
linux:
  target: [{ target: dir, arch: [x64] }]
  executableName: shardstorm
  icon: build/icon.png
  files: ["!node_modules/steamworks.js/dist/{osx,win64}/**"]
```

Verified with a Linux `--linux dir` build of the smoke app:
- `resources/app.asar.unpacked/node_modules/steamworks.js/dist/linux64/{steamworksjs.linux-x64-gnu.node,libsteam_api.so}` is present, and the packaged app loads it.
- Platform-scoped `files` excludes removed the other OSes' binaries.
- The unpacked Linux build is **286 MB**, which is normal for Electron.
- electron-builder drops `*.dll` and `*.exe` from `node_modules` **only for non-Windows targets** (`appFileCopier.js#getNodeModuleExcludedExts`), so the Windows build keeps `steam_api64.dll`. The `extraFiles` copy next to `SHARDSTORM.exe` is a belt-and-braces measure that matches the steamworks.js README ("copy redistributable files into the root of your build").
- Not verified (no mac runner here): the `mac.x64ArchFiles` value (the key itself is verified in the 26.15.3 schema). `@electron/universal` refuses Mach-O files that are byte-identical in both arch builds unless they match `x64ArchFiles`. Confirm on the first macOS CI run.

Outputs to hand to SteamPipe:
- `release/win-unpacked/` → Windows depot (`SHARDSTORM.exe`)
- `release/mac-universal/SHARDSTORM.app` → macOS depot
- `release/linux-unpacked/` → Linux depot (`shardstorm`)

### 4.3 `steam_appid.txt`: dev vs release
- **Dev:** put `steam_appid.txt` containing `480` (or the real AppID once you have it) in the repo root, gitignored, because `electron .` runs with CWD = repo root. With the file present, `restartAppIfNecessary` returns `false` [VERIFIED] and `init()` with no argument finds the AppID. Also run a Steam client logged into an account that owns the app; 480 is free.
- **Release:** **do not ship `steam_appid.txt`.** Add a `FileExclusion` in the depot VDF. Steam sets `SteamAppId`/`SteamGameId` env vars when it launches the game. Pass the real AppID to `init(APP_ID)` anyway. Gate `restartAppIfNecessary(APP_ID)` to packaged Steam builds, so a user double-clicking the exe gets relaunched through Steam.
- **Non-Steam builds** (itch.io, direct download): `build-flags.json { "steam": false }`. Steam init is still attempted (it fails cleanly in about 1 ms), but `restartAppIfNecessary` is never called.

### 4.4 SteamPipe VDF templates (placeholders: AppID `1234560`, depots `1234561..3`)

`steam/app_build.vdf`
```
"AppBuild"
{
  "AppID"       "1234560"
  "Desc"        "SHARDSTORM v1.1.0 (git <sha>)"
  "BuildOutput" "../steam-output/"
  "ContentRoot" "../release/"
  "SetLive"     ""            // never auto-live default; e.g. "beta" for the beta branch
  "Preview"     "0"           // "1" = dry run, no upload
  "Depots"
  {
    "1234561" "depot_build_win.vdf"
    "1234562" "depot_build_mac.vdf"
    "1234563" "depot_build_linux.vdf"
  }
}
```

`steam/depot_build_win.vdf`
```
"DepotBuild"
{
  "DepotID" "1234561"
  "FileMapping" { "LocalPath" "win-unpacked/*" "DepotPath" "." "Recursive" "1" }
  "FileExclusion" "*.pdb"
  "FileExclusion" "steam_appid.txt"
}
```

`steam/depot_build_mac.vdf`
```
"DepotBuild"
{
  "DepotID" "1234562"
  "FileMapping" { "LocalPath" "mac-universal/*" "DepotPath" "." "Recursive" "1" }
  "FileExclusion" "steam_appid.txt"
}
```

`steam/depot_build_linux.vdf`
```
"DepotBuild"
{
  "DepotID" "1234563"
  "FileMapping" { "LocalPath" "linux-unpacked/*" "DepotPath" "." "Recursive" "1" }
  "FileExclusion" "steam_appid.txt"
}
```

Upload command: `steamcmd +login <builder> +run_app_build $(pwd)/steam/app_build.vdf +quit`.

Upload the macOS and Linux depots from a Unix host (the CI Docker action runs Linux) so the executable bits survive. Content built on Windows loses them [DOCS].

Steamworks → Installation → General [DOCS]:

| OS | Executable | Arguments | Notes |
|---|---|---|---|
| Windows | `SHARDSTORM.exe` | | |
| macOS | `SHARDSTORM.app` | | |
| Linux + SteamOS | `shardstorm` | `--no-sandbox` | see section 5 |

Set each depot's OS filter on the Depots page.

---

## 5. Steam Deck compatibility checklist

Valve's Deck Verified criteria [DOCS]:

| # | Item | SHARDSTORM action |
|---|---|---|
| 1 | Runs at **1280x800** (16:10) and handles 1280x720 | Default window 1280x800. Fullscreen when `isSteamRunningOnSteamDeck()` or `env.SteamDeck==='1'`. Check that HUD and level-up cards fit at 16:10. |
| 2 | **Full controller navigation**: every screen (title, hangar, workshop, records, settings, level-up, pause, victory, results, story dialogue, co-op join) works with a gamepad alone, with no mouse or keyboard prompt | `src/core/input.ts` already polls `navigator.getGamepads()`. Audit `ui.ts` for focus handling on every DOM screen. Add an e2e test that drives each screen with simulated gamepad input. |
| 3 | **Correct glyphs**: show controller glyphs (Xbox/Deck style) when the last input was a pad; never show "Press Enter/Click" | Under Steam Input on Deck, `Gamepad.id` reports an Xbox-style pad, so Xbox/Deck ABXY glyphs are correct |
| 4 | **Legible text**: smallest on-screen glyph at least **9 px** tall at 1280x800 (Valve recommends 12 px or more) | Audit `style.css` and HUD canvas fonts at 1280x800. Add a UI-scale setting (100/125/150 %). |
| 5 | **No launcher**, and no external browser or account login required | Electron opens straight to the game. Hide any "open link" UI on Deck, or route it through `overlay.activateToWebPage`. |
| 6 | Text input uses the on-screen keyboard | Not needed today. If any is added, use `utils.showFloatingGamepadTextInput`. |
| 7 | Default controller config | Steamworks → Steam Input: "Gamepad" template; opt in for Xbox, PlayStation, Switch and generic controllers |
| 8 | Performance: at least 30 fps sustained by default, no stutter on load | Measure the canvas renderer on Deck APU. Expose "reduced effects" (particles, glow) in settings and default to it on Deck if needed. |
| 9 | Suspend/resume (sleep) | Pause on `visibilitychange`; resume the AudioContext on resume; the fixed-step loop must clamp large dt (it already has hitstop logic, so verify it). |
| 10 | Native Linux vs Proton | **Primary:** native Linux depot under "Steam Linux Runtime 3.0 (sniper)" (Steamworks → Installation → Linux runtime). **Risk:** Chromium's sandbox inside pressure-vessel (no SUID `chrome-sandbox`, nested user namespaces may be denied), hence `--no-sandbox` in the Linux launch option. contextIsolation and IPC validation still protect the renderer, and the app loads only local content. **Fallback:** force Proton in Steamworks (Deck → Compatibility) and run the Windows build. Test both on hardware. |
| 11 | Quit works from the pause menu and from the Steam "Exit game" button | `quit()` bridge, plus `window-all-closed` → `app.quit()` |
| 12 | Submit for Deck review after release (or before, from Steamworks → Steam Deck compatibility) | Owner action |

## 6. Remote Play Together requirements

- **Game side:** RPT streams the host's game. Guests' controllers appear on the host as **additional virtual gamepads** (each guest pad becomes a new `navigator.getGamepads()` slot). Guests' keyboard and mouse are injected into the host's **single shared keyboard and mouse**, if the host allows it. So:
  - local co-op must assign players **per gamepad index**, with **hot-join**: press A or Start on an unassigned pad to join;
  - at most one keyboard-and-mouse player;
  - all co-op menus must be navigable by any joined player's pad.
  
  The local co-op design (1-4 players) already covers this.
- **Steamworks side** [DOCS]: on the store page, tick the categories **"Shared/Split Screen Co-op"** (and "Shared/Split Screen" if applicable), plus "Remote Play Together", "Remote Play on TV" and "Remote Play on Phone/Tablet" if they are offered. Leave Remote Play enabled in Steamworks → Application → Remote Play (it is on by default for local-multiplayer games). Declare "Full controller support" in the controller survey.
- **Not available in steamworks.js:** `ISteamRemotePlay` (session count, guest names, `BSendRemotePlayTogetherInvite`). This is not needed, because invites come from the Steam overlay or friends list.
- **Bandwidth and latency:** the game runs a local sim, so nothing changes. Prefer readable effects at 720p streaming (avoid sub-pixel neon lines; already mostly glow sprites).

---

## 7. Store and library assets (exact pixel sizes)

These are the dimensions as of the 2024-2025 Steam asset refresh [DOCS]. The Steamworks "Store Assets" and "Library Assets" upload pages reject wrong sizes, so re-check there.

| Asset | Size (px) | Format / notes |
|---|---|---|
| Header capsule | **920 x 430** | Logo plus key art; top of store page, recommendations |
| Small capsule | **462 x 174** | Must keep the logo readable at small size |
| Main capsule | **1232 x 706** | Front-page carousel |
| Vertical capsule | **748 x 896** | Seasonal sales pages |
| Page background | **1438 x 810** | Optional; ambient, low contrast |
| Library capsule | **600 x 900** | Library grid |
| Library header | **920 x 430** | Library "recent" shelf |
| Library hero | **3840 x 1240** | No text or logo; keep the key area centred (safe area about 860 x 380 centre) |
| Library logo | **1280 x 720** max (one side at full size) | Transparent PNG; place over the hero in the logo tool |
| Screenshots | at least **1920 x 1080** (16:9), minimum 5 | 1280x720 minimum accepted; capture with co-op, bosses, galaxy backdrops |
| Trailer | 1920 x 1080 MP4/MOV, 5000+ kbps | Optional but strongly recommended |
| Community icon | **184 x 184** | JPG |
| Client/app icon | `.ico` with 16/32/48/256; Linux PNG 256 x 256; macOS `.icns` | Also used by electron-builder (`build/icon.*`) |
| Achievement icons | **256 x 256** | JPG/PNG, **42 files** (21 unlocked + 21 locked/grey) |
| Event/announcement cover | 800 x 450; header 1920 x 622 | For launch and update posts |

---

## 8. CI: GitHub Actions

`.github/workflows/desktop.yml`:

```yaml
name: desktop
on:
  push: { tags: ['v*'] }
  workflow_dispatch: { inputs: { deploy: { type: boolean, default: false }, branch: { type: string, default: beta } } }
jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - { os: windows-latest, target: --win,   out: win-unpacked }
          - { os: macos-latest,   target: --mac,   out: mac-universal }
          - { os: ubuntu-latest,  target: --linux, out: linux-unpacked }
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run check                     # typecheck + vitest + vite build
      - run: npx electron-builder ${{ matrix.target }} --dir --publish never
        env: { CSC_IDENTITY_AUTO_DISCOVERY: 'false' }   # until signing secrets exist
      - name: Packaged smoke (Linux)
        if: runner.os == 'Linux'
        run: |
          sudo apt-get install -y xvfb
          SHARDSTORM_SMOKE=1 xvfb-run -a release/linux-unpacked/shardstorm --no-sandbox
          # main.cjs: when SHARDSTORM_SMOKE=1, log steam status + did-finish-load, quit after 5 s, exit 1 on renderer crash
      - uses: actions/upload-artifact@v4
        with: { name: ${{ matrix.out }}, path: release/${{ matrix.out }}, if-no-files-found: error }

  deploy:
    needs: build
    if: github.event_name == 'workflow_dispatch' && inputs.deploy
    runs-on: ubuntu-latest                       # steam-deploy is a Docker action
    environment: steam                           # require manual approval
    steps:
      - uses: actions/download-artifact@v4
        with: { path: build }
      - uses: game-ci/steam-deploy@v3.2.1        # tag verified to exist; pin to SHA 50f6b29fc64922e19a16d202a88fe199d394b536
        with:
          username: ${{ secrets.STEAM_USERNAME }}
          configVdf: ${{ secrets.STEAM_CONFIG_VDF }}   # base64 config.vdf from a steamcmd login with Steam Guard done
          appId: 1234560
          firstDepotIdOverride: 1234561          # depot1=win, depot2=mac, depot3=linux (default would be appId+1..)
          buildDescription: ${{ github.ref_name }}
          rootPath: build
          depot1Path: win-unpacked
          depot2Path: mac-universal
          depot3Path: linux-unpacked
          releaseBranch: ${{ inputs.branch }}    # NEVER "default"; promote to default manually in Steamworks
```

Verified inputs of `game-ci/steam-deploy@v3.2.1` (`action.yml`):
- inputs: `username`, `password`, `totp`, `configVdf`, `appId`, `firstDepotIdOverride`, `buildDescription`, `rootPath`, `depot1Path..depot9Path`, `depotNInstallScriptPath`, `releaseBranch`, `debugBranch`;
- outputs: `manifest`, `buildId`.

Notes:
- Use a **dedicated Steam builder account** with only the "Edit App Metadata" and "Publish App Changes" / build permissions for this app [DOCS].
- Steam Guard: generate `config.vdf` once by running `steamcmd +login` locally, then store it base64 in `STEAM_CONFIG_VDF`. It expires periodically. Alternatively use `totp` with a shared secret.
- The macOS job needs signing and notarisation secrets before it can produce a Gatekeeper-friendly build: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.

---

## 9. Steps only the owner can do

1. **Create a Steamworks partner account** (partner.steamgames.com): legal entity or individual, bank details, tax interview (W-8/W-9), identity verification.
2. **Pay the Steam Direct fee of USD 100 per app.** It is recoupable after USD 1,000 of adjusted gross revenue. There is a **30-day wait** after the first payment before the first release [DOCS]. The fee produces the **AppID** and default depot IDs. Put them in `app_build.vdf`, `electron-builder` env and `steam.cjs`.
3. **Store page:** description, tags, categories (single-player, **Shared/Split Screen Co-op**, Remote Play Together, Steam Achievements, Steam Cloud, Full Controller Support), system requirements, price, and the assets from section 7. The **content survey / mature content** questions must be answered. The store page must be **"Coming Soon" for at least 2 weeks** before release, and goes through **store page review** (about 3-5 business days) [DOCS].
4. **Configure in the Steamworks UI**, then **Publish** each change:
   - the **21 achievements** (API names identical to the game ids, display names and descriptions from `achievements.ts`, 42 icons);
   - any int stats;
   - the **rich presence localisation file**;
   - **Auto-Cloud** roots and quota;
   - **depots** and OS filters;
   - **launch options**;
   - **Steam Input default config** and controller survey;
   - **Linux runtime** choice;
   - beta branch (optionally password-protected).
5. **Builder account and CI secrets**: create the account, run `steamcmd` login once, add the `STEAM_USERNAME`/`STEAM_CONFIG_VDF` secrets and the `steam` environment approval.
6. **Ratings:** complete the **IARC questionnaire** in Steamworks (free) for age ratings; add PEGI/ESRB/USK details as needed.
7. **Code signing (optional but recommended):**
   - Windows Authenticode certificate (reduces SmartScreen prompts for anyone launching the exe outside Steam);
   - Apple Developer ID (USD 99/yr) for macOS signing and notarisation.
   
   Steam does not strictly require either.
8. **Release review:** set the build live on the default branch, then "Mark as ready for review". Valve tests the build (about 3-5 business days). Request **Steam Deck compatibility review**.
9. **Pricing and launch:** set price and regional pricing, launch discount, release date. Press the release button.
10. **Legal:** an EULA if desired; credits and licences file. Include the MIT licence for steamworks.js, Electron/Chromium licences (`LICENSES.chromium.html` is already shipped by electron-builder), and the Steamworks SDK redistributable terms.

---

## 10. Smoke-test record (reproducible)

Location: `scratchpad/plan/electron-smoke/`. Versions: `electron@44.6.0`, `steamworks.js@0.4.0`, `electron-builder@26.15.3`, Node 22.22 host.

| Run | Command | Result |
|---|---|---|
| A: dev, no `steam_appid.txt` | `xvfb-run -a npx electron . --no-sandbox` | require OK; `restartAppIfNecessary(480)` → **true** after `sh: /root/.steam/root/steam.sh: not found`; `init(480)` threw `Error("Failed to load module '/root/.steam/sdk64/steamclient.so'")`, code `GenericFailure`, 0 ms, with `[S_API] SteamAPI_Init(): SteamAPI_IsSteamRunning() did not locate a running instance of Steam.` on stdout; window loaded the data: URL; bridge ping `{"steam":false}`; renderer `typeof require` = `undefined`; quit at 3 s, exit code 0 |
| B: dev, with `steam_appid.txt` (480) + overlay | `SMOKE_OVERLAY=1 xvfb-run ...` | overlay switches applied (`in-process-gpu` and `disable-direct-composition` both true); `restartAppIfNecessary` → **false**; init threw the same clean error; window and bridge OK; exit 0 |
| C: Ozone headless | `npx electron . --no-sandbox --ozone-platform=headless` (also with `--disable-gpu`) | steamworks part identical; **Electron SIGSEGV** after GPU process init failure; reproduced with a minimal app **without** steamworks, so unrelated to Steam |
| D: plain Node 22 | `node -e "require('steamworks.js').init()"` | Same clean throw. `init()` with no id and no `steam_appid.txt` throws the same error (the client is missing before the AppID is checked). |
| E: packaged asar (`electron-builder --linux dir`) | `xvfb-run -a release/linux-unpacked/shardstorm --no-sandbox` | Native module loaded from `app.asar.unpacked`; same results as A; with `steam_appid.txt` next to the exe (CWD) → `restartAppIfNecessary` false |
| F: `app://` protocol + CSP | separate `proto/` app | `origin=app://game`; `localStorage` counter 1 → 2 across launches; `getGamepads` and `AudioContext` present; userData `~/.config/<app name>` |

---

## 11. Open risks and follow-ups for the implementation phase
- On first real Steam testing (dev machine with a Steam client and AppID 480), confirm:
  - the achievement toast appears;
  - `isActivated` sticks across launches;
  - rich presence shows in the friends list (needs the real app's token file, because 480 has its own);
  - the overlay works with Shift+Tab on Windows.
- Confirm the `mac.x64ArchFiles` universal merge on a macOS runner.
- On Deck hardware, test native Linux under sniper with `--no-sandbox`, and the Proton fallback.
- If a Steam Daily-Run leaderboard becomes a priority, prototype `steamworks-ffi-node` behind `steam.cjs`. Its SDK redistributables come from the partner site and must not be committed to a public repo.
- steamworks.js is stale (last npm release 2024-08). Pin `0.4.0` exactly and vendor-check its integrity hash in CI (`npm ci` with the lockfile already does this).
