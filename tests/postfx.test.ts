import { describe, expect, it, vi } from 'vitest';
import { flashBudget, lowHpPressure, PostFx } from '../src/render/postfx';

it('keeps the reduced-flashing low-health edge steady and bounded', () => {
  for (const hp of [0, 0.08, 0.25, 0.3, 1]) {
    const samples = [0, 0.2, 0.5, 1].map(t => lowHpPressure(hp, t, false));
    expect(new Set(samples).size).toBe(1);
    expect(samples[0]).toBeLessThanOrEqual(0.15);
  }
  expect(lowHpPressure(0.08, 0, true)).toBe((0.3 - 0.08) * 1.6 * 0.5);
  expect(lowHpPressure(0.08, Math.PI / 12, true)).toBe((0.3 - 0.08) * 1.6);
});

function rig() {
  const listeners = new Map<string, EventListener>();
  const uniforms = new Map<string, number | number[]>();
  const gl = new Proxy<Record<string, unknown>>({
    getShaderParameter: () => true, getProgramParameter: () => true,
    isContextLost: () => false, getExtension: () => null,
    getUniformLocation: (_p: unknown, name: string) => ({ name }),
    uniform1f: (u: { name: string }, v: number) => uniforms.set(u.name, v),
    uniform1i: (u: { name: string }, v: number) => uniforms.set(u.name, v),
    uniform4f: (u: { name: string }, ...v: number[]) => uniforms.set(u.name, v),
    uniform4fv: (u: { name: string }, v: Float32Array) => uniforms.set(u.name, Array.from(v)),
    drawArrays: vi.fn(),
  }, { get: (obj, key: string) => obj[key] ?? (() => ({})) });
  const canvas = { width: 0, height: 0, getContext: () => gl,
    addEventListener: (name: string, cb: EventListener) => listeners.set(name, cb),
    removeEventListener: (name: string) => listeners.delete(name) } as unknown as HTMLCanvasElement;
  const fx = PostFx.create(canvas)!;
  const src = { width: 1280, height: 720 } as HTMLCanvasElement;
  return { fx, src, uniforms, gl, dispatch: (name: string) => listeners.get(name)?.(new Event(name, { cancelable: true })) };
}
const wave = { radius: 200, strength: 20, duration: 10 };
function frames(fx: PostFx, n: number, ms: number) { for (let i = 0; i < n; i++) fx.reportFrameTime(ms); }

describe('post-processing pipeline', () => {
  it('falls back when WebGL2 is missing or cannot be created', () => {
    expect(PostFx.create({ getContext: () => null } as unknown as HTMLCanvasElement)).toBeNull();
    expect(PostFx.create({ getContext: () => { throw Error('driver'); } } as unknown as HTMLCanvasElement)).toBeNull();
  });
  it('budgets minor waves at a burst of three and refills three per second', () => {
    const { fx, src } = rig();
    expect([1, 2, 3, 4].map(() => fx.shockwave(0, 0, wave))).toEqual([true, true, true, false]);
    expect(fx.stats().wavesDropped).toBe(1);
    expect(fx.shockwave(0, 0, { ...wave, major: true })).toBe(true);
    fx.render(src, 1 / 3);
    expect(fx.shockwave(0, 0, wave)).toBe(true);
    expect(fx.shockwave(0, 0, wave)).toBe(false);
  });
  it('keeps eight waves, replaces weaker waves, and always admits a major event', () => {
    const { fx } = rig();
    for (let i = 0; i < 8; i++) fx.shockwave(0, 0, { ...wave, major: true });
    expect(fx.shockwave(0, 0, { ...wave, strength: 1 })).toBe(false);
    expect(fx.shockwave(0, 0, { ...wave, strength: 25 })).toBe(true);
    expect(fx.shockwave(0, 0, { ...wave, strength: 1, major: true })).toBe(true);
    expect(fx.stats().waves).toBe(8);
  });
  it('steps down through every rung, switches off, then retries at q1', () => {
    const { fx } = rig(), changes: number[][] = [], active: boolean[] = [];
    fx.onQualityChange = (q, rs) => changes.push([q, rs]);
    fx.onActiveChange = on => active.push(on);
    expect(fx.costTier).toBe(3);
    frames(fx, 400, 30);
    expect(changes).toEqual([[1, 1], [0, 1], [0, 0.75]]);
    expect(active).toEqual([false]);
    expect(fx.active).toBe(false);
    expect(fx.autoOff).toBe(true);
    expect(fx.costTier).toBe(0);
    fx.reenable();
    expect(fx.active).toBe(true);
    expect(fx.quality).toBe(1);
    expect(fx.renderScale).toBe(1);
    expect(fx.autoOff).toBe(false);
  });
  it('climbs only after sustained fast frames and stops oscillating after three downgrades', () => {
    const { fx } = rig();
    frames(fx, 700, 10);
    expect(fx.quality).toBe(2);
    frames(fx, 150, 10);
    expect(fx.quality).toBe(3);
    expect(fx.costTier).toBe(4);
    while (fx.quality > 0) fx.reportFrameTime(30);
    frames(fx, 2000, 10);
    expect(fx.quality).toBe(0);
  });
  it('ignores invalid samples, bounds one tab-switch stall and leaves pinned quality unchanged', () => {
    const { fx } = rig();
    for (const ms of [0, -30, NaN, Infinity]) frames(fx, 500, ms);
    expect(fx.stats().frameMs).toBe(16.7);
    fx.reportFrameTime(10000);
    expect(fx.stats().frameMs).toBeLessThan(30);
    frames(fx, 600, 1000 / 60);
    expect(fx.quality).toBe(2);
    expect(fx.active).toBe(true);
    fx.settings.quality = 2;
    frames(fx, 1000, 500);
    expect(fx.quality).toBe(2);
    expect(fx.active).toBe(true);
  });
  it('escapes sustained software-renderer stalls longer than 250 ms', () => {
    const { fx } = rig(), changes: number[][] = [];
    fx.onQualityChange = (q, rs) => changes.push([q, rs]);
    frames(fx, 80, 500);
    expect(changes).toEqual([[1, 1], [0, 1], [0, 0.75]]);
    expect(fx.autoOff).toBe(true);
  });
  it('gates aberration, surges and warping, and caps the flash', () => {
    const { fx, src, uniforms } = rig();
    fx.settings.quality = 3;
    fx.settings.flashes = false;
    fx.kickAberration(1); fx.kickBloom(1);
    fx.shockwave(0, 0, wave);
    fx.settings.shake = 0;
    fx.setFlash('#ffffff', 1);
    expect(fx.render(src, 0)).toBe(true);
    expect(uniforms.get('uCA')).toBe(0);
    expect(uniforms.get('uStreakAmt')).toBe(0);
    expect(uniforms.get('uWaveCount')).toBe(0);
    expect(uniforms.get('uFlash')).toEqual([1, 1, 1, 0.25]);
  });
  it('runs the reviewed six-level q3 pipeline in 12 draws, plus three for a surge', () => {
    const { fx, src, gl } = rig();
    fx.settings.quality = 3;
    fx.render(src, 0);
    expect(gl.drawArrays).toHaveBeenCalledTimes(12);
    vi.mocked(gl.drawArrays as () => void).mockClear();
    fx.kickBloom(0.8); fx.render(src, 0);
    expect(gl.drawArrays).toHaveBeenCalledTimes(15);
  });
  it('notifies the renderer on context loss and restoration', () => {
    const { fx, src, dispatch } = rig(), changes: boolean[] = [];
    fx.onActiveChange = on => changes.push(on);
    dispatch('webglcontextlost');
    expect(fx.active).toBe(false);
    expect(fx.render(src, 0)).toBe(false);
    dispatch('webglcontextrestored');
    expect(fx.active).toBe(true);
    expect(fx.render(src, 0)).toBe(true);
    expect(changes).toEqual([false, true]);
  });
  it('anchors waves through zoom, shake, source scaling and output Y inversion', () => {
    const { fx, uniforms } = rig();
    fx.resize(1280, 720);
    const k = 1.2 * 2 * 0.75 / 1.45, ox = 315, oy = 220, x = 42, y = -17;
    fx.setView(k, ox, oy); fx.shockwave(x, y, wave);
    fx.render({ width: 960, height: 540 } as HTMLCanvasElement, 0.05);
    const values = uniforms.get('uWave[0]') as number[];
    expect(values[0]).toBeCloseTo((ox + x * k) * 1280 / 960, 3);
    expect(values[1]).toBeCloseTo(720 - (oy + y * k) * 720 / 540, 3);
  });
  it('clears effects and refills the bucket for a new run', () => {
    const { fx, src, uniforms } = rig();
    fx.shockwave(0, 0, wave); fx.kickAberration(1); fx.kickBloom(1); fx.setFlash('#ffffff', 1);
    fx.clearEffects(); fx.render(src, 0);
    expect(fx.stats().waves).toBe(0);
    expect(uniforms.get('uCA')).toBe(0);
    expect(uniforms.get('uFlash')).toEqual([1, 1, 1, 0]);
    expect([1, 2, 3].map(() => fx.shockwave(0, 0, wave))).toEqual([true, true, true]);
  });
});

describe('shared punch and flash budget', () => {
  it.each([[true, true, 0.35], [true, false, 0.45], [false, true, 0.15], [false, false, 0.15]] as const)
  ('flashes=%s post-FX=%s caps at %s', (flashes, post, cap) => {
    expect(flashBudget(0, flashes, post)).toBe(cap);
    expect(flashBudget(0.09, flashes, post)).toBeCloseTo(cap - 0.09);
    expect(flashBudget(1, flashes, post)).toBe(0);
  });
});
