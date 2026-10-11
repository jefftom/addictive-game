import { chromium } from '/home/user/addictive-game/node_modules/playwright/index.mjs';
const browser = await chromium.launch({ args: ['--enable-gpu-rasterization', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.setContent('<canvas id=c width=1920 height=1080></canvas>');
const res = await page.evaluate(() => {
  const c = document.getElementById('c');
  const ctx = c.getContext('2d', { alpha: false });
  const flush = () => ctx.getImageData(0, 0, 1, 1);
  const out = {};
  const run = (name, fn) => {
    for (let i = 0; i < 3; i++) { fn(i); flush(); }
    const t0 = performance.now();
    for (let i = 0; i < 40; i++) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1920, 1080); fn(i); flush(); }
    out[name] = +((performance.now() - t0) / 40).toFixed(2);
  };
  const S = 45;
  const wob = (x, y, i) => Math.sin(x * 0.01 + y * 0.013 + i) * 6;
  const grid = (mode, lw, segs) => (i) => {
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgb(100,170,230)';
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = lw;
    ctx.beginPath();
    for (let y = 0; y < 1080; y += S) {
      if (mode === 'long') { ctx.moveTo(0, y); ctx.lineTo(1920, y); continue; }
      ctx.moveTo(0, y);
      for (let x = S; x <= 1920; x += S) {
        if (mode === 'quad') ctx.quadraticCurveTo(x - S / 2, y + wob(x, y, i), x, y + wob(x + 9, y, i));
        else if (mode === 'sub') { ctx.lineTo(x, y + wob(x, y, i)); ctx.moveTo(x, y + wob(x, y, i)); }
        else ctx.lineTo(x, y + wob(x, y, i));
      }
    }
    for (let x = 0; x < 1920; x += S) {
      if (mode === 'long') { ctx.moveTo(x, 0); ctx.lineTo(x, 1080); continue; }
      ctx.moveTo(x, 0);
      for (let y = S; y <= 1080; y += S) {
        if (mode === 'quad') ctx.quadraticCurveTo(x + wob(x, y, i), y - S / 2, x + wob(x, y + 9, i), y);
        else if (mode === 'sub') { ctx.lineTo(x + wob(x, y, i), y); ctx.moveTo(x + wob(x, y, i), y); }
        else ctx.lineTo(x + wob(x, y, i), y);
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };
  const g2 = (mode, lw, comp, alphaMode) => (i) => {
    ctx.globalCompositeOperation = comp;
    if (alphaMode === 'rgba') { ctx.strokeStyle = 'rgba(100,170,230,0.3)'; ctx.globalAlpha = 1; }
    else { ctx.strokeStyle = 'rgb(100,170,230)'; ctx.globalAlpha = 0.3; }
    ctx.lineWidth = lw;
    ctx.beginPath();
    for (let y = 0; y < 1080; y += S) {
      ctx.moveTo(0, y);
      for (let x = S; x <= 1920; x += S) {
        if (mode === 'quad') ctx.quadraticCurveTo(x - S / 2, y + wob(x, y, i), x, y + wob(x + 9, y, i));
        else ctx.lineTo(x, y + wob(x, y, i));
      }
    }
    for (let x = 0; x < 1920; x += S) {
      ctx.moveTo(x, 0);
      for (let y = S; y <= 1080; y += S) {
        if (mode === 'quad') ctx.quadraticCurveTo(x + wob(x, y, i), y - S / 2, x + wob(x, y + 9, i), y);
        else ctx.lineTo(x + wob(x, y, i), y);
      }
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };
  run('fill-only', () => {});
  for (const comp of ['source-over', 'lighter']) for (const am of ['rgba', 'galpha']) for (const mode of ['poly', 'quad']) for (const lw of [1, 1.3, 2, 5]) run(`${comp}-${am}-${mode}-${lw}`, g2(mode, lw, comp, am));
  return out;
});
console.log(JSON.stringify(res, null, 1));
await browser.close();
