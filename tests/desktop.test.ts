// Main-process modules of the desktop shell (CommonJS, no Electron needed).
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const v = require('../desktop/validate.cjs');
const savefile = require('../desktop/savefile.cjs');
const { createSteam, RETRY_MS, RETRY_WINDOW_MS } = require('../desktop/steam.cjs');
const table = require('../steam/achievements.json');

describe('IPC validation', () => {
  const allow: Set<string> = v.achievementAllowlist(table);

  it('allowlists exactly the generated achievement API names', () => {
    expect(allow.size).toBe(table.achievements.length);
    expect(allow.has('ACH_FIRST_RUN')).toBe(true);
    expect(v.validAchievement('ACH_FIRST_RUN', allow)).toBe('ACH_FIRST_RUN');
    expect(v.validAchievement('ACH_NOT_REAL', allow)).toBeNull();
    expect(v.validAchievement({ toString: () => 'ACH_FIRST_RUN' }, allow)).toBeNull();
    expect(v.validAchievementList(['ACH_WARDEN', 'ACH_WARDEN', 'x', 5], allow)).toEqual(['ACH_WARDEN']);
    expect(v.achievementAllowlist({ achievements: [{ apiName: 'rm -rf' }] }).size).toBe(0);
  });

  it('maps presence to Steam keys and drops anything unexpected', () => {
    expect(v.presenceToSteam({ mode: 'run', sector: 2, ship: 'tempest', players: 3, time: '4:12', evil: 'x' })).toEqual({
      steam_display: '#Status_Run', sector: '2', ship: 'tempest', players: '3', steam_player_group_size: '3', time: '4:12',
    });
    expect(v.presenceToSteam({ mode: 'menu', ship: '#Status_Run', sector: 7, time: '99' })).toEqual({ steam_display: '#Status_Menu' });
    expect(v.presenceToSteam({ mode: 'hax' })).toBeNull();
    expect(v.presenceToSteam(null)).toBeNull();
    for (const m of v.PRESENCE_MODES) expect(v.presenceToSteam({ mode: m }).steam_display).toMatch(/^#Status_/);
  });

  it('names the boss in a boss fight, and falls back to the run token for an unknown one', () => {
    expect(v.presenceToSteam({ mode: 'boss', boss: 'hydra', sector: 2, time: '6:05', ship: 'spark', players: 1 })).toEqual({
      steam_display: '#Status_Boss', boss: 'hydra', sector: '2', time: '6:05', ship: 'spark', players: '1',
    });
    expect(v.presenceToSteam({ mode: 'boss', boss: '{#Status_Menu}' })).toEqual({ steam_display: '#Status_Run' });
    expect(v.presenceToSteam({ mode: 'run', boss: 'hydra' })).toEqual({ steam_display: '#Status_Run' });
    expect(v.PRESENCE_KEYS).toContain('boss');
  });

  it('every token the validator can send exists in the rich presence file', () => {
    const vdf = readFileSync(new URL('../steam/rich_presence_english.vdf', import.meta.url), 'utf8');
    for (const t of Object.values(v.PRESENCE_TOKENS) as string[]) expect(vdf).toContain(`"${t}"`);
    for (const b of v.BOSS_IDS as string[]) expect(vdf).toContain(`"#Boss_${b}"`);
    for (const s of v.SHIP_IDS as string[]) expect(vdf).toContain(`"#Ship_${s}"`);
  });

  it('accepts only JSON objects up to 1 MiB as saves', () => {
    expect(v.validSavePayload('{"a":1}')).toBe('{"a":1}');
    expect(v.validSavePayload('[]')).toBe('[]');
    expect(v.validSavePayload('null')).toBeNull();
    expect(v.validSavePayload('42')).toBeNull();
    expect(v.validSavePayload('{broken')).toBeNull();
    expect(v.validSavePayload({})).toBeNull();
    expect(v.validSavePayload(`{"x":"${'a'.repeat(v.MAX_SAVE_BYTES)}"}`)).toBeNull();
  });

  it('trusts only the app://game origin', () => {
    expect(v.trustedSender({ senderFrame: { url: 'app://game/index.html' } })).toBe(true);
    expect(v.trustedSender({ senderFrame: { url: 'https://evil.example/' } })).toBe(false);
    expect(v.trustedSender({ senderFrame: { url: 'app://gamer/index.html' } })).toBe(false);
    expect(v.trustedSender({ senderFrame: null })).toBe(false);
    expect(v.trustedSender(undefined)).toBe(false);
  });

  it('parses AppIDs strictly', () => {
    expect(v.parseAppId('480\n')).toBe(480);
    expect(v.parseAppId(1234560)).toBe(1234560);
    expect(v.parseAppId('0')).toBe(0);
    expect(v.parseAppId('480; rm')).toBe(0);
    expect(v.parseAppId(undefined)).toBe(0);
    expect(v.parseAppId(-1)).toBe(0);
  });
});

describe('atomic save file', () => {
  let dir = '';
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('writes, keeps a backup and falls back to it when the main file is corrupt', () => {
    dir = mkdtempSync(join(tmpdir(), 'ss-save-'));
    const p = savefile.savePaths(join(dir, 'save'));
    expect(savefile.readSave(p.dir)).toBeNull();
    expect(savefile.writeSave(p.dir, '{"v":1}')).toBe(true);
    expect(savefile.writeSave(p.dir, '{"v":2}')).toBe(true);
    expect(readFileSync(p.file, 'utf8')).toBe('{"v":2}');
    expect(readFileSync(p.bak, 'utf8')).toBe('{"v":1}');
    writeFileSync(p.file, '{"v":3'); // torn write from another tool
    expect(savefile.readSave(p.dir)).toBe('{"v":1}');
    // A corrupt current file is not copied over the good backup.
    expect(savefile.writeSave(p.dir, '{"v":4}')).toBe(true);
    expect(readFileSync(p.bak, 'utf8')).toBe('{"v":1}');
    expect(savefile.readSave(p.dir)).toBe('{"v":4}');
  });

  it('reports failure instead of throwing', () => {
    dir = mkdtempSync(join(tmpdir(), 'ss-save-'));
    const blocker = join(dir, 'file');
    writeFileSync(blocker, 'x');
    expect(savefile.writeSave(join(blocker, 'save'), '{}')).toBe(false);
  });
});

/** A fake steamworks.js module. */
function fakeSteamworks(opts: { initThrows?: boolean; activateOk?: () => boolean; restart?: boolean } = {}) {
  const log: string[] = [];
  const unlocked = new Set<string>();
  const presence = new Map<string, string>();
  const client = {
    achievement: {
      activate: (n: string) => {
        log.push(`activate ${n}`);
        const ok = opts.activateOk ? opts.activateOk() : true;
        if (ok) unlocked.add(n);
        return ok;
      },
      isActivated: (n: string) => unlocked.has(n),
    },
    stats: { store: () => (log.push('store'), true) },
    localplayer: {
      getName: () => 'Starling',
      setRichPresence: (k: string, val?: string) => (val === undefined ? presence.delete(k) : presence.set(k, val)),
    },
    apps: { currentGameLanguage: () => 'english', appBuildId: () => 42 },
    utils: { isSteamRunningOnSteamDeck: () => false },
    overlay: { activateDialog: (d: number) => log.push(`overlay ${d}`) },
  };
  const mod = {
    restartAppIfNecessary: (id: number) => (log.push(`restart? ${id}`), !!opts.restart),
    init: (id?: number) => {
      log.push(`init ${id}`);
      if (opts.initThrows) throw new Error("Failed to load module '/root/.steam/sdk64/steamclient.so'");
      return client;
    },
    electronEnableSteamOverlay: () => log.push('overlay-switches'),
  };
  return { mod, log, unlocked, presence };
}

function manualTimers() {
  let t = 0;
  const intervals = new Map<number, { fn: () => void; ms: number; next: number }>();
  let id = 0;
  return {
    now: () => t,
    setInterval: (fn: () => void, ms: number) => {
      intervals.set(++id, { fn, ms, next: t + ms });
      return id;
    },
    clearInterval: (h: number) => void intervals.delete(h),
    advance(ms: number) {
      const end = t + ms;
      for (;;) {
        const due = [...intervals.entries()].filter(([, x]) => x.next <= end).sort((a, b) => a[1].next - b[1].next)[0];
        if (!due) break;
        t = due[1].next;
        due[1].next += due[1].ms;
        due[1].fn();
      }
      t = end;
    },
    active: () => intervals.size,
  };
}

describe('steam wrapper', () => {
  it('falls back cleanly when the module is missing or init throws', () => {
    const logs: string[] = [];
    const missing = createSteam({ loadModule: () => { throw new Error('Unsupported OS'); }, appId: 480, allowRestart: false, overlay: true, log: (m: string) => logs.push(m) });
    expect(missing.available).toBe(false);
    expect(missing.status.reason).toMatch(/module-unavailable/);
    expect(missing.activateAchievement('ACH_FIRST_RUN')).toBe(false);
    expect(missing.playerName()).toBeNull();
    expect(missing.setPresence({ steam_display: '#Status_Menu' }, v.PRESENCE_KEYS)).toBe(false);

    const f = fakeSteamworks({ initThrows: true });
    const noClient = createSteam({ loadModule: () => f.mod, appId: 480, allowRestart: false, overlay: true, log: (m: string) => logs.push(m) });
    expect(noClient.available).toBe(false);
    expect(noClient.status.reason).toMatch(/steamclient/);
    expect(f.log).toEqual(['init 480']); // no restart, no overlay switches without a client
    expect(logs.some((l) => l.startsWith('steam: unavailable, running without Steam'))).toBe(true);
    expect(noClient.syncAchievements(['ACH_FIRST_RUN'])).toBe(0);
    expect(() => noClient.shutdown()).not.toThrow();
  });

  it('only calls restartAppIfNecessary when allowed, and stops when it asks to relaunch', () => {
    const f = fakeSteamworks({ restart: true });
    const s = createSteam({ loadModule: () => f.mod, appId: 1234560, allowRestart: true, overlay: true, log: () => undefined });
    expect(s.status.restart).toBe(true);
    expect(f.log).toEqual(['restart? 1234560']);
    const g = fakeSteamworks({ restart: true });
    createSteam({ loadModule: () => g.mod, appId: 480, allowRestart: false, overlay: false, log: () => undefined });
    expect(g.log).toEqual(['init 480']);
  });

  it('initialises, enables the overlay, and sets/clears rich presence', () => {
    const f = fakeSteamworks();
    const s = createSteam({ loadModule: () => f.mod, appId: 480, allowRestart: false, overlay: true, log: () => undefined });
    expect(s.available).toBe(true);
    expect(s.status.overlay).toBe(true);
    expect(f.log).toEqual(['init 480', 'overlay-switches']);
    expect(s.playerName()).toBe('Starling');
    expect(s.buildId()).toBe(42);
    s.setPresence(v.presenceToSteam({ mode: 'run', sector: 2, players: 2 }), v.PRESENCE_KEYS);
    expect(Object.fromEntries(f.presence)).toEqual({ steam_display: '#Status_Run', sector: '2', players: '2', steam_player_group_size: '2' });
    s.setPresence(v.presenceToSteam({ mode: 'menu' }), v.PRESENCE_KEYS);
    expect(Object.fromEntries(f.presence)).toEqual({ steam_display: '#Status_Menu' });
    s.clearPresence(v.PRESENCE_KEYS);
    expect(f.presence.size).toBe(0);
    expect(s.openAchievementsOverlay()).toBe(true);
    expect(f.log.at(-1)).toBe('overlay 6');
  });

  it('queues achievements that fail before stats arrive and retries them', () => {
    let ready = false;
    const f = fakeSteamworks({ activateOk: () => ready });
    const timers = manualTimers();
    const s = createSteam({ loadModule: () => f.mod, appId: 480, allowRestart: false, overlay: false, log: () => undefined, timers });
    expect(s.activateAchievement('ACH_FIRST_RUN')).toBe(false);
    expect(s.pendingAchievements()).toEqual(['ACH_FIRST_RUN']);
    timers.advance(RETRY_MS);
    expect(s.pendingAchievements()).toEqual(['ACH_FIRST_RUN']);
    ready = true;
    timers.advance(RETRY_MS);
    expect(s.pendingAchievements()).toEqual([]);
    expect(f.unlocked.has('ACH_FIRST_RUN')).toBe(true);
    expect(timers.active()).toBe(0);
  });

  it('gives up retrying after the retry window, and sync skips already-unlocked ones', () => {
    const f = fakeSteamworks({ activateOk: () => false });
    const timers = manualTimers();
    const s = createSteam({ loadModule: () => f.mod, appId: 480, allowRestart: false, overlay: false, log: () => undefined, timers });
    f.unlocked.add('ACH_WARDEN');
    expect(s.syncAchievements(['ACH_WARDEN', 'ACH_HYDRA'])).toBe(1);
    expect(s.pendingAchievements()).toEqual(['ACH_HYDRA']);
    timers.advance(RETRY_WINDOW_MS + RETRY_MS * 2);
    expect(s.pendingAchievements()).toEqual([]);
    s.flushAchievements();
    expect(f.log.at(-1)).toBe('store');
  });
});
