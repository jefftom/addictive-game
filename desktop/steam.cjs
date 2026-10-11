'use strict';
/**
 * The ONLY module that requires steamworks.js. Every function here is safe to call
 * without Steam: it returns false/null and never throws.
 *
 * Verified behaviour of steamworks.js 0.4.0 (see docs/STEAM.md):
 * - require() throws only on unsupported OS/arch (no linux-arm64, no win-arm64).
 * - init(appId) throws a clean Error within ~1 ms when no Steam client is running.
 * - init() starts its own 30 Hz runCallbacks interval; we do not start a second one.
 * - No leaderboards, no "stats received" callback, no overlay-activated callback.
 * - restartAppIfNecessary() can exec steam.sh when Steam is absent, so it only runs
 *   in packaged Steam release builds.
 * - achievement.activate() can return false before the user's stats have arrived,
 *   so unlocks are queued and retried.
 *
 * Electron is injected (not required) so tests can run this with fakes.
 */

const RETRY_MS = 2000;
const RETRY_WINDOW_MS = 60_000;
/** `overlay.Dialog.Achievements` is a TypeScript const enum in client.d.ts (value 6), absent at runtime. */
const OVERLAY_DIALOG_ACHIEVEMENTS = 6;

/**
 * @typedef {{
 *   loadModule?: () => any,
 *   appId: number,
 *   allowRestart: boolean,
 *   overlay: boolean,
 *   log?: (msg: string) => void,
 *   timers?: { setInterval: typeof setInterval, clearInterval: typeof clearInterval, now: () => number },
 * }} SteamOptions
 */

/**
 * Initialises Steam. Call synchronously before `app.whenReady()` so the overlay
 * command-line switches take effect.
 * @param {SteamOptions} opts
 */
function createSteam(opts) {
  const log = opts.log ?? ((m) => console.log(`[shardstorm] ${m}`));
  const timers = opts.timers ?? { setInterval, clearInterval, now: Date.now };
  /** @type {any} */ let sw = null;
  /** @type {any} */ let client = null;
  /** @type {{ steam: boolean, reason: string | null, restart: boolean, overlay: boolean }} */
  const status = { steam: false, reason: null, restart: false, overlay: false };

  try {
    sw = (opts.loadModule ?? (() => require('steamworks.js')))();
  } catch (e) {
    status.reason = `module-unavailable: ${short(e)}`;
  }

  if (sw && opts.allowRestart && opts.appId) {
    try {
      if (sw.restartAppIfNecessary(opts.appId)) {
        status.restart = true;
        status.reason = 'relaunching-through-steam';
        log('steam: not launched by Steam, relaunching through the Steam client');
        return finish();
      }
    } catch (e) {
      log(`steam: restartAppIfNecessary failed: ${short(e)}`);
    }
  }

  if (sw) {
    const t0 = timers.now();
    try {
      client = sw.init(opts.appId || undefined);
      status.steam = true;
      log(`steam: initialised (app ${opts.appId || 'from steam_appid.txt'}) in ${timers.now() - t0} ms`);
    } catch (e) {
      client = null;
      status.reason = short(e);
    }
  }

  if (client && opts.overlay) {
    try {
      sw.electronEnableSteamOverlay();
      status.overlay = true;
    } catch (e) {
      log(`steam: overlay unavailable: ${short(e)}`);
    }
  }

  if (!status.steam) log(`steam: unavailable, running without Steam (${status.reason ?? 'unknown'})`);
  return finish();

  function finish() {
    /** @type {Map<string, number>} name -> first queued time */
    const pending = new Map();
    /** @type {ReturnType<typeof setInterval> | null} */
    let retryTimer = null;

    const call = (fn, fallback) => {
      if (!client) return fallback;
      try {
        return fn(client);
      } catch {
        return fallback;
      }
    };

    function retryPending() {
      const now = timers.now();
      for (const [name, since] of pending) {
        const ok = call((c) => c.achievement.isActivated(name) || c.achievement.activate(name), false);
        if (ok || now - since > RETRY_WINDOW_MS) pending.delete(name);
      }
      if (pending.size === 0 && retryTimer) {
        timers.clearInterval(retryTimer);
        retryTimer = null;
      }
    }

    function queue(name) {
      if (!pending.has(name)) pending.set(name, timers.now());
      if (!retryTimer) retryTimer = timers.setInterval(retryPending, RETRY_MS);
    }

    return {
      status,
      get available() {
        return client !== null;
      },
      /** @param {string} name allowlisted API name */
      activateAchievement(name) {
        if (!client) return false;
        const ok = call((c) => c.achievement.activate(name), false);
        if (!ok) queue(name);
        return ok;
      },
      /** @param {string} name */
      isAchievementActivated(name) {
        return call((c) => c.achievement.isActivated(name), false);
      },
      /**
       * Re-sync: activates every locally earned achievement Steam does not have yet
       * (offline play, early unlocks before stats arrived, pre-Steam saves).
       * @param {string[]} names
       * @returns {number} how many were newly activated or queued
       */
      syncAchievements(names) {
        if (!client) return 0;
        let n = 0;
        for (const name of names) {
          if (call((c) => c.achievement.isActivated(name), false)) continue;
          n++;
          if (!call((c) => c.achievement.activate(name), false)) queue(name);
        }
        return n;
      },
      /** Retries whatever is still queued (end of run, before quit). */
      flushAchievements() {
        if (pending.size) retryPending();
        call((c) => c.stats.store(), false);
      },
      pendingAchievements() {
        return [...pending.keys()];
      },
      openAchievementsOverlay() {
        return call((c) => {
          c.overlay.activateDialog(OVERLAY_DIALOG_ACHIEVEMENTS);
          return true;
        }, false);
      },
      /** @param {Record<string, string>} kv already validated (validate.cjs#presenceToSteam) */
      setPresence(kv, keys) {
        if (!client) return false;
        return call((c) => {
          for (const k of keys) if (!(k in kv)) c.localplayer.setRichPresence(k);
          for (const [k, v] of Object.entries(kv)) c.localplayer.setRichPresence(k, v);
          return true;
        }, false);
      },
      /** @param {readonly string[]} keys */
      clearPresence(keys) {
        return call((c) => {
          for (const k of keys) c.localplayer.setRichPresence(k);
          return true;
        }, false);
      },
      playerName() {
        return call((c) => c.localplayer.getName() || null, null);
      },
      language() {
        return call((c) => c.apps.currentGameLanguage() || null, null);
      },
      buildId() {
        return call((c) => c.apps.appBuildId(), null);
      },
      isSteamDeck() {
        return call((c) => !!c.utils.isSteamRunningOnSteamDeck(), false);
      },
      shutdown() {
        if (retryTimer) timers.clearInterval(retryTimer);
        retryTimer = null;
        call((c) => c.stats.store(), false);
      },
    };
  }
}

function short(e) {
  return String((e && e.message) || e).replace(/\s+/g, ' ').slice(0, 200);
}

module.exports = { createSteam, RETRY_MS, RETRY_WINDOW_MS };
