import { expect, it } from 'vitest';
import { makeRunConfig } from '../src/game/runconfig';
import { World } from '../src/game/world';
import { defaultSave } from '../src/meta/save';
import { reviewRun } from '../src/ui/runreview';

it('reports an unfinished goal honestly, falls back to measurable missions, and snapshots the final build', () => {
  const w = new World(makeRunConfig({ seed: 77 })), s = defaultSave(), b = w.players[0]!.build;
  b.weapons[0]!.level = 3;
  b.passives = { power: 2, magnet: 1, plating: 1, fortune: 1 };
  s.missions = [{ def: 'survive', progress: 24, target: 90, tier: 0, done: false }];
  const before = JSON.stringify([s, b, w.rng, w.lootRng]);
  const review = reviewRun(w, s, 'pulse');
  expect(review.goal?.title).toBe('Next run: Photon Storm');
  expect(review.goal?.detail).toContain('before passive slots fill');
  expect(review.weapons).toContain('Pulse Blaster · Lv 3');
  expect(review.equipment).toContain('Power Core · Lv 2');
  expect(JSON.stringify([s, b, w.rng, w.lootRng])).toBe(before);
  b.weapons[0]!.evolved = true;
  expect(reviewRun(w, s, 'pulse').goal?.detail).toBe('Best single run: 00:24 / 01:30.');
  expect(review.weapons).toContain('Pulse Blaster · Lv 3');
  s.missions = [];
  expect(reviewRun(w, s, null).goal).toBeUndefined();
});

it('records actual contact and projectile collision paths, not the boss present', () => {
  for (const contact of [true, false]) {
    const w = new World(makeRunConfig({ seed: 77 })), p = w.players[0]!;
    p.build.weapons = []; p.hp = 1; p.invuln = 0;
    w.spawnEnemy('warden', p.x + 500, p.y + 500);
    if (contact) { const e = w.spawnEnemy('drifter', p.x, p.y)!; e.spawnT = 0; }
    else w.fireBullet(p.x, p.y, 0, 0, 50);
    w.update(1 / 60, { mx: 0, my: 0, dash: false });
    expect(w.gameOver).toBe(true);
    expect(w.defeat?.cause).toEqual(contact ? { kind: 'contact', enemy: 'drifter' } : { kind: 'projectile' });
    expect(reviewRun(w, defaultSave(), null).cause).toContain(contact ? 'Drone' : 'hostile projectile');
    expect(reviewRun(w, defaultSave(), null).cause).not.toContain('Warden');
  }
});

it('ignores shields and self-revives, attributes only the final co-op hit, and omits death on victory/retreat', () => {
  const w = new World(makeRunConfig({ seed: 77, players: [{ ship: 'spark' }, { ship: 'spark' }] }));
  const p = w.players[0]!, q = w.players[1]!;
  p.shieldReady = true; p.invuln = 0;
  w.hurtPlayer(1e6, p.x, p.y, 0, { kind: 'projectile' });
  expect(w.defeat).toBeNull(); expect(p.hp).toBe(p.stats.maxHp);
  p.invuln = 0; p.stats.revives = 1;
  w.hurtPlayer(1e6, p.x, p.y, 0, { kind: 'projectile' });
  expect(w.defeat).toBeNull(); expect(p.revivesUsed).toBe(1);
  p.invuln = 0;
  w.hurtPlayer(1e6, p.x, p.y, 0, { kind: 'projectile' });
  expect(w.defeat).toBeNull(); expect(p.downed).toBe(true);
  q.invuln = 0;
  w.hurtPlayer(1e6, q.x, q.y, 1, { kind: 'contact', enemy: 'drifter' });
  expect(reviewRun(w, defaultSave(), null).cause).toBe('Final pilot P2 lost to contact with Drone.');
  w.victory = true;
  expect(reviewRun(w, defaultSave(), null).cause).toBeUndefined();
  w.victory = false; w.gameOver = false;
  expect(reviewRun(w, defaultSave(), null).cause).toBeUndefined();
  w.gameOver = true; w.defeat = null;
  expect(reviewRun(w, defaultSave(), null).cause).toContain('unavailable');
});
