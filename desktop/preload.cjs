'use strict';
/**
 * Sandboxed preload (must stay CommonJS and may only require 'electron').
 * Exposes `window.shardstormDesktop`, a small frozen API. Arguments are type-checked
 * here and validated again in the main process (desktop/validate.cjs), which is the
 * real security boundary.
 *
 * Contract: src/platform/platform.ts (DesktopBridge). Bump apiVersion on breaking changes.
 */
const { contextBridge, ipcRenderer } = require('electron');

const inv = (channel, ...args) => ipcRenderer.invoke(`ss:${channel}`, ...args);
const reject = (msg) => Promise.reject(new TypeError(msg));
const isName = (n) => typeof n === 'string' && n.length > 0 && n.length <= 64;

/** @type {null | (() => unknown)} */
let flushHandler = null;
ipcRenderer.on('ss:flush', async () => {
  try {
    if (flushHandler) await flushHandler();
  } catch {
    /* never block quitting */
  } finally {
    ipcRenderer.send('ss:flushed');
  }
});

contextBridge.exposeInMainWorld(
  'shardstormDesktop',
  Object.freeze({
    apiVersion: 1,
    /** @returns {Promise<PlatformInfo>} */
    getPlatform: () => inv('platform'),
    /** @returns {Promise<boolean>} */
    isSteam: () => inv('platform').then((p) => !!p.steam),
    achievements: Object.freeze({
      /** Steam API name, e.g. ACH_FIRST_RUN. Resolves false when Steam is absent (queued if Steam is not ready). */
      activate: (apiName) => (isName(apiName) ? inv('ach:activate', apiName) : reject('achievement name')),
      isActivated: (apiName) => (isName(apiName) ? inv('ach:is', apiName) : reject('achievement name')),
      /** Re-sync locally earned achievements; resolves with the number activated or queued. */
      sync: (apiNames) => (Array.isArray(apiNames) ? inv('ach:sync', apiNames.filter(isName).slice(0, 256)) : reject('achievement list')),
      /** Retries queued unlocks and stores stats; resolves with the number still pending. */
      flush: () => inv('ach:flush'),
      openOverlay: () => inv('ach:overlay'),
    }),
    presence: Object.freeze({
      /** { mode, sector?, ship?, players?, time? } (see src/platform/presence.ts) */
      set: (p) => (p && typeof p === 'object' ? inv('presence:set', { ...p }) : reject('presence')),
      clear: () => inv('presence:clear'),
    }),
    /** steamworks.js 0.4.0 has no leaderboard API (verified); the UI should hide Steam boards. */
    leaderboards: Object.freeze({ supported: false }),
    save: Object.freeze({
      /** @returns {Promise<string | null>} */
      read: () => inv('save:read'),
      /** JSON text, at most 1 MiB. @returns {Promise<boolean>} */
      write: (json) => (typeof json === 'string' ? inv('save:write', json) : reject('save text')),
    }),
    /** Registers the callback main awaits (max 500 ms) before quitting, to flush the save. */
    onFlushRequest: (fn) => {
      flushHandler = typeof fn === 'function' ? fn : null;
    },
    /** on: true/false sets, undefined toggles. Resolves with the new state. */
    setFullscreen: (on) => inv('win:fullscreen', typeof on === 'boolean' ? on : undefined),
    toggleFullscreen: () => inv('win:fullscreen'),
    quit: () => inv('app:quit'),
  }),
);
