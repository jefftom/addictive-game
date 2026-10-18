import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACHIEVEMENTS, achievementDef } from '../src/meta/achievements';
import { SAVE_KEY, defaultSave, loadSave, writeSave } from '../src/meta/save';
import {
  COOP_ACHIEVEMENTS,
  STEAM_ACHIEVEMENTS,
  buildSteamAchievements,
  gameIdFromApiName,
  steamApiName,
  steamDescription,
  toSteamNames,
} from '../src/platform/achievements';
import { createDesktopPlatform } from '../src/platform/desktop';
import { PRESENCE_EVERY, PlatformLink, presenceFor, type PresenceSnapshot } from '../src/platform/link';
import { createPlatform, detectBridge, platform, setPlatformForTests, type DesktopBridge, type Platform, type PlatformInfo } from '../src/platform/platform';
import {
  createPresenceThrottle,
  formatPresenceTime,
  runPresence,
  sanitizePresence,
  sectorForTime,
  type Presence,
  type ThrottleClock,
} from '../src/platform/presence';
import { CLEARED_SAVE, DEFAULT_SAVE_KEY, createMirroredStorage, memoryStorage, safeStorage, type Timers } from '../src/platform/storage';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Manual clock + timers for debounce/throttle tests. */
function fakeClock(): ThrottleClock & Timers & { advance(ms: number): void } {
  let t = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => t,
    setTimeout(fn, ms) {
      const id = ++seq;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimeout(h) {
      timers.delete(h as number);
    },
    advance(ms) {
      t += ms;
      for (const [id, x] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (x.at <= t) {
          timers.delete(id);
          x.fn();
        }
      }
    },
  };
}

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

function fakeBridge(file: string | null = null) {
  const calls: { ch: string; arg?: unknown }[] = [];
  const state = { file, flushHandler: null as null | (() => unknown), fullscreenHandler: null as null | ((on: boolean) => void) };
  const info: PlatformInfo = {
    apiVersion: 1, os: 'linux', arch: 'x64', appVersion: '1.0.0', electron: '44.6.0', chrome: '152', packaged: false,
    steam: true, steamDeck: false, overlay: true, playerName: 'Starling', language: 'english', buildId: 7, fullscreen: true, leaderboards: false,
  };
  const rec = <T>(ch: string, ret: T, arg?: unknown) => {
    calls.push({ ch, arg });
    return Promise.resolve(ret);
  };
  const bridge: DesktopBridge = {
    apiVersion: 1,
    getPlatform: () => rec('platform', info),
    isSteam: () => rec('isSteam', true),
    achievements: {
      activate: (n) => rec('ach:activate', true, n),
      isActivated: (n) => rec('ach:is', false, n),
      sync: (ns) => rec('ach:sync', ns.length, ns),
      flush: () => rec('ach:flush', 0),
      openOverlay: () => rec('ach:overlay', true),
    },
    presence: { set: (p) => rec('presence:set', true, p), clear: () => rec('presence:clear', true) },
    leaderboards: { supported: false },
    save: {
      read: () => rec('save:read', state.file),
      write: (json) => {
        state.file = json;
        return rec('save:write', true, json);
      },
    },
    onFlushRequest: (fn) => {
      state.flushHandler = fn;
    },
    onFullscreenChange: (fn) => {
      state.fullscreenHandler = fn;
    },
    setFullscreen: (on) => rec('fullscreen', on ?? false, on),
    toggleFullscreen: () => rec('toggleFullscreen', false),
    quit: () => rec('quit', true),
  };
  return { bridge, calls, state };
}

describe('platform detection', () => {
  it('uses the web platform without a bridge and the desktop one with a compatible bridge', () => {
    expect(createPlatform({}).kind).toBe('web');
    expect(createPlatform({ shardstormDesktop: fakeBridge().bridge }).kind).toBe('desktop');
  });

  it('rejects incompatible or malformed bridges', () => {
    const { bridge } = fakeBridge();
    expect(detectBridge({ shardstormDesktop: { ...bridge, apiVersion: 2 } })).toBeNull();
    expect(detectBridge({ shardstormDesktop: { apiVersion: 1 } })).toBeNull();
    expect(detectBridge(null)).toBeNull();
    expect(detectBridge({ shardstormDesktop: bridge })).toBe(bridge);
  });

  it('web platform is a safe no-op', async () => {
    const p = createPlatform({});
    await p.init();
    expect(p.isSteam()).toBe(false);
    expect(p.canQuit).toBe(false);
    expect(p.leaderboardsSupported).toBe(false);
    p.unlockAchievements(['first_run']);
    p.setPresence({ mode: 'menu' });
    p.storage.setItem(SAVE_KEY, '{"a":1}');
    expect(p.storage.getItem(SAVE_KEY)).toBe('{"a":1}');
    expect(await p.toggleFullscreen()).toBe(false);
  });
});

describe('save storage adapter', () => {
  it('uses the same key as src/meta/save.ts', () => {
    expect(DEFAULT_SAVE_KEY).toBe(SAVE_KEY);
  });

  it('falls back to memory when localStorage throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    const s = safeStorage(broken);
    s.setItem('k', 'v');
    expect(s.getItem('k')).toBe('v');
    s.removeItem('k');
    expect(s.getItem('k')).toBeNull();
  });

  it('debounces save-key writes to the file and ignores other keys', async () => {
    const clock = fakeClock();
    const { bridge, calls, state } = fakeBridge();
    const s = createMirroredStorage(memoryStorage(), bridge.save, { timers: clock, debounceMs: 500 });
    s.setItem(SAVE_KEY, '{"v":1}');
    s.setItem(SAVE_KEY, '{"v":2}');
    s.setItem('other', 'x');
    expect(s.pending()).toBe(true);
    clock.advance(499);
    expect(calls.filter((c) => c.ch === 'save:write')).toHaveLength(0);
    clock.advance(1);
    await flushMicrotasks();
    expect(calls.filter((c) => c.ch === 'save:write').map((c) => c.arg)).toEqual(['{"v":2}']);
    expect(state.file).toBe('{"v":2}');
    expect(s.getItem(SAVE_KEY)).toBe('{"v":2}');
  });

  it('flush() writes immediately and removeItem writes a cleared save', async () => {
    const clock = fakeClock();
    const { bridge, state } = fakeBridge();
    const s = createMirroredStorage(memoryStorage(), bridge.save, { timers: clock });
    s.setItem(SAVE_KEY, '{"v":3}');
    await s.flush();
    expect(state.file).toBe('{"v":3}');
    s.removeItem(SAVE_KEY);
    await s.flush();
    expect(state.file).toBe(CLEARED_SAVE);
    expect(s.getItem(SAVE_KEY)).toBeNull();
  });

  it('hydrate() prefers the file, migrates an existing local save, and survives errors', async () => {
    const local = memoryStorage();
    local.setItem(SAVE_KEY, '{"old":true}');
    const fromFile = createMirroredStorage(local, fakeBridge('{"cloud":true}').bridge.save);
    expect(await fromFile.hydrate()).toBe('file');
    expect(local.getItem(SAVE_KEY)).toBe('{"cloud":true}');

    const local2 = memoryStorage();
    local2.setItem(SAVE_KEY, '{"old":true}');
    const fb = fakeBridge(null);
    const migrate = createMirroredStorage(local2, fb.bridge.save);
    expect(await migrate.hydrate()).toBe('migrated-local');
    await migrate.flush();
    expect(fb.state.file).toBe('{"old":true}');

    const cleared = memoryStorage();
    cleared.setItem(SAVE_KEY, '{"old":true}');
    expect(await createMirroredStorage(cleared, fakeBridge(CLEARED_SAVE).bridge.save).hydrate()).toBe('file');
    expect(cleared.getItem(SAVE_KEY)).toBeNull();

    expect(await createMirroredStorage(memoryStorage(), fakeBridge('not json').bridge.save).hydrate()).toBe('empty');
    const onError = vi.fn();
    const failing = createMirroredStorage(memoryStorage(), { read: () => Promise.reject(new Error('io')), write: async () => true }, { onError });
    expect(await failing.hydrate()).toBe('error');
    expect(onError).toHaveBeenCalled();
  });
});

describe('desktop platform', () => {
  it('init hydrates the save before reading platform info', async () => {
    const { bridge, calls } = fakeBridge('{"rank":3}');
    const local = memoryStorage();
    const p = createDesktopPlatform(bridge, local);
    expect(p.isSteam()).toBe(false);
    await p.init();
    await p.init(); // idempotent
    expect(calls.filter((c) => c.ch === 'save:read')).toHaveLength(1);
    expect(calls.map((c) => c.ch).slice(0, 2)).toEqual(['save:read', 'platform']);
    expect(p.hydrated()).toBe('file');
    expect(local.getItem(SAVE_KEY)).toBe('{"rank":3}');
    expect(p.isSteam()).toBe(true);
    expect(p.info().playerName).toBe('Starling');
    expect(p.leaderboardsSupported).toBe(false);
  });

  it('maps achievements to Steam API names and drops unknown ids', async () => {
    const { bridge, calls } = fakeBridge();
    const p = createDesktopPlatform(bridge, memoryStorage());
    p.unlockAchievements(['first_run', 'nope', 'warden']);
    p.syncAchievements(['victory', 'victory', 'bogus']);
    p.syncAchievements(['bogus']);
    await flushMicrotasks();
    expect(calls.filter((c) => c.ch === 'ach:activate').map((c) => c.arg)).toEqual(['ACH_FIRST_RUN', 'ACH_WARDEN']);
    expect(calls.filter((c) => c.ch === 'ach:sync').map((c) => c.arg)).toEqual([['ACH_VICTORY']]);
  });

  it('throttles and sanitises presence, ignoring invalid input', () => {
    const clock = fakeClock();
    const { bridge, calls } = fakeBridge();
    const p = createDesktopPlatform(bridge, memoryStorage(), { clock, presenceIntervalMs: 10_000 });
    p.setPresence({ mode: 'run', sector: 1, ship: 'spark', players: 1, time: '0:01' });
    p.setPresence({ mode: 'run', sector: 1, ship: 'spark', players: 1, time: '0:02' });
    p.setPresence({ mode: 'bogus' } as unknown as Presence);
    expect(calls.filter((c) => c.ch === 'presence:set')).toHaveLength(1);
    clock.advance(10_000);
    expect(calls.filter((c) => c.ch === 'presence:set').map((c) => (c.arg as Presence).time)).toEqual(['0:01', '0:02']);
    p.setPresence(null);
    expect(calls.at(-1)?.ch).toBe('presence:clear');
  });

  it('registers a flush handler that writes the pending save and flushes achievements', async () => {
    const clock = fakeClock();
    const { bridge, calls, state } = fakeBridge();
    const p = createDesktopPlatform(bridge, memoryStorage(), { storage: { timers: clock } });
    p.storage.setItem(SAVE_KEY, '{"v":9}');
    expect(state.flushHandler).toBeTypeOf('function');
    await state.flushHandler!();
    expect(state.file).toBe('{"v":9}');
    expect(calls.some((c) => c.ch === 'ach:flush')).toBe(true);
  });

  it('quit flushes first and a failing bridge never throws', async () => {
    const { bridge, calls } = fakeBridge();
    const p = createDesktopPlatform(bridge, memoryStorage(), { log: () => undefined });
    p.quit();
    await flushMicrotasks();
    expect(calls.at(-1)?.ch).toBe('quit');

    const broken = fakeBridge().bridge;
    const bad = { ...broken, achievements: { ...broken.achievements, activate: () => Promise.reject(new Error('x')) }, toggleFullscreen: () => Promise.reject(new Error('y')) };
    const q = createDesktopPlatform(bad, memoryStorage(), { log: () => undefined });
    expect(() => q.unlockAchievements(['first_run'])).not.toThrow();
    expect(await q.toggleFullscreen()).toBe(false);
  });
});

describe('Steam achievement mapping', () => {
  it('maps ids to ACH_ names and back', () => {
    expect(steamApiName('first_run')).toBe('ACH_FIRST_RUN');
    expect(steamApiName('kills10k')).toBe('ACH_KILLS10K');
    expect(gameIdFromApiName('ACH_FIRST_RUN')).toBe('first_run');
    expect(gameIdFromApiName('first_run')).toBeNull();
    expect(() => steamApiName('Bad Id')).toThrow();
    expect(toSteamNames(['first_run', 'x', 'first_run'])).toEqual(['ACH_FIRST_RUN']);
  });

  it('covers every game achievement plus the co-op ones, with unique API names', () => {
    const ids = STEAM_ACHIEVEMENTS.map((a) => a.id);
    for (const a of ACHIEVEMENTS) expect(ids).toContain(a.id);
    for (const a of COOP_ACHIEVEMENTS) expect(ids).toContain(a.id);
    expect(ACHIEVEMENTS.length).toBeGreaterThanOrEqual(21);
    expect(new Set(STEAM_ACHIEVEMENTS.map((a) => a.apiName)).size).toBe(STEAM_ACHIEVEMENTS.length);
    for (const a of STEAM_ACHIEVEMENTS) {
      expect(a.apiName).toMatch(/^ACH_[A-Z0-9_]+$/);
      expect(a.displayName.length).toBeGreaterThan(0);
      expect(a.description).not.toMatch(/unlocks/i);
    }
  });

  it('prefers the game definition over a co-op placeholder with the same id', () => {
    const table = buildSteamAchievements([{ id: 'squad', name: 'Real Name', text: 'Real text' }]);
    expect(table.filter((a) => a.id === 'squad')).toEqual([
      { id: 'squad', apiName: 'ACH_SQUAD', displayName: 'Real Name', description: 'Real text', hidden: false },
    ]);
    expect(steamDescription('Survive 3:00 in a run (unlocks Vanguard)')).toBe('Survive 3:00 in a run');
  });

  it('steam/achievements.json lists the same API names (the desktop allowlist)', () => {
    const file = JSON.parse(readFileSync(join(ROOT, 'steam', 'achievements.json'), 'utf8')) as {
      achievements: { id: string; apiName: string }[];
    };
    const names = (xs: { apiName: string }[]) => xs.map((a) => a.apiName).sort();
    // If this fails after changing src/meta/achievements.ts: run `npm run steam:achievements`.
    expect(names(file.achievements)).toEqual(names([...STEAM_ACHIEVEMENTS]));
  });
});

describe('presence helpers', () => {
  it('formats the run clock and derives sectors', () => {
    expect(formatPresenceTime(0)).toBe('0:00');
    expect(formatPresenceTime(252.9)).toBe('4:12');
    expect(formatPresenceTime(-5)).toBe('0:00');
    expect(formatPresenceTime(Number.NaN)).toBe('0:00');
    expect(sectorForTime(0)).toBe(1);
    expect(sectorForTime(200)).toBe(2);
    expect(sectorForTime(9999)).toBe(4);
  });

  it('builds run presence and sanitises untrusted input', () => {
    expect(runPresence({ time: 252, ship: 'tempest', players: 3, sector: 2 })).toEqual({
      mode: 'run', sector: 2, ship: 'tempest', players: 3, time: '4:12',
    });
    expect(runPresence({ time: 610, ship: 'spark', overtime: true }).mode).toBe('overtime');
    expect(sanitizePresence({ mode: 'run', ship: 'xwing', players: 9, sector: 2, time: '<b>', extra: 1 })).toEqual({ mode: 'run', sector: 2 });
    expect(sanitizePresence({ mode: 'evil' })).toBeNull();
    expect(sanitizePresence('run')).toBeNull();
  });

  it('throttle sends mode changes at once and coalesces same-mode updates', () => {
    const clock = fakeClock();
    const sent: (Presence | null)[] = [];
    const t = createPresenceThrottle((p) => sent.push(p), 10_000, clock);
    t.update({ mode: 'menu' });
    t.update({ mode: 'menu' }); // duplicate, dropped
    t.update({ mode: 'run', time: '0:00' });
    t.update({ mode: 'run', time: '0:05' });
    t.update({ mode: 'run', time: '0:06' });
    expect(sent).toHaveLength(2);
    clock.advance(10_000);
    expect(sent.map((p) => p?.time)).toEqual([undefined, '0:00', '0:06']);
    t.update({ mode: 'run', time: '0:20' });
    t.flush();
    expect(sent).toHaveLength(4);
  });
});

describe('web bundle isolation', () => {
  it('nothing under src/ imports electron or steamworks.js', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|js|mjs|cjs)$/.test(f)) files.push(p);
      }
    };
    walk(join(ROOT, 'src'));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/from\s+['"](electron|steamworks\.js)['"]|require\(\s*['"](electron|steamworks\.js)['"]\s*\)|import\(\s*['"](electron|steamworks\.js)['"]/);
    }
  });
});

/** A Platform double that records what the game reports to it. */
function recordingPlatform(): { p: Platform; log: { unlocked: string[][]; synced: string[][]; presence: (Presence | null)[]; flushes: number } } {
  const log = { unlocked: [] as string[][], synced: [] as string[][], presence: [] as (Presence | null)[], flushes: 0 };
  const p: Platform = {
    ...createPlatform({}),
    kind: 'desktop',
    unlockAchievements: (ids) => void log.unlocked.push([...ids]),
    syncAchievements: (ids) => void log.synced.push([...ids]),
    setPresence: (x) => void log.presence.push(x),
    flush: async () => void log.flushes++,
  };
  return { p, log };
}

describe('save routing through the platform', () => {
  afterEach(() => setPlatformForTests(null));

  it('loadSave/writeSave use platform().storage: synchronous for the game, mirrored to the file later', async () => {
    const clock = fakeClock();
    const { bridge, state } = fakeBridge();
    const local = memoryStorage();
    const p = createDesktopPlatform(bridge, local, { storage: { timers: clock } });
    setPlatformForTests(p);
    await p.init();
    expect(platform()).toBe(p);
    const s = defaultSave();
    s.cores = 42;
    expect(writeSave(s)).toBe(true);
    expect(JSON.parse(local.getItem(SAVE_KEY)!).cores).toBe(42);
    expect(loadSave().cores).toBe(42);
    expect(state.file).toBeNull(); // debounced
    clock.advance(500);
    await flushMicrotasks();
    expect(JSON.parse(state.file!).cores).toBe(42);
  });

  it('desktop boot: the save file (Steam Auto-Cloud) wins over localStorage', async () => {
    const local = memoryStorage();
    local.setItem(SAVE_KEY, JSON.stringify({ ...defaultSave(), cores: 5 }));
    const p = createDesktopPlatform(fakeBridge(JSON.stringify({ ...defaultSave(), cores: 9 })).bridge, local);
    setPlatformForTests(p);
    await p.init();
    expect(p.hydrated()).toBe('file');
    expect(loadSave().cores).toBe(9);
  });

  it('desktop first launch: an old localStorage save is migrated to the save file, once', async () => {
    const local = memoryStorage();
    local.setItem(SAVE_KEY, JSON.stringify({ ...defaultSave(), cores: 7, achievements: { first_run: 1 } }));
    const first = fakeBridge(null);
    const p = createDesktopPlatform(first.bridge, local);
    setPlatformForTests(p);
    await p.init();
    expect(p.hydrated()).toBe('migrated-local');
    await p.flush();
    expect(JSON.parse(first.state.file!).cores).toBe(7);
    expect(loadSave().achievements.first_run).toBe(1);

    // Next launch: the file exists now, so a stale local copy no longer counts.
    local.setItem(SAVE_KEY, JSON.stringify({ ...defaultSave(), cores: 1 }));
    const second = fakeBridge(first.state.file);
    const q = createDesktopPlatform(second.bridge, local);
    setPlatformForTests(q);
    await q.init();
    expect(q.hydrated()).toBe('file');
    expect(loadSave().cores).toBe(7);
    expect(second.calls.some((c) => c.ch === 'save:write')).toBe(false);
  });

  it('the quit handshake writes a pending save without waiting for the debounce', async () => {
    const clock = fakeClock();
    const { bridge, state } = fakeBridge();
    const p = createDesktopPlatform(bridge, memoryStorage(), { storage: { timers: clock } });
    setPlatformForTests(p);
    await p.init();
    writeSave({ ...defaultSave(), cores: 77 });
    await state.flushHandler!();
    expect(JSON.parse(state.file!).cores).toBe(77);
  });

  it('web: the same key in localStorage, so existing saves (and e2e seeding) keep working', () => {
    const local = memoryStorage();
    local.setItem(SAVE_KEY, JSON.stringify({ story: { introSeen: true }, cores: 3 }));
    setPlatformForTests(createPlatform({ localStorage: local }));
    expect(platform().kind).toBe('web');
    const s = loadSave();
    expect(s.cores).toBe(3);
    expect(s.story?.introSeen).toBe(true);
    s.cores = 4;
    writeSave(s);
    expect(JSON.parse(local.getItem(SAVE_KEY)!).cores).toBe(4);
  });
});

describe('platform link (what the App reports)', () => {
  it('reports newly earned achievements by id and re-syncs the earned ones once per session', () => {
    const { p, log } = recordingPlatform();
    const link = new PlatformLink(p);
    link.syncAchievements(['first_run', 'warden']);
    link.syncAchievements(['victory']); // second call in the same session: ignored
    expect(log.synced).toEqual([['first_run', 'warden']]);
    link.unlocked([]);
    link.unlocked([achievementDef('victory')!, achievementDef('squad')!]);
    expect(log.unlocked).toEqual([['victory', 'squad']]);
    link.runEnded();
    expect(log.flushes).toBe(1);
  });

  it('desktop: unlocks reach the bridge as Steam names, and a run end retries the queue and writes the save', async () => {
    const clock = fakeClock();
    const { bridge, calls, state } = fakeBridge();
    const p = createDesktopPlatform(bridge, memoryStorage(), { storage: { timers: clock } });
    const link = new PlatformLink(p);
    link.syncAchievements(['first_run', 'not_an_achievement']);
    link.unlocked([achievementDef('warden')!]);
    p.storage.setItem(SAVE_KEY, '{"runs":1}');
    link.runEnded();
    await flushMicrotasks();
    expect(calls.filter((c) => c.ch === 'ach:sync').map((c) => c.arg)).toEqual([['ACH_FIRST_RUN']]);
    expect(calls.filter((c) => c.ch === 'ach:activate').map((c) => c.arg)).toEqual(['ACH_WARDEN']);
    expect(calls.some((c) => c.ch === 'ach:flush')).toBe(true);
    expect(state.file).toBe('{"runs":1}'); // written at once, not after the debounce
  });

  it('re-evaluates rich presence about once a second', () => {
    const link = new PlatformLink(recordingPlatform().p);
    expect(link.presenceDue(0)).toBe(true);
    expect(link.presenceDue(PRESENCE_EVERY / 2)).toBe(false);
    expect(link.presenceDue(PRESENCE_EVERY / 2)).toBe(true);
    expect(link.presenceDue(1 / 60)).toBe(false);
  });

  it('is a safe no-op on the web platform', async () => {
    const link = new PlatformLink(createPlatform({}));
    expect(() => {
      link.syncAchievements(['first_run']);
      link.unlocked([achievementDef('first_run')!]);
      link.runEnded();
      link.setPresence({ state: 'title', ship: 'spark', run: null });
    }).not.toThrow();
  });
});

describe('rich presence mapping (steam.md 2.5)', () => {
  const run = (over: Partial<NonNullable<PresenceSnapshot['run']>> = {}): NonNullable<PresenceSnapshot['run']> => ({
    time: 252, sector: 1, players: 1, overtime: false, boss: null, ...over,
  });

  it('title and menus, the shipyard (Hangar, Workshop) and the co-op lobby', () => {
    expect(presenceFor({ state: 'title', screen: 'title', ship: 'spark', run: null })).toEqual({ mode: 'menu' });
    expect(presenceFor({ state: 'title', screen: 'records', ship: 'spark', run: null })).toEqual({ mode: 'menu' });
    expect(presenceFor({ state: 'title', screen: 'hangar', ship: 'bastion', run: null })).toEqual({ mode: 'hangar', ship: 'bastion' });
    expect(presenceFor({ state: 'title', screen: 'workshop', ship: 'spark', run: null })).toEqual({ mode: 'hangar', ship: 'spark' });
    expect(presenceFor({ state: 'lobby', screen: 'lobby', ship: 'spark', run: null })).toEqual({ mode: 'hangar', ship: 'spark' });
  });

  it('solo and co-op runs carry the sector, clock, ship and pilot count', () => {
    expect(presenceFor({ state: 'playing', ship: 'tempest', run: run() })).toEqual({
      mode: 'run', sector: 2, ship: 'tempest', players: 1, time: '4:12',
    });
    expect(presenceFor({ state: 'playing', ship: 'spark', run: run({ players: 3, sector: 0, time: 61 }) })).toEqual({
      mode: 'run', sector: 1, ship: 'spark', players: 3, time: '1:01',
    });
    for (const state of ['levelup', 'paused', 'dying'] as const) {
      expect(presenceFor({ state, ship: 'spark', run: run() }).mode).toBe('run');
    }
  });

  it('boss fight, victory screen, Overtime and results', () => {
    expect(presenceFor({ state: 'playing', ship: 'spark', run: run({ boss: 'hydra' }) })).toMatchObject({ mode: 'boss', boss: 'hydra', sector: 2 });
    // world.victory is already true on the victory screen: that screen is not Overtime yet.
    expect(presenceFor({ state: 'victory', ship: 'spark', run: run({ time: 600, sector: 3, overtime: true }) }).mode).toBe('victory');
    expect(presenceFor({ state: 'playing', ship: 'phantom', run: run({ time: 640, sector: 3, overtime: true, boss: 'voidheart' }) })).toMatchObject({
      mode: 'overtime', sector: 4, ship: 'phantom',
    });
    expect(presenceFor({ state: 'results', ship: 'vanguard', run: null, lastPlayers: 2 })).toEqual({ mode: 'results', ship: 'vanguard', players: 2 });
  });

  it('a boss presence without a known boss is sent as a plain run', () => {
    expect(sanitizePresence({ mode: 'boss', boss: 'warden', sector: 2 })).toEqual({ mode: 'boss', boss: 'warden', sector: 2 });
    expect(sanitizePresence({ mode: 'boss', boss: 'mothership' })).toEqual({ mode: 'run' });
    expect(runPresence({ time: 10, ship: 'spark', boss: null }).mode).toBe('run');
  });

  it('throttled on desktop: mode changes go out at once, same-mode updates at most every 10 s', () => {
    const clock = fakeClock();
    const { bridge, calls } = fakeBridge();
    const link = new PlatformLink(createDesktopPlatform(bridge, memoryStorage(), { clock }));
    const sent = () => calls.filter((c) => c.ch === 'presence:set').map((c) => c.arg as Presence);
    link.setPresence({ state: 'title', screen: 'title', ship: 'spark', run: null });
    link.setPresence({ state: 'playing', ship: 'spark', run: run({ time: 1 }) });
    link.setPresence({ state: 'playing', ship: 'spark', run: run({ time: 2 }) });
    link.setPresence({ state: 'playing', ship: 'spark', run: run({ time: 3 }) });
    expect(sent().map((p) => p.mode)).toEqual(['menu', 'run']);
    link.setPresence({ state: 'playing', ship: 'spark', run: run({ time: 4, boss: 'warden' }) });
    expect(sent().map((p) => p.mode)).toEqual(['menu', 'run', 'boss']);
    clock.advance(10_000);
    expect(sent()).toHaveLength(3); // nothing new queued since the boss update
  });
});

describe('fullscreen', () => {
  it('desktop: the setting goes through the bridge and F11 changes are reported back', async () => {
    const { bridge, calls, state } = fakeBridge();
    const p = createDesktopPlatform(bridge, memoryStorage());
    const seen: boolean[] = [];
    p.onFullscreenChange((on) => seen.push(on));
    expect(await p.setFullscreen(false)).toBe(false);
    expect(calls.find((c) => c.ch === 'fullscreen')?.arg).toBe(false);
    state.fullscreenHandler!(true); // main: the window entered fullscreen (F11)
    expect(seen).toEqual([true]);
    expect(p.info().fullscreen).toBe(true);
  });

  it('web: uses the Fullscreen API when the page has one', async () => {
    let fsEl: object | null = null;
    const listeners: (() => void)[] = [];
    const document = {
      get fullscreenElement() {
        return fsEl;
      },
      documentElement: { requestFullscreen: async () => void (fsEl = {}) },
      exitFullscreen: async () => void (fsEl = null),
      addEventListener: (_t: string, fn: () => void) => void listeners.push(fn),
    };
    const p = createPlatform({ document });
    const seen: boolean[] = [];
    p.onFullscreenChange((on) => seen.push(on));
    expect(await p.setFullscreen(true)).toBe(true);
    listeners.forEach((fn) => fn());
    expect(await p.toggleFullscreen()).toBe(false);
    listeners.forEach((fn) => fn());
    expect(seen).toEqual([true, false]);
    expect(p.canQuit).toBe(false);
  });
});
