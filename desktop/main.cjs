'use strict';
/**
 * SHARDSTORM desktop shell (Electron main process).
 *
 * - Serves the unchanged Vite build (dist/) from the privileged scheme app://game/
 *   (stable origin for localStorage, strict CSP, module scripts work).
 * - Renderer is sandboxed with contextIsolation; the only bridge is desktop/preload.cjs.
 * - Steamworks lives here only (desktop/steam.cjs) and degrades to a no-op without Steam.
 * - Saves go to <userData>/save/shardstorm-save.json (atomic) for Steam Auto-Cloud.
 *
 * Environment / flags (all optional):
 *   SHARDSTORM_STEAM_APPID=<id>   AppID override (else SteamAppId, build-flags.json, steam_appid.txt)
 *   SHARDSTORM_NO_STEAM=1         skip Steam entirely            (also --no-steam)
 *   SHARDSTORM_NO_OVERLAY=1       skip the Steam overlay switches (also --no-steam-overlay)
 *   SHARDSTORM_WINDOWED=1         start windowed                  (also --windowed / --fullscreen)
 *   SHARDSTORM_USER_DATA=<dir>    userData override (tests)
 *   SHARDSTORM_SMOKE=1            load, check the title screen, quit (CI packaged smoke)
 */
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, BrowserWindow, Menu, ipcMain, net, protocol, session, shell } = require('electron');
const { createSteam } = require('./steam.cjs');
const { readSave, writeSave } = require('./savefile.cjs');
const v = require('./validate.cjs');

/** Set once the single-instance lock is held: <userData>/logs/main.log, fresh each launch (for bug reports). */
let logFile = null;
const log = (msg) => {
  const line = `[shardstorm] ${msg}`;
  console.log(line);
  if (logFile) {
    try {
      fs.appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`);
    } catch {
      logFile = null;
    }
  }
};
const argv = new Set(process.argv.slice(1));
const env = process.env;
const ORIGIN = 'app://game';
const DIST = path.resolve(__dirname, '..', 'dist');
const SMOKE = env.SHARDSTORM_SMOKE === '1';

// ---------------------------------------------------------------- identity / paths
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);
// Pins the userData dir to .../SHARDSTORM on every OS (Auto-Cloud roots depend on it).
app.setName('SHARDSTORM');
if (env.SHARDSTORM_USER_DATA) app.setPath('userData', path.resolve(env.SHARDSTORM_USER_DATA));
const SAVE_DIR = path.join(app.getPath('userData'), 'save');
const SETTINGS_FILE = path.join(app.getPath('userData'), 'desktop-settings.json');

if (!app.requestSingleInstanceLock()) {
  log('another instance is already running; focusing it and exiting');
  app.exit(0);
  return; // CommonJS module scope: stop evaluating this file.
}
try {
  const f = path.join(app.getPath('userData'), 'logs', 'main.log');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, '');
  logFile = f;
} catch {
  /* logging to stdout only */
}

// ---------------------------------------------------------------- build flags / Steam
function readJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}
const flags = readJson(path.join(__dirname, 'build-flags.json'), {});
const steamAchievements = readJson(path.join(__dirname, '..', 'steam', 'achievements.json'), null);
const ACH_ALLOW = v.achievementAllowlist(steamAchievements);

function resolveAppId() {
  const candidates = [
    env.SHARDSTORM_STEAM_APPID,
    env.SteamAppId, // set by the Steam client when it launches the game
    flags.steamAppId,
  ];
  for (const c of candidates) {
    const id = v.parseAppId(c);
    if (id) return { id, source: 'env/flags' };
  }
  // Dev: steam/steam_appid.txt in the repo; release: steam_appid.txt next to the exe or in CWD.
  const files = [path.join(process.cwd(), 'steam_appid.txt'), path.join(path.dirname(process.execPath), 'steam_appid.txt')];
  if (!app.isPackaged) files.unshift(path.join(__dirname, '..', 'steam', 'steam_appid.txt'));
  for (const f of files) {
    try {
      const id = v.parseAppId(fs.readFileSync(f, 'utf8'));
      if (id) return { id, source: f };
    } catch {
      /* missing */
    }
  }
  return { id: 0, source: 'none' };
}

const noSteam = env.SHARDSTORM_NO_STEAM === '1' || argv.has('--no-steam');
const appId = resolveAppId();
const steam = createSteam({
  loadModule: noSteam
    ? () => {
        throw new Error('disabled by SHARDSTORM_NO_STEAM / --no-steam');
      }
    : undefined,
  appId: appId.id,
  // Only a packaged Steam release may bounce through the Steam client (it execs steam.sh otherwise).
  allowRestart: app.isPackaged && flags.steamRelease === true && appId.id > 0 && appId.id !== 480 && !noSteam,
  overlay: env.SHARDSTORM_NO_OVERLAY !== '1' && !argv.has('--no-steam-overlay'),
  log,
});
if (steam.status.restart) {
  app.exit(0);
  return;
}
log(`desktop shell ${app.getVersion()} (electron ${process.versions.electron}, ${process.platform}-${process.arch}), steam=${steam.available}, appId=${appId.id || 'none'}`);

// ---------------------------------------------------------------- window settings
function loadSettings() {
  const s = readJson(SETTINGS_FILE, {});
  return { fullscreen: typeof s.fullscreen === 'boolean' ? s.fullscreen : true };
}
function saveSettings(s) {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s));
  } catch {
    /* non-fatal */
  }
}
const settings = loadSettings();
const steamDeck = env.SteamDeck === '1' || steam.isSteamDeck();
const windowedOverride = argv.has('--windowed') || env.SHARDSTORM_WINDOWED === '1';
const deckLock = steamDeck && !windowedOverride;
function startFullscreen() {
  if (windowedOverride) return false;
  if (argv.has('--fullscreen') || steamDeck) return true;
  return settings.fullscreen;
}

// ---------------------------------------------------------------- app:// protocol
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Fonts are bundled in dist/assets (src/assets/fonts): no third-party hosts at all.
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  "img-src 'self' data: blob:",
  "media-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
].join('; ');

async function serve(req) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('', { status: 405 });
  let p;
  try {
    const u = new URL(req.url);
    if (u.host !== 'game') return new Response('', { status: 403 });
    const rel = decodeURIComponent(u.pathname);
    p = path.normalize(path.join(DIST, rel === '/' ? 'index.html' : rel));
  } catch {
    return new Response('', { status: 400 });
  }
  if (!p.startsWith(DIST + path.sep)) return new Response('', { status: 403 });
  const res = await net.fetch(pathToFileURL(p).toString());
  if (!res.ok) return res;
  const headers = new Headers(res.headers);
  headers.set('Content-Security-Policy', CSP);
  headers.set('X-Content-Type-Options', 'nosniff');
  return new Response(res.body, { status: res.status, headers });
}

// ---------------------------------------------------------------- IPC bridge
/** @type {BrowserWindow | null} */
let win = null;

function handle(channel, fn) {
  ipcMain.handle(`ss:${channel}`, (event, ...args) => {
    if (!v.trustedSender(event)) throw new Error('forbidden');
    return fn(event, ...args);
  });
}

function platformInfo() {
  return {
    apiVersion: 1,
    os: process.platform,
    arch: process.arch,
    appVersion: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    packaged: app.isPackaged,
    steam: steam.available,
    steamDeck,
    overlay: steam.status.overlay,
    playerName: steam.playerName(),
    language: steam.language(),
    buildId: steam.buildId(),
    fullscreen: !!win && win.isFullScreen(),
    leaderboards: false,
  };
}

function setFullscreen(on) {
  if (!win) return false;
  if (deckLock) {
    if (!win.isFullScreen()) win.setFullScreen(true);
    return true;
  }
  const next = typeof on === 'boolean' ? on : !win.isFullScreen();
  win.setFullScreen(next);
  settings.fullscreen = next;
  saveSettings(settings);
  return next;
}

let lastPresence = '';
handle('platform', () => platformInfo());
handle('ach:activate', (_e, name) => {
  const n = v.validAchievement(name, ACH_ALLOW);
  if (!n) throw new Error('unknown achievement');
  return steam.activateAchievement(n);
});
handle('ach:is', (_e, name) => {
  const n = v.validAchievement(name, ACH_ALLOW);
  return n ? steam.isAchievementActivated(n) : false;
});
handle('ach:sync', (_e, names) => steam.syncAchievements(v.validAchievementList(names, ACH_ALLOW)));
handle('ach:flush', () => {
  steam.flushAchievements();
  return steam.pendingAchievements().length;
});
handle('ach:overlay', () => steam.openAchievementsOverlay());
handle('presence:set', (_e, p) => {
  const kv = v.presenceToSteam(p);
  if (!kv) throw new Error('invalid presence');
  const key = JSON.stringify(kv);
  if (key === lastPresence) return steam.available;
  lastPresence = key;
  return steam.setPresence(kv, v.PRESENCE_KEYS);
});
handle('presence:clear', () => {
  lastPresence = '';
  return steam.clearPresence(v.PRESENCE_KEYS);
});
handle('save:read', () => readSave(SAVE_DIR));
handle('save:write', (_e, json) => {
  const text = v.validSavePayload(json);
  return text === null ? false : writeSave(SAVE_DIR, text);
});
handle('win:fullscreen', (_e, on) => setFullscreen(typeof on === 'boolean' ? on : undefined));
handle('app:quit', () => {
  setImmediate(() => app.quit());
  return true;
});

// ---------------------------------------------------------------- quit: flush renderer save first
// Closing the window, Cmd+Q, platform().quit(), SIGTERM (Steam "Exit game") all go through here:
// the renderer gets up to 500 ms to write its pending save before the window goes away.
let flushed = false;
/** @type {Promise<void> | null} */
let flushing = null;
function flushRenderer() {
  if (flushed || !win || win.isDestroyed()) {
    flushed = true;
    return Promise.resolve();
  }
  const wc = win.webContents;
  flushing ??= new Promise((resolve) => {
    const onFlushed = (event) => {
      if (event.sender !== wc) return;
      clearTimeout(t);
      ipcMain.removeListener('ss:flushed', onFlushed);
      resolve();
    };
    const t = setTimeout(() => {
      ipcMain.removeListener('ss:flushed', onFlushed);
      resolve();
    }, 500);
    ipcMain.on('ss:flushed', onFlushed);
    wc.send('ss:flush');
  }).then(() => {
    flushed = true;
  });
  return flushing;
}
app.on('before-quit', (e) => {
  if (flushed) {
    steam.shutdown();
    return;
  }
  e.preventDefault();
  void flushRenderer().then(() => app.quit());
});
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => app.quit());
app.on('window-all-closed', () => app.quit()); // macOS too: it is a game
app.on('second-instance', () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

// ---------------------------------------------------------------- window
function installMenu() {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
    return;
  }
  // macOS needs an app menu for Cmd+Q / Cmd+Ctrl+F; keep it minimal.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'hide' }, { role: 'quit' }] },
      { label: 'View', submenu: [{ role: 'togglefullscreen' }] },
      { role: 'windowMenu' },
    ]),
  );
}

function createWindow() {
  const fullscreen = startFullscreen();
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    fullscreen,
    show: false,
    title: 'SHARDSTORM',
    backgroundColor: '#05040f',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      spellcheck: false,
      devTools: !app.isPackaged,
      autoplayPolicy: 'no-user-gesture-required',
      backgroundThrottling: false,
    },
  });
  const wc = win.webContents;
  win.once('ready-to-show', () => win && win.show());
  win.on('close', (e) => {
    if (flushed) return;
    e.preventDefault();
    void flushRenderer().then(() => {
      if (win && !win.isDestroyed()) win.close();
    });
  });
  win.on('closed', () => {
    win = null;
  });
  // F11, Alt+Enter, the macOS menu and setFullscreen() all end here: keep the game's Settings in step.
  const notifyFullscreen = (on) => {
    if (win && !win.isDestroyed()) win.webContents.send('ss:fullscreen', on);
  };
  win.on('enter-full-screen', () => notifyFullscreen(true));
  win.on('leave-full-screen', () => notifyFullscreen(false));
  wc.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (e, url) => {
    if (!url.startsWith(`${ORIGIN}/`)) e.preventDefault();
  });
  wc.on('will-attach-webview', (e) => e.preventDefault());
  wc.on('did-finish-load', () => wc.setVisualZoomLevelLimits(1, 1));
  // F11 and Alt+Enter toggle fullscreen everywhere (macOS also has Ctrl+Cmd+F from the menu).
  wc.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return;
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) {
      e.preventDefault();
      setFullscreen();
    }
  });
  wc.on('render-process-gone', (_e, d) => {
    log(`renderer gone: ${d.reason} (exit ${d.exitCode})`);
    if (SMOKE) app.exit(1);
    else if (d.reason !== 'clean-exit' && win) wc.reload();
  });
  wc.on('console-message', (ev, level, message) => {
    const lvl = ev && typeof ev.level === 'string' ? ev.level : level;
    const msg = ev && typeof ev.message === 'string' ? ev.message : message;
    if (lvl === 'error' || lvl === 3 || SMOKE) log(`renderer ${lvl}: ${msg}`);
  });
  if (!fs.existsSync(path.join(DIST, 'index.html'))) {
    log(`missing ${path.join(DIST, 'index.html')}; run "npm run build" first`);
  }
  void win.loadURL(`${ORIGIN}/index.html`);
  if (SMOKE) runSmoke(wc);
}

/** CI check for packaged builds: the title screen and the bridge must be there. */
function runSmoke(wc) {
  const fail = setTimeout(() => {
    log('smoke: FAILED (title screen not seen within 20 s)');
    app.exit(1);
  }, 20_000);
  wc.once('did-finish-load', async () => {
    for (let i = 0; i < 50; i++) {
      const r = await wc
        .executeJavaScript(
          `({ title: !!document.querySelector('#screen-title'), bridge: typeof window.shardstormDesktop, req: typeof require, origin: location.origin })`,
        )
        .catch(() => null);
      if (r && r.title) {
        clearTimeout(fail);
        log(`smoke: title screen ok ${JSON.stringify(r)} steam=${steam.available}`);
        setTimeout(() => app.quit(), 500);
        return;
      }
      await new Promise((res) => setTimeout(res, 200));
    }
  });
}

app.whenReady().then(() => {
  protocol.handle('app', serve);
  const allow = new Set(['fullscreen', 'pointerLock']);
  session.defaultSession.setPermissionRequestHandler((_wc, perm, cb) => cb(allow.has(perm)));
  session.defaultSession.setPermissionCheckHandler((_wc, perm) => allow.has(perm));
  installMenu();
  createWindow();
});

process.on('exit', (code) => {
  if (SMOKE) log(`exit code ${code}`);
});
