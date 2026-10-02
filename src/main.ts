import './ui/style.css';
import { App } from './app';

function boot(): void {
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  const ui = document.getElementById('ui');
  if (!canvas || !ui) throw new Error('Shardstorm: missing #game canvas or #ui root');
  const app = new App(canvas, ui);
  app.start();
  // Exposed for debugging and automated smoke tests.
  (window as unknown as { shardstorm?: App }).shardstorm = app;
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
