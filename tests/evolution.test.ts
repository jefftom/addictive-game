import { describe, expect, it } from 'vitest';
import { WEAPONS } from '../src/game/content/weapons';
import { makeRunConfig } from '../src/game/runconfig';
import type { WeaponId } from '../src/game/types';
import { availableEvolutions } from '../src/game/upgrades';
import { World } from '../src/game/world';
import { evolutionPath } from '../src/ui/evolution';

describe('evolution presentation', () => {
  it('agrees with real eligibility for every weapon, level and partner state without mutating the run', () => {
    for (const id of Object.keys(WEAPONS) as WeaponId[]) for (let level = 1; level <= 5; level++) for (const owned of [false, true]) {
      const w = new World(makeRunConfig({ seed: 77 })), build = w.players[0]!.build;
      build.weapons = [{ id, level, evolved: false, timer: 0, phase: 0 }];
      build.passives = owned ? { [WEAPONS[id].evolvesWith]: 1 } : {};
      const before = JSON.stringify([build, w.spawnRng, w.lootRng, w.rng, w.posRng]);
      const p = evolutionPath(build, id);
      expect(p.state === 'ready').toBe(availableEvolutions(w).includes(id));
      expect(p.level).toBe(level); expect(p.partnerOwned).toBe(owned);
      expect(JSON.stringify([build, w.spawnRng, w.lootRng, w.rng, w.posRng])).toBe(before);
    }
  });
  it('explains a blocked partner and treats completed evolution as complete', () => {
    const w = new World(makeRunConfig({ seed: 77 })), b = w.players[0]!.build;
    b.weapons = [{ id: 'pulse', level: 5, evolved: false, timer: 0, phase: 0 }];
    // Pulse needs overclock; four other passives leave no slot for it.
    b.passives = { power: 1, magnet: 1, plating: 1, fortune: 1 };
    expect(evolutionPath(b, 'pulse').state).toBe('blocked');
    b.weapons[0]!.evolved = true;
    expect(evolutionPath(b, 'pulse').state).toBe('evolved');
  });
});
