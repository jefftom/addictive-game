import './ui/style.css';
import { App } from './app';
import { initPlatform, platform, type Platform } from './platform/platform';

/** A desktop bridge that never answers must not keep the game from starting. */
const PLATFORM_INIT_TIMEOUT_MS = 4000;

/**
 * Web or desktop (Electron/Steam), chosen by the platform layer. On desktop this copies the
 * Steam Auto-Cloud save file into storage, so it has to finish before the App loads the save.
 */
async function startPlatform(): Promise<Platform> {
  let timer = 0;
  const timeout = new Promise<'timeout'>((resolve) => {
    timer = window.setTimeout(() => resolve('timeout'), PLATFORM_INIT_TIMEOUT_MS);
  });
  try {
    const r = await Promise.race([initPlatform(), timeout]);
    if (r === 'timeout') console.warn('[platform] init timed out; starting with what is there');
  } catch (e) {
    console.warn('[platform] init failed; starting with what is there', e);
  } finally {
    window.clearTimeout(timer);
  }
  return platform();
}

async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  const ui = document.getElementById('ui');
  if (!canvas || !ui) throw new Error('Shardstorm: missing #game canvas or #ui root');
  const p = await startPlatform();
  if (p.kind === 'desktop') {
    // Desktop saves are mirrored to the save file 500 ms after each write: write them now when the
    // page goes away (the shell's own quit path also asks for this flush and waits for it).
    // Web saves are written synchronously, so the browser build adds no unload listeners.
    const flush = () => void p.flush();
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) flush();
    });
  }
  const app = new App(canvas, ui, p);
  app.start();
  // Exposed for debugging and automated smoke tests.
  (window as unknown as { shardstorm?: App }).shardstorm = app;
}

const start = () => void boot().catch((e: unknown) => console.error(e));
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
