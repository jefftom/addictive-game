// Desktop smoke test: launches the real Electron shell on the built game (dist/) with
// Playwright's _electron API and checks the things only a real window can prove.
//
//   npm run desktop:smoke          (builds first)
//   node scripts/desktop-smoke.mjs (uses the existing dist/)
//
// On Linux without a display it re-runs itself under `xvfb-run -a`.
// Steam is expected to be ABSENT here: the test asserts the clean no-Steam fallback.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from '@playwright/test';

const root = fileURLToPath(new URL('..', import.meta.url));

if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.SHARDSTORM_SMOKE_XVFB) {
  const r = spawnSync('xvfb-run', ['-a', process.execPath, fileURLToPath(import.meta.url), ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, SHARDSTORM_SMOKE_XVFB: '1' },
  });
  if (r.error) {
    console.error('xvfb-run is required on Linux without a display:', r.error.message);
    process.exit(1);
  }
  process.exit(r.status ?? 1);
}

const require = createRequire(import.meta.url);
const electronPath = require('electron'); // path to the Electron binary
const results = [];
let failed = false;
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failed = true;
};

if (!existsSync(join(root, 'dist', 'index.html'))) {
  console.error('dist/index.html missing: run "npm run build" (or "npm run desktop:smoke")');
  process.exit(1);
}
// The web bundle must never contain the Steam/Electron runtime.
const bundle = readdirSync(join(root, 'dist', 'assets'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => readFileSync(join(root, 'dist', 'assets', f), 'utf8'))
  .join('\n');
check('web bundle has no steamworks/electron imports', !/steamworks|require\(["']electron["']\)/.test(bundle));

const userData = mkdtempSync(join(tmpdir(), 'shardstorm-smoke-'));
const saveFile = join(userData, 'save', 'shardstorm-save.json');

async function launch(extraEnv = {}) {
  const app = await _electron.launch({
    executablePath: electronPath,
    // cwd is the repo; a trailing backslash in an absolute Windows entry path
    // prevents Electron's debugger launch from reaching the app.
    args: ['.', '--no-sandbox'],
    cwd: root,
    env: { ...process.env, SHARDSTORM_USER_DATA: userData, ...extraEnv },
    timeout: 60_000,
  });
  const out = [];
  app.process().stdout?.on('data', (d) => out.push(String(d)));
  app.process().stderr?.on('data', (d) => out.push(String(d)));
  const page = await app.firstWindow();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  return { app, page, out, pageErrors, requests };
}

const exitCode = (app) =>
  new Promise((resolve) => {
    const p = app.process();
    if (p.exitCode !== null) resolve(p.exitCode);
    else p.once('exit', (code) => resolve(code));
  });

const readJson = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null);
/** Polls `fn` until it returns a truthy value (or the time is up); resolves with the last value. */
async function until(fn, ms = 5000) {
  const end = Date.now() + ms;
  let v = await fn();
  while (!v && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 100));
    v = await fn();
  }
  return v;
}
const settingsFile = join(userData, 'desktop-settings.json');
const isFullScreen = (app) => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen());
/** The App's private platform (window.shardstorm is the App; private fields are readable at runtime). */
const hydrated = (page) => page.evaluate(() => window.shardstorm.platform.hydrated());

try {
  // ---------------------------------------------------------------- launch 1: fresh profile, default (fullscreen)
  const { app, page, out, pageErrors, requests } = await launch();
  // A fresh save opens with the story briefing (opening crawl): skip it with a key press.
  await page.waitForSelector('#screen-title:visible, #crawl', { timeout: 30_000 });
  if (await page.locator('#crawl').isVisible()) {
    await page.waitForTimeout(900);
    await page.keyboard.press('Escape');
  }
  await page.waitForSelector('#screen-title', { state: 'visible', timeout: 30_000 });
  check('title screen visible', true);
  await page.waitForFunction(() => window.shardstorm.renderer.bg.galaxy.isReady(0), null, { timeout: 20_000 });
  const gal = await page.evaluate(() => ({ worker: window.shardstorm.renderer.bg.galaxy.usesWorker, viaWorker: window.shardstorm.renderer.bg.galaxy.genStats.get(0)?.worker }));
  check('galaxy backdrop generates in a worker', gal.worker === true && gal.viaWorker === true, JSON.stringify(gal));
  const logo = await page.locator('.logo').first().textContent();
  check('logo shows SHARDSTORM', /SHARD/i.test(logo ?? ''), JSON.stringify(logo?.trim()));
  check('window title', (await page.title()).toLowerCase().includes('shardstorm'), await page.title());
  check('fresh profile: nothing to hydrate', (await hydrated(page)) === 'empty');

  const env = await page.evaluate(() => ({
    origin: location.origin,
    href: location.href,
    require: typeof globalThis.require,
    process: typeof globalThis.process,
    bridge: typeof window.shardstormDesktop,
    frozen: Object.isFrozen(window.shardstormDesktop),
    leaderboards: window.shardstormDesktop?.leaderboards?.supported,
    platform: window.shardstorm?.platform?.kind,
  }));
  check('served from app://game', env.origin === 'app://game', env.href);
  check('renderer has no Node (require/process)', env.require === 'undefined' && env.process === 'undefined');
  check('bridge exposed and frozen', env.bridge === 'object' && env.frozen);
  check('game runs on the desktop platform', env.platform === 'desktop');
  check('leaderboards reported unsupported', env.leaderboards === false);

  // Bundled fonts: loaded from app://game, no request leaves the app.
  const fonts = await page.evaluate(async () => {
    await document.fonts.ready;
    return {
      tektur: document.fonts.check('900 40px Tektur'),
      chakra: document.fonts.check('400 15px "Chakra Petch"'),
      kode: document.fonts.check('700 12px "Kode Mono"'),
      loaded: [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family),
    };
  });
  check('bundled fonts loaded', fonts.tektur && fonts.chakra && fonts.kode && ['Tektur', 'Chakra Petch', 'Kode Mono'].every((f) => fonts.loaded.includes(f)), JSON.stringify(fonts.loaded));
  // Vite's inline worker uses a blob owned by the same local application origin.
  const remote = requests.filter((u) => !u.startsWith('app://game/') && !u.startsWith('blob:app://game/') && !u.startsWith('data:'));
  check('no network requests outside app://game', remote.length === 0, remote.join(' '));

  const info = await page.evaluate(() => window.shardstormDesktop.getPlatform());
  check('platform info: steam=false without a Steam client', info.steam === false, JSON.stringify(info));
  check('isSteam() false', (await page.evaluate(() => window.shardstormDesktop.isSteam())) === false);
  const win = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const p = w.webContents.getLastWebPreferences();
    return { fullscreen: w.isFullScreen(), contextIsolation: p.contextIsolation, sandbox: p.sandbox, nodeIntegration: p.nodeIntegration, menu: w.isMenuBarVisible() };
  });
  check('fullscreen by default', win.fullscreen === true, JSON.stringify(win));
  check('secure webPreferences', win.contextIsolation === true && win.sandbox === true && win.nodeIntegration === false);
  check('title has "Quit to desktop"', await page.locator('#screen-title [data-act="quit"]').isVisible());

  // Protocol hardening and CSP.
  const proto = await page.evaluate(async () => {
    const r = await fetch('app://game/index.html');
    const st = (u) => fetch(u).then((x) => x.status, () => 'network-error');
    return {
      csp: r.headers.get('content-security-policy'),
      traversal: [await st('app://game/%2e%2e/package.json'), await st('app://game/..%2fpackage.json'), await st('app://game/%2e%2e%2fdesktop%2fmain.cjs')],
      otherHost: await st('app://evil/index.html'),
    };
  });
  check('CSP header served, no remote font hosts', /script-src 'self'/.test(proto.csp ?? '') && /font-src 'self'/.test(proto.csp ?? '') && !/https:/.test(proto.csp ?? ''), proto.csp?.slice(0, 60));
  check('path traversal (403 from the handler) and foreign origins refused (CSP)', proto.traversal.every((x) => x !== 200) && proto.traversal.includes(403) && proto.otherHost !== 200, JSON.stringify(proto));

  // ---------------------------------------------------------------- Settings: fullscreen toggle (persisted) and F11
  await page.locator('#screen-title [data-act="settings"]').click();
  const fsToggle = page.locator('#set-fullscreen');
  check('Settings shows the fullscreen toggle, on', (await fsToggle.isVisible()) && (await fsToggle.isChecked()));
  await fsToggle.click();
  check('toggle off -> windowed', (await until(async () => !(await isFullScreen(app)))) === true);
  check('windowed choice persisted by the shell', (await until(() => readJson(settingsFile)?.fullscreen === false)) === true, JSON.stringify(readJson(settingsFile)));
  // A real key press (Playwright's CDP keys bypass the shell's before-input-event handler).
  await app.evaluate(({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'F11' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'F11' });
  });
  check('F11 -> fullscreen, and the Settings toggle follows', (await until(async () => (await isFullScreen(app)) && (await fsToggle.isChecked()))) === true);
  await fsToggle.click(); // back to windowed for launch 2
  await until(async () => !(await isFullScreen(app)));
  await page.keyboard.press('Escape');
  await page.waitForSelector('#screen-title', { state: 'visible' });

  // ---------------------------------------------------------------- a run: the game itself writes the save file
  await page.locator('#screen-title [data-act="play"]').click();
  await page.waitForFunction(() => window.shardstorm?.state === 'playing', null, { timeout: 10_000 });
  await page.waitForTimeout(2500);
  const run = await page.evaluate(() => ({ time: window.shardstorm.world?.time ?? 0, enemies: window.shardstorm.world?.enemies.length ?? 0 }));
  check('run started and simulates', run.time > 1 && run.enemies > 0, JSON.stringify(run));
  await page.locator('#pause-btn').click();
  await page.locator('#screen-pause [data-act="quit"]').click();
  await page.waitForSelector('#screen-results', { state: 'visible', timeout: 10_000 });
  const localSave = await page.evaluate(() => localStorage.getItem('shardstorm.save'));
  check('game wrote its save (localStorage)', !!localSave && JSON.parse(localSave).stats.runs === 1);
  const fileSave = await until(() => readJson(saveFile)?.stats?.runs === 1 && readJson(saveFile), 2000);
  check('run end wrote userData/save/shardstorm-save.json (no manual bridge call)', fileSave?.stats?.runs === 1 && fileSave?.story?.introSeen === true, saveFile);

  // ---------------------------------------------------------------- the bridge itself
  const readBack = await page.evaluate(() => window.shardstormDesktop.save.read());
  check('save.read returns the file', JSON.parse(readBack ?? '{}').stats?.runs === 1);
  const rejected = await page.evaluate(() => window.shardstormDesktop.save.write('{not json'));
  check('invalid save payload rejected', rejected === false);

  // ---------------------------------------------------------------- Steam calls degrade cleanly
  const steamCalls = await page.evaluate(async () => {
    const d = window.shardstormDesktop;
    const bad = await d.achievements.activate('ACH_HACKED').then(() => 'accepted', (e) => `rejected: ${e.message}`);
    const badPresence = await d.presence.set({ mode: 'evil' }).then(() => 'accepted', () => 'rejected');
    return {
      activate: await d.achievements.activate('ACH_FIRST_RUN'),
      isActivated: await d.achievements.isActivated('ACH_FIRST_RUN'),
      sync: await d.achievements.sync(['ACH_FIRST_RUN', 'ACH_WARDEN']),
      presence: await d.presence.set({ mode: 'boss', boss: 'warden', sector: 1, ship: 'spark', players: 1, time: '3:02' }),
      clear: await d.presence.clear(),
      bad,
      badPresence,
    };
  });
  check(
    'achievements/presence are safe no-ops without Steam',
    steamCalls.activate === false && steamCalls.isActivated === false && steamCalls.sync === 0 && steamCalls.presence === false,
    JSON.stringify(steamCalls),
  );
  check('unknown achievement and bad presence rejected by main', steamCalls.bad.startsWith('rejected') && steamCalls.badPresence === 'rejected');

  // ---------------------------------------------------------------- Quit to desktop flushes a pending save first
  await page.locator('#screen-results [data-act="menu"]').click();
  await page.waitForSelector('#screen-title', { state: 'visible' });
  await page.locator('#screen-title [data-act="settings"]').click();
  await page.locator('#set-showFps').click(); // writeSave: mirrored to the file only after 500 ms
  await page.keyboard.press('Escape');
  const code = exitCode(app);
  await page.locator('#screen-title [data-act="quit"]').click();
  check('"Quit to desktop" exits with code 0', (await code) === 0);
  const afterQuit = readJson(saveFile);
  check('quit flushed the pending save first', afterQuit?.settings?.showFps === true && afterQuit?.stats?.runs === 1, JSON.stringify(afterQuit?.settings));
  check('previous save kept as .bak', existsSync(`${saveFile}.bak`));

  // Main-process log: stdout is partly consumed by Playwright, so read the shell's log file too.
  const mainLog = join(userData, 'logs', 'main.log');
  const log = out.join('') + (existsSync(mainLog) ? readFileSync(mainLog, 'utf8') : '');
  check('no-Steam fallback logged once, cleanly', (log.match(/steam: unavailable, running without Steam/g) ?? []).length === 1, log.match(/steam: unavailable[^\n]*/)?.[0]);
  check('no uncaught errors in main or renderer', !/Uncaught|UnhandledPromiseRejection|TypeError/.test(log) && pageErrors.length === 0, pageErrors.join('; '));
  const rendererErrors = log.split('\n').filter((l) => /renderer error:/.test(l) && !/app:\/\/evil/.test(l));
  check('no renderer console errors (besides the deliberate CSP probe)', rendererErrors.length === 0, rendererErrors.join(' | '));
  console.log('--- main process log (launch 1) ---');
  console.log(readFileSync(mainLog, 'utf8').trim());

  // ---------------------------------------------------------------- launch 2: the file is the source of truth
  const second = await launch({ SHARDSTORM_NO_STEAM: '1' });
  await second.page.waitForSelector('#screen-title', { state: 'visible', timeout: 30_000 });
  check('relaunch honours the saved windowed setting', (await isFullScreen(second.app)) === false);
  check('save hydrated from the file', (await hydrated(second.page)) === 'file');
  const loaded = await second.page.evaluate(() => ({ runs: window.shardstorm.save.stats.runs, showFps: window.shardstorm.save.settings.showFps }));
  check('game loaded the file save (runs, settings)', loaded.runs === 1 && loaded.showFps === true, JSON.stringify(loaded));
  // Closing the window (title-bar X, Alt+F4, Steam "Exit game") must also flush a pending save first.
  await second.page.locator('#screen-title [data-act="settings"]').click();
  await second.page.locator('#set-showFps').click();
  const code2 = exitCode(second.app);
  await second.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  check('closing the window exits with code 0', (await code2) === 0);
  check('window close flushes the pending save first', readJson(saveFile)?.settings?.showFps === false, JSON.stringify(readJson(saveFile)?.settings));
  check('--no-steam path logs the opt-out', /disabled by SHARDSTORM_NO_STEAM/.test(second.out.join('') + readFileSync(join(userData, 'logs', 'main.log'), 'utf8')));

  // ---------------------------------------------------------------- launch 3: migration from localStorage, Steam Deck
  // No save file but a localStorage save (a desktop build from before the save file): it is migrated once.
  rmSync(join(userData, 'save'), { recursive: true, force: true });
  const third = await launch({ SHARDSTORM_NO_STEAM: '1', SteamDeck: '1' });
  await third.page.waitForSelector('#screen-title', { state: 'visible', timeout: 30_000 });
  check('old localStorage save migrated to the save file', (await hydrated(third.page)) === 'migrated-local');
  check('migrated save written to disk', (await until(() => readJson(saveFile)?.stats?.runs === 1)) === true);
  check('Steam Deck starts fullscreen despite the windowed setting', (await isFullScreen(third.app)) === true);
  await third.page.locator('#screen-title [data-act="settings"]').click();
  check('Steam Deck: fullscreen toggle locked on', (await third.page.locator('#set-fullscreen').isChecked()) && (await third.page.locator('#set-fullscreen').isDisabled()));
  await third.app.evaluate(({ BrowserWindow }) => {
    const wc = BrowserWindow.getAllWindows()[0].webContents;
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'F11' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'F11' });
  });
  await third.page.waitForTimeout(1000); // allow a window-mode transition to finish if the lock regresses
  check('Steam Deck: F11 keeps fullscreen and preserves the windowed preference',
    (await isFullScreen(third.app)) === true && readJson(settingsFile)?.fullscreen === false);
  const code3 = exitCode(third.app);
  await third.page.keyboard.press('Escape');
  await third.page.locator('#screen-title [data-act="quit"]').click();
  check('third launch quits cleanly', (await code3) === 0);
} catch (e) {
  check('smoke run completed', false, e instanceof Error ? e.stack : String(e));
} finally {
  rmSync(userData, { recursive: true, force: true });
}

console.log('--- desktop smoke ---');
console.log(results.join('\n'));
console.log(failed ? 'DESKTOP SMOKE: FAILED' : `DESKTOP SMOKE: ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
