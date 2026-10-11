/** Browser platform: localStorage saves, no Steam, Fullscreen API when the page allows it. */
import { defaultPlatformInfo, type Platform } from './platform';
import { safeStorage, type SaveStorage } from './storage';

interface FullscreenDoc {
  fullscreenElement?: Element | null;
  documentElement?: { requestFullscreen?: () => Promise<void> };
  exitFullscreen?: () => Promise<void>;
  addEventListener?: (type: 'fullscreenchange', fn: () => void) => void;
}

export function createWebPlatform(local: SaveStorage | null, scope: unknown = globalThis): Platform {
  const storage = safeStorage(local);
  const info = defaultPlatformInfo('web');
  const doc = (scope as { document?: FullscreenDoc }).document;
  let onChange: ((on: boolean) => void) | null = null;
  doc?.addEventListener?.('fullscreenchange', () => onChange?.(!!doc.fullscreenElement));

  const setFullscreen = async (on: boolean): Promise<boolean> => {
    if (!doc) return false;
    try {
      if (!on && doc.fullscreenElement) await doc.exitFullscreen?.();
      else if (on && !doc.fullscreenElement) await doc.documentElement?.requestFullscreen?.();
    } catch {
      /* not allowed here (no user gesture, iframe, iOS) */
    }
    return !!doc.fullscreenElement;
  };

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
    toggleFullscreen: () => setFullscreen(!doc?.fullscreenElement),
    setFullscreen,
    onFullscreenChange(fn) {
      onChange = fn;
    },
    flush: async () => undefined,
  };
}
