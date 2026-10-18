import { describe, expect, it } from 'vitest';
import { makeRunConfig } from '../src/game/runconfig';
import { World } from '../src/game/world';
import { EDGE_BOTTOM, EDGE_LEFT, EDGE_RIGHT, EDGE_TOP, edgeIndicator, leashEdges } from '../src/render/pilots';

describe('pilot position cues', () => {
  it('marks only leash-pinned sides and includes ghosts', () => {
    const w = new World(makeRunConfig({ seed: 11, players: [{ ship: 'spark' }, { ship: 'tempest' }] }));
    const a = w.players[0]!, b = w.players[1]!, span = w.maxSpan(), sx = span.x, sy = span.y;
    a.x = a.y = 0; b.x = sx; b.y = sy; b.downed = true;
    expect(leashEdges(w, a)).toBe(EDGE_LEFT | EDGE_TOP); expect(leashEdges(w, b)).toBe(EDGE_RIGHT | EDGE_BOTTOM);
    b.x /= 2; b.y /= 2; expect(leashEdges(w, a)).toBe(0); expect(leashEdges(w, b)).toBe(0);
    b.alive = false; expect(leashEdges(w, a)).toBe(0);
  });
  it('clamps each offscreen side and corner with an outward angle', () => {
    expect(edgeIndicator(10, 10, 100, 80, 10)).toBeNull();
    expect(edgeIndicator(50, 40, 100, 80, 10)).toBeNull();
    for (const [sx, sy, x, y] of [[-5,40,10,40],[110,40,90,40],[50,-5,50,10],[50,90,50,70],[-5,-5,10,10],[105,-5,90,10],[-5,85,10,70],[105,85,90,70]]) {
      expect(edgeIndicator(sx!, sy!, 100, 80, 10)).toEqual({ x, y, angle: Math.atan2(sy! - y!, sx! - x!) });
    }
  });
});
