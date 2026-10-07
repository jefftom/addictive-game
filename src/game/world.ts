import { SpatialGrid } from '../core/grid';
import { TAU, clamp, damp, ease } from '../core/math';
import { Rng } from '../core/rng';
import { comboMult, comboTier, milestoneAt } from './combo';
import {
  CAM_MARGIN,
  GHOST_SPEED,
  LEASH_EDGE,
  MAX_PLAYERS,
  REVIVE_DECAY,
  REVIVE_GROWTH,
  REVIVE_HP,
  REVIVE_INVULN,
  REVIVE_RADIUS,
  REVIVE_TIME,
  REVIVE_TIME_MAX,
  SPAWN_CLEARANCE,
  SPAWN_RETRIES,
  SPAWN_SPACING,
  ZOOM_IN_RATE,
  ZOOM_MAX,
  ZOOM_OUT_RATE,
  coopScaling,
  type CoopScaling,
} from './content/coop';
import { BOSS_KINDS, BOSS_SCHEDULE, ENEMIES, VICTORY_TIME } from './content/enemies';
import { SHIPS } from './content/ships';
import { Director } from './director';
import { updateEnemies, separateEnemies } from './enemyai';
import { computeStats, xpForLevel } from './stats';
import type {
  Beam,
  Bullet,
  ControlInput,
  Enemy,
  EnemyKind,
  GameEvent,
  Mine,
  PassiveId,
  Pickup,
  PickupKind,
  Player,
  PlayerRunStats,
  Projectile,
  RelicId,
  Ring,
  RunConfig,
  ShipId,
  Stats,
  WeaponId,
  WeaponInstance,
} from './types';
import { updateWeapons } from './weapons';

export const DASH_TIME = 0.17;
export const DASH_SPEED = 1150;
export const DASH_BASE_DAMAGE = 30;
export const PLAYER_RADIUS = 11;
/** Solo enemy cap (co-op uses `world.maxEnemies`). */
export const MAX_ENEMIES = 420;
export const MAX_PICKUPS = 450;

export interface RunStats {
  kills: number;
  elites: number;
  bossesKilled: EnemyKind[];
  dashKills: number;
  perfects: number;
  gems: number;
  hitsTaken: number;
  damageTaken: number;
  maxCombo: number;
  evolutions: number;
  coresCollected: number;
  longestNoHit: number;
  maxWeapons: number;
}

export interface Build {
  weapons: WeaponInstance[];
  passives: Partial<Record<PassiveId, number>>;
  relics: RelicId[];
}

/** A pilot: body, kinematics, stats and build. Index in `world.players` = pid. */
export interface PlayerState extends Player {
  stats: Stats;
  build: Build;
  rerolls: number;
  pendingCaches: number;
  run: PlayerRunStats;
}

/** One pick (level-up or cache) for one pilot. */
export interface PickRequest {
  pid: number;
  cache: boolean;
}

const NO_INPUT: ControlInput = { mx: 0, my: 0, dash: false };

export interface WorldOptions {
  /** Personal best score; crossing it emits a `newbest` event. */
  bestScore?: number;
}

export class World {
  readonly cfg: RunConfig;
  /** Spawn timeline stream (seeded; identical for everyone on a Daily Run). */
  readonly spawnRng: Rng;
  /** Upgrade offer stream (seeded). */
  readonly lootRng: Rng;
  /** Combat randomness (crits, drops, spread). */
  readonly rng: Rng;
  /** Spawn positions (player-relative, so kept apart from the seeded timeline). */
  readonly posRng: Rng;

  time = 0;
  /** Every pilot, fixed for the run; index = pid. */
  readonly players: PlayerState[];
  /** players.length > 1 */
  readonly coop: boolean;
  /** COOP_SCALING row for the player count. */
  readonly scaling: CoopScaling;
  /** Live (non-boss) enemy cap. */
  readonly maxEnemies: number;
  /** Camera zoom-out factor owned by the sim (1 forever in solo). */
  zoom = 1;
  /** pids still to pick in the current team level round. */
  levelRound: number[] = [];

  enemies: Enemy[] = [];
  projectiles: Projectile[] = [];
  bullets: Bullet[] = [];
  pickups: Pickup[] = [];
  rings: Ring[] = [];
  mines: Mine[] = [];
  beams: Beam[] = [];
  /** Orbit blade positions this tick (for rendering). */
  blades: { x: number; y: number; r: number; pid: number }[] = [];
  events: GameEvent[] = [];

  readonly grid = new SpatialGrid(64, 2048);
  readonly queryBuf: number[] = [];

  level = 1;
  xp = 0;
  xpNext: number;
  pendingLevelUps = 0;

  combo = 0;
  comboTimer = 0;
  comboTierIdx = 0;
  overdriveT = 0;

  score = 0;
  private scoreTimeAcc = 0;
  private bestScore: number;
  private newBestAnnounced = false;

  /** Base (zoom 1) half-size of the visible area in world units (set by the app). */
  viewHalfW = 700;
  viewHalfH = 400;

  boss: Enemy | null = null;
  readonly director: Director;
  victory = false;
  gameOver = false;

  /** Presentation requests (read and cleared by the app loop). */
  hitstop = 0;
  slowmoT = 0;
  slowmoScale = 1;

  runStats: RunStats = {
    kills: 0,
    elites: 0,
    bossesKilled: [],
    dashKills: 0,
    perfects: 0,
    gems: 0,
    hitsTaken: 0,
    damageTaken: 0,
    maxCombo: 0,
    evolutions: 0,
    coresCollected: 0,
    longestNoHit: 0,
    maxWeapons: 1,
  };
  private noHitT = 0;
  private nextId = 1;
  private nextFxId = 1;
  /** Global dash id sequence, so two players' dashes never share an id. */
  private dashSeq = 0;
  private readonly centerBuf = { x: 0, y: 0 };
  private readonly spanBuf = { x: 0, y: 0 };
  private readonly spawnBuf = { x: 0, y: 0 };
  /** Each pilot's position before this tick's movement (leash reference). */
  private readonly preX = new Float64Array(MAX_PLAYERS);
  private readonly preY = new Float64Array(MAX_PLAYERS);
  private readonly velBuf = { x: 0, y: 0 };

  constructor(cfg: RunConfig, opts: WorldOptions = {}) {
    this.cfg = cfg;
    const root = new Rng(cfg.seed);
    this.spawnRng = root.fork(1);
    this.lootRng = root.fork(2);
    this.rng = root.fork(3);
    this.posRng = root.fork(4);
    this.bestScore = opts.bestScore ?? 0;
    this.scaling = coopScaling(cfg.players.length);
    this.maxEnemies = this.scaling.maxEnemies;
    this.xpNext = Math.round(xpForLevel(1) * this.scaling.xpReq);
    this.director = new Director(cfg);
    const n = cfg.players.length;
    this.coop = n > 1;
    this.players = cfg.players.map((pc, pid) => this.makePlayer(pid, pc.ship, n));
    for (const p of this.players) {
      this.addWeapon(SHIPS[p.ship].weapon, p.pid);
      this.refreshStats(p.pid);
      p.hp = p.stats.maxHp;
      p.dashCharges = p.stats.dashCharges;
      p.rerolls = p.stats.rerolls;
    }
  }

  private makePlayer(pid: number, ship: ShipId, n: number): PlayerState {
    return {
      pid,
      ship,
      x: n > 1 ? (pid - (n - 1) / 2) * SPAWN_SPACING : 0,
      y: 0,
      vx: 0,
      vy: 0,
      r: PLAYER_RADIUS,
      hp: 100,
      facingX: 1,
      facingY: 0,
      invuln: 1,
      hurtT: 0,
      dashT: 0,
      dashDirX: 1,
      dashDirY: 0,
      dashCharges: 1,
      dashRecharge: 0,
      dashId: 0,
      dashBuffer: 0,
      perfectThisDash: false,
      shieldT: 0,
      shieldReady: false,
      alive: true,
      revivesUsed: 0,
      downed: false,
      reviveT: 0,
      downs: 0,
      stats: computeStats(this.cfg, {}, [], ship),
      build: { weapons: [], passives: {}, relics: [] },
      rerolls: 0,
      pendingCaches: 0,
      run: {
        kills: 0,
        dashKills: 0,
        perfects: 0,
        damage: 0,
        hitsTaken: 0,
        damageTaken: 0,
        gems: 0,
        downs: 0,
        revivesGiven: 0,
        evolutions: 0,
        maxWeapons: 0,
      },
    };
  }

  // ───────────────────────────── P1 aliases ─────────────────────────────
  // P1 aliases for tests, debug and the e2e harness. Production code must use players[pid].
  // (tests/no-p1-alias.test.ts allow-lists only this block.)

  get player(): PlayerState { return this.players[0]!; }
  get stats(): Stats { return this.players[0]!.stats; }
  get build(): Build { return this.players[0]!.build; }
  get rerolls(): number { return this.players[0]!.rerolls; }
  set rerolls(v: number) { this.players[0]!.rerolls = v; }
  get pendingCaches(): number { return this.players[0]!.pendingCaches; }
  set pendingCaches(v: number) { this.players[0]!.pendingCaches = v; }

  // ───────────────────────────── team helpers ─────────────────────────────

  /** Alive and not downed: can move, shoot, collect and be targeted. */
  isUp(p: Player): boolean {
    return p.alive && !p.downed;
  }

  /** Up players (allocates; not for hot loops). */
  alivePlayers(): PlayerState[] {
    return this.players.filter((p) => this.isUp(p));
  }

  /** Alive players, including downed ghosts. */
  presentPlayers(): PlayerState[] {
    return this.players.filter((p) => p.alive);
  }

  /**
   * Bounding-box midpoint of present players (ghosts included). Solo returns
   * the player's position. Returns a reused scratch object: copy the values.
   */
  teamCenter(): Readonly<{ x: number; y: number }> {
    const c = this.centerBuf;
    if (!this.coop) {
      const p = this.players[0]!;
      c.x = p.x;
      c.y = p.y;
      return c;
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of this.players) {
      if (!p.alive) continue;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    if (minX === Infinity) {
      const p = this.players[0]!;
      c.x = p.x;
      c.y = p.y;
    } else {
      c.x = (minX + maxX) / 2;
      c.y = (minY + maxY) / 2;
    }
    return c;
  }

  /** Mean velocity of present players. Solo: the player's velocity. Reused scratch object. */
  teamVelocity(): Readonly<{ x: number; y: number }> {
    const v = this.velBuf;
    if (!this.coop) {
      const p = this.players[0]!;
      v.x = p.vx;
      v.y = p.vy;
      return v;
    }
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const p of this.players) {
      if (!p.alive) continue;
      sx += p.vx;
      sy += p.vy;
      n++;
    }
    v.x = n > 0 ? sx / n : 0;
    v.y = n > 0 ? sy / n : 0;
    return v;
  }

  /** Effective (zoomed) half extents of the view in world units. */
  effHalfW(): number {
    return this.viewHalfW * this.zoom;
  }

  effHalfH(): number {
    return this.viewHalfH * this.zoom;
  }

  nearestUpPlayer(x: number, y: number): PlayerState | null {
    let best: PlayerState | null = null;
    let bestD = Infinity;
    for (const p of this.players) {
      if (!this.isUp(p)) continue;
      const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  /** True if any pilot owns the relic (team-wide relics such as Chrono Field). */
  teamHasRelic(id: RelicId): boolean {
    for (const p of this.players) if (p.build.relics.includes(id)) return true;
    return false;
  }

  /** Team combo window: the best Combo Engine on the team counts. */
  comboWindow(): number {
    let w = 0;
    for (const p of this.players) if (p.stats.comboWindow > w) w = p.stats.comboWindow;
    return w;
  }

  // ───────────────────────────── picks (level rounds & caches) ─────────────────────────────

  hasPendingPicks(): boolean {
    if (this.pendingLevelUps > 0 || this.levelRound.length > 0) return true;
    for (const p of this.players) if (p.pendingCaches > 0) return true;
    return false;
  }

  /**
   * Starts the next pick and consumes its counter. Caches go first (P1→P4);
   * then one team level-up opens a round where every pilot picks once in pid
   * order (downed pilots included, so nobody falls permanently behind).
   */
  beginPick(): PickRequest | null {
    for (const p of this.players) {
      if (p.pendingCaches > 0) {
        p.pendingCaches--;
        return { pid: p.pid, cache: true };
      }
    }
    if (this.levelRound.length === 0 && this.pendingLevelUps > 0) {
      this.pendingLevelUps--;
      for (const p of this.players) this.levelRound.push(p.pid);
    }
    const pid = this.levelRound.shift();
    return pid === undefined ? null : { pid, cache: false };
  }

  /** Picks this pilot still has queued (caches + remaining level picks), for HUD chips. */
  pendingPicksFor(pid: number): number {
    const p = this.players[pid];
    if (!p) return 0;
    let n = p.pendingCaches + this.pendingLevelUps;
    if (this.levelRound.includes(pid)) n++;
    return n;
  }

  // ───────────────────────────── build & stats ─────────────────────────────

  addWeapon(id: WeaponId, pid = 0): void {
    const p = this.players[pid]!;
    const build = p.build;
    if (build.weapons.some((w) => w.id === id)) return;
    build.weapons.push({ id, level: 1, evolved: false, timer: 0.4, phase: 0 });
    this.runStats.maxWeapons = Math.max(this.runStats.maxWeapons, build.weapons.length);
    p.run.maxWeapons = Math.max(p.run.maxWeapons, build.weapons.length);
  }

  hasRelic(id: RelicId, pid = 0): boolean {
    return this.players[pid]!.build.relics.includes(id);
  }

  refreshStats(pid = 0): void {
    const p = this.players[pid]!;
    const prev = p.stats;
    p.stats = computeStats(this.cfg, p.build.passives, p.build.relics, p.ship);
    const hpGain = p.stats.maxHp - prev.maxHp;
    if (hpGain > 0 && !p.downed) p.hp += hpGain;
    const chargeGain = p.stats.dashCharges - prev.dashCharges;
    if (chargeGain > 0) p.dashCharges += chargeGain;
    p.hp = p.downed ? 0 : Math.min(p.hp, p.stats.maxHp);
  }

  /** Multiplier applied to a pilot's weapon cooldowns right now. */
  cooldownMult(p: PlayerState = this.players[0]!): number {
    let m = p.stats.cooldown;
    if (this.overdriveT > 0) m /= 1.5;
    if (this.combo >= 40 && this.hasRelic('fever', p.pid)) m /= 1.35;
    return m;
  }

  moveSpeed(p: PlayerState = this.players[0]!): number {
    let s = p.stats.speed;
    if (this.combo >= 40 && this.hasRelic('fever', p.pid)) s *= 1.15;
    if (this.cfg.daily === 'hyper') s *= 1.1;
    return s;
  }

  scoreMult(): number {
    return this.cfg.hardMode ? 1.5 : 1;
  }

  // ───────────────────────────── main update ─────────────────────────────

  /**
   * Advances the simulation. A single `ControlInput` drives P1 (other pilots
   * get no input); an array gives one input per pid.
   */
  update(dt: number, input: ControlInput | readonly ControlInput[]): void {
    if (this.gameOver) return;
    this.time += dt;
    if (this.overdriveT > 0) this.overdriveT -= dt;

    this.director.update(this, dt);
    const many = Array.isArray(input);
    let anyUp = false;
    if (this.coop) {
      for (const p of this.players) {
        this.preX[p.pid] = p.x;
        this.preY[p.pid] = p.y;
      }
    }
    for (const p of this.players) {
      const inp = many ? ((input as readonly ControlInput[])[p.pid] ?? NO_INPUT) : p.pid === 0 ? (input as ControlInput) : NO_INPUT;
      this.updatePlayer(p, dt, inp);
      if (this.isUp(p)) anyUp = true;
    }
    if (anyUp) {
      this.noHitT += dt;
      if (this.noHitT > this.runStats.longestNoHit) this.runStats.longestNoHit = this.noHitT;
    }
    if (this.coop) {
      this.applyLeash();
      this.updateRevives(dt);
      this.updateZoom(dt);
    }
    updateEnemies(this, dt);
    const c = this.teamCenter();
    this.grid.build(this.enemies, c.x, c.y);
    separateEnemies(this);
    updateWeapons(this, dt);
    this.updateProjectiles(dt);
    this.updateRings(dt);
    this.updateMines(dt);
    this.updateBeams(dt);
    this.updateBullets(dt);
    this.playerContacts();
    this.updatePickups(dt);
    this.updateCombo(dt);

    this.scoreTimeAcc += dt;
    while (this.scoreTimeAcc >= 1) {
      this.scoreTimeAcc -= 1;
      this.addScore(5);
    }

    if (!this.victory && this.time >= VICTORY_TIME) {
      this.victory = true;
      this.events.push({ t: 'victory' });
    }
    this.cleanup();
  }

  // ───────────────────────────── player ─────────────────────────────

  private updatePlayer(p: PlayerState, dt: number, input: ControlInput): void {
    const st = p.stats;
    if (!p.alive) return;

    if (p.downed) {
      // Ghost: drift slowly toward help. No dash, regen, shield or attacks.
      p.dashBuffer = 0;
      p.dashT = 0;
      const speed = this.moveSpeed(p) * GHOST_SPEED;
      const k = damp(16, dt);
      p.vx += (input.mx * speed - p.vx) * k;
      p.vy += (input.my * speed - p.vy) * k;
      const mag = Math.hypot(input.mx, input.my);
      if (mag > 0.15) {
        p.facingX = input.mx / mag;
        p.facingY = input.my / mag;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.hurtT > 0) p.hurtT -= dt;
      return;
    }

    if (input.dash) p.dashBuffer = 0.15;
    else p.dashBuffer -= dt;

    // Dash recharge.
    if (p.dashCharges < st.dashCharges) {
      if (p.dashRecharge === 0) p.dashRecharge = st.dashCooldown;
      p.dashRecharge -= dt;
      this.settleDashRecharge(p);
    } else {
      p.dashRecharge = 0;
    }

    const mag = Math.hypot(input.mx, input.my);
    if (mag > 0.15) {
      p.facingX = input.mx / mag;
      p.facingY = input.my / mag;
    }

    // Start a dash.
    if (p.dashBuffer > 0 && p.dashT <= 0 && p.dashCharges >= 1) {
      let dx = p.facingX;
      let dy = p.facingY;
      if (mag <= 0.15) {
        const target = this.nearestEnemy(p.x, p.y, 400);
        if (target) {
          const d = Math.hypot(target.x - p.x, target.y - p.y) || 1;
          dx = (target.x - p.x) / d;
          dy = (target.y - p.y) / d;
        }
      }
      p.dashDirX = dx;
      p.dashDirY = dy;
      p.dashT = DASH_TIME;
      p.dashCharges--;
      // Arm the recharge now so a perfect dash on this same tick can refund it.
      if (p.dashRecharge <= 0) p.dashRecharge = st.dashCooldown;
      p.dashId = ++this.dashSeq;
      p.perfectThisDash = false;
      p.dashBuffer = 0;
      this.events.push({ t: 'dash', x: p.x, y: p.y, dx, dy, pid: p.pid });
    }

    if (p.dashT > 0) {
      p.vx = p.dashDirX * DASH_SPEED;
      p.vy = p.dashDirY * DASH_SPEED;
      p.dashT -= dt;
      if (p.dashT <= 0) {
        p.invuln = Math.max(p.invuln, 0.12);
        p.vx *= 0.25;
        p.vy *= 0.25;
        if (SHIPS[p.ship].dashNova) {
          this.addRing(p.x, p.y, 150 * st.area, 0.3, 26 * st.dashDamage, 320, false, '#6fd2ff', 0, p.pid);
        }
      }
    } else {
      const speed = this.moveSpeed(p);
      const k = damp(16, dt);
      p.vx += (input.mx * speed - p.vx) * k;
      p.vy += (input.my * speed - p.vy) * k;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    if (p.invuln > 0) p.invuln -= dt;
    if (p.hurtT > 0) p.hurtT -= dt;
    if (st.regen > 0 && p.hp < st.maxHp) p.hp = Math.min(st.maxHp, p.hp + st.regen * dt);

    if (this.hasRelic('shield', p.pid) && !p.shieldReady) {
      p.shieldT += dt;
      if (p.shieldT >= 20) {
        p.shieldReady = true;
        p.shieldT = 0;
      }
    }
  }

  isPlayerInvulnerable(pid = 0): boolean {
    const p = this.players[pid]!;
    return p.dashT > 0 || p.invuln > 0;
  }

  private perfectDash(p: PlayerState): void {
    if (p.perfectThisDash) return;
    p.perfectThisDash = true;
    this.runStats.perfects++;
    p.run.perfects++;
    if (p.dashCharges < p.stats.dashCharges) {
      p.dashRecharge -= p.stats.dashCooldown * 0.5;
      this.settleDashRecharge(p);
    }
    this.addCombo(3);
    // A milder slow-mo in co-op so one pilot's perfects don't stutter everyone.
    if (this.coop) this.slowmo(0.6, 0.15);
    else this.slowmo(0.35, 0.22);
    this.events.push({ t: 'perfect', x: p.x, y: p.y, pid: p.pid });
  }

  /** Converts a non-positive recharge timer into charges, carrying any remainder. */
  private settleDashRecharge(p: PlayerState): void {
    const st = p.stats;
    while (p.dashRecharge <= 0 && p.dashCharges < st.dashCharges) {
      p.dashCharges++;
      this.events.push({ t: 'dashready', pid: p.pid });
      p.dashRecharge = p.dashCharges < st.dashCharges ? p.dashRecharge + st.dashCooldown : 0;
    }
  }

  private playerContacts(): void {
    const buf = this.queryBuf;
    for (const p of this.players) {
      if (!this.isUp(p)) continue;
      const dashing = p.dashT > 0;
      const n = this.grid.query(p.x, p.y, p.r + 72, buf);
      for (let k = 0; k < n; k++) {
        if (!this.isUp(p)) break;
        const e = this.enemies[buf[k]!]!;
        if (e.dead) continue;
        const dx = e.x - p.x;
        const dy = e.y - p.y;
        const reach = dashing ? e.r + p.r + 8 : e.r + p.r * 0.8;
        if (dx * dx + dy * dy > reach * reach) continue;
        if (dashing) {
          if (e.dashHitId[p.pid] !== p.dashId) {
            e.dashHitId[p.pid] = p.dashId;
            this.perfectDash(p);
            const [dmg, crit] = this.rollDamage(DASH_BASE_DAMAGE * p.stats.dashDamage, p.pid);
            this.damageEnemy(e, dmg, crit, p.dashDirX, p.dashDirY, 420, true, p.pid);
          }
        } else if (e.spawnT <= 0) {
          this.hurtPlayer(e.damage, e.x, e.y, p.pid);
        }
      }
    }
  }

  hurtPlayer(raw: number, sx: number, sy: number, pid = 0): void {
    const p = this.players[pid]!;
    if (!this.isUp(p) || this.isPlayerInvulnerable(pid)) return;
    if (p.shieldReady) {
      p.shieldReady = false;
      p.shieldT = 0;
      p.invuln = 0.8;
      this.events.push({ t: 'shieldbreak', x: p.x, y: p.y, pid });
      return;
    }
    const dmg = Math.max(1, raw - p.stats.armor);
    p.hp -= dmg;
    p.invuln = 0.75;
    p.hurtT = 0.3;
    this.runStats.hitsTaken++;
    this.runStats.damageTaken += dmg;
    p.run.hitsTaken++;
    p.run.damageTaken += dmg;
    this.noHitT = 0;
    const d = Math.hypot(p.x - sx, p.y - sy) || 1;
    p.vx += ((p.x - sx) / d) * 260;
    p.vy += ((p.y - sy) / d) * 260;
    if (this.combo > 0) {
      this.combo = Math.floor(this.combo / 2);
      this.comboTierIdx = comboTier(this.combo);
    }
    this.events.push({ t: 'hurt', dmg, x: p.x, y: p.y, pid });

    if (p.hp <= 0) {
      if (p.revivesUsed < p.stats.revives) {
        // Self-revives (Second Wind, Revival) are spent first.
        p.revivesUsed++;
        p.hp = p.stats.maxHp * 0.5;
        p.invuln = 2.5;
        this.addRing(p.x, p.y, 420, 0.5, 200, 700, false, '#ffffff', 0, pid);
        for (const b of this.bullets) b.dead = true;
        this.slowmo(0.3, 0.8);
        this.events.push({ t: 'revive', x: p.x, y: p.y, pid });
      } else if (this.coop && this.players.some((q) => q !== p && this.isUp(q))) {
        this.downPlayer(p);
      } else {
        this.teamWipe(p);
      }
    }
  }

  /** Co-op: the pilot becomes a ghost until a teammate revives them. */
  private downPlayer(p: PlayerState): void {
    p.hp = 0;
    p.downed = true;
    p.downs++;
    p.run.downs++;
    p.reviveT = 0;
    p.dashT = 0;
    p.dashBuffer = 0;
    p.vx *= 0.2;
    p.vy *= 0.2;
    this.hitstop = Math.max(this.hitstop, 0.06);
    this.slowmo(0.4, 0.5);
    this.events.push({ t: 'downed', pid: p.pid, x: p.x, y: p.y });
    let up: PlayerState | null = null;
    let nUp = 0;
    for (const q of this.players) {
      if (this.isUp(q)) {
        nUp++;
        up = q;
      }
    }
    if (nUp === 1 && up) this.events.push({ t: 'laststand', pid: up.pid });
  }

  /** Seconds a teammate must stay close to revive this pilot (grows with each down). */
  reviveNeed(p: Player): number {
    return Math.min(REVIVE_TIME_MAX, REVIVE_TIME * (1 + REVIVE_GROWTH * Math.max(0, p.downs - 1)));
  }

  private updateRevives(dt: number): void {
    const r2 = REVIVE_RADIUS * REVIVE_RADIUS;
    for (const p of this.players) {
      if (!p.alive || !p.downed) continue;
      let by = -1;
      for (const q of this.players) {
        if (q === p || !this.isUp(q)) continue;
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        if (dx * dx + dy * dy <= r2) {
          by = q.pid;
          break;
        }
      }
      p.reviveT = by >= 0 ? p.reviveT + dt : Math.max(0, p.reviveT - dt * REVIVE_DECAY);
      if (by >= 0 && p.reviveT >= this.reviveNeed(p)) {
        p.downed = false;
        p.reviveT = 0;
        p.hp = p.stats.maxHp * REVIVE_HP;
        p.invuln = REVIVE_INVULN;
        p.dashCharges = p.stats.dashCharges;
        p.dashRecharge = 0;
        // Shove the crowd back so the revived pilot gets a breath.
        this.addRing(p.x, p.y, 220, 0.4, 40, 600, false, '#ffffff', 0, p.pid);
        this.players[by]!.run.revivesGiven++;
        this.events.push({ t: 'revived', pid: p.pid, by, x: p.x, y: p.y });
      }
    }
  }

  /**
   * Largest allowed span of the present players' bounding box (leash), per
   * axis. Returns a shared scratch object: copy the values.
   */
  maxSpan(): Readonly<{ x: number; y: number }> {
    const s = this.spanBuf;
    s.x = 2 * (this.viewHalfW * ZOOM_MAX - LEASH_EDGE);
    s.y = 2 * (this.viewHalfH * ZOOM_MAX - LEASH_EDGE);
    return s;
  }

  /**
   * Co-op leash: keeps the present players' bounding box within the max-zoom
   * view. It blocks a pilot at the edge and never drags anyone else.
   *
   * Each pilot is first clamped against where the others stood before this
   * tick's movement, so a pilot walking away is stopped instead of towing the
   * rest. A second pass against current positions is a safety net for the rare
   * tick where two pilots move apart at once.
   */
  private applyLeash(): void {
    const span = this.maxSpan();
    const sx = span.x;
    const sy = span.y;
    this.leashPass(sx, sy, true);
    this.leashPass(sx, sy, false);
  }

  private leashPass(sx: number, sy: number, before: boolean): void {
    for (const p of this.players) {
      if (!p.alive) continue;
      let oMinX = Infinity;
      let oMaxX = -Infinity;
      let oMinY = Infinity;
      let oMaxY = -Infinity;
      for (const q of this.players) {
        if (q === p || !q.alive) continue;
        const qx = before ? this.preX[q.pid]! : q.x;
        const qy = before ? this.preY[q.pid]! : q.y;
        if (qx < oMinX) oMinX = qx;
        if (qx > oMaxX) oMaxX = qx;
        if (qy < oMinY) oMinY = qy;
        if (qy > oMaxY) oMaxY = qy;
      }
      if (oMinX === Infinity) continue;
      const loX = oMaxX - sx;
      const hiX = oMinX + sx;
      if (loX > hiX) p.x = (loX + hiX) / 2;
      else if (p.x < loX) {
        p.x = loX;
        if (p.vx < 0) p.vx = 0;
      } else if (p.x > hiX) {
        p.x = hiX;
        if (p.vx > 0) p.vx = 0;
      }
      const loY = oMaxY - sy;
      const hiY = oMinY + sy;
      if (loY > hiY) p.y = (loY + hiY) / 2;
      else if (p.y < loY) {
        p.y = loY;
        if (p.vy < 0) p.vy = 0;
      } else if (p.y > hiY) {
        p.y = hiY;
        if (p.vy > 0) p.vy = 0;
      }
    }
  }

  /** Co-op zoom: fit every present pilot, out fast, in slowly, capped at ZOOM_MAX. */
  private updateZoom(dt: number): void {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of this.players) {
      if (!p.alive) continue;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    if (minX === Infinity) return;
    const wb = this.viewHalfW;
    const hb = this.viewHalfH;
    const hx = (maxX - minX) / 2;
    const hy = (maxY - minY) / 2;
    const zFit = Math.max((hx + CAM_MARGIN) / wb, (hy + CAM_MARGIN) / hb);
    const zTarget = clamp(zFit, 1, ZOOM_MAX);
    this.zoom += (zTarget - this.zoom) * damp(zTarget > this.zoom ? ZOOM_OUT_RATE : ZOOM_IN_RATE, dt);
    // Hard guarantee: a lagging zoom never leaves a pilot outside the view.
    const zNeed = Math.max((hx + LEASH_EDGE) / wb, (hy + LEASH_EDGE) / hb);
    this.zoom = clamp(Math.max(this.zoom, zNeed), 1, ZOOM_MAX);
  }

  /** Ends the run: every pilot is out. */
  private teamWipe(p: PlayerState): void {
    p.hp = 0;
    for (const q of this.players) q.alive = false;
    this.gameOver = true;
    this.events.push({ t: 'death', x: p.x, y: p.y, pid: p.pid });
  }

  heal(amount: number, pid = 0): void {
    const p = this.players[pid]!;
    if (p.downed) return;
    const before = p.hp;
    p.hp = Math.min(p.stats.maxHp, p.hp + amount);
    if (p.hp > before) this.events.push({ t: 'heal', amount: p.hp - before, pid });
  }

  // ───────────────────────────── enemies ─────────────────────────────

  spawnEnemy(kind: EnemyKind, x: number, y: number, elite = false): Enemy | null {
    const def = ENEMIES[kind];
    const isBoss = BOSS_KINDS.has(kind);
    if (!isBoss && this.enemies.length >= this.maxEnemies) return null;
    const d = this.director;
    const t = this.time;
    const daily = this.cfg.daily;
    let hp = def.hp * (isBoss ? d.bossHpMult() : d.hpMult(t));
    let r = def.r;
    let speed = def.speed * (isBoss ? 1 : d.speedMult(t));
    let xp = def.xp;
    let score = def.score;
    if (elite) {
      hp *= 6;
      r *= 1.35;
      speed *= 0.9;
      xp *= 8;
      score *= 10;
    }
    if (daily === 'glass') hp *= 0.5;
    if (daily === 'rich') {
      hp *= 1.3;
      xp *= 2;
    }
    if (daily === 'giants' && !isBoss) {
      hp *= 2.5;
      r *= 1.4;
      xp *= 2;
      score *= 2;
    }
    if (daily === 'hyper') speed *= 1.2;
    if (this.cfg.hardMode) {
      hp *= 1.4;
      speed *= 1.12;
    }
    const e: Enemy = {
      id: this.nextId++,
      kind,
      x,
      y,
      kx: 0,
      ky: 0,
      r,
      hp,
      maxHp: hp,
      speed,
      damage: def.damage * d.dmgMult(t) * (this.cfg.hardMode ? 1.25 : 1),
      xp,
      score,
      mass: def.mass * (elite ? 3 : 1),
      elite,
      boss: isBoss,
      flash: 0,
      angle: 0,
      spin: (this.rng.next() - 0.5) * 2,
      state: 0,
      stateT: this.rng.range(0.5, 2),
      aimX: 0,
      aimY: 0,
      fireT: this.rng.range(1, 2.5),
      summonT: 6,
      // -1 in co-op: no current target yet, so the first pick is the nearest pilot.
      tgt: this.coop ? -1 : 0,
      orbitHitT: new Array<number>(this.players.length).fill(-99),
      dashHitId: new Array<number>(this.players.length).fill(-1),
      spawnT: isBoss ? 0.8 : 0.35,
      dead: false,
    };
    this.enemies.push(e);
    if (isBoss) {
      this.boss = e;
    }
    if (elite) this.events.push({ t: 'elite', x, y });
    return e;
  }

  /** Rolls damage with the owner's damage and crit stats. */
  rollDamage(base: number, owner = 0): [number, boolean] {
    const st = this.players[owner]!.stats;
    let dmg = base * st.damage * this.rng.range(0.92, 1.08);
    const crit = this.rng.chance(st.crit);
    if (crit) dmg *= st.critMult;
    return [dmg, crit];
  }

  /** Applies damage and knockback. (dx, dy) is the knockback direction (unit). `owner` gets the credit. */
  damageEnemy(
    e: Enemy,
    dmg: number,
    crit: boolean,
    dx: number,
    dy: number,
    knock: number,
    viaDash = false,
    owner = 0,
  ): void {
    if (e.dead) return;
    const p = this.players[owner]!;
    p.run.damage += Math.min(dmg, Math.max(0, e.hp));
    e.hp -= dmg;
    e.flash = 0.08;
    if (knock > 0) {
      const k = knock / e.mass;
      e.kx += dx * k;
      e.ky += dy * k;
    }
    this.events.push({ t: 'hit', x: e.x, y: e.y - e.r, dmg, crit });
    if (e.hp > 0 && !e.boss && this.hasRelic('exec', owner) && e.hp < e.maxHp * 0.12) e.hp = 0;
    if (e.hp <= 0) this.killEnemy(e, viaDash, owner);
  }

  killEnemy(e: Enemy, viaDash = false, owner = 0): void {
    if (e.dead) return;
    e.dead = true;
    const def = ENEMIES[e.kind];
    const killer = this.players[owner]!;
    this.runStats.kills++;
    killer.run.kills++;
    if (viaDash) {
      this.runStats.dashKills++;
      killer.run.dashKills++;
    }
    this.addCombo(1);
    const points = Math.round(e.score * comboMult(this.combo) * this.scoreMult());
    this.addScore(points);

    this.dropXp(e.x, e.y, e.xp);

    if (e.boss) {
      this.runStats.bossesKilled.push(e.kind);
      if (this.boss === e) this.boss = this.enemies.find((x) => x.boss && !x.dead) ?? null;
      for (let i = 0; i < 10; i++) this.dropXp(e.x + this.rng.range(-60, 60), e.y + this.rng.range(-60, 60), e.xp / 10);
      const cores = this.hasRelic('bounty', owner) ? 50 : 25;
      for (let i = 0; i < 5; i++) this.dropPickup('core', e.x, e.y, cores / 5);
      // Bosses are team milestones: one cache and one heart per pilot.
      for (let i = 0; i < this.players.length; i++) {
        this.dropPickup('cache', e.x, e.y, 1);
        this.dropPickup('heart', e.x, e.y, 40);
      }
      this.hitstop = Math.max(this.hitstop, 0.12);
      this.slowmo(0.25, 1.2);
      for (const b of this.bullets) b.dead = true;
      this.events.push({ t: 'bossdead', x: e.x, y: e.y, name: def.name });
    } else if (e.elite) {
      this.runStats.elites++;
      this.dropPickup('cache', e.x, e.y, 1);
      const cores = this.hasRelic('bounty', owner) ? 6 : 3;
      this.dropPickup('core', e.x, e.y, cores);
      this.hitstop = Math.max(this.hitstop, 0.05);
    } else {
      const luck = killer.stats.luck;
      const roll = this.rng.next();
      if (roll < 0.009 * luck) this.dropPickup('heart', e.x, e.y, 25);
      else if (roll < 0.0125 * luck) this.dropPickup('magnet', e.x, e.y, 1);
      else if (roll < 0.015 * luck) this.dropPickup('bomb', e.x, e.y, 1);
    }

    if (e.kind === 'splitter') {
      const n = e.elite ? 4 : 2;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + this.rng.next();
        const child = this.spawnEnemy('splitling', e.x + Math.cos(a) * 12, e.y + Math.sin(a) * 12);
        if (child) {
          child.kx = Math.cos(a) * 220;
          child.ky = Math.sin(a) * 220;
          child.spawnT = 0;
        }
      }
    }

    if (this.hasRelic('vamp', owner) && this.rng.chance(0.08)) this.heal(2, owner);

    this.events.push({
      t: 'kill',
      x: e.x,
      y: e.y,
      color: def.color,
      r: e.r,
      elite: e.elite,
      boss: e.boss,
      score: points,
      dash: viaDash,
      pid: owner,
    });
  }

  nearestEnemy(x: number, y: number, maxDist: number, exclude?: ReadonlySet<number>): Enemy | null {
    let best: Enemy | null = null;
    let bestD = maxDist * maxDist;
    for (const e of this.enemies) {
      if (e.dead || (exclude && exclude.has(e.id))) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /**
   * A point just outside the visible area, biased toward where the team is
   * heading. Returns a shared scratch object: copy the values.
   */
  spawnPoint(margin = 70): Readonly<{ x: number; y: number }> {
    const center = this.teamCenter();
    const cx = center.x;
    const cy = center.y;
    const vel = this.teamVelocity();
    const vx = vel.x;
    const vy = vel.y;
    const rng = this.posRng;
    const hw = this.effHalfW();
    const hh = this.effHalfH();
    const speed = Math.hypot(vx, vy);
    const tries = this.coop ? SPAWN_RETRIES + 1 : 1;
    let px = cx;
    let py = cy;
    for (let attempt = 0; attempt < tries; attempt++) {
      let a = rng.next() * TAU;
      if (speed > 40 && rng.chance(0.35)) {
        a = Math.atan2(vy, vx) + rng.range(-0.9, 0.9);
      }
      const c = Math.cos(a);
      const s = Math.sin(a);
      const edge = Math.min(Math.abs(c) > 1e-6 ? hw / Math.abs(c) : Infinity, Math.abs(s) > 1e-6 ? hh / Math.abs(s) : Infinity);
      const d = edge + margin;
      px = cx + c * d;
      py = cy + s * d;
      // Co-op: a point just off a spread team's view can sit on an edge pilot; try again.
      if (!this.coop || this.clearOfPlayers(px, py, SPAWN_CLEARANCE)) break;
    }
    const pt = this.spawnBuf;
    pt.x = px;
    pt.y = py;
    return pt;
  }

  /**
   * Distance along the ray from (cx, cy) at angle `a`, starting at `r`, where a
   * spawn keeps SPAWN_CLEARANCE from every active pilot. Co-op only: used by
   * surge rings and boss entries, which are placed around the team centre and
   * could otherwise land on a pilot at the edge of a spread team. Draws no rng.
   */
  clearRadius(cx: number, cy: number, a: number, r: number): number {
    if (!this.coop) return r;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const c2 = SPAWN_CLEARANCE * SPAWN_CLEARANCE;
    // A pilot whose clearance disc covers the point pushes it outward past the
    // disc. A push can land in another pilot's disc, so repeat (at most once per
    // pilot). Pilots stay inside the zoomed view, so the result stays well
    // within the enemy recycle distance.
    for (let pass = 0; pass < this.players.length; pass++) {
      let moved = false;
      for (const p of this.players) {
        if (!this.isUp(p)) continue;
        const dx = p.x - cx;
        const dy = p.y - cy;
        const along = dx * c + dy * s;
        const perp2 = dx * dx + dy * dy - along * along;
        if (perp2 >= c2) continue;
        const half = Math.sqrt(c2 - perp2);
        // The ray is inside this pilot's disc between along-half and along+half.
        if (r > along - half && r < along + half) {
          r = along + half + 1;
          moved = true;
        }
      }
      if (!moved) break;
    }
    return r;
  }

  /** True if no active pilot is within `dist` of (x, y). */
  clearOfPlayers(x: number, y: number, dist: number): boolean {
    const d2 = dist * dist;
    for (const p of this.players) {
      if (!this.isUp(p)) continue;
      const dx = p.x - x;
      const dy = p.y - y;
      if (dx * dx + dy * dy < d2) return false;
    }
    return true;
  }

  fireBullet(x: number, y: number, angle: number, speed: number, damage: number, r = 6): void {
    let sp = speed;
    if (this.teamHasRelic('chrono')) sp *= 0.8;
    if (this.cfg.daily === 'hyper') sp *= 1.2;
    this.bullets.push({
      x,
      y,
      vx: Math.cos(angle) * sp,
      vy: Math.sin(angle) * sp,
      r,
      damage: damage * this.director.dmgMult(this.time) * (this.cfg.hardMode ? 1.25 : 1),
      life: 6,
      grazed: false,
      dead: false,
    });
  }

  // ───────────────────────────── projectiles & effects ─────────────────────────────

  addRing(
    x: number,
    y: number,
    maxRadius: number,
    duration: number,
    damage: number,
    knock: number,
    follow: boolean,
    color: string,
    delay = 0,
    owner = 0,
  ): void {
    this.rings.push({
      id: this.nextFxId++,
      x,
      y,
      radius: 0,
      maxRadius,
      t: -delay,
      duration,
      damage,
      knock,
      follow,
      hit: new Set(),
      color,
      hurtsPlayer: false,
      owner,
    });
    if (delay <= 0) this.events.push({ t: 'ring', x, y, r: maxRadius, color });
  }

  newFxId(): number {
    return this.nextFxId++;
  }

  private updateProjectiles(dt: number): void {
    const buf = this.queryBuf;
    for (const pr of this.projectiles) {
      if (pr.dead) continue;
      if (pr.kind === 'missile') {
        let target: Enemy | null = null;
        if (pr.targetId >= 0) {
          for (const e of this.enemies) {
            if (e.id === pr.targetId) {
              target = e.dead ? null : e;
              break;
            }
          }
        }
        if (!target) {
          target = this.nearestEnemy(pr.x, pr.y, 500);
          pr.targetId = target ? target.id : -1;
        }
        if (target) {
          const desired = Math.atan2(target.y - pr.y, target.x - pr.x);
          const cur = Math.atan2(pr.vy, pr.vx);
          let diff = desired - cur;
          while (diff > Math.PI) diff -= TAU;
          while (diff < -Math.PI) diff += TAU;
          const turn = Math.max(-pr.turn * dt, Math.min(pr.turn * dt, diff));
          const na = cur + turn;
          pr.vx = Math.cos(na) * pr.speed;
          pr.vy = Math.sin(na) * pr.speed;
        }
      }
      pr.x += pr.vx * dt;
      pr.y += pr.vy * dt;
      pr.life -= dt;
      if (pr.life <= 0) {
        if (pr.kind === 'missile') this.explode(pr.x, pr.y, pr.splash, pr.damage * 0.6, '#ffb3f0', -1, pr.owner);
        pr.dead = true;
        continue;
      }
      const n = this.grid.query(pr.x, pr.y, pr.r + 64, buf);
      for (let k = 0; k < n; k++) {
        const e = this.enemies[buf[k]!]!;
        if (e.dead || pr.hits.includes(e.id)) continue;
        const dx = e.x - pr.x;
        const dy = e.y - pr.y;
        const rr = e.r + pr.r;
        if (dx * dx + dy * dy > rr * rr) continue;
        if (pr.kind === 'missile') {
          const [dmg, crit] = this.rollDamage(pr.damage, pr.owner);
          this.damageEnemy(e, dmg, crit, pr.vx / pr.speed, pr.vy / pr.speed, 120, false, pr.owner);
          this.explode(pr.x, pr.y, pr.splash, pr.damage * 0.6, '#ffb3f0', e.id, pr.owner);
          pr.dead = true;
          break;
        }
        const [dmg, crit] = this.rollDamage(pr.damage, pr.owner);
        const sp = Math.hypot(pr.vx, pr.vy) || 1;
        this.damageEnemy(e, dmg, crit, pr.vx / sp, pr.vy / sp, 90, false, pr.owner);
        pr.hits.push(e.id);
        pr.pierce--;
        if (pr.pierce < 0) {
          pr.dead = true;
          break;
        }
      }
    }
  }

  /** Area damage. `base` is pre-crit damage before the global damage multiplier. */
  explode(x: number, y: number, radius: number, base: number, color: string, skipId = -1, owner = 0): void {
    const buf = this.queryBuf;
    const n = this.grid.query(x, y, radius + 64, buf);
    const hits: Enemy[] = [];
    for (let k = 0; k < n; k++) {
      const e = this.enemies[buf[k]!]!;
      if (e.dead || e.id === skipId) continue;
      const dx = e.x - x;
      const dy = e.y - y;
      const rr = radius + e.r;
      if (dx * dx + dy * dy <= rr * rr) hits.push(e);
    }
    for (const e of hits) {
      const d = Math.hypot(e.x - x, e.y - y) || 1;
      const [dmg, crit] = this.rollDamage(base, owner);
      this.damageEnemy(e, dmg, crit, (e.x - x) / d, (e.y - y) / d, 160, false, owner);
    }
    this.events.push({ t: 'explode', x, y, r: radius, color });
  }

  private updateRings(dt: number): void {
    const buf = this.queryBuf;
    for (const ring of this.rings) {
      ring.t += dt;
      if (ring.t < 0) continue;
      if (ring.t - dt < 0) this.events.push({ t: 'ring', x: ring.x, y: ring.y, r: ring.maxRadius, color: ring.color });
      if (ring.follow) {
        const p = this.players[ring.owner]!;
        ring.x = p.x;
        ring.y = p.y;
      }
      const k = Math.min(1, ring.t / ring.duration);
      ring.radius = ring.maxRadius * ease.outCubic(k);
      const n = this.grid.query(ring.x, ring.y, ring.radius + 64, buf);
      const victims: Enemy[] = [];
      for (let j = 0; j < n; j++) {
        const e = this.enemies[buf[j]!]!;
        if (e.dead || ring.hit.has(e.id)) continue;
        const dx = e.x - ring.x;
        const dy = e.y - ring.y;
        const rr = ring.radius + e.r;
        if (dx * dx + dy * dy <= rr * rr) victims.push(e);
      }
      for (const e of victims) {
        ring.hit.add(e.id);
        const d = Math.hypot(e.x - ring.x, e.y - ring.y) || 1;
        const [dmg, crit] = this.rollDamage(ring.damage, ring.owner);
        this.damageEnemy(e, dmg, crit, (e.x - ring.x) / d, (e.y - ring.y) / d, ring.knock, false, ring.owner);
      }
    }
    this.rings = this.rings.filter((r) => r.t < r.duration + 0.25);
  }

  private updateMines(dt: number): void {
    const buf = this.queryBuf;
    for (const m of this.mines) {
      if (m.dead) continue;
      m.armT -= dt;
      m.life -= dt;
      if (m.triggered) {
        m.pullT -= dt;
        if (m.pull) {
          const pullR = m.radius * 1.3;
          const n = this.grid.query(m.x, m.y, pullR + 64, buf);
          for (let k = 0; k < n; k++) {
            const e = this.enemies[buf[k]!]!;
            if (e.dead || e.boss) continue;
            const dx = m.x - e.x;
            const dy = m.y - e.y;
            const d = Math.hypot(dx, dy);
            if (d > pullR || d < 4) continue;
            const f = (420 / e.mass) * dt;
            e.x += (dx / d) * Math.min(f, d - 4);
            e.y += (dy / d) * Math.min(f, d - 4);
          }
        }
        if (m.pullT <= 0) {
          this.explode(m.x, m.y, m.radius, m.damage, '#b4ff6a', -1, m.owner);
          m.dead = true;
        }
        continue;
      }
      if (m.life <= 0) {
        m.triggered = true;
        m.pullT = m.pull ? 0.6 : 0;
        continue;
      }
      if (m.armT > 0) continue;
      const trigger = 36;
      const n = this.grid.query(m.x, m.y, trigger + 64, buf);
      for (let k = 0; k < n; k++) {
        const e = this.enemies[buf[k]!]!;
        if (e.dead) continue;
        const rr = trigger + e.r;
        const dx = e.x - m.x;
        const dy = e.y - m.y;
        if (dx * dx + dy * dy <= rr * rr) {
          m.triggered = true;
          m.pullT = m.pull ? 0.9 : 0.05;
          break;
        }
      }
    }
    this.mines = this.mines.filter((m) => !m.dead);
  }

  private updateBeams(dt: number): void {
    const buf = this.queryBuf;
    for (const b of this.beams) {
      b.t += dt;
      if (b.evolved) {
        const p = this.players[b.owner]!;
        b.angle += 2.6 * dt;
        b.x = p.x;
        b.y = p.y;
      }
      if (b.t > b.duration) continue;
      const cx = b.x + (Math.cos(b.angle) * b.length) / 2;
      const cy = b.y + (Math.sin(b.angle) * b.length) / 2;
      const n = this.grid.query(cx, cy, b.length / 2 + 64, buf);
      const ux = Math.cos(b.angle);
      const uy = Math.sin(b.angle);
      const victims: Enemy[] = [];
      for (let k = 0; k < n; k++) {
        const e = this.enemies[buf[k]!]!;
        if (e.dead || b.hit.has(e.id)) continue;
        const rx = e.x - b.x;
        const ry = e.y - b.y;
        const along = rx * ux + ry * uy;
        if (along < -e.r || along > b.length + e.r) continue;
        const perp = Math.abs(rx * uy - ry * ux);
        if (perp <= b.width / 2 + e.r) victims.push(e);
      }
      for (const e of victims) {
        b.hit.add(e.id);
        const [dmg, crit] = this.rollDamage(b.damage, b.owner);
        this.damageEnemy(e, dmg, crit, ux, uy, 140, false, b.owner);
      }
    }
    this.beams = this.beams.filter((b) => b.t < b.duration + 0.2);
  }

  private updateBullets(dt: number): void {
    const center = this.teamCenter();
    const cx = center.x;
    const cy = center.y;
    const limit = Math.max(this.effHalfW(), this.effHalfH()) * 2 + 200;
    for (const b of this.bullets) {
      if (b.dead) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || Math.abs(b.x - cx) > limit || Math.abs(b.y - cy) > limit) {
        b.dead = true;
        continue;
      }
      for (const p of this.players) {
        if (!this.isUp(p)) continue;
        const dx = b.x - p.x;
        const dy = b.y - p.y;
        const rr = b.r + p.r * (p.dashT > 0 ? 1.4 : 0.75);
        if (dx * dx + dy * dy > rr * rr) continue;
        if (p.dashT > 0) {
          if (!b.grazed) {
            b.grazed = true;
            this.perfectDash(p);
          }
        } else if (p.invuln <= 0) {
          this.hurtPlayer(b.damage, b.x, b.y, p.pid);
          b.dead = true;
          break;
        }
      }
    }
  }

  // ───────────────────────────── pickups ─────────────────────────────

  dropXp(x: number, y: number, value: number): void {
    if (value <= 0) return;
    if (this.pickups.length >= MAX_PICKUPS) {
      // Merge into a nearby gem to keep entity counts bounded.
      let best: Pickup | null = null;
      let bestD = Infinity;
      for (const pk of this.pickups) {
        if (pk.kind !== 'xp' || pk.dead) continue;
        const d = Math.abs(pk.x - x) + Math.abs(pk.y - y);
        if (d < bestD) {
          bestD = d;
          best = pk;
        }
      }
      if (best) {
        best.value += value;
        return;
      }
    }
    this.dropPickup('xp', x, y, value);
  }

  dropPickup(kind: PickupKind, x: number, y: number, value: number): void {
    const a = this.rng.next() * TAU;
    const sp = kind === 'xp' ? this.rng.range(20, 90) : this.rng.range(80, 160);
    this.pickups.push({
      kind,
      x,
      y,
      vx: Math.cos(a) * sp,
      vy: Math.sin(a) * sp,
      value,
      magnetized: false,
      age: 0,
      dead: false,
      owner: -1,
    });
  }

  magnetizeAll(): void {
    for (const pk of this.pickups) {
      if (pk.kind === 'xp' || pk.kind === 'core') {
        pk.magnetized = true;
        pk.owner = -1;
      }
    }
  }

  private updatePickups(dt: number): void {
    if (!this.coop) this.updatePickupsSolo(dt);
    else this.updatePickupsCoop(dt);
  }

  /**
   * Co-op pickups: each flies to the nearest active pilot whose magnet reaches
   * it (that pilot becomes its owner), and is collected by the nearest active
   * pilot that touches it. A downed owner releases it to the nearest pilot.
   */
  private updatePickupsCoop(dt: number): void {
    const fr = damp(5, dt);
    const players = this.players;
    for (const pk of this.pickups) {
      if (pk.dead) continue;
      pk.age += dt;
      const wide = pk.kind === 'xp' || pk.kind === 'core';
      // One pass over the pilots, on squared pre-move distances: the nearest
      // pilot with this pickup in magnet range, the nearest active pilot, and
      // the nearest pilot close enough to collect it.
      let q: PlayerState | null = null;
      let qD2 = Infinity;
      let near: PlayerState | null = null;
      let nearD2 = Infinity;
      let collector: PlayerState | null = null;
      let collectD2 = Infinity;
      for (const p of players) {
        if (!this.isUp(p)) continue;
        const dx = p.x - pk.x;
        const dy = p.y - pk.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < nearD2) {
          nearD2 = d2;
          near = p;
        }
        const radius = wide ? p.stats.magnet : Math.min(p.stats.magnet, 60);
        if (d2 < radius * radius && d2 < qD2) {
          qD2 = d2;
          q = p;
        }
        const cr = p.r + 12;
        if (d2 < cr * cr && d2 < collectD2) {
          collectD2 = d2;
          collector = p;
        }
      }

      let target: PlayerState | null = null;
      const owner = pk.owner >= 0 ? players[pk.owner] : undefined;
      if (pk.magnetized && owner && this.isUp(owner)) {
        target = owner;
      } else if (q && pk.age > 0.15) {
        pk.magnetized = true;
        pk.owner = q.pid;
        target = q;
      } else if (pk.magnetized) {
        target = near;
        pk.owner = near ? near.pid : -1;
      }

      if (target) {
        const dx = target.x - pk.x;
        const dy = target.y - pk.y;
        const d = Math.hypot(dx, dy) || 1;
        const radius = wide ? target.stats.magnet : Math.min(target.stats.magnet, 60);
        const speed = Math.min(1400, 260 + pk.age * 900 + (radius / d) * 60);
        pk.vx = (dx / d) * speed;
        pk.vy = (dy / d) * speed;
      } else {
        pk.vx -= pk.vx * fr;
        pk.vy -= pk.vy * fr;
      }
      pk.x += pk.vx * dt;
      pk.y += pk.vy * dt;
      if (collector) {
        pk.dead = true;
        this.collect(pk, collector.pid);
      }
    }
  }

  /** The original single-player routine, kept verbatim (it also magnetizes on the death tick). */
  private updatePickupsSolo(dt: number): void {
    const p = this.players[0]!;
    const magnet = p.stats.magnet;
    const fr = damp(5, dt);
    for (const pk of this.pickups) {
      if (pk.dead) continue;
      pk.age += dt;
      const dx = p.x - pk.x;
      const dy = p.y - pk.y;
      const d = Math.hypot(dx, dy) || 1;
      const radius = pk.kind === 'xp' || pk.kind === 'core' ? magnet : Math.min(magnet, 60);
      if (!pk.magnetized && d < radius && pk.age > 0.15) pk.magnetized = true;
      if (pk.magnetized && p.alive) {
        const speed = Math.min(1400, 260 + pk.age * 900 + (radius / d) * 60);
        pk.vx = (dx / d) * speed;
        pk.vy = (dy / d) * speed;
      } else {
        pk.vx -= pk.vx * fr;
        pk.vy -= pk.vy * fr;
      }
      pk.x += pk.vx * dt;
      pk.y += pk.vy * dt;
      if (p.alive && d < p.r + 12) {
        pk.dead = true;
        this.collect(pk, 0);
      }
    }
  }

  private collect(pk: Pickup, pid: number): void {
    const p = this.players[pid]!;
    switch (pk.kind) {
      case 'xp':
        this.runStats.gems++;
        p.run.gems++;
        this.addXp(pk.value, pid);
        break;
      case 'heart':
        this.heal(pk.value, pid);
        break;
      case 'magnet':
        this.magnetizeAll();
        this.events.push({ t: 'magnet' });
        break;
      case 'bomb':
        this.bomb(pid);
        break;
      case 'core':
        this.runStats.coresCollected += pk.value;
        break;
      case 'cache':
        p.pendingCaches++;
        break;
    }
    this.events.push({ t: 'pickup', kind: pk.kind, value: pk.value, pid });
  }

  /** Clears the (zoomed) screen around the team centre. `pid` gets the credit. */
  bomb(pid = 0): void {
    const c = this.teamCenter();
    const cx = c.x;
    const cy = c.y;
    const hw = this.effHalfW() + 40;
    const hh = this.effHalfH() + 40;
    for (const e of this.enemies) {
      if (e.dead || Math.abs(e.x - cx) > hw || Math.abs(e.y - cy) > hh) continue;
      const d = Math.hypot(e.x - cx, e.y - cy) || 1;
      const dmg = e.boss || e.elite ? e.maxHp * 0.1 : e.hp + 1;
      this.damageEnemy(e, dmg, false, (e.x - cx) / d, (e.y - cy) / d, 300, false, pid);
    }
    for (const b of this.bullets) b.dead = true;
    this.hitstop = Math.max(this.hitstop, 0.08);
    this.events.push({ t: 'bomb', x: cx, y: cy });
  }

  /** Team XP; the collector's xpGain applies. */
  addXp(amount: number, pid = 0): void {
    this.xp += amount * this.players[pid]!.stats.xpGain;
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext;
      this.level++;
      this.xpNext = Math.round(xpForLevel(this.level) * this.scaling.xpReq);
      this.pendingLevelUps++;
      this.events.push({ t: 'levelup', level: this.level });
    }
  }

  addScore(points: number): void {
    this.score += points;
    if (!this.newBestAnnounced && this.bestScore > 0 && this.score > this.bestScore) {
      this.newBestAnnounced = true;
      this.events.push({ t: 'newbest' });
    }
  }

  // ───────────────────────────── combo ─────────────────────────────

  addCombo(n: number): void {
    for (let i = 0; i < n; i++) {
      this.combo++;
      const m = milestoneAt(this.combo);
      if (m) this.triggerMilestone(m);
    }
    this.comboTimer = this.comboWindow();
    if (this.combo > this.runStats.maxCombo) this.runStats.maxCombo = this.combo;
    const tier = comboTier(this.combo);
    if (tier > this.comboTierIdx) this.events.push({ t: 'combo', tier, mult: comboMult(this.combo) });
    this.comboTierIdx = tier;
  }

  private triggerMilestone(name: 'MAGNET PULSE' | 'NOVA BURST' | 'OVERDRIVE'): void {
    if (name === 'MAGNET PULSE') this.magnetizeAll();
    else if (name === 'NOVA BURST') {
      // One ring per active pilot (solo: always the one pilot, exactly as before).
      for (const p of this.players) {
        if (this.coop && !this.isUp(p)) continue;
        this.addRing(p.x, p.y, 460, 0.55, 60, 500, true, '#ffffff', 0, p.pid);
      }
    } else this.overdriveT = 6;
    this.events.push({ t: 'milestone', name, combo: this.combo });
  }

  private updateCombo(dt: number): void {
    if (this.combo <= 0) return;
    this.comboTimer -= dt;
    if (this.comboTimer <= 0) {
      this.events.push({ t: 'combobreak', combo: this.combo });
      this.combo = 0;
      this.comboTierIdx = 0;
    }
  }

  // ───────────────────────────── misc ─────────────────────────────

  slowmo(scale: number, duration: number): void {
    if (duration > this.slowmoT || scale < this.slowmoScale) {
      this.slowmoScale = scale;
      this.slowmoT = duration;
    }
  }

  /** Upcoming boss (for HUD), or null. */
  nextBoss(): { name: string; at: number } | null {
    const next = this.director.nextBossInfo(this.time);
    return next;
  }

  bossSchedule(): typeof BOSS_SCHEDULE {
    return BOSS_SCHEDULE;
  }

  private cleanup(): void {
    compact(this.enemies);
    compact(this.projectiles);
    compact(this.bullets);
    compact(this.pickups);
  }
}

function compact<T extends { dead: boolean }>(arr: T[]): void {
  let w = 0;
  for (let i = 0; i < arr.length; i++) {
    const item = arr[i]!;
    if (!item.dead) arr[w++] = item;
  }
  arr.length = w;
}
