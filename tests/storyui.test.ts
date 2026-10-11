import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { makeRunConfig } from '../src/game/runconfig';
import type { Enemy, GameEvent, ShipId } from '../src/game/types';
import { World } from '../src/game/world';
import { defaultSave, migrate } from '../src/meta/save';
import { PRIORITY, StoryDirector, type CommsMessage, type RunStartOptions, type StorySignal } from '../src/story/director';
import { StoryRunLink } from '../src/story/runlink';
import { STORY } from '../src/story/script';
import { chatterAllows, shortRole } from '../src/ui/comms';
import { paragraphHold } from '../src/ui/crawl';

function world(ships: ShipId[], seed = 7): World {
  return new World(makeRunConfig({ seed, players: ships.map((ship) => ({ ship })) }));
}

/** Records every call the link makes into the director. */
class SpyDirector {
  started: RunStartOptions[] = [];
  events: { ev: GameEvent; player: number | undefined }[] = [];
  signals: StorySignal[] = [];
  ended = 0;
  startRun(o: RunStartOptions): void {
    this.started.push(o);
  }
  onEvent(ev: GameEvent, player?: number): void {
    this.events.push({ ev, player });
  }
  signal(s: StorySignal): void {
    this.signals.push(s);
  }
  endRun(): void {
    this.ended++;
  }
}

function spyLink(): { spy: SpyDirector; link: StoryRunLink } {
  const spy = new SpyDirector();
  return { spy, link: new StoryRunLink(spy as unknown as StoryDirector) };
}

function fakeBoss(id: number, kind: Enemy['kind'], hp: number, maxHp: number): Enemy {
  return { id, kind, hp, maxHp, dead: false } as Enemy;
}

describe('StoryRunLink', () => {
  it('starts the director with every pilot, the daily flag and co-op', () => {
    const { spy, link } = spyLink();
    link.startRun(world(['tempest', 'phantom']), { daily: false });
    expect(spy.started).toEqual([{ ships: ['tempest', 'phantom'], daily: false, coop: true, local: 0 }]);
    link.startRun(world(['bastion']), { daily: true });
    expect(spy.started[1]).toEqual({ ships: ['bastion'], daily: true, coop: false, local: 0 });
  });

  it('passes each event with its own pid, and pid-less events without one', () => {
    const { spy, link } = spyLink();
    const w = world(['spark', 'vanguard']);
    link.startRun(w);
    link.frame(w, [
      { t: 'kill', x: 0, y: 0, color: '#fff', r: 1, elite: false, boss: false, score: 1, dash: false, pid: 1 },
      { t: 'levelup', level: 2 },
      { t: 'perfect', x: 0, y: 0, pid: 0 },
    ]);
    expect(spy.events.map((e) => [e.ev.t, e.player])).toEqual([
      ['kill', 1],
      ['levelup', undefined],
      ['perfect', 0],
    ]);
  });

  it('turns sector, downed and revived events into signals', () => {
    const { spy, link } = spyLink();
    const w = world(['spark', 'phantom']);
    link.startRun(w);
    link.frame(w, [
      { t: 'sector', index: 2 },
      { t: 'downed', pid: 1, x: 0, y: 0 },
      { t: 'revived', pid: 1, by: 0, x: 0, y: 0 },
    ]);
    expect(spy.signals).toEqual([
      { kind: 'sector', index: 2 },
      { kind: 'coopDown', player: 1 },
      { kind: 'coopRevive', player: 1, by: 0 },
    ]);
    expect(spy.events).toEqual([]);
  });

  it('signals low HP once per crossing per pilot, re-arming after a heal', () => {
    const { spy, link } = spyLink();
    const w = world(['spark', 'vanguard']);
    link.startRun(w);
    const [a, b] = w.players;
    const low = () => spy.signals.filter((s) => s.kind === 'lowHp');
    a!.hp = a!.stats.maxHp * 0.2;
    link.frame(w, []);
    link.frame(w, []);
    expect(low()).toEqual([{ kind: 'lowHp', player: 0 }]);
    b!.hp = b!.stats.maxHp * 0.1;
    link.frame(w, []);
    expect(low()).toHaveLength(2);
    expect(low()[1]).toEqual({ kind: 'lowHp', player: 1 });
    // Still low, or only partly healed: no repeat.
    a!.hp = a!.stats.maxHp * 0.4;
    link.frame(w, []);
    a!.hp = a!.stats.maxHp * 0.25;
    link.frame(w, []);
    expect(low()).toHaveLength(2);
    // Healed above the re-arm line, then low again: a new signal.
    a!.hp = a!.stats.maxHp * 0.8;
    link.frame(w, []);
    a!.hp = a!.stats.maxHp * 0.15;
    link.frame(w, []);
    expect(low()).toHaveLength(3);
  });

  it('ignores downed pilots for low HP', () => {
    const { spy, link } = spyLink();
    const w = world(['spark', 'vanguard']);
    link.startRun(w);
    w.players[1]!.downed = true;
    w.players[1]!.hp = 1;
    link.frame(w, []);
    expect(spy.signals).toEqual([]);
  });

  it('signals the boss crossing half HP once per boss', () => {
    const { spy, link } = spyLink();
    const w = world(['spark']);
    link.startRun(w);
    const half = () => spy.signals.filter((s) => s.kind === 'bossHalf');
    w.boss = fakeBoss(10, 'warden', 3000, 3500);
    link.frame(w, []);
    expect(half()).toEqual([]);
    w.boss.hp = 1700;
    link.frame(w, []);
    w.boss.hp = 1200;
    link.frame(w, []);
    expect(half()).toEqual([{ kind: 'bossHalf', boss: 'warden' }]);
    // A different boss entity re-arms it.
    w.boss = fakeBoss(11, 'hydra', 10000, 10000);
    link.frame(w, []);
    w.boss.hp = 4000;
    link.frame(w, []);
    expect(half()[1]).toEqual({ kind: 'bossHalf', boss: 'hydra' });
  });

  it('maps picks to evolve / relic / cache signals and forwards Overtime', () => {
    const { spy, link } = spyLink();
    link.startRun(world(['spark']));
    link.pick('weapon', false, 0);
    link.pick('evolve', false, 0);
    link.pick('relic', true, 1);
    link.pick('bonus', true, 0);
    link.overtime();
    link.endRun();
    expect(spy.signals).toEqual([
      { kind: 'evolve', player: 0 },
      { kind: 'relic', player: 1 },
      { kind: 'cache', player: 0 },
      { kind: 'overtime' },
    ]);
    expect(spy.ended).toBe(1);
  });

  it('drives a real director: the opening plays, co-op downs bark per pilot', () => {
    const d = new StoryDirector(new Rng(3));
    const link = new StoryRunLink(d);
    const w = world(['spark', 'phantom']);
    link.startRun(w);
    const shown: CommsMessage[] = [];
    const tick = (s: number) => {
      for (let t = 0; t < s; t += 0.1) {
        d.update(0.1);
        shown.push(...d.consumeShown());
      }
    };
    tick(0.1);
    expect(shown[0]?.source).toBe('sector:0');
    expect(shown[0]?.priority).toBe(PRIORITY.story);
    tick(40);
    link.frame(w, [{ t: 'downed', pid: 1, x: 0, y: 0 }]);
    tick(8);
    const down = shown.find((m) => m.source === 'coop_down');
    expect(down).toBeDefined();
    // The line is voiced by the helper (P1's captain), the downed pilot's captain, or the shared crew.
    const allowed = new Set(['starling', 'nocturne', ...STORY.characters.filter((c) => !Object.values(STORY.pilots).includes(c.id)).map((c) => c.id)]);
    expect(allowed.has(down!.speaker.id)).toBe(true);
  });
});

describe('comms helpers', () => {
  it('filters lines by the crew chatter setting', () => {
    const common = { priority: PRIORITY.common };
    const rare = { priority: PRIORITY.rare };
    const story = { priority: PRIORITY.story };
    expect([common, rare, story].map((m) => chatterAllows('all', m))).toEqual([true, true, true]);
    expect([common, rare, story].map((m) => chatterAllows('important', m))).toEqual([false, true, true]);
    expect([common, rare, story].map((m) => chatterAllows('off', m))).toEqual([false, false, false]);
  });

  it('shortens roles for the comms header', () => {
    const role = (id: string) => STORY.characters.find((c) => c.id === id)!.role;
    expect(shortRole(role('starling'))).toBe('Captain of the Glimmer of Hope');
    expect(shortRole(role('wink'))).toBe("Ship's computer");
    expect(shortRole(role('voidheart'))).toBe('Hive mothership');
    for (const c of STORY.characters) expect(shortRole(c.role).length).toBeGreaterThan(0);
  });

  it('paces crawl paragraphs by length, within bounds', () => {
    const holds = STORY.intro.paragraphs.map(paragraphHold);
    for (const h of holds) {
      expect(h).toBeGreaterThanOrEqual(2.2);
      expect(h).toBeLessThanOrEqual(8.5);
    }
    expect(paragraphHold('x'.repeat(200))).toBeGreaterThan(paragraphHold('x'.repeat(50)));
  });
});

describe('chatter setting in the save', () => {
  it('defaults to all and survives a round trip', () => {
    expect(defaultSave().settings.chatter).toBe('all');
    const s = defaultSave();
    s.settings.chatter = 'important';
    expect(migrate(JSON.parse(JSON.stringify(s))).settings.chatter).toBe('important');
  });

  it('falls back to all for old or malformed saves', () => {
    expect(migrate({ settings: { music: 0.2 } }).settings.chatter).toBe('all');
    expect(migrate({ settings: { chatter: 'loud' } }).settings.chatter).toBe('all');
  });
});
