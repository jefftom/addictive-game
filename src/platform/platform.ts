/**
 * Platform layer: one interface for the browser build and the Electron/Steam build.
 *
 * The game never talks to Electron or Steam directly. Desktop calls go through
 * `window.shardstormDesktop` (desktop/preload.cjs), and everything here falls back
 * to browser behaviour when that bridge is missing. Nothing in src/ may import
 * 'electron' or 'steamworks.js' (tests/platform.test.ts enforces this).
 *
 * Wiring:
 *   main.ts:  `await initPlatform()` before `new App(..., platform)` (hydrates the desktop save)
 *   save.ts:  `storage()` returns `platform().storage`
 *   app.ts:   a PlatformLink (./link.ts) reports achievements, rich presence and run ends
 */
import { createDesktopPlatform } from './desktop';
import type { Presence } from './presence';
import type { SaveStorage } from './storage';
import { createWebPlatform } from './web';

export interface PlatformInfo {
  apiVersion: number;
  os: string;
  arch: string;
  appVersion: string;
  electron: string | null;
  chrome: string | null;
  packaged: boolean;
  steam: boolean;
  steamDeck: boolean;
  overlay: boolean;
  playerName: string | null;
  language: string | null;
  buildId: number | null;
  fullscreen: boolean;
  leaderboards: boolean;
}

/** Shape of `window.shardstormDesktop` (desktop/preload.cjs). Keep the two in sync. */
export interface DesktopBridge {
  readonly apiVersion: number;
  getPlatform(): Promise<PlatformInfo>;
  isSteam(): Promise<boolean>;
  readonly achievements: {
    activate(apiName: string): Promise<boolean>;
    isActivated(apiName: string): Promise<boolean>;
    sync(apiNames: string[]): Promise<number>;
    flush(): Promise<number>;
    openOverlay(): Promise<boolean>;
  };
  readonly presence: {
    set(p: Presence): Promise<boolean>;
    clear(): Promise<boolean>;
  };
  readonly leaderboards: { readonly supported: boolean };
  readonly save: {
    read(): Promise<string | null>;
    write(json: string): Promise<boolean>;
  };
  onFlushRequest(fn: (() => unknown) | null): void;
  /** Main reports window fullscreen changes (F11, Alt+Enter, the macOS menu). Optional: older shells lack it. */
  onFullscreenChange?(fn: ((on: boolean) => void) | null): void;
  setFullscreen(on?: boolean): Promise<boolean>;
  toggleFullscreen(): Promise<boolean>;
  quit(): Promise<boolean>;
}

export type PlatformKind = 'web' | 'desktop';

export interface Platform {
  readonly kind: PlatformKind;
  /** Synchronous storage that `src/meta/save.ts` can use as-is (getItem/setItem/removeItem). */
  readonly storage: SaveStorage;
  /** Async setup: desktop reads the save file into storage and fetches platform info. Idempotent. */
  init(): Promise<void>;
  /** Cached after init(); defaults before it. */
  info(): PlatformInfo;
  isSteam(): boolean;
  /** Game achievement ids (src/meta/achievements.ts), mapped to Steam names internally. Fire-and-forget. */
  unlockAchievements(ids: readonly string[]): void;
  /** Pushes every locally earned achievement to Steam (startup re-sync). */
  syncAchievements(ids: readonly string[]): void;
  /** Rich presence; null clears it. Throttled on desktop. */
  setPresence(p: Presence | null): void;
  readonly leaderboardsSupported: boolean;
  /** True when the platform has a real "Quit" (desktop). */
  readonly canQuit: boolean;
  quit(): void;
  /** Resolves with the new fullscreen state. */
  toggleFullscreen(): Promise<boolean>;
  /** Sets fullscreen (desktop: the window, remembered by the shell); resolves with the new state. */
  setFullscreen(on: boolean): Promise<boolean>;
  /** One listener for fullscreen changes made outside the game (F11, Alt+Enter); null removes it. */
  onFullscreenChange(fn: ((on: boolean) => void) | null): void;
  /** Writes pending saves now (call before quitting / on pagehide). */
  flush(): Promise<void>;
}

/** Defaults used before init() or when the bridge fails. */
export function defaultPlatformInfo(kind: PlatformKind): PlatformInfo {
  return {
    apiVersion: 1,
    os: 'web',
    arch: 'unknown',
    appVersion: '',
    electron: null,
    chrome: null,
    packaged: false,
    steam: false,
    steamDeck: false,
    overlay: false,
    playerName: null,
    language: null,
    buildId: null,
    fullscreen: false,
    leaderboards: false,
    ...(kind === 'desktop' ? { os: 'desktop' } : {}),
  };
}

export const SUPPORTED_BRIDGE_VERSION = 1;

/** Returns the desktop bridge when present and compatible, else null. */
export function detectBridge(scope: unknown = globalThis): DesktopBridge | null {
  if (!scope || typeof scope !== 'object') return null;
  const b = (scope as { shardstormDesktop?: unknown }).shardstormDesktop;
  if (!b || typeof b !== 'object') return null;
  const d = b as Partial<DesktopBridge>;
  if (d.apiVersion !== SUPPORTED_BRIDGE_VERSION) return null;
  if (typeof d.getPlatform !== 'function' || !d.save || !d.achievements || !d.presence) return null;
  return d as DesktopBridge;
}

/** Browser localStorage, or null when it is unavailable (private mode, sandboxed iframes). */
export function browserStorage(scope: unknown = globalThis): SaveStorage | null {
  try {
    const ls = (scope as { localStorage?: SaveStorage }).localStorage;
    return ls ?? null;
  } catch {
    return null;
  }
}

/** Picks the platform for this environment. */
export function createPlatform(scope: unknown = globalThis): Platform {
  const bridge = detectBridge(scope);
  const local = browserStorage(scope);
  return bridge ? createDesktopPlatform(bridge, local) : createWebPlatform(local, scope);
}

let current: Platform | null = null;

/** The process-wide platform (created on first use). */
export function platform(): Platform {
  current ??= createPlatform();
  return current;
}

/** Creates (if needed) and initialises the platform. Safe to call more than once. */
export async function initPlatform(): Promise<Platform> {
  const p = platform();
  await p.init();
  return p;
}

/** Test hook: replace or reset the singleton. */
export function setPlatformForTests(p: Platform | null): void {
  current = p;
}
