/** Browser platform: localStorage saves, no Steam, Fullscreen API when the page allows it. */
import { defaultPlatformInfo, type Platform } from './platform';
import { safeStorage, type SaveStorage } from './storage';

interface FullscreenDoc {
  fullscreenElement?: Element | null;
  documentElement?: { requestFullscreen?: () => Promise<void> };
  exitFullscreen?: () => Promise<void>;
}

export function createWebPlatform(local: SaveStorage | null, scope: unknown = globalThis): Platform {
  const storage = safeStorage(local);
  const info = defaultPlatformInfo('web');
  const doc = (scope as { document?: FullscreenDoc }).document;

  return {
    kind: 'web',
    storage,
    init: async () => undefined,
    info: () => ({ ...info, fullscreen: !!doc?.fullscreenElement }),
    isSteam: () => false,
    unlockAchievements: () => undefined,
    syncAchievements: () => undefined,
    setPresence: () => undefined,
    leaderboardsSupported: false,
    canQuit: false,
    quit: () => undefined,
    async toggleFullscreen() {
      if (!doc) return false;
      try {
        if (doc.fullscreenElement) {
          await doc.exitFullscreen?.();
          return false;
        }
        await doc.documentElement?.requestFullscreen?.();
        return !!doc.fullscreenElement;
      } catch {
        return !!doc.fullscreenElement;
      }
    },
    flush: async () => undefined,
  };
}
