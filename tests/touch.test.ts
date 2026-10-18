import { describe, expect, it } from 'vitest';
import { dashLayout, TOUCH_RADIUS, touchVector } from '../src/core/touch';
import { FloatTexts, Callouts } from '../src/render/effects';

describe('phone controls', () => {
  it('suppresses thumb jitter, ramps continuously and retains full diagonal speed', () => {
    expect(touchVector(8, 0, TOUCH_RADIUS)).toEqual({ mx: 0, my: 0 });
    expect(touchVector(TOUCH_RADIUS * 0.18 + 0.01, 0, TOUCH_RADIUS).mx).toBeLessThan(0.001);
    expect(touchVector(TOUCH_RADIUS * 0.59, 0, TOUCH_RADIUS).mx).toBeCloseTo(0.5);
    const diagonal = touchVector(-200, 200, TOUCH_RADIUS);
    expect(Math.hypot(diagonal.mx, diagonal.my)).toBeCloseTo(1);
    expect(diagonal.mx).toBeLessThan(0);
    expect(diagonal.my).toBeGreaterThan(0);
    expect(touchVector(0, 0, 0)).toEqual({ mx: 0, my: 0 });
  });
  it('keeps the 76 CSS-pixel dash target inside portrait/landscape safe areas at every DPR', () => {
    for (const [w, h] of [[320, 568], [393, 851], [844, 390]]) for (const dpr of [1, 1.5, 2, 3]) {
      const button = dashLayout(w!, h!, dpr, 44, 34);
      expect(button.r * 2 / dpr).toBe(76);
      expect((button.x + button.r) / dpr).toBeLessThan(w! - 44);
      expect((button.y + button.r) / dpr).toBeLessThan(h! - 34);
      expect(button.y - button.r).toBeGreaterThan(0);
    }
  });
});

describe('phone combat readability', () => {
  it('declutters nearby damage text while retaining important rewards within a bounded pool', () => {
    const text = new FloatTexts(); text.compact = true;
    text.update(1);
    for (let i = 0; i < 30; i++) text.add(100, 100, '5', '#fff', 10);
    expect(text.items).toHaveLength(1);
    text.add(100, 100, '+20', '#fff', 15, 1, true);
    expect(text.items).toHaveLength(2);
    for (let i = 0; i < 50; i++) text.add(0, 0, 'reward', '#fff', 15, 1, true);
    expect(text.items).toHaveLength(24);
  });
  it('shows boss warnings even when celebrations fill the two phone announcement slots', () => {
    const callouts = new Callouts(); callouts.compact = true;
    for (const label of ['PERFECT', 'CACHE', '×3', 'WARNING']) callouts.add(label, '#fff');
    callouts.update(0.3);
    const drawn: string[] = [];
    const ctx = new Proxy({ fillText: (text: string) => drawn.push(text) }, { get: (obj, key: string) => obj[key as keyof typeof obj] ?? (() => {}) }) as unknown as CanvasRenderingContext2D;
    callouts.draw(ctx, 393, 851, 1);
    expect(drawn).toContain('WARNING');
    expect(drawn).toHaveLength(2);
  });
});
