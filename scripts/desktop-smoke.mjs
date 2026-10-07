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
    args: [root, '--no-sandbox'],
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
  return { app, page, out, pageErrors };
}

const exitCode = (app) =>
  new Promise((resolve) => {
    const p = app.process();
    if (p.exitCode !== null) resolve(p.exitCode);
    else p.once('exit', (code) => resolve(code));
  });

try {
  // ---------------------------------------------------------------- launch 1: default (fullscreen)
  const { app, page, out, pageErrors } = await launch();
  // A fresh save opens with the story briefing (opening crawl): skip it with a key press.
  await page.waitForSelector('#screen-title:visible, #crawl', { timeout: 30_000 });
  if (await page.locator('#crawl').isVisible()) {
    await page.waitForTimeout(900);
    await page.keyboard.press('Escape');
  }
  await page.waitForSelector('#screen-title', { state: 'visible', timeout: 30_000 });
  check('title screen visible', true);
  const logo = await page.locator('.logo').first().textContent();
  check('logo shows SHARDSTORM', /SHARD/i.test(logo ?? ''), JSON.stringify(logo?.trim()));
  check('window title', (await page.title()).toLowerCase().includes('shardstorm'), await page.title());

  const env = await page.evaluate(() => ({
    origin: location.origin,
    href: location.href,
    require: typeof globalThis.require,
    process: typeof globalThis.process,
    bridge: typeof window.shardstormDesktop,
    frozen: Object.isFrozen(window.shardstormDesktop),
    leaderboards: window.shardstormDesktop?.leaderboards?.supported,
  }));
  check('served from app://game', env.origin === 'app://game', env.href);
  check('renderer has no Node (require/process)', env.require === 'undefined' && env.process === 'undefined');
  check('bridge exposed and frozen', env.bridge === 'object' && env.frozen);
  check('leaderboards reported unsupported', env.leaderboards === false);

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
  check('CSP header served', /script-src 'self'/.test(proto.csp ?? ''), proto.csp?.slice(0, 60));
  check('path traversal (403 from the handler) and foreign origins refused (CSP)', proto.traversal.every((x) => x !== 200) && proto.traversal.includes(403) && proto.otherHost !== 200, JSON.stringify(proto));

  // ---------------------------------------------------------------- start a run
  await page.locator('#screen-title [data-act="play"]').click();
  await page.waitForFunction(() => window.shardstorm?.state === 'playing', null, { timeout: 10_000 });
  await page.waitForTimeout(2500);
  const run = await page.evaluate(() => ({ time: window.shardstorm.world?.time ?? 0, enemies: window.shardstorm.world?.enemies.length ?? 0 }));
  check('run started and simulates', run.time > 1 && run.enemies > 0, JSON.stringify(run));

  // End the run so the game writes its save to localStorage (as in the browser build).
  await page.locator('#pause-btn').click();
  await page.locator('#screen-pause [data-act="quit"]').click();
  await page.waitForSelector('#screen-results', { state: 'visible', timeout: 10_000 });
  const localSave = await page.evaluate(() => localStorage.getItem('shardstorm.save'));
  check('game wrote its save (localStorage)', !!localSave && JSON.parse(localSave).stats.runs === 1);

  // ---------------------------------------------------------------- save file through the bridge
  const wrote = await page.evaluate((s) => window.shardstormDesktop.save.write(s), localSave);
  const onDisk = existsSync(saveFile) ? JSON.parse(readFileSync(saveFile, 'utf8')) : null;
  check('save.write -> userData/save/shardstorm-save.json', wrote === true && onDisk?.stats?.runs === 1, saveFile);
  const readBack = await page.evaluate(() => window.shardstormDesktop.save.read());
  check('save.read returns the file', readBack === localSave);
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
      presence: await d.presence.set({ mode: 'run', sector: 1, ship: 'spark', players: 1, time: '0:42' }),
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

  // ---------------------------------------------------------------- fullscreen toggle
  const toggled = await page.evaluate(() => window.shardstormDesktop.toggleFullscreen());
  await page.waitForTimeout(300);
  const settingsFile = join(userData, 'desktop-settings.json');
  const persisted = existsSync(settingsFile) ? JSON.parse(readFileSync(settingsFile, 'utf8')) : null;
  check('toggleFullscreen -> windowed, persisted', toggled === false && persisted?.fullscreen === false, JSON.stringify(persisted));

  // ---------------------------------------------------------------- quit flushes the renderer first
  await page.evaluate(() => {
    window.shardstormDesktop.onFlushRequest(() => window.shardstormDesktop.save.write(JSON.stringify({ flushedOnQuit: true })));
  });
  const code = exitCode(app);
  await page.evaluate(() => window.shardstormDesktop.quit()).catch(() => undefined);
  check('quit() exits with code 0', (await code) === 0);
  const afterQuit = existsSync(saveFile) ? JSON.parse(readFileSync(saveFile, 'utf8')) : null;
  check('before-quit flush handshake wrote the save', afterQuit?.flushedOnQuit === true);
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

  // ---------------------------------------------------------------- launch 2: windowed setting + persistence
  const second = await launch({ SHARDSTORM_NO_STEAM: '1' });
  await second.page.waitForSelector('#screen-title', { state: 'visible', timeout: 30_000 });
  const fs2 = await second.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen());
  check('relaunch honours the saved windowed setting', fs2 === false);
  const persistedSave = await second.page.evaluate(() => window.shardstormDesktop.save.read());
  check('save file persists across launches', JSON.parse(persistedSave ?? '{}').flushedOnQuit === true);
  // Closing the window (title-bar X, Alt+F4, Steam "Exit game") must also flush the save first.
  await second.page.evaluate(() => {
    window.shardstormDesktop.onFlushRequest(() => window.shardstormDesktop.save.write(JSON.stringify({ flushedOnClose: true })));
  });
  const code2 = exitCode(second.app);
  await second.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
  check('closing the window exits with code 0', (await code2) === 0);
  const afterClose = existsSync(saveFile) ? JSON.parse(readFileSync(saveFile, 'utf8')) : null;
  check('window close flushes the save first', afterClose?.flushedOnClose === true);
  check('--no-steam path logs the opt-out', /disabled by SHARDSTORM_NO_STEAM/.test(second.out.join('') + readFileSync(join(userData, 'logs', 'main.log'), 'utf8')));
} catch (e) {
  check('smoke run completed', false, e instanceof Error ? e.stack : String(e));
} finally {
  rmSync(userData, { recursive: true, force: true });
}

console.log('--- desktop smoke ---');
console.log(results.join('\n'));
console.log(failed ? 'DESKTOP SMOKE: FAILED' : `DESKTOP SMOKE: ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
