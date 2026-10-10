/**
 * Save storage adapter.
 *
 * `src/meta/save.ts` reads and writes through a synchronous `Storage`
 * (getItem/setItem/removeItem). This adapter keeps that contract:
 * - reads come from localStorage (or memory when localStorage is unavailable);
 * - on desktop, writes of the save key are mirrored, debounced, to the atomic JSON
 *   file in userData (via the bridge), which Steam Auto-Cloud syncs;
 * - `hydrate()` runs once at boot, before `loadSave()`: the file is the source of truth
 *   on desktop, so its contents are copied into localStorage.
 *
 * src/meta/save.ts reads and writes through `platform().storage` (see platform.ts).
 */

/** Same shape as the `Storage` interface in src/meta/save.ts. */
export interface SaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Must equal SAVE_KEY in src/meta/save.ts (a test checks it; importing it here would be circular). */
export const DEFAULT_SAVE_KEY = 'shardstorm.save';
/** Written to the file when the player resets progress (Auto-Cloud keeps a file, not a deletion). */
export const CLEARED_SAVE = '{}';

export interface SaveFileBridge {
  read(): Promise<string | null>;
  write(json: string): Promise<boolean>;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface MirroredStorageOptions {
  key?: string;
  debounceMs?: number;
  timers?: Timers;
  onError?: (err: unknown) => void;
}

export type HydrateResult = 'file' | 'migrated-local' | 'empty' | 'error';

export interface MirroredStorage extends SaveStorage {
  /** Copies the save file into local storage (desktop boot). */
  hydrate(): Promise<HydrateResult>;
  /** Writes any pending save to the file now. */
  flush(): Promise<void>;
  /** True while a write is scheduled but not yet sent. */
  pending(): boolean;
}

/** In-memory Storage, used when localStorage throws or is missing. */
export function memoryStorage(): SaveStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
  };
}

/** Wraps a Storage so that exceptions (quota, privacy mode) fall back to memory instead of throwing. */
export function safeStorage(primary: SaveStorage | null): SaveStorage {
  const mem = memoryStorage();
  if (!primary) return mem;
  return {
    getItem(k) {
      // Memory first: it holds this session's latest write even when the primary write failed.
      const m = mem.getItem(k);
      if (m !== null) return m;
      try {
        return primary.getItem(k);
      } catch {
        return null;
      }
    },
    setItem(k, v) {
      mem.setItem(k, v);
      try {
        primary.setItem(k, v);
      } catch {
        /* memory copy keeps the session going */
      }
    },
    removeItem(k) {
      mem.removeItem(k);
      try {
        primary.removeItem(k);
      } catch {
        /* ignore */
      }
    },
  };
}

const defaultTimers: Timers = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
};

function isJsonObject(text: string): boolean {
  try {
    const v: unknown = JSON.parse(text);
    return !!v && typeof v === 'object';
  } catch {
    return false;
  }
}

/** Storage that mirrors the save key to a desktop save file. */
export function createMirroredStorage(
  local: SaveStorage | null,
  file: SaveFileBridge,
  opts: MirroredStorageOptions = {},
): MirroredStorage {
  const key = opts.key ?? DEFAULT_SAVE_KEY;
  const debounceMs = opts.debounceMs ?? 500;
  const timers = opts.timers ?? defaultTimers;
  const onError = opts.onError ?? (() => undefined);
  const store = safeStorage(local);
  let timer: unknown = null;
  let queued: string | null = null;
  let inflight: Promise<void> = Promise.resolve();

  const send = (text: string): Promise<void> => {
    inflight = inflight
      .then(() => file.write(text))
      .then(
        (ok) => {
          if (!ok) onError(new Error('save file write rejected'));
        },
        (err: unknown) => onError(err),
      );
    return inflight;
  };

  const schedule = (text: string): void => {
    queued = text;
    if (timer !== null) timers.clearTimeout(timer);
    timer = timers.setTimeout(() => {
      timer = null;
      const t = queued;
      queued = null;
      if (t !== null) void send(t);
    }, debounceMs);
  };

  return {
    getItem: (k) => store.getItem(k),
    setItem(k, v) {
      store.setItem(k, v);
      if (k === key) schedule(v);
    },
    removeItem(k) {
      store.removeItem(k);
      if (k === key) schedule(CLEARED_SAVE);
    },
    pending: () => queued !== null,
    async flush() {
      if (timer !== null) timers.clearTimeout(timer);
      timer = null;
      const t = queued;
      queued = null;
      if (t !== null) await send(t);
      else await inflight;
    },
    async hydrate() {
      let text: string | null;
      try {
        text = await file.read();
      } catch (err) {
        onError(err);
        return 'error';
      }
      if (typeof text === 'string' && isJsonObject(text)) {
        if (text.trim() === CLEARED_SAVE) store.removeItem(key);
        else store.setItem(key, text);
        return 'file';
      }
      // No file yet: adopt an existing local save (first launch of this build) so it reaches the cloud.
      const existing = store.getItem(key);
      if (existing && isJsonObject(existing)) {
        void send(existing);
        return 'migrated-local';
      }
      return 'empty';
    },
  };
}
