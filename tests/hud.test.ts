import { describe, expect, it } from 'vitest';
import { makeRunConfig } from '../src/game/runconfig';
import type { Enemy } from '../src/game/types';
import { World } from '../src/game/world';
import { drawHud, type HudState } from '../src/render/hud';

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
    xpFlash: 0, hpFlash: 0, comboBreak: null, pauseInset: 50,
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
        p.hp = 12.1; st.hpFlash = 0.7; st.xpFlash = 0.4;
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
