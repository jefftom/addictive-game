import { describe, expect, it } from 'vitest';
import { damp } from '../src/core/math';
import { makeRunConfig } from '../src/game/runconfig';
import { World } from '../src/game/world';
import { CAM_INSET, followCamera, viewOf } from '../src/render/camera';

const squad = () => new World(makeRunConfig({ seed: 11, players: Array.from({ length: 4 }, () => ({ ship: 'spark' as const })) }));

describe('shared camera', () => {
  it('preserves the zoom-one transform and inverts scaled targets', () => {
    expect(viewOf(12, -31, 1, 0.8, 2, 1280, 720, 1, 4, -3)).toEqual({ k: 1.6, ox: 640 - 12 * 1.6 + 8, oy: 360 + 31 * 1.6 - 6 });
    for (const s of [1, 0.75]) {
      const v = viewOf(129, -357, 1.45, 0.8, 2, 1920 * s, 1080 * s, s, 0, 0);
      const x = -1957.12, y = 3831.4;
      const cssX = (v.ox + x * v.k) / (2 * s), cssY = (v.oy + y * v.k) / (2 * s);
      expect(Math.abs((cssX * 2 * s - v.ox) / v.k - x)).toBeLessThan(1e-9);
      expect(Math.abs((cssY * 2 * s - v.oy) / v.k - y)).toBeLessThan(1e-9);
    }
  });

  it('matches the old solo formula exactly across varying real dt', () => {
    const w = new World(makeRunConfig({ seed: 11 })), p = w.players[0]!;
    const cam = { camX: 123, camY: -87 }, old = { ...cam };
    for (let i = 0; i < 30; i++) {
      p.x = i * 17 - 230; p.y = 140 - i * 13; p.vx = i - 20; p.vy = 100 - i;
      const dt = (i % 7) / 100, cd = damp(7, dt);
      old.camX += (p.x + p.vx * 0.12 - old.camX) * cd;
      old.camY += (p.y + p.vy * 0.12 - old.camY) * cd;
      followCamera(cam, w, dt, 500, 400, 92);
      expect(cam).toEqual(old);
    }
  });

  it('converges to the squad look-ahead without mutating players or zoom', () => {
    const w = squad(), cam = { camX: -100, camY: 120 };
    for (const p of w.players) { p.x += 500; p.y -= 200; p.vx = 30; p.vy = -40; }
    const c = w.teamCenter(), tx = c.x + 30 * 0.08, ty = c.y - 40 * 0.08;
    const before = JSON.stringify([w.players, w.zoom]);
    for (let i = 0; i < 300; i++) followCamera(cam, w, 1 / 60, 1000, 1000, 0);
    expect(cam.camX).toBeCloseTo(tx, 9); expect(cam.camY).toBeCloseTo(ty, 9);
    expect(JSON.stringify([w.players, w.zoom])).toBe(before);
  });

  it('clamps immediately around leash corners, including a ghost', () => {
    const w = squad(), span = w.maxSpan(), sx = span.x, sy = span.y;
    w.players.forEach((p, i) => { p.x = (i % 2 - 0.5) * sx; p.y = (Math.floor(i / 2) - 0.5) * sy; });
    w.players[3]!.downed = true;
    const cam = { camX: 2000, camY: -2000 }, hw = w.viewHalfW * 1.45, hh = w.viewHalfH * 1.45;
    followCamera(cam, w, 0, hw, hh, 0);
    for (const p of w.players) {
      expect(hw - Math.abs(p.x - cam.camX)).toBeGreaterThanOrEqual(CAM_INSET - 1e-9);
      expect(hh - Math.abs(p.y - cam.camY)).toBeGreaterThanOrEqual(CAM_INSET - 1e-9);
    }
  });

  it('reserves the bottom band, then falls back to symmetric margins or bbox centre', () => {
    const w = squad(); w.players.forEach(p => { p.x = 0; p.y = 0; });
    const cam = { camX: 0, camY: -1000 };
    followCamera(cam, w, 0, 500, 300, 92);
    expect(cam.camY).toBe(-178);
    w.players[0]!.y = -260; w.players[1]!.y = 260;
    followCamera(cam, w, 0, 500, 300, 92); expect(cam.camY).toBe(-10);
    w.players[0]!.x = -1000; w.players[1]!.x = 1200;
    w.players[0]!.y = -700; w.players[1]!.y = 900;
    followCamera(cam, w, 0, 500, 300, 92); expect(cam).toEqual({ camX: 100, camY: 100 });
  });
});
