/**
 * StoryDirector: turns simulation events and app signals into a paced stream of
 * comms messages (bridge-crew barks, boss and sector sequences).
 *
 * Pure and deterministic for a given Rng: no Date.now / Math.random, time only
 * advances through update(dt). The app feeds it:
 *   - startRun({ ships, daily })            at run start (queues the sector 0 opening)
 *   - onEvents(world.events)                every frame, with the simulation's GameEvents
 *   - signal({ kind: ... })                 for app-level moments (picks, low HP, sectors, ...)
 *   - update(dt)                            every frame while the run is not paused
 * and reads consumeShown() (messages that started since the last call) or `current`.
 */
import { hashString, type Rng } from '../core/rng';
import type { GameEvent, ShipId } from '../game/types';
import { BOSS_IDS, STORY, type BarkTrigger, type BossId, type CharacterDef, type Line, type Speaker } from './script';

// ---------------------------------------------------------------------------
// Characters and speaker resolution

export const PRIORITY = { common: 0, rare: 1, story: 2 } as const;
export type CommsPriority = (typeof PRIORITY)[keyof typeof PRIORITY];

const CHAR_BY_ID = new Map<string, CharacterDef>(STORY.characters.map((c) => [c.id, c]));
const SHIP_BY_CAPTAIN = new Map<string, ShipId>(
  (Object.keys(STORY.pilots) as ShipId[]).map((ship) => [STORY.pilots[ship], ship]),
);

export function characterById(id: string): CharacterDef | undefined {
  return CHAR_BY_ID.get(id);
}

/** Captain character id for a ship ('spark' -> 'starling'). */
export function captainId(ship: ShipId): string {
  return STORY.pilots[ship];
}

/** Ship id whose captain this character is, or null for non-captains. */
export function shipOfCaptain(characterId: string): ShipId | null {
  return SHIP_BY_CAPTAIN.get(characterId) ?? null;
}

/** Resolves '@pilot' (captain of `ship`), '@ai', '@villain' or a character id. Throws on unknown ids. */
export function resolveSpeaker(speaker: Speaker, ship: ShipId): CharacterDef {
  const id =
    speaker === '@pilot' ? captainId(ship) : speaker === '@ai' ? STORY.aiId : speaker === '@villain' ? STORY.villainId : speaker;
  const c = CHAR_BY_ID.get(id);
  if (!c) throw new Error(`Unknown story speaker: ${speaker}`);
  return c;
}

/** A script line with its speaker resolved for a given ship. */
export interface ResolvedLine {
  /** Stable key for the line (used for history / dedupe). */
  key: string;
  speaker: CharacterDef;
  text: string;
  /** Ship whose captain speaks, or null when the speaker is not a captain. */
  ship: ShipId | null;
}

export function resolveLine(line: Line, ship: ShipId, key: string): ResolvedLine {
  const speaker = resolveSpeaker(line.speaker, ship);
  return { key, speaker, text: line.text, ship: shipOfCaptain(speaker.id) };
}

/** Seconds a line stays on screen: grows with length, clamped to [2.5, 6]. */
export function lineDuration(text: string): number {
  return Math.min(6, Math.max(2.5, 2.2 + text.length * 0.045));
}

/** Maps a simulation boss name ('The Warden', 'Void Heart') or kind to a BossId. */
export function bossIdFromName(name: string): BossId | null {
  const n = name.toLowerCase().replace(/[^a-z]/g, '');
  for (const id of BOSS_IDS) if (n.includes(id)) return id;
  return null;
}

// ---------------------------------------------------------------------------
// Shuffle bags: every line of a pool plays once before any repeats, and a
// refill never starts with the line that just played.

export class ShuffleBag {
  private order: number[] = [];
  private last = -1;

  constructor(readonly size: number) {}

  draw(rng: Rng): number {
    if (this.size <= 1) return 0;
    if (this.order.length === 0) {
      this.order = rng.shuffle(Array.from({ length: this.size }, (_, i) => i));
      // Draws pop from the end; avoid a back-to-back repeat across refills.
      if (this.order[this.order.length - 1] === this.last) {
        const a = this.order.length - 1;
        [this.order[0], this.order[a]] = [this.order[a]!, this.order[0]!];
      }
    }
    this.last = this.order.pop()!;
    return this.last;
  }
}

// ---------------------------------------------------------------------------
// Messages and rules

export interface CommsMessage {
  /** Unique per director instance. */
  id: string;
  /** Stable script key of the line, e.g. 'barks.levelup.2' or 'bosses.warden.intro.0'. */
  key: string;
  /** What produced it: a BarkTrigger, or 'sector:1', 'boss_intro:warden', 'overtime_credits', ... */
  source: string;
  speaker: CharacterDef;
  text: string;
  priority: CommsPriority;
  /** Seconds on screen. */
  duration: number;
  /** Ship whose captain is speaking (for per-player tinting in co-op), else null. */
  ship: ShipId | null;
}

export interface TriggerRule {
  priority: CommsPriority;
  /** Probability that an eligible event produces a bark. */
  chance: number;
  /** Seconds before the same trigger may bark again. */
  cooldown: number;
}

const C = PRIORITY.common;
const R = PRIORITY.rare;
const S = PRIORITY.story;

export const TRIGGER_RULES: Record<BarkTrigger, TriggerRule> = {
  run_start: { priority: S, chance: 1, cooldown: 0 },
  daily_start: { priority: S, chance: 1, cooldown: 0 },
  coop_start: { priority: S, chance: 1, cooldown: 0 },
  first_kill: { priority: C, chance: 1, cooldown: 0 },
  levelup: { priority: C, chance: 0.5, cooldown: 10 },
  evolve: { priority: R, chance: 1, cooldown: 3 },
  relic: { priority: R, chance: 1, cooldown: 3 },
  cache: { priority: R, chance: 1, cooldown: 6 },
  combo_x2: { priority: C, chance: 0.7, cooldown: 30 },
  combo_x5: { priority: R, chance: 1, cooldown: 20 },
  combo_x10: { priority: R, chance: 1, cooldown: 30 },
  milestone: { priority: R, chance: 1, cooldown: 15 },
  overdrive: { priority: R, chance: 1, cooldown: 20 },
  perfect: { priority: C, chance: 0.6, cooldown: 8 },
  low_hp: { priority: R, chance: 1, cooldown: 25 },
  heal: { priority: C, chance: 0.35, cooldown: 20 },
  shield_break: { priority: C, chance: 0.7, cooldown: 15 },
  elite: { priority: R, chance: 0.8, cooldown: 20 },
  surge: { priority: R, chance: 1, cooldown: 20 },
  boss_half: { priority: R, chance: 1, cooldown: 0 },
  new_best: { priority: R, chance: 1, cooldown: 0 },
  revive: { priority: R, chance: 1, cooldown: 0 },
  idle: { priority: C, chance: 1, cooldown: 30 },
  overtime: { priority: C, chance: 1, cooldown: 0 },
  coop_down: { priority: R, chance: 1, cooldown: 4 },
  coop_revive: { priority: R, chance: 1, cooldown: 4 },
};

export interface DirectorConfig {
  /** Gap (s) after any shown line before the next common bark may start. */
  commonGapMin: number;
  commonGapMax: number;
  /** Chance a trigger with a captain entry uses the captain's own line. */
  pilotMix: number;
  /** Seconds without a kill before the idle bark. */
  idleAfter: number;
  /** Seconds between ambient barks.overtime lines once Overtime has begun. */
  overtimeBarkEvery: number;
  /** Seconds a queued rare line may wait before it is dropped as stale. */
  rareTtl: number;
  /** Max rare lines waiting in the queue. */
  maxRareQueue: number;
  /** first_kill only barks within this many seconds of the run start. */
  firstKillWindow: number;
}

export const DEFAULT_DIRECTOR_CONFIG: DirectorConfig = {
  commonGapMin: 4,
  commonGapMax: 6,
  pilotMix: 0.5,
  idleAfter: 12,
  overtimeBarkEvery: 75,
  rareTtl: 8,
  maxRareQueue: 3,
  firstKillWindow: 40,
};

export interface RunStartOptions {
  /** Ship of each player; index = player index. Solo: one entry. */
  ships: readonly ShipId[];
  /** Index of the local player (whose captain voices generic '@pilot' lines). Default 0. */
  local?: number;
  daily?: boolean;
  /** Defaults to ships.length > 1. */
  coop?: boolean;
  /** Queue the sector 0 arrival + opening bark. Default true. */
  opening?: boolean;
}

/** App-level moments the simulation does not emit as GameEvents. */
export type StorySignal =
  | { kind: 'evolve'; player?: number }
  | { kind: 'relic'; player?: number }
  | { kind: 'cache'; player?: number }
  /** HP crossed below the low threshold (send once per crossing). */
  | { kind: 'lowHp'; player?: number }
  /** Boss HP crossed 50%. Defaults to the boss announced by the last 'boss' event. */
  | { kind: 'bossHalf'; boss?: BossId }
  /** Galaxy backdrop changed to sector `index` (0-3). Index 0 is covered by startRun. */
  | { kind: 'sector'; index: number }
  | { kind: 'overtime' }
  /** Force an idle bark attempt (the director also detects idle time itself). */
  | { kind: 'idle' }
  /** Co-op: `player` went down; `by` = the ally expected to help (optional). */
  | { kind: 'coopDown'; player: number; by?: number }
  /** Co-op: `player` was revived by `by` (optional). */
  | { kind: 'coopRevive'; player: number; by?: number };

interface Queued {
  msg: CommsMessage;
  expiresAt: number;
}

interface BarkContext {
  /** Ship whose captain voices '@pilot'. */
  pilotShip: ShipId;
  /** Ship whose captain's pilotBarks may be mixed in. */
  mixShip: ShipId;
  /** pilotBarks trigger to read for that captain (default: the bark's own trigger). */
  mixTrigger?: BarkTrigger;
}

const COMBO_TRIGGERS: Partial<Record<number, BarkTrigger>> = { 2: 'combo_x2', 5: 'combo_x5', 10: 'combo_x10' };

export class StoryDirector {
  readonly config: DirectorConfig;
  /** Seconds since construction (advanced only by update). */
  time = 0;
  /** Seconds since startRun. */
  runTime = 0;
  private running = false;
  private players: ShipId[] = ['spark'];
  private local = 0;
  private coop = false;

  private cur: CommsMessage | null = null;
  private curStart = 0;
  private queue: Queued[] = [];
  private shown: CommsMessage[] = [];
  private seq = 0;
  private nextCommonAt = 0;
  private cooldownUntil = new Map<BarkTrigger, number>();
  private bags = new Map<string, ShuffleBag>();

  private idleT = 0;
  private overtimeActive = false;
  private overtimeT = 0;
  private firstKillDone = false;
  private currentBoss: BossId | null = null;
  private bossIntroSeen = new Set<BossId>();
  private bossHalfSeen = new Set<BossId>();
  private bossDefeatSeen = new Set<BossId>();
  private sectorsSeen = new Set<number>();

  constructor(
    private readonly rng: Rng,
    config: Partial<DirectorConfig> = {},
  ) {
    this.config = { ...DEFAULT_DIRECTOR_CONFIG, ...config };
  }

  // ---- read side -----------------------------------------------------------

  /** The message on screen right now, if any. */
  get current(): CommsMessage | null {
    return this.cur;
  }

  /** Seconds the current message has been on screen. */
  get currentElapsed(): number {
    return this.cur ? this.time - this.curStart : 0;
  }

  /** Number of messages waiting behind the current one. */
  get pending(): number {
    return this.queue.length;
  }

  get isRunning(): boolean {
    return this.running;
  }

  /** Messages that started showing since the last call (oldest first). */
  consumeShown(): CommsMessage[] {
    const out = this.shown;
    this.shown = [];
    return out;
  }

  /** Captain ship for a player index (falls back to the local player). */
  shipOf(player?: number): ShipId {
    return this.players[player ?? this.local] ?? this.players[this.local] ?? 'spark';
  }

  // ---- run lifecycle -------------------------------------------------------

  startRun(opts: RunStartOptions): void {
    this.endRun();
    this.running = true;
    this.players = opts.ships.length > 0 ? [...opts.ships] : ['spark'];
    this.local = Math.min(Math.max(0, opts.local ?? 0), this.players.length - 1);
    this.coop = opts.coop ?? this.players.length > 1;
    this.runTime = 0;
    if (opts.opening === false) {
      this.sectorsSeen.add(0);
      return;
    }
    const opener: BarkTrigger = opts.daily ? 'daily_start' : this.coop ? 'coop_start' : 'run_start';
    this.queueSector(0);
    const line = this.pickBark(opener, this.ctx());
    this.enqueue(this.message(line, opener, PRIORITY.story));
  }

  /** Stops the run and clears every queued line (keeps shuffle bags, so the next run continues them). */
  endRun(): void {
    this.running = false;
    this.cur = null;
    this.queue = [];
    this.shown = [];
    this.cooldownUntil.clear();
    this.nextCommonAt = this.time;
    this.idleT = 0;
    this.overtimeActive = false;
    this.overtimeT = 0;
    this.firstKillDone = false;
    this.currentBoss = null;
    this.bossIntroSeen.clear();
    this.bossHalfSeen.clear();
    this.bossDefeatSeen.clear();
    this.sectorsSeen.clear();
  }

  /** Dismisses the current message (e.g. the player tapped it). */
  skipCurrent(): void {
    if (!this.cur) return;
    this.cur = null;
    this.advance();
  }

  update(dt: number): void {
    if (!(dt > 0)) return;
    this.time += dt;
    if (this.running) {
      this.runTime += dt;
      this.idleT += dt;
      if (this.idleT >= this.config.idleAfter && this.bark('idle', this.ctx())) this.idleT = 0;
      if (this.overtimeActive) {
        this.overtimeT += dt;
        if (this.overtimeT >= this.config.overtimeBarkEvery && this.bark('overtime', this.ctx())) this.overtimeT = 0;
      }
    }
    if (this.cur && this.time >= this.curStart + this.cur.duration) this.cur = null;
    if (!this.cur && this.queue.length > 0) this.advance();
  }

  // ---- inputs --------------------------------------------------------------

  onEvents(events: readonly GameEvent[], player?: number): void {
    for (const ev of events) this.onEvent(ev, player);
  }

  /** Feeds one simulation event. `player` = the co-op player it concerns (default: local). */
  onEvent(ev: GameEvent, player?: number): void {
    if (!this.running) return;
    const ctx = this.ctx(player);
    switch (ev.t) {
      case 'kill':
        this.idleT = 0;
        if (!this.firstKillDone && this.runTime <= this.config.firstKillWindow && this.bark('first_kill', ctx)) {
          this.firstKillDone = true;
        }
        break;
      case 'levelup':
        this.bark('levelup', ctx);
        break;
      case 'combo': {
        const trig = COMBO_TRIGGERS[ev.mult];
        if (trig) this.bark(trig, ctx);
        break;
      }
      case 'milestone':
        this.bark(ev.name === 'OVERDRIVE' ? 'overdrive' : 'milestone', ctx);
        break;
      case 'perfect':
        this.bark('perfect', ctx);
        break;
      case 'heal':
        this.bark('heal', ctx);
        break;
      case 'shieldbreak':
        this.bark('shield_break', ctx);
        break;
      case 'elite':
        this.bark('elite', ctx);
        break;
      case 'surge':
        this.bark('surge', ctx);
        break;
      case 'pickup':
        if (ev.kind === 'cache') this.bark('cache', ctx);
        break;
      case 'newbest':
        this.bark('new_best', ctx);
        break;
      case 'revive':
        this.bark('revive', ctx);
        break;
      case 'boss': {
        const id = bossIdFromName(ev.name);
        if (id) this.bossIntro(id);
        break;
      }
      case 'bossdead': {
        const id = bossIdFromName(ev.name);
        if (id) this.bossDefeat(id);
        break;
      }
      case 'victory':
        // The ending card takes over: drop chatter, keep any story line already playing.
        this.queue = this.queue.filter((q) => q.msg.priority === PRIORITY.story);
        if (this.cur && this.cur.priority !== PRIORITY.story) this.skipCurrent();
        break;
      default:
        break;
    }
  }

  signal(s: StorySignal): void {
    if (!this.running) return;
    switch (s.kind) {
      case 'evolve':
      case 'relic':
      case 'cache':
        this.bark(s.kind, this.ctx(s.player));
        break;
      case 'lowHp':
        this.bark('low_hp', this.ctx(s.player));
        break;
      case 'bossHalf': {
        const id = s.boss ?? this.currentBoss;
        if (!id) {
          this.bark('boss_half', this.ctx());
        } else if (!this.bossHalfSeen.has(id)) {
          this.bossHalfSeen.add(id);
          this.queueSequence(STORY.bosses[id].half, `bosses.${id}.half`, `boss_half:${id}`, this.shipOf());
        } else {
          this.bark('boss_half', this.ctx());
        }
        break;
      }
      case 'sector':
        this.queueSector(s.index);
        break;
      case 'overtime':
        if (this.overtimeActive) break;
        this.overtimeActive = true;
        this.overtimeT = 0;
        this.queueSequence(STORY.overtime, 'overtime', 'overtime_credits', this.shipOf());
        break;
      case 'idle':
        if (this.bark('idle', this.ctx())) this.idleT = 0;
        break;
      case 'coopDown': {
        const helper = s.by ?? this.otherPlayer(s.player);
        this.bark('coop_down', { pilotShip: this.shipOf(helper), mixShip: this.shipOf(s.player), mixTrigger: 'low_hp' });
        break;
      }
      case 'coopRevive': {
        const helper = s.by ?? this.otherPlayer(s.player);
        this.bark('coop_revive', { pilotShip: this.shipOf(helper), mixShip: this.shipOf(s.player), mixTrigger: 'revive' });
        break;
      }
    }
  }

  // ---- sequences -----------------------------------------------------------

  private bossIntro(id: BossId): void {
    this.currentBoss = id;
    if (!this.bossIntroSeen.has(id)) {
      this.bossIntroSeen.add(id);
      this.queueSequence(STORY.bosses[id].intro, `bosses.${id}.intro`, `boss_intro:${id}`, this.shipOf());
      return;
    }
    // Overtime rematch: a single line from the boss itself.
    this.queueOneOf(STORY.bosses[id].intro, `bosses.${id}.intro`, `boss_intro:${id}`, (l) => l.speaker === id);
  }

  private bossDefeat(id: BossId): void {
    if (this.currentBoss === id) this.currentBoss = null;
    if (!this.bossDefeatSeen.has(id)) {
      this.bossDefeatSeen.add(id);
      this.queueSequence(STORY.bosses[id].defeat, `bosses.${id}.defeat`, `boss_defeat:${id}`, this.shipOf());
      return;
    }
    this.queueOneOf(STORY.bosses[id].defeat, `bosses.${id}.defeat`, `boss_defeat:${id}`, () => true);
  }

  private queueSector(index: number): void {
    const sector = STORY.sectors[index];
    if (!sector || this.sectorsSeen.has(index)) return;
    this.sectorsSeen.add(index);
    this.queueSequence(sector.arrival, `sectors.${index}.arrival`, `sector:${index}`, this.shipOf());
  }

  private queueSequence(lines: readonly Line[], keyBase: string, source: string, ship: ShipId): void {
    lines.forEach((line, i) => this.enqueue(this.message(resolveLine(line, ship, `${keyBase}.${i}`), source, PRIORITY.story)));
  }

  private queueOneOf(lines: readonly Line[], keyBase: string, source: string, filter: (l: Line) => boolean): void {
    const idx = lines.map((l, i) => (filter(l) ? i : -1)).filter((i) => i >= 0);
    if (idx.length === 0) return;
    const i = idx[this.bag(`${keyBase}.repeat`, idx.length).draw(this.rng)]!;
    this.enqueue(this.message(resolveLine(lines[i]!, this.shipOf(), `${keyBase}.${i}`), source, PRIORITY.story));
  }

  // ---- barks ---------------------------------------------------------------

  private ctx(player?: number): BarkContext {
    const ship = this.shipOf(player);
    return { pilotShip: ship, mixShip: ship };
  }

  private otherPlayer(player: number): number {
    if (this.local !== player) return this.local;
    for (let i = 0; i < this.players.length; i++) if (i !== player) return i;
    return player;
  }

  private bag(key: string, size: number): ShuffleBag {
    let b = this.bags.get(key);
    if (!b || b.size !== size) {
      b = new ShuffleBag(size);
      this.bags.set(key, b);
    }
    return b;
  }

  /** Picks a line for a trigger: the captain's own pool (pilotMix chance) or the shared pool. */
  private pickBark(trigger: BarkTrigger, ctx: BarkContext): ResolvedLine {
    const mixTrigger = ctx.mixTrigger ?? trigger;
    const captain = captainId(ctx.mixShip);
    const own = STORY.pilotBarks[captain]?.[mixTrigger];
    if (own && own.length > 0 && this.rng.chance(this.config.pilotMix)) {
      const i = this.bag(`pilot.${captain}.${mixTrigger}`, own.length).draw(this.rng);
      return resolveLine(own[i]!, ctx.mixShip, `pilotBarks.${captain}.${mixTrigger}.${i}`);
    }
    const pool = STORY.barks[trigger];
    const i = this.bag(`barks.${trigger}`, pool.length).draw(this.rng);
    return resolveLine(pool[i]!, ctx.pilotShip, `barks.${trigger}.${i}`);
  }

  private canShowCommon(): boolean {
    return !this.cur && this.queue.length === 0 && this.time >= this.nextCommonAt;
  }

  /** Tries to play a bark for `trigger`. Returns true when a line was shown or queued. */
  private bark(trigger: BarkTrigger, ctx: BarkContext): boolean {
    const rule = TRIGGER_RULES[trigger];
    if (this.time < (this.cooldownUntil.get(trigger) ?? -Infinity)) return false;
    if (rule.priority === PRIORITY.common && !this.canShowCommon()) return false;
    if (rule.priority === PRIORITY.rare && this.rareBlocked()) return false;
    if (rule.chance < 1 && !this.rng.chance(rule.chance)) return false;
    this.enqueue(this.message(this.pickBark(trigger, ctx), trigger, rule.priority));
    if (rule.cooldown > 0) this.cooldownUntil.set(trigger, this.time + rule.cooldown);
    return true;
  }

  private rareBlocked(): boolean {
    let rare = 0;
    for (const q of this.queue) if (q.msg.priority === PRIORITY.rare) rare++;
    return rare >= this.config.maxRareQueue;
  }

  private message(line: ResolvedLine, source: string, priority: CommsPriority): CommsMessage {
    return {
      id: `c${++this.seq}`,
      key: line.key,
      source,
      speaker: line.speaker,
      text: line.text,
      priority,
      duration: lineDuration(line.text),
      ship: line.ship,
    };
  }

  // ---- queue ---------------------------------------------------------------

  private enqueue(msg: CommsMessage): void {
    const expiresAt = msg.priority === PRIORITY.rare ? this.time + this.config.rareTtl : Infinity;
    // Stable insert: after every queued item of equal or higher priority.
    let at = this.queue.length;
    while (at > 0 && this.queue[at - 1]!.msg.priority < msg.priority) at--;
    this.queue.splice(at, 0, { msg, expiresAt });
    // A strictly higher priority line may cut in; equal or lower never interrupts.
    if (this.cur && this.cur.priority < this.queue[0]!.msg.priority) this.cur = null;
    if (!this.cur) this.advance();
  }

  private advance(): void {
    this.queue = this.queue.filter((q) => q.expiresAt >= this.time);
    const next = this.queue.shift();
    if (!next) return;
    this.cur = next.msg;
    this.curStart = this.time;
    this.shown.push(next.msg);
    const gap = this.rng.range(this.config.commonGapMin, this.config.commonGapMax);
    this.nextCommonAt = Math.max(this.nextCommonAt, this.time + gap);
  }
}

// ---------------------------------------------------------------------------
// Results screen, ending and intro text

/** Stable key for a game-over quip (survives script reordering). */
export function quipKey(line: Line): string {
  return `q${hashString(`${line.speaker}|${line.text}`).toString(36)}`;
}

/**
 * Picks a results-screen quip, avoiding the last `avoidLast` keys in `history`
 * (newest last). Persist the returned key with pushQuipHistory.
 */
export function pickGameOverQuip(rng: Rng, ship: ShipId, history: readonly string[] = [], avoidLast = 8): ResolvedLine {
  const lines = STORY.gameOver;
  const avoid = new Set(history.slice(-Math.min(avoidLast, lines.length - 1)));
  let pool = lines.filter((l) => !avoid.has(quipKey(l)));
  if (pool.length === 0) pool = [...lines];
  const line = rng.pick(pool);
  return resolveLine(line, ship, quipKey(line));
}

/** Appends a shown quip key to a history list, keeping the newest `max`. */
export function pushQuipHistory(history: readonly string[], key: string, max = 16): string[] {
  return [...history.filter((k) => k !== key), key].slice(-max);
}

/** Results header line when `boss` destroyed the player. */
export function pickBossVictoryTaunt(rng: Rng, boss: BossId, ship: ShipId): ResolvedLine {
  const lines = STORY.bosses[boss].victoryTaunt;
  const i = rng.int(0, lines.length - 1);
  return resolveLine(lines[i]!, ship, `bosses.${boss}.victoryTaunt.${i}`);
}

/** Ending card at 10:00. */
export function victoryText(): { title: string; paragraphs: readonly string[] } {
  return STORY.victory;
}

/** Post-credits comms lines for Overtime (also played by the director on the 'overtime' signal). */
export function overtimeLines(ship: ShipId): ResolvedLine[] {
  return STORY.overtime.map((l, i) => resolveLine(l, ship, `overtime.${i}`));
}

/** Opening crawl (first launch, replayable from the Logbook). */
export function introText(): { title: string; paragraphs: readonly string[] } {
  return STORY.intro;
}

/** Galaxy name/subtitle for sector 0-3 (clamped). */
export function sectorInfo(index: number): { name: string; subtitle: string } {
  const s = STORY.sectors[Math.min(STORY.sectors.length - 1, Math.max(0, Math.floor(index)))]!;
  return { name: s.name, subtitle: s.subtitle };
}

/** Class, name and blurb for a ship's vessel card. */
export function vesselInfo(ship: ShipId): { className: string; shipName: string; blurb: string; captain: CharacterDef } {
  return { ...STORY.vessels[ship], captain: resolveSpeaker('@pilot', ship) };
}
