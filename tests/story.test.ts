import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import type { GameEvent, ShipId } from '../src/game/types';
import { applyRun } from '../src/meta/progression';
import type { RunResult } from '../src/meta/result';
import { defaultSave, migrate, type SaveData } from '../src/meta/save';
import {
  PRIORITY,
  ShuffleBag,
  StoryDirector,
  TRIGGER_RULES,
  bossIdFromName,
  introText,
  lineDuration,
  overtimeLines,
  pickBossVictoryTaunt,
  pickGameOverQuip,
  pushQuipHistory,
  quipKey,
  resolveSpeaker,
  sectorInfo,
  vesselInfo,
  victoryText,
  type CommsMessage,
  type DirectorConfig,
  type StorySignal,
} from '../src/story/director';
import {
  checkLogbook,
  isLogbookEntryMet,
  logbookHint,
  logbookView,
  markIntroSeen,
  markLogSeen,
  recordQuip,
  storyState,
  unseenLogCount,
} from '../src/story/logbook';
import { BOSS_IDS, STORY, type BarkTrigger, type Line } from '../src/story/script';

const SHIPS: ShipId[] = ['spark', 'vanguard', 'tempest', 'bastion', 'phantom'];
const CAPTAINS: Record<ShipId, string> = {
  spark: 'starling',
  vanguard: 'ironwake',
  tempest: 'hotwire',
  bastion: 'rampart',
  phantom: 'nocturne',
};
const TRIGGERS = Object.keys(STORY.barks) as BarkTrigger[];
const CHAR_IDS = new Set(STORY.characters.map((c) => c.id));

function allLines(): { where: string; line: Line; max: number }[] {
  const out: { where: string; line: Line; max: number }[] = [];
  STORY.sectors.forEach((s, i) => s.arrival.forEach((line) => out.push({ where: `sector${i}`, line, max: 90 })));
  for (const id of BOSS_IDS) {
    const b = STORY.bosses[id];
    for (const part of ['intro', 'half', 'defeat', 'victoryTaunt'] as const) {
      b[part].forEach((line) => out.push({ where: `${id}.${part}`, line, max: 90 }));
    }
  }
  for (const t of TRIGGERS) STORY.barks[t].forEach((line) => out.push({ where: `barks.${t}`, line, max: 72 }));
  for (const [cap, pools] of Object.entries(STORY.pilotBarks)) {
    for (const [t, lines] of Object.entries(pools)) lines!.forEach((line) => out.push({ where: `pilot.${cap}.${t}`, line, max: 72 }));
  }
  STORY.gameOver.forEach((line) => out.push({ where: 'gameOver', line, max: 90 }));
  STORY.overtime.forEach((line) => out.push({ where: 'overtime', line, max: 90 }));
  return out;
}

function director(seed = 1, cfg: Partial<DirectorConfig> = {}): StoryDirector {
  return new StoryDirector(new Rng(seed), cfg);
}

/** Advances time in small steps, collecting messages that started. */
function run(d: StoryDirector, seconds: number, step = 0.1): CommsMessage[] {
  const out: CommsMessage[] = [];
  for (let t = 0; t < seconds - 1e-9; t += step) {
    d.update(step);
    out.push(...d.consumeShown());
  }
  return out;
}

/** Plays until the queue is empty and nothing is on screen. */
function drain(d: StoryDirector): CommsMessage[] {
  const out = d.consumeShown();
  for (let i = 0; i < 2000 && (d.current || d.pending > 0); i++) {
    d.update(0.1);
    out.push(...d.consumeShown());
  }
  return out;
}

function fresh(seed = 1, cfg: Partial<DirectorConfig> = {}, ships: ShipId[] = ['spark']): StoryDirector {
  const d = director(seed, cfg);
  d.startRun({ ships, opening: false });
  return d;
}

const kill = (): GameEvent => ({ t: 'kill', x: 0, y: 0, color: '#fff', r: 10, elite: false, boss: false, score: 10, dash: false, pid: 0 });

/** How to provoke each trigger through the public API. */
const PROVOKE: Record<BarkTrigger, ((d: StoryDirector) => void) | null> = {
  run_start: null,
  daily_start: null,
  coop_start: null,
  first_kill: (d) => d.onEvent(kill()),
  levelup: (d) => d.onEvent({ t: 'levelup', level: 2 }),
  evolve: (d) => d.signal({ kind: 'evolve' }),
  relic: (d) => d.signal({ kind: 'relic' }),
  cache: (d) => d.onEvent({ t: 'pickup', kind: 'cache', value: 1, pid: 0 }),
  combo_x2: (d) => d.onEvent({ t: 'combo', tier: 1, mult: 2 }),
  combo_x5: (d) => d.onEvent({ t: 'combo', tier: 4, mult: 5 }),
  combo_x10: (d) => d.onEvent({ t: 'combo', tier: 7, mult: 10 }),
  milestone: (d) => d.onEvent({ t: 'milestone', name: 'NOVA BURST', combo: 100 }),
  overdrive: (d) => d.onEvent({ t: 'milestone', name: 'OVERDRIVE', combo: 200 }),
  perfect: (d) => d.onEvent({ t: 'perfect', x: 0, y: 0, pid: 0 }),
  low_hp: (d) => d.signal({ kind: 'lowHp' }),
  heal: (d) => d.onEvent({ t: 'heal', amount: 10, pid: 0 }),
  shield_break: (d) => d.onEvent({ t: 'shieldbreak', x: 0, y: 0, pid: 0 }),
  elite: (d) => d.onEvent({ t: 'elite', x: 0, y: 0 }),
  surge: (d) => d.onEvent({ t: 'surge' }),
  boss_half: (d) => d.signal({ kind: 'bossHalf' }),
  new_best: (d) => d.onEvent({ t: 'newbest' }),
  revive: (d) => d.onEvent({ t: 'revive', x: 0, y: 0, pid: 0 }),
  idle: (d) => d.signal({ kind: 'idle' }),
  overtime: null,
  coop_down: (d) => d.signal({ kind: 'coopDown', player: 0 }),
  coop_revive: (d) => d.signal({ kind: 'coopRevive', player: 0 }),
};

function textsFor(trigger: BarkTrigger): Set<string> {
  const s = new Set(STORY.barks[trigger].map((l) => l.text));
  for (const pools of Object.values(STORY.pilotBarks)) for (const l of pools[trigger] ?? []) s.add(l.text);
  if (trigger === 'coop_down') for (const pools of Object.values(STORY.pilotBarks)) for (const l of pools.low_hp ?? []) s.add(l.text);
  if (trigger === 'coop_revive') for (const pools of Object.values(STORY.pilotBarks)) for (const l of pools.revive ?? []) s.add(l.text);
  return s;
}

function expectValid(m: CommsMessage): void {
  expect(CHAR_IDS.has(m.speaker.id)).toBe(true);
  expect(m.text.length).toBeGreaterThan(0);
  expect(m.duration).toBeGreaterThanOrEqual(2.5);
  expect(m.duration).toBeLessThanOrEqual(6);
  expect(m.id).toMatch(/^c\d+$/);
}

// ---------------------------------------------------------------------------

describe('story script integrity', () => {
  it('has unique characters and resolvable cast ids', () => {
    expect(CHAR_IDS.size).toBe(STORY.characters.length);
    expect(CHAR_IDS.has(STORY.aiId)).toBe(true);
    expect(CHAR_IDS.has(STORY.villainId)).toBe(true);
    for (const ship of SHIPS) {
      expect(STORY.pilots[ship]).toBe(CAPTAINS[ship]);
      expect(CHAR_IDS.has(STORY.pilots[ship])).toBe(true);
      expect(STORY.vessels[ship].shipName.length).toBeGreaterThan(0);
    }
    for (const id of BOSS_IDS) expect(CHAR_IDS.has(id)).toBe(true);
  });

  it('every line has a resolvable speaker and fits its length limit', () => {
    const lines = allLines();
    expect(lines.length).toBeGreaterThan(200);
    for (const { where, line, max } of lines) {
      const s = line.speaker;
      expect(s === '@pilot' || s === '@ai' || s === '@villain' || CHAR_IDS.has(s), `${where}: ${s}`).toBe(true);
      expect(line.text.length, `${where}: ${line.text}`).toBeLessThanOrEqual(max);
      expect(line.text.trim()).toBe(line.text);
    }
  });

  it('keeps voice markers (villain caps, nocturne lowercase, gauge no exclamations, biscuit mrrp)', () => {
    for (const { where, line } of allLines()) {
      if (line.speaker === '@villain' || line.speaker === 'facetius') expect(line.text, where).toBe(line.text.toUpperCase());
      // Nocturne whispers: lowercase apart from the odd emphasised word ("SO quiet").
      if (line.speaker === 'nocturne') {
        expect(line.text[0], where).toBe(line.text[0]!.toLowerCase());
        expect(/(^|[.?!] )[A-Z][a-z]/.test(line.text), where).toBe(false);
      }
      if (line.speaker === 'gauge') expect(line.text, where).not.toContain('!');
      if (line.speaker === 'biscuit') expect(line.text.toLowerCase().startsWith('mrrp'), where).toBe(true);
    }
  });

  it('every bark trigger has lines and a rule; pilot barks are well-formed', () => {
    for (const t of TRIGGERS) {
      expect(STORY.barks[t].length, t).toBeGreaterThan(0);
      expect(TRIGGER_RULES[t], t).toBeDefined();
    }
    expect(Object.keys(TRIGGER_RULES).sort()).toEqual([...TRIGGERS].sort());
    for (const [cap, pools] of Object.entries(STORY.pilotBarks)) {
      expect(Object.values(CAPTAINS)).toContain(cap);
      for (const required of ['run_start', 'perfect', 'low_hp', 'new_best'] as const) {
        expect(pools[required]?.length ?? 0, `${cap}.${required}`).toBeGreaterThan(0);
      }
      for (const [t, lines] of Object.entries(pools)) {
        expect(TRIGGERS).toContain(t);
        for (const l of lines!) expect(l.speaker === cap || l.speaker === '@pilot').toBe(true);
      }
    }
  });

  it('has the expected structure (intro, 4 sectors, 3 bosses, results lines)', () => {
    expect(STORY.intro.paragraphs).toHaveLength(5);
    expect(STORY.sectors).toHaveLength(4);
    for (const s of STORY.sectors) expect(s.arrival.length).toBeGreaterThanOrEqual(3);
    for (const id of BOSS_IDS) {
      const b = STORY.bosses[id];
      expect(b.intro.length && b.half.length && b.defeat.length && b.victoryTaunt.length).toBeGreaterThan(0);
      expect(b.intro.some((l) => l.speaker === id)).toBe(true);
    }
    expect(STORY.gameOver.length).toBeGreaterThanOrEqual(20);
    expect(new Set(STORY.gameOver.map(quipKey)).size).toBe(STORY.gameOver.length);
    expect(STORY.victory.paragraphs.length).toBeGreaterThan(0);
    expect(STORY.overtime.length).toBeGreaterThan(0);
  });

  it('logbook entries have unique ids, valid unlocks, cover every unlock kind and are 82-93 words', () => {
    const ids = STORY.logbook.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const kinds = new Set(STORY.logbook.map((e) => e.unlock.kind));
    expect([...kinds].sort()).toEqual(['boss', 'combo', 'coop', 'rank', 'runs', 'ship', 'time', 'victory']);
    for (const e of STORY.logbook) {
      const words = e.text.split(/\s+/).filter(Boolean).length;
      expect(words, e.id).toBeGreaterThanOrEqual(82);
      expect(words, e.id).toBeLessThanOrEqual(93);
      const { kind, value } = e.unlock;
      if (kind === 'boss') expect(BOSS_IDS).toContain(value);
      else if (kind === 'ship') expect(SHIPS).toContain(value);
      else expect(typeof value === 'number' && value > 0).toBe(true);
    }
  });

  it('avoids off-limits franchise vocabulary', () => {
    const banned = [/stardate/i, /captain's log/i, /make it so/i, /\bengage\b/i, /\bbeam/i, /phaser/i, /torpedo/i, /\bcloak/i, /shields up/i, /hyperspace/i, /the force\b/i, /up to eleven/i];
    const texts = [
      ...allLines().map((l) => l.line.text),
      ...STORY.intro.paragraphs,
      ...STORY.victory.paragraphs,
      ...STORY.logbook.map((e) => e.text),
    ];
    for (const t of texts) for (const re of banned) expect(re.test(t), `${re} in "${t}"`).toBe(false);
  });
});

describe('speaker resolution', () => {
  it.each(SHIPS)('resolves @pilot/@ai/@villain for %s', (ship) => {
    expect(resolveSpeaker('@pilot', ship).id).toBe(CAPTAINS[ship]);
    expect(resolveSpeaker('@ai', ship).id).toBe('wink');
    expect(resolveSpeaker('@villain', ship).id).toBe('facetius');
    expect(resolveSpeaker('gauge', ship).id).toBe('gauge');
    expect(vesselInfo(ship).captain.id).toBe(CAPTAINS[ship]);
  });

  it('throws on an unknown speaker', () => {
    expect(() => resolveSpeaker('nobody', 'spark')).toThrow();
  });

  it.each(SHIPS)('the opening line and @pilot lines speak as the %s captain', (ship) => {
    const d = director(7, { pilotMix: 1 });
    d.startRun({ ships: [ship] });
    const msgs = drain(d);
    const opener = msgs.find((m) => m.source === 'run_start')!;
    expect(opener.speaker.id).toBe(CAPTAINS[ship]);
    expect(opener.ship).toBe(ship);
    // Sector 3 arrival ends with an @pilot line.
    d.signal({ kind: 'sector', index: 3 });
    const arrival = drain(d);
    expect(arrival.at(-1)!.speaker.id).toBe(CAPTAINS[ship]);
  });

  it('maps simulation boss names to boss ids', () => {
    expect(bossIdFromName('The Warden')).toBe('warden');
    expect(bossIdFromName('The Hydra')).toBe('hydra');
    expect(bossIdFromName('Void Heart')).toBe('voidheart');
    expect(bossIdFromName('voidheart')).toBe('voidheart');
    expect(bossIdFromName('Somebody Else')).toBeNull();
  });
});

describe('StoryDirector triggers', () => {
  it.each(TRIGGERS.filter((t) => PROVOKE[t]))('%s produces a valid line from its pool', (trigger) => {
    for (const ship of SHIPS) {
      const d = fresh(3, {}, [ship, 'spark']);
      const valid = textsFor(trigger);
      let got: CommsMessage | undefined;
      for (let i = 0; i < 60 && !got; i++) {
        PROVOKE[trigger]!(d);
        got = d.consumeShown().find((m) => m.source === trigger);
        drain(d);
        run(d, 40, 1);
      }
      expect(got, `${trigger} on ${ship}`).toBeDefined();
      expectValid(got!);
      expect(valid.has(got!.text), got!.text).toBe(true);
      expect(got!.priority).toBe(TRIGGER_RULES[trigger].priority);
    }
  });

  it('opening uses daily_start for the Daily Run and coop_start for co-op', () => {
    const daily = director(1);
    daily.startRun({ ships: ['spark'], daily: true });
    const a = drain(daily);
    expect(a.map((m) => m.source)).toEqual(['sector:0', 'sector:0', 'sector:0', 'daily_start']);
    expect(textsFor('daily_start').has(a[3]!.text)).toBe(true);

    const coop = director(1);
    coop.startRun({ ships: ['spark', 'bastion'] });
    const b = drain(coop);
    expect(b.at(-1)!.source).toBe('coop_start');
  });

  it('every message from a long noisy run is valid', () => {
    const d = director(11);
    d.startRun({ ships: ['tempest'] });
    const evs: GameEvent[] = [
      kill(), { t: 'levelup', level: 3 }, { t: 'perfect', x: 0, y: 0, pid: 0 }, { t: 'heal', amount: 3, pid: 0 },
      { t: 'combo', tier: 1, mult: 2 }, { t: 'shieldbreak', x: 0, y: 0, pid: 0 }, { t: 'elite', x: 0, y: 0 },
    ];
    const all: CommsMessage[] = [];
    for (let i = 0; i < 3000; i++) {
      d.onEvent(evs[i % evs.length]!);
      d.update(0.1);
      all.push(...d.consumeShown());
    }
    expect(all.length).toBeGreaterThan(20);
    for (const m of all) expectValid(m);
  });

  it('is deterministic for a given seed', () => {
    const play = () => {
      const d = director(99);
      d.startRun({ ships: ['phantom'] });
      const out: string[] = [];
      for (let i = 0; i < 2000; i++) {
        if (i % 7 === 0) d.onEvent({ t: 'levelup', level: i });
        if (i % 13 === 0) d.onEvent({ t: 'perfect', x: 0, y: 0, pid: 0 });
        if (i === 500) d.onEvent({ t: 'boss', name: 'The Warden', title: '' });
        d.update(0.05);
        out.push(...d.consumeShown().map((m) => `${m.key}@${d.time.toFixed(2)}`));
      }
      return out;
    };
    expect(play()).toEqual(play());
  });
});

describe('StoryDirector pacing', () => {
  it('plays at most one common bark every 4-6 s', () => {
    const d = fresh(5);
    const starts: number[] = [];
    for (let i = 0; i < 1200; i++) {
      d.onEvent({ t: 'levelup', level: 2 });
      d.onEvent({ t: 'perfect', x: 0, y: 0, pid: 0 });
      d.onEvent({ t: 'shieldbreak', x: 0, y: 0, pid: 0 });
      d.update(0.1);
      for (const m of d.consumeShown()) if (m.priority === PRIORITY.common) starts.push(d.time);
    }
    expect(starts.length).toBeGreaterThan(10);
    expect(starts.length).toBeLessThanOrEqual(Math.ceil(120 / 4));
    for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(4 - 1e-6);
  });

  it('drops common barks while anything is on screen', () => {
    const d = fresh(5);
    d.signal({ kind: 'evolve' });
    expect(d.current!.source).toBe('evolve');
    for (let i = 0; i < 20; i++) d.onEvent({ t: 'perfect', x: 0, y: 0, pid: 0 });
    expect(d.pending).toBe(0);
    expect(d.current!.source).toBe('evolve');
  });

  it('rare lines interrupt common ones; story lines interrupt rare ones; never the reverse', () => {
    const d = fresh(2);
    d.signal({ kind: 'idle' });
    expect(d.current!.priority).toBe(PRIORITY.common);
    d.signal({ kind: 'relic' });
    expect(d.current!.source).toBe('relic');
    d.consumeShown();
    d.onEvent({ t: 'boss', name: 'The Warden', title: 'Keeper of the First Gate' });
    expect(d.current!.source).toBe('boss_intro:warden');
    const storyLine = d.current!.id;
    d.signal({ kind: 'evolve' });
    d.onEvent({ t: 'newbest' });
    expect(d.current!.id).toBe(storyLine);
    // Rare lines queue behind the story sequence, ordered after it.
    const msgs = drain(d);
    const sources = msgs.map((m) => m.source);
    const lastStory = sources.lastIndexOf('boss_intro:warden');
    for (let i = 0; i < sources.length; i++) {
      if (msgs[i]!.priority === PRIORITY.rare) expect(i).toBeGreaterThan(lastStory);
    }
  });

  it('drops stale rare lines that waited longer than their TTL', () => {
    const d = fresh(2, { rareTtl: 3 });
    d.onEvent({ t: 'boss', name: 'The Hydra', title: '' });
    d.signal({ kind: 'evolve' });
    const msgs = drain(d);
    expect(msgs.every((m) => m.source === 'boss_intro:hydra')).toBe(true);
    expect(msgs).toHaveLength(STORY.bosses.hydra.intro.length);
  });

  it('caps the number of waiting rare lines', () => {
    const d = fresh(2, { maxRareQueue: 2, rareTtl: 100 });
    d.onEvent({ t: 'boss', name: 'The Hydra', title: '' });
    d.signal({ kind: 'evolve' });
    d.signal({ kind: 'relic' });
    d.signal({ kind: 'lowHp' });
    d.onEvent({ t: 'newbest' });
    expect(d.pending).toBe(STORY.bosses.hydra.intro.length - 1 + 2);
  });

  it('respects per-trigger cooldowns', () => {
    const d = fresh(2);
    d.signal({ kind: 'lowHp' });
    drain(d);
    run(d, 10);
    d.signal({ kind: 'lowHp' });
    expect(d.consumeShown()).toHaveLength(0);
    run(d, TRIGGER_RULES.low_hp.cooldown);
    d.signal({ kind: 'lowHp' });
    expect(d.consumeShown().map((m) => m.source)).toEqual(['low_hp']);
  });

  it('skipCurrent advances to the next queued line', () => {
    const d = fresh(2);
    d.signal({ kind: 'sector', index: 1 });
    const first = d.current!.id;
    d.skipCurrent();
    expect(d.current!.id).not.toBe(first);
    expect(d.current!.key).toBe('sectors.1.arrival.1');
  });

  it('line duration grows with length within bounds', () => {
    expect(lineDuration('Hi')).toBe(2.5);
    expect(lineDuration('x'.repeat(200))).toBe(6);
    expect(lineDuration('x'.repeat(60))).toBeGreaterThan(lineDuration('x'.repeat(30)));
  });
});

describe('no-repeat shuffle bags and pilot mixing', () => {
  it('a shuffle bag deals every index once per cycle and never back-to-back', () => {
    const rng = new Rng(4);
    const bag = new ShuffleBag(5);
    const draws = Array.from({ length: 200 }, () => bag.draw(rng));
    for (let c = 0; c < 40; c++) expect(new Set(draws.slice(c * 5, c * 5 + 5)).size).toBe(5);
    for (let i = 1; i < draws.length; i++) expect(draws[i]).not.toBe(draws[i - 1]);
    expect(new ShuffleBag(1).draw(rng)).toBe(0);
  });

  it('a trigger does not repeat a line until its pool is exhausted', () => {
    const d = fresh(8, { pilotMix: 0 });
    const keys: string[] = [];
    const n = STORY.barks.relic.length;
    for (let i = 0; i < n * 3; i++) {
      d.signal({ kind: 'relic' });
      keys.push(...d.consumeShown().map((m) => m.key));
      drain(d);
      run(d, 5, 1);
    }
    expect(keys).toHaveLength(n * 3);
    for (let c = 0; c < 3; c++) expect(new Set(keys.slice(c * n, c * n + n)).size).toBe(n);
  });

  it('mixes captain lines in about half the time when the captain has an entry', () => {
    let pilot = 0;
    const N = 400;
    const d = director(21);
    for (let i = 0; i < N; i++) {
      d.startRun({ ships: ['bastion'] });
      const opener = drain(d).find((m) => m.source === 'run_start')!;
      if (opener.key.startsWith('pilotBarks.rampart.run_start')) pilot++;
    }
    expect(pilot / N).toBeGreaterThan(0.38);
    expect(pilot / N).toBeLessThan(0.62);
  });

  it('never mixes captain lines for triggers without a captain entry', () => {
    const d = fresh(3, { pilotMix: 1 }, ['vanguard']);
    for (let i = 0; i < 10; i++) {
      d.signal({ kind: 'relic' });
      for (const m of d.consumeShown()) expect(m.key.startsWith('barks.relic')).toBe(true);
      drain(d);
      run(d, 4, 1);
    }
  });
});

describe('co-op captains', () => {
  it('per-player events speak with that player\'s captain', () => {
    const d = fresh(1, { pilotMix: 1 }, ['spark', 'phantom']);
    for (let i = 0; i < 20 && !d.current; i++) d.onEvent({ t: 'perfect', x: 0, y: 0, pid: 0 }, 1);
    expect(d.current!.speaker.id).toBe('nocturne');
    expect(d.current!.ship).toBe('phantom');
  });

  it('coop_down mixes in the downed captain and gives @pilot lines to the helper', () => {
    const mixed = fresh(1, { pilotMix: 1 }, ['spark', 'phantom']);
    mixed.signal({ kind: 'coopDown', player: 1 });
    expect(mixed.current!.speaker.id).toBe('nocturne');
    expect(mixed.current!.key.startsWith('pilotBarks.nocturne.low_hp')).toBe(true);

    const d = fresh(1, { pilotMix: 0 }, ['spark', 'phantom']);
    const pilotLine = STORY.barks.coop_down.find((l) => l.speaker === '@pilot')!;
    let seen = false;
    for (let i = 0; i < STORY.barks.coop_down.length; i++) {
      d.signal({ kind: 'coopDown', player: 1 });
      const m = d.consumeShown()[0]!;
      if (m.text === pilotLine.text) {
        seen = true;
        expect(m.speaker.id).toBe('starling');
      }
      drain(d);
      run(d, 5, 1);
    }
    expect(seen).toBe(true);
  });

  it('coop_revive @pilot lines come from the reviver', () => {
    const d = fresh(1, { pilotMix: 0 }, ['bastion', 'tempest', 'vanguard']);
    const pilotLine = STORY.barks.coop_revive.find((l) => l.speaker === '@pilot')!;
    let seen = false;
    for (let i = 0; i < STORY.barks.coop_revive.length; i++) {
      d.signal({ kind: 'coopRevive', player: 0, by: 2 });
      const m = d.consumeShown()[0]!;
      if (m.text === pilotLine.text) {
        seen = true;
        expect(m.speaker.id).toBe('ironwake');
      }
      drain(d);
      run(d, 5, 1);
    }
    expect(seen).toBe(true);
  });
});

describe('boss, sector and overtime sequences', () => {
  it.each(BOSS_IDS)('%s: intro, half and defeat play in order, then the next sector', (id) => {
    const names = { warden: 'The Warden', hydra: 'The Hydra', voidheart: 'Void Heart' } as const;
    const d = fresh(4, {}, ['vanguard']);
    d.onEvent({ t: 'boss', name: names[id], title: '' });
    const intro = drain(d);
    expect(intro.map((m) => m.text)).toEqual(STORY.bosses[id].intro.map((l) => l.text));
    expect(intro.every((m) => m.priority === PRIORITY.story)).toBe(true);
    for (const [i, m] of intro.entries()) {
      const sp = STORY.bosses[id].intro[i]!.speaker;
      expect(m.speaker.id).toBe(resolveSpeaker(sp, 'vanguard').id);
    }

    d.signal({ kind: 'bossHalf' });
    expect(drain(d).map((m) => m.text)).toEqual(STORY.bosses[id].half.map((l) => l.text));

    const sector = BOSS_IDS.indexOf(id) + 1;
    d.onEvent({ t: 'bossdead', x: 0, y: 0, name: names[id] });
    d.signal({ kind: 'sector', index: sector });
    const after = drain(d);
    expect(after.map((m) => m.text)).toEqual([
      ...STORY.bosses[id].defeat.map((l) => l.text),
      ...STORY.sectors[sector]!.arrival.map((l) => l.text),
    ]);
  });

  it('overtime rematches use a single boss line and the generic half bark', () => {
    const d = fresh(4);
    d.onEvent({ t: 'boss', name: 'The Warden', title: '' });
    d.signal({ kind: 'bossHalf' });
    d.onEvent({ t: 'bossdead', x: 0, y: 0, name: 'The Warden' });
    drain(d);
    d.onEvent({ t: 'boss', name: 'The Warden', title: '' });
    const again = drain(d);
    expect(again).toHaveLength(1);
    expect(again[0]!.speaker.id).toBe('warden');
    d.signal({ kind: 'bossHalf' });
    const half = drain(d);
    expect(half).toHaveLength(1);
    expect(half[0]!.source).toBe('boss_half');
    d.onEvent({ t: 'bossdead', x: 0, y: 0, name: 'The Warden' });
    expect(drain(d)).toHaveLength(1);
  });

  it('plays the sector 0 arrival at run start and each sector only once', () => {
    const d = director(6);
    d.startRun({ ships: ['spark'] });
    const opening = drain(d);
    expect(opening.slice(0, 3).map((m) => m.key)).toEqual(['sectors.0.arrival.0', 'sectors.0.arrival.1', 'sectors.0.arrival.2']);
    d.signal({ kind: 'sector', index: 0 });
    d.signal({ kind: 'sector', index: 9 });
    expect(drain(d)).toHaveLength(0);
    for (const i of [1, 2, 3]) {
      d.signal({ kind: 'sector', index: i });
      d.signal({ kind: 'sector', index: i });
      expect(drain(d)).toHaveLength(STORY.sectors[i]!.arrival.length);
    }
  });

  it('overtime plays the post-credits lines, then ambient overtime barks', () => {
    const d = fresh(6, { overtimeBarkEvery: 30 });
    d.signal({ kind: 'overtime' });
    expect(drain(d).map((m) => m.text)).toEqual(STORY.overtime.map((l) => l.text));
    d.signal({ kind: 'overtime' });
    expect(drain(d)).toHaveLength(0);
    const later: CommsMessage[] = [];
    for (let i = 0; i < 400; i++) {
      d.onEvent(kill());
      d.update(0.1);
      later.push(...d.consumeShown());
    }
    const ot = later.filter((m) => m.source === 'overtime');
    expect(ot.length).toBeGreaterThanOrEqual(1);
    for (const m of ot) expect(textsFor('overtime').has(m.text)).toBe(true);
  });

  it('victory drops chatter but keeps story lines', () => {
    const d = fresh(6);
    d.signal({ kind: 'sector', index: 3 });
    d.signal({ kind: 'evolve' });
    d.onEvent({ t: 'victory' });
    const msgs = drain(d);
    expect(msgs.every((m) => m.priority === PRIORITY.story)).toBe(true);
  });
});

describe('idle and first kill', () => {
  it('barks after idle time without kills; kills reset the timer', () => {
    const d = fresh(9, { idleAfter: 10 });
    for (let i = 0; i < 300; i++) {
      d.onEvent(kill());
      d.update(0.1);
    }
    expect(d.consumeShown().filter((m) => m.source === 'idle')).toHaveLength(0);
    const quiet = run(d, 11);
    expect(quiet.filter((m) => m.source === 'idle')).toHaveLength(1);
  });

  it('first_kill waits for the opening to finish and plays once', () => {
    const d = director(9);
    d.startRun({ ships: ['spark'] });
    const out: CommsMessage[] = [];
    for (let i = 0; i < 350; i++) {
      d.onEvent(kill());
      d.update(0.1);
      out.push(...d.consumeShown());
    }
    const fk = out.filter((m) => m.source === 'first_kill');
    expect(fk).toHaveLength(1);
    const openerIdx = out.findIndex((m) => m.source === 'run_start');
    expect(out.indexOf(fk[0]!)).toBeGreaterThan(openerIdx);
  });

  it('ignores input outside a run and endRun clears everything', () => {
    const d = director(1);
    d.signal({ kind: 'evolve' });
    d.onEvent({ t: 'newbest' });
    expect(d.current).toBeNull();
    d.startRun({ ships: ['spark'] });
    expect(d.current).not.toBeNull();
    d.endRun();
    expect(d.current).toBeNull();
    expect(d.pending).toBe(0);
    expect(d.isRunning).toBe(false);
  });
});

describe('results, ending and intro text', () => {
  it('game-over quips avoid the last N shown', () => {
    const rng = new Rng(12);
    let history: string[] = [];
    const keys: string[] = [];
    for (let i = 0; i < 80; i++) {
      const q = pickGameOverQuip(rng, 'spark', history, 8);
      expect(CHAR_IDS.has(q.speaker.id)).toBe(true);
      keys.push(q.key);
      history = pushQuipHistory(history, q.key, 16);
    }
    for (let i = 0; i < keys.length; i++) {
      expect(keys.slice(Math.max(0, i - 8), i)).not.toContain(keys[i]);
    }
    expect(new Set(keys).size).toBe(STORY.gameOver.length);
    expect(history.length).toBeLessThanOrEqual(16);
  });

  it.each(SHIPS)('game-over @pilot quips resolve to the %s captain', (ship) => {
    const pilotQuips = STORY.gameOver.filter((l) => l.speaker === '@pilot');
    const others = STORY.gameOver.filter((l) => l.speaker !== '@pilot').map(quipKey);
    const q = pickGameOverQuip(new Rng(1), ship, others, others.length);
    expect(pilotQuips.map((l) => l.text)).toContain(q.text);
    expect(q.speaker.id).toBe(CAPTAINS[ship]);
  });

  it('quip history persists in the save', () => {
    const save = defaultSave();
    const q = pickGameOverQuip(new Rng(3), 'spark', storyState(save).quipHistory);
    recordQuip(save, q.key);
    const loaded = migrate(JSON.parse(JSON.stringify(save)));
    expect(loaded.story!.quipHistory).toEqual([q.key]);
    const next = pickGameOverQuip(new Rng(3), 'spark', loaded.story!.quipHistory);
    expect(next.key).not.toBe(q.key);
  });

  it('boss victory taunts, ending, overtime and intro accessors', () => {
    for (const id of BOSS_IDS) {
      const t = pickBossVictoryTaunt(new Rng(1), id, 'tempest');
      expect(STORY.bosses[id].victoryTaunt.map((l) => l.text)).toContain(t.text);
    }
    expect(victoryText().title).toBe(STORY.victory.title);
    expect(overtimeLines('phantom')).toHaveLength(STORY.overtime.length);
    expect(overtimeLines('phantom')[0]!.speaker.id).toBe('facetius');
    expect(introText().paragraphs).toHaveLength(5);
    expect(sectorInfo(2).name).toBe('The Amethyst Abyss');
    expect(sectorInfo(99).name).toBe('The Gilded Throne');
  });
});

// ---------------------------------------------------------------------------

function runResult(over: Partial<RunResult> = {}): RunResult {
  return {
    score: 12000, time: 150, level: 10, kills: 400, elites: 2, bossesKilled: [], dashKills: 20,
    perfects: 4, gems: 380, maxCombo: 80, evolutions: 0, coresCollected: 6, hitsTaken: 9,
    longestNoHit: 40, maxWeapons: 2, victory: false, daily: false, ship: 'spark', hard: false, coreGain: 1,
    ...over,
  };
}

const unlockedIds = (save: SaveData, ctx = {}) => checkLogbook(save, ctx).map((e) => e.id);

describe('logbook unlocks', () => {
  it('a fresh save unlocks nothing', () => {
    const save = defaultSave();
    expect(unlockedIds(save)).toEqual([]);
    expect(logbookView(save).every((r) => !r.unlocked)).toBe(true);
  });

  it.each([
    ['runs', (s: SaveData) => (s.stats.runs = 1), ['first-light']],
    ['runs 5', (s: SaveData) => (s.stats.runs = 5), ['first-light', 'mabel']],
    ['time', (s: SaveData) => (s.stats.bestTime = 180.4), ['regulations']],
    ['time 900', (s: SaveData) => (s.stats.bestTime = 901), ['regulations', 'new-limit']],
    ['boss warden', (s: SaveData) => (s.achievements.warden = 1), ['not-on-the-list']],
    ['boss hydra', (s: SaveData) => (s.achievements.hydra = 1), ['round-and-round']],
    ['boss voidheart', (s: SaveData) => (s.achievements.voidheart = 1), ['sweet-prism']],
    ['combo', (s: SaveData) => (s.stats.bestCombo = 100), ['pun-ledger']],
    ['rank 3', (s: SaveData) => (s.rank = 3), ['closing-speeches']],
    ['rank 5', (s: SaveData) => (s.rank = 5), ['closing-speeches', 'overlord-notebook']],
    ['ship phantom', (s: SaveData) => (s.achievements.perfect10 = 1), ['lights-off']],
    ['victory', (s: SaveData) => (s.stats.victories = 1), ['the-light-holds']],
    ['victory 5', (s: SaveData) => (s.stats.victories = 5), ['the-light-holds', 'last-stanza']],
  ] as [string, (s: SaveData) => unknown, string[]][])('%s', (_name, setup, expected) => {
    const save = defaultSave();
    setup(save);
    expect(unlockedIds(save)).toEqual([...expected]);
    expect(unlockedIds(save)).toEqual([]);
    expect(save.story!.logUnlocked).toEqual([...expected]);
  });

  it('coop unlocks from the run context or a saved co-op counter', () => {
    const a = defaultSave();
    expect(unlockedIds(a)).toEqual([]);
    expect(unlockedIds(a, { coopRun: true })).toEqual(['fleet-channel']);
    const b = defaultSave();
    expect(unlockedIds(b, { coopRuns: 1 })).toEqual(['fleet-channel']);
    const c = defaultSave();
    (c.stats as unknown as Record<string, number>).coopRuns = 2;
    expect(unlockedIds(c)).toEqual(['fleet-channel']);
  });

  it('works with applyRun results', () => {
    const save = defaultSave();
    applyRun(save, runResult({ time: 200, bossesKilled: ['warden'], perfects: 10 }), new Rng(1), '2026-10-07');
    expect(unlockedIds(save)).toEqual(['first-light', 'regulations', 'not-on-the-list', 'lights-off']);
  });

  it('tracks seen entries and the unseen badge', () => {
    const save = defaultSave();
    save.stats.runs = 5;
    checkLogbook(save);
    expect(unseenLogCount(save)).toBe(2);
    markLogSeen(save, 'mabel');
    markLogSeen(save, 'mabel');
    markLogSeen(save, 'last-stanza'); // locked: ignored
    expect(unseenLogCount(save)).toBe(1);
    expect(save.story!.logSeen).toEqual(['mabel']);
    const view = logbookView(save);
    expect(view).toHaveLength(STORY.logbook.length);
    expect(view.find((r) => r.entry.id === 'mabel')).toMatchObject({ unlocked: true, seen: true });
    expect(view.find((r) => r.entry.id === 'pun-ledger')!.progress).toEqual([0, 100]);
  });

  it('progress and hints exist for every entry', () => {
    const save = defaultSave();
    for (const e of STORY.logbook) {
      expect(logbookHint(e).length).toBeGreaterThan(5);
      expect(isLogbookEntryMet(e, save)).toBe(false);
    }
    expect(logbookHint(STORY.logbook.find((e) => e.id === 'regulations')!)).toBe('Survive 3:00 in a run');
  });

  it('migrates story state: defaults for old saves, sanitises bad data, survives round trips', () => {
    const old = migrate({ cores: 5 });
    expect(old.story).toEqual({ introSeen: false, logUnlocked: [], logSeen: [], quipHistory: [] });
    const bad = migrate({ story: { introSeen: 'yes', logUnlocked: ['a', 3, 'a'], logSeen: null, quipHistory: 'x' } });
    expect(bad.story).toEqual({ introSeen: false, logUnlocked: ['a'], logSeen: [], quipHistory: [] });
    const save = defaultSave();
    markIntroSeen(save);
    save.stats.runs = 1;
    checkLogbook(save);
    const back = migrate(JSON.parse(JSON.stringify(save)));
    expect(back.story).toEqual(save.story);
    expect(back.story!.introSeen).toBe(true);
  });
});

// Keeps the StorySignal union exhaustive in tests (compile-time check).
const _signals: StorySignal['kind'][] = ['evolve', 'relic', 'cache', 'lowHp', 'bossHalf', 'sector', 'overtime', 'idle', 'coopDown', 'coopRevive'];
void _signals;
