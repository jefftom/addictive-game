/**
 * Desktop (Electron) platform over `window.shardstormDesktop`.
 * Every bridge call is fire-and-forget or awaited with a catch: a broken bridge
 * must never break the game.
 */
import { toSteamNames } from './achievements';
import type { DesktopBridge, Platform, PlatformInfo } from './platform';
import { defaultPlatformInfo } from './platform';
import { createPresenceThrottle, sanitizePresence, type Presence, type ThrottleClock } from './presence';
import { createMirroredStorage, type HydrateResult, type MirroredStorageOptions, type SaveStorage } from './storage';

export interface DesktopPlatformOptions {
  storage?: MirroredStorageOptions;
  presenceIntervalMs?: number;
  clock?: ThrottleClock;
  log?: (msg: string, err?: unknown) => void;
}

export interface DesktopPlatform extends Platform {
  readonly kind: 'desktop';
  /** Result of the boot-time save hydration (null before init). */
  hydrated(): HydrateResult | null;
}

export function createDesktopPlatform(
  bridge: DesktopBridge,
  local: SaveStorage | null,
  opts: DesktopPlatformOptions = {},
): DesktopPlatform {
  const log = opts.log ?? ((msg: string, err?: unknown) => console.warn(`[platform] ${msg}`, err ?? ''));
  const storage = createMirroredStorage(local, bridge.save, {
    ...opts.storage,
    onError: (e) => log('save file write failed', e),
  });
  let info: PlatformInfo = defaultPlatformInfo('desktop');
  let initPromise: Promise<void> | null = null;
  let hydrated: HydrateResult | null = null;

  const quietly = (p: Promise<unknown> | undefined, what: string): void => {
    void p?.catch((e: unknown) => log(what, e));
  };

  const presence = createPresenceThrottle(
    (p) => quietly(p ? bridge.presence.set(p) : bridge.presence.clear(), 'presence failed'),
    opts.presenceIntervalMs,
    opts.clock,
  );

  const flush = async (): Promise<void> => {
    presence.flush();
    await storage.flush().catch((e: unknown) => log('save flush failed', e));
    await bridge.achievements.flush().catch((e: unknown) => log('achievement flush failed', e));
  };

  // Main asks for a flush before quitting (it waits up to 500 ms).
  try {
    bridge.onFlushRequest(flush);
  } catch (e) {
    log('onFlushRequest unavailable', e);
  }

  return {
    kind: 'desktop',
    storage,
    hydrated: () => hydrated,
    init() {
      initPromise ??= (async () => {
        hydrated = await storage.hydrate();
        try {
          info = { ...info, ...(await bridge.getPlatform()) };
        } catch (e) {
          log('platform info unavailable', e);
        }
      })();
      return initPromise;
    },
    info: () => info,
    isSteam: () => info.steam,
    unlockAchievements(ids) {
      for (const name of toSteamNames(ids)) quietly(bridge.achievements.activate(name), `achievement ${name} failed`);
    },
    syncAchievements(ids) {
      const names = toSteamNames(ids);
      if (names.length) quietly(bridge.achievements.sync(names), 'achievement sync failed');
    },
    setPresence(p: Presence | null) {
      if (p === null) {
        presence.update(null);
        return;
      }
      const clean = sanitizePresence(p);
      if (clean) presence.update(clean);
    },
    leaderboardsSupported: bridge.leaderboards?.supported === true,
    canQuit: true,
    quit() {
      void flush().finally(() => quietly(bridge.quit(), 'quit failed'));
    },
    async toggleFullscreen() {
      try {
        const on = await bridge.toggleFullscreen();
        info = { ...info, fullscreen: on };
        return on;
      } catch (e) {
        log('fullscreen toggle failed', e);
        return info.fullscreen;
      }
    },
    flush,
  };
}
