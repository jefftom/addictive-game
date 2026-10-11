import { describe, expect, it } from 'vitest';
import { makeRunConfig } from '../src/game/runconfig';
import type { Enemy } from '../src/game/types';
import { World } from '../src/game/world';
import { coopHudBand, coopPanelLayout, drawHud, type HudState } from '../src/render/hud';

/** Canvas call log: independent of rasterizer, installed fonts and simulation ticks. */
function recordingContext() {
  const log: unknown[][] = [];
  const state: Record<string, unknown> = { font: '10px sans-serif' };
  const stack: Record<string, unknown>[] = [];
  let gradientId = 0;
  const round = (v: unknown): unknown => typeof v === 'number' ? Number(v.toFixed(3)) : v;
  const ctx = new Proxy(state, {
    set(obj, key: string, value) { log.push(['set', key, round(value)]); obj[key] = value; return true; },
    get(obj, key: string) {
      if (key in obj) return obj[key];
      return (...args: unknown[]) => {
        log.push([key, ...args.map(round)]);
        if (key === 'measureText') return { width: String(args[0]).length * Number(String(obj.font).match(/([\d.]+)px/)?.[1] ?? 10) * 0.6 };
        if (key === 'save') stack.push({ ...obj });
        if (key === 'restore') Object.assign(obj, stack.pop());
        if (key.startsWith('create') && key.endsWith('Gradient')) {
          const id = ++gradientId;
          return { id, addColorStop: (...stops: unknown[]) => log.push(['stop', id, ...stops.map(round)]) };
        }
      };
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, log };
}

function hudState(): HudState {
  return { bestScore: 5000, touch: false, fps: 59.7, showFps: false, fxLabel: 'FX q3',
    xpFlash: 0, hpFlash: [0, 0, 0, 0], comboBreak: null, pauseInset: 50,
    dashButton: { x: 710, y: 1510, r: 63.36 },
    stick: { active: false, ox: 120, oy: 1440, x: 146, y: 1418 } };
}

function soloFixture() {
  const w = new World(makeRunConfig({ seed: 11 })), p = w.players[0]!;
  w.addWeapon('nova', 0);
  p.build.weapons[0]!.level = 3;
  p.build.passives = { power: 2, magnet: 1 };
  p.hp = 74; w.level = 7; w.xp = 42; w.xpNext = 100; w.score = 1234;
  w.time = 97.25; w.combo = 17; w.comboTimer = 1.25; w.overdriveT = 0;
  return w;
}

describe('solo HUD drawing contract', () => {
  it('preserves the original calls for plain, touch, danger/boss and FPS states', async () => {
    // Captured from the unmodified HUD before the co-op rendering pass.
    // Never re-record this snapshot to accommodate rendering changes.
    const output: string[] = [];
    for (const name of ['plain', 'touch', 'danger/boss', 'fps']) {
      const w = soloFixture(), p = w.players[0]!, st = hudState();
      if (name === 'touch') {
        st.touch = st.stick.active = true; p.dashCharges = 0; p.dashRecharge = 1.7;
      }
      if (name === 'danger/boss') {
        p.hp = 12.1; st.hpFlash[0] = 0.7; st.xpFlash = 0.4;
        p.build.relics = ['shield', 'comboeng']; p.shieldReady = false; p.shieldT = 7.25;
        st.comboBreak = { value: 150, t: 0.65 }; w.overdriveT = 2.4; w.score = 99999;
        w.boss = { kind: 'warden', dead: false, hp: 123, maxHp: 1000 } as Enemy;
      }
      if (name === 'fps') st.showFps = true;
      const { ctx, log } = recordingContext();
      drawHud(ctx, w, name === 'touch' ? 824 : 1280, name === 'touch' ? 1678 : 720,
        name === 'touch' ? 1.44 : 720 / 760, st);
      output.push(name, ...log.map(row => JSON.stringify(row)));
    }
    await expect(output.join('\n') + '\n').toMatchFileSnapshot('./__snapshots__/hud.solo.log');
  });
});

const sizes = [[1280, 720, 0.947], [1920, 1080, 1.35], [824, 1678, 1.44], [1678, 824, 1.44], [720, 1480, 1.44]];

describe('co-op HUD layout', () => {
  it('fits separate panels at every target size and roster length', () => {
    for (const [w, h, ui] of sizes) for (const n of [2, 3, 4]) {
      const panels = coopPanelLayout(n, w!, h!, ui!);
      expect(coopHudBand(ui!)).toBe(92 * ui!);
      for (let i = 0; i < n; i++) {
        const p = panels[i]!;
        expect(p.x).toBeGreaterThanOrEqual(0); expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.x + p.w).toBeLessThanOrEqual(w! + 1e-9); expect(p.y + p.h).toBeLessThanOrEqual(h!);
        if (i) expect(p.x).toBeGreaterThan(panels[i - 1]!.x + panels[i - 1]!.w);
        expect(p.mode).toBe(p.w >= 180 * ui! ? 'full' : p.w >= 120 * ui! ? 'mid' : 'compact');
      }
      if (n < 4) { expect(panels[0]!.x).toBe(16 * ui!); expect(panels[n - 1]!.x + panels[n - 1]!.w).toBeCloseTo(w! - 16 * ui!, 8); }
      if (n === 3) expect(panels[1]!.x + panels[1]!.w / 2).toBeCloseTo(w! / 2, 8);
      if (n === 4 && w === 824) expect(panels[0]!.mode).toBe('mid');
    }
  });

  it('keeps HP, downed cues and complete builds within their panel', () => {
    for (const [w, h, ui] of sizes) {
      const world = new World(makeRunConfig({ seed: 11, players: ['spark', 'vanguard', 'tempest', 'spark'].map(ship => ({ ship: ship as 'spark' })) }));
      for (const p of world.players) {
        for (const id of ['nova', 'orbit', 'arc'] as const) world.addWeapon(id, p.pid);
        p.build.passives = { power: 5, magnet: 5, thrusters: 5, amp: 5 }; p.build.relics = ['shield']; p.pendingCaches = 2;
      }
      world.players[1]!.downed = true; world.players[1]!.reviveT = 0.5;
      const st = hudState(); st.hpFlash[2] = 1; st.flashes = false;
      const { ctx, log } = recordingContext(); drawHud(ctx, world, w!, h!, ui!, st);
      const panels = coopPanelLayout(4, w!, h!, ui!);
      for (const row of log) {
        if (row[0] === 'fillRect' || row[0] === 'strokeRect') {
          const [, x, y, rw, rh] = row as [string, number, number, number, number];
          expect(x).toBeGreaterThanOrEqual(0); expect(y).toBeGreaterThanOrEqual(0);
          expect(x + rw).toBeLessThanOrEqual(w! + 0.002); expect(y + rh).toBeLessThanOrEqual(h! + 0.002);
        }
        if (row[0] === 'fillText') {
          const [, , x, y] = row as [string, string, number, number];
          expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(w!);
          if (y > 300 * ui!) expect(panels.some(p => x >= p.x - 0.001 && x <= p.x + p.w + 0.001 && y >= p.y - 0.001 && y <= p.y + p.h + 0.001)).toBe(true);
        }
      }
    }
  });
});
