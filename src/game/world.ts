import { SpatialGrid } from '../core/grid';
import { TAU, damp, ease } from '../core/math';
import { Rng } from '../core/rng';
import { comboMult, comboTier, milestoneAt } from './combo';
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
  Projectile,
  RelicId,
  Ring,
  RunConfig,
  Stats,
  WeaponId,
  WeaponInstance,
} from './types';
import { updateWeapons } from './weapons';

export const DASH_TIME = 0.17;
export const DASH_SPEED = 1150;
export const DASH_BASE_DAMAGE = 30;
export const PLAYER_RADIUS = 11;
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
  player: Player;
  stats!: Stats;
  build: Build = { weapons: [], passives: {}, relics: [] };

  enemies: Enemy[] = [];
  projectiles: Projectile[] = [];
  bullets: Bullet[] = [];
  pickups: Pickup[] = [];
  rings: Ring[] = [];
  mines: Mine[] = [];
  beams: Beam[] = [];
  /** Orbit blade positions this tick (for rendering). */
  blades: { x: number; y: number; r: number }[] = [];
  events: GameEvent[] = [];

  readonly grid = new SpatialGrid(64, 2048);
  readonly queryBuf: number[] = [];

  level = 1;
  xp = 0;
  xpNext = xpForLevel(1);
  pendingLevelUps = 0;
  pendingCaches = 0;
  rerolls = 0;

  combo = 0;
  comboTimer = 0;
  comboTierIdx = 0;
  overdriveT = 0;

  score = 0;
  private scoreTimeAcc = 0;
  private bestScore: number;
  private newBestAnnounced = false;

  /** Half-size of the visible area in world units (set by the renderer). */
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

  constructor(cfg: RunConfig, opts: WorldOptions = {}) {
    this.cfg = cfg;
    const root = new Rng(cfg.seed);
    this.spawnRng = root.fork(1);
    this.lootRng = root.fork(2);
    this.rng = root.fork(3);
    this.posRng = root.fork(4);
    this.bestScore = opts.bestScore ?? 0;
    this.director = new Director(cfg);
    this.player = {
      x: 0,
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
    };
    this.addWeapon(SHIPS[cfg.ship].weapon);
    this.refreshStats();
    this.player.hp = this.stats.maxHp;
    this.player.dashCharges = this.stats.dashCharges;
    this.rerolls = this.stats.rerolls;
  }

  // ───────────────────────────── build & stats ─────────────────────────────

  addWeapon(id: WeaponId): void {
    if (this.build.weapons.some((w) => w.id === id)) return;
    this.build.weapons.push({ id, level: 1, evolved: false, timer: 0.4, phase: 0 });
    this.runStats.maxWeapons = Math.max(this.runStats.maxWeapons, this.build.weapons.length);
  }

  hasRelic(id: RelicId): boolean {
    return this.build.relics.includes(id);
  }

  refreshStats(): void {
    const prev = this.stats;
    this.stats = computeStats(this.cfg, this.build.passives, this.build.relics);
    if (prev) {
      const hpGain = this.stats.maxHp - prev.maxHp;
      if (hpGain > 0) this.player.hp += hpGain;
      const chargeGain = this.stats.dashCharges - prev.dashCharges;
      if (chargeGain > 0) this.player.dashCharges += chargeGain;
    }
    this.player.hp = Math.min(this.player.hp, this.stats.maxHp);
  }

  /** Multiplier applied to weapon cooldowns right now. */
  cooldownMult(): number {
    let m = this.stats.cooldown;
    if (this.overdriveT > 0) m /= 1.5;
    if (this.combo >= 40 && this.hasRelic('fever')) m /= 1.35;
    return m;
  }

  moveSpeed(): number {
    let s = this.stats.speed;
    if (this.combo >= 40 && this.hasRelic('fever')) s *= 1.15;
    if (this.cfg.daily === 'hyper') s *= 1.1;
    return s;
  }

  scoreMult(): number {
    return this.cfg.hardMode ? 1.5 : 1;
  }

  // ───────────────────────────── main update ─────────────────────────────

  update(dt: number, input: ControlInput): void {
    if (this.gameOver) return;
    this.time += dt;
    if (this.overdriveT > 0) this.overdriveT -= dt;

    this.director.update(this, dt);
    this.updatePlayer(dt, input);
    updateEnemies(this, dt);
    this.grid.build(this.enemies, this.player.x, this.player.y);
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

  private updatePlayer(dt: number, input: ControlInput): void {
    const p = this.player;
    const st = this.stats;
    if (!p.alive) return;

    if (input.dash) p.dashBuffer = 0.15;
    else p.dashBuffer -= dt;

    // Dash recharge.
    if (p.dashCharges < st.dashCharges) {
      if (p.dashRecharge === 0) p.dashRecharge = st.dashCooldown;
      p.dashRecharge -= dt;
      this.settleDashRecharge();
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
      p.dashId++;
      p.perfectThisDash = false;
      p.dashBuffer = 0;
      this.events.push({ t: 'dash', x: p.x, y: p.y, dx, dy });
    }

    if (p.dashT > 0) {
      p.vx = p.dashDirX * DASH_SPEED;
      p.vy = p.dashDirY * DASH_SPEED;
      p.dashT -= dt;
      if (p.dashT <= 0) {
        p.invuln = Math.max(p.invuln, 0.12);
        p.vx *= 0.25;
        p.vy *= 0.25;
        if (SHIPS[this.cfg.ship].dashNova) {
          this.addRing(p.x, p.y, 150 * st.area, 0.3, 26 * st.dashDamage, 320, false, '#6fd2ff');
        }
      }
    } else {
      const speed = this.moveSpeed();
      const k = damp(16, dt);
      p.vx += (input.mx * speed - p.vx) * k;
      p.vy += (input.my * speed - p.vy) * k;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    if (p.invuln > 0) p.invuln -= dt;
    if (p.hurtT > 0) p.hurtT -= dt;
    if (st.regen > 0 && p.hp < st.maxHp) p.hp = Math.min(st.maxHp, p.hp + st.regen * dt);

    if (this.hasRelic('shield') && !p.shieldReady) {
      p.shieldT += dt;
      if (p.shieldT >= 20) {
        p.shieldReady = true;
        p.shieldT = 0;
      }
    }

    this.noHitT += dt;
    if (this.noHitT > this.runStats.longestNoHit) this.runStats.longestNoHit = this.noHitT;
  }

  isPlayerInvulnerable(): boolean {
    return this.player.dashT > 0 || this.player.invuln > 0;
  }

  private perfectDash(): void {
    const p = this.player;
    if (p.perfectThisDash) return;
    p.perfectThisDash = true;
    this.runStats.perfects++;
    if (p.dashCharges < this.stats.dashCharges) {
      p.dashRecharge -= this.stats.dashCooldown * 0.5;
      this.settleDashRecharge();
    }
    this.addCombo(3);
    this.slowmo(0.35, 0.22);
    this.events.push({ t: 'perfect', x: p.x, y: p.y });
  }

  /** Converts a non-positive recharge timer into charges, carrying any remainder. */
  private settleDashRecharge(): void {
    const p = this.player;
    const st = this.stats;
    while (p.dashRecharge <= 0 && p.dashCharges < st.dashCharges) {
      p.dashCharges++;
      this.events.push({ t: 'dashready' });
      p.dashRecharge = p.dashCharges < st.dashCharges ? p.dashRecharge + st.dashCooldown : 0;
    }
  }

  private playerContacts(): void {
    const p = this.player;
    if (!p.alive) return;
    const buf = this.queryBuf;
    const dashing = p.dashT > 0;
    const n = this.grid.query(p.x, p.y, p.r + 72, buf);
    for (let k = 0; k < n; k++) {
      const e = this.enemies[buf[k]!]!;
      if (e.dead) continue;
      const dx = e.x - p.x;
      const dy = e.y - p.y;
      const reach = dashing ? e.r + p.r + 8 : e.r + p.r * 0.8;
      if (dx * dx + dy * dy > reach * reach) continue;
      if (dashing) {
        if (e.dashHitId !== p.dashId) {
          e.dashHitId = p.dashId;
          this.perfectDash();
          const [dmg, crit] = this.rollDamage(DASH_BASE_DAMAGE * this.stats.dashDamage);
          this.damageEnemy(e, dmg, crit, p.dashDirX, p.dashDirY, 420, true);
        }
      } else if (e.spawnT <= 0) {
        this.hurtPlayer(e.damage, e.x, e.y);
      }
    }
  }

  hurtPlayer(raw: number, sx: number, sy: number): void {
    const p = this.player;
    if (!p.alive || this.isPlayerInvulnerable()) return;
    if (p.shieldReady) {
      p.shieldReady = false;
      p.shieldT = 0;
      p.invuln = 0.8;
      this.events.push({ t: 'shieldbreak', x: p.x, y: p.y });
      return;
    }
    const dmg = Math.max(1, raw - this.stats.armor);
    p.hp -= dmg;
    p.invuln = 0.75;
    p.hurtT = 0.3;
    this.runStats.hitsTaken++;
    this.runStats.damageTaken += dmg;
    this.noHitT = 0;
    const d = Math.hypot(p.x - sx, p.y - sy) || 1;
    p.vx += ((p.x - sx) / d) * 260;
    p.vy += ((p.y - sy) / d) * 260;
    if (this.combo > 0) {
      this.combo = Math.floor(this.combo / 2);
      this.comboTierIdx = comboTier(this.combo);
    }
    this.events.push({ t: 'hurt', dmg, x: p.x, y: p.y });

    if (p.hp <= 0) {
      if (p.revivesUsed < this.stats.revives) {
        p.revivesUsed++;
        p.hp = this.stats.maxHp * 0.5;
        p.invuln = 2.5;
        this.addRing(p.x, p.y, 420, 0.5, 200, 700, false, '#ffffff');
        for (const b of this.bullets) b.dead = true;
        this.slowmo(0.3, 0.8);
        this.events.push({ t: 'revive', x: p.x, y: p.y });
      } else {
        p.hp = 0;
        p.alive = false;
        this.gameOver = true;
        this.events.push({ t: 'death', x: p.x, y: p.y });
      }
    }
  }

  heal(amount: number): void {
    const p = this.player;
    const before = p.hp;
    p.hp = Math.min(this.stats.maxHp, p.hp + amount);
    if (p.hp > before) this.events.push({ t: 'heal', amount: p.hp - before });
  }

  // ───────────────────────────── enemies ─────────────────────────────

  spawnEnemy(kind: EnemyKind, x: number, y: number, elite = false): Enemy | null {
    const def = ENEMIES[kind];
    const isBoss = BOSS_KINDS.has(kind);
    if (!isBoss && this.enemies.length >= MAX_ENEMIES) return null;
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
      orbitHitT: -99,
      dashHitId: -1,
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

  rollDamage(base: number): [number, boolean] {
    let dmg = base * this.stats.damage * this.rng.range(0.92, 1.08);
    const crit = this.rng.chance(this.stats.crit);
    if (crit) dmg *= this.stats.critMult;
    return [dmg, crit];
  }

  /** Applies damage and knockback. (dx, dy) is the knockback direction (unit). */
  damageEnemy(e: Enemy, dmg: number, crit: boolean, dx: number, dy: number, knock: number, viaDash = false): void {
    if (e.dead) return;
    e.hp -= dmg;
    e.flash = 0.08;
    if (knock > 0) {
      const k = knock / e.mass;
      e.kx += dx * k;
      e.ky += dy * k;
    }
    this.events.push({ t: 'hit', x: e.x, y: e.y - e.r, dmg, crit });
    if (e.hp > 0 && !e.boss && this.hasRelic('exec') && e.hp < e.maxHp * 0.12) e.hp = 0;
    if (e.hp <= 0) this.killEnemy(e, viaDash);
  }

  killEnemy(e: Enemy, viaDash = false): void {
    if (e.dead) return;
    e.dead = true;
    const def = ENEMIES[e.kind];
    this.runStats.kills++;
    if (viaDash) this.runStats.dashKills++;
    this.addCombo(1);
    const points = Math.round(e.score * comboMult(this.combo) * this.scoreMult());
    this.addScore(points);

    this.dropXp(e.x, e.y, e.xp);

    if (e.boss) {
      this.runStats.bossesKilled.push(e.kind);
      if (this.boss === e) this.boss = this.enemies.find((x) => x.boss && !x.dead) ?? null;
      for (let i = 0; i < 10; i++) this.dropXp(e.x + this.rng.range(-60, 60), e.y + this.rng.range(-60, 60), e.xp / 10);
      const cores = this.hasRelic('bounty') ? 50 : 25;
      for (let i = 0; i < 5; i++) this.dropPickup('core', e.x, e.y, cores / 5);
      this.dropPickup('cache', e.x, e.y, 1);
      this.dropPickup('heart', e.x, e.y, 40);
      this.hitstop = Math.max(this.hitstop, 0.12);
      this.slowmo(0.25, 1.2);
      for (const b of this.bullets) b.dead = true;
      this.events.push({ t: 'bossdead', x: e.x, y: e.y, name: def.name });
    } else if (e.elite) {
      this.runStats.elites++;
      this.dropPickup('cache', e.x, e.y, 1);
      const cores = this.hasRelic('bounty') ? 6 : 3;
      this.dropPickup('core', e.x, e.y, cores);
      this.hitstop = Math.max(this.hitstop, 0.05);
    } else {
      const luck = this.stats.luck;
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

    if (this.hasRelic('vamp') && this.rng.chance(0.08)) this.heal(2);

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

  /** A point just outside the visible area, biased toward where the player is heading. */
  spawnPoint(margin = 70): { x: number; y: number } {
    const p = this.player;
    const rng = this.posRng;
    let a = rng.next() * TAU;
    const speed = Math.hypot(p.vx, p.vy);
    if (speed > 40 && rng.chance(0.35)) {
      a = Math.atan2(p.vy, p.vx) + rng.range(-0.9, 0.9);
    }
    const c = Math.cos(a);
    const s = Math.sin(a);
    const hw = this.viewHalfW;
    const hh = this.viewHalfH;
    const edge = Math.min(Math.abs(c) > 1e-6 ? hw / Math.abs(c) : Infinity, Math.abs(s) > 1e-6 ? hh / Math.abs(s) : Infinity);
    const d = edge + margin;
    return { x: p.x + c * d, y: p.y + s * d };
  }

  fireBullet(x: number, y: number, angle: number, speed: number, damage: number, r = 6): void {
    let sp = speed;
    if (this.hasRelic('chrono')) sp *= 0.8;
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
        if (pr.kind === 'missile') this.explode(pr.x, pr.y, pr.splash, pr.damage * 0.6, '#ffb3f0');
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
          const [dmg, crit] = this.rollDamage(pr.damage);
          this.damageEnemy(e, dmg, crit, pr.vx / pr.speed, pr.vy / pr.speed, 120);
          this.explode(pr.x, pr.y, pr.splash, pr.damage * 0.6, '#ffb3f0', e.id);
          pr.dead = true;
          break;
        }
        const [dmg, crit] = this.rollDamage(pr.damage);
        const sp = Math.hypot(pr.vx, pr.vy) || 1;
        this.damageEnemy(e, dmg, crit, pr.vx / sp, pr.vy / sp, 90);
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
  explode(x: number, y: number, radius: number, base: number, color: string, skipId = -1): void {
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
      const [dmg, crit] = this.rollDamage(base);
      this.damageEnemy(e, dmg, crit, (e.x - x) / d, (e.y - y) / d, 160);
    }
    this.events.push({ t: 'explode', x, y, r: radius, color });
  }

  private updateRings(dt: number): void {
    const buf = this.queryBuf;
    const p = this.player;
    for (const ring of this.rings) {
      ring.t += dt;
      if (ring.t < 0) continue;
      if (ring.t - dt < 0) this.events.push({ t: 'ring', x: ring.x, y: ring.y, r: ring.maxRadius, color: ring.color });
      if (ring.follow) {
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
        const [dmg, crit] = this.rollDamage(ring.damage);
        this.damageEnemy(e, dmg, crit, (e.x - ring.x) / d, (e.y - ring.y) / d, ring.knock);
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
          this.explode(m.x, m.y, m.radius, m.damage, '#b4ff6a');
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
    const p = this.player;
    for (const b of this.beams) {
      b.t += dt;
      if (b.evolved) {
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
        const [dmg, crit] = this.rollDamage(b.damage);
        this.damageEnemy(e, dmg, crit, ux, uy, 140);
      }
    }
    this.beams = this.beams.filter((b) => b.t < b.duration + 0.2);
  }

  private updateBullets(dt: number): void {
    const p = this.player;
    const limit = Math.max(this.viewHalfW, this.viewHalfH) * 2 + 200;
    for (const b of this.bullets) {
      if (b.dead) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || Math.abs(b.x - p.x) > limit || Math.abs(b.y - p.y) > limit) {
        b.dead = true;
        continue;
      }
      if (!p.alive) continue;
      const dx = b.x - p.x;
      const dy = b.y - p.y;
      const rr = b.r + p.r * (p.dashT > 0 ? 1.4 : 0.75);
      if (dx * dx + dy * dy > rr * rr) continue;
      if (p.dashT > 0) {
        if (!b.grazed) {
          b.grazed = true;
          this.perfectDash();
        }
      } else if (p.invuln <= 0) {
        this.hurtPlayer(b.damage, b.x, b.y);
        b.dead = true;
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
    });
  }

  magnetizeAll(): void {
    for (const pk of this.pickups) if (pk.kind === 'xp' || pk.kind === 'core') pk.magnetized = true;
  }

  private updatePickups(dt: number): void {
    const p = this.player;
    const magnet = this.stats.magnet;
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
        this.collect(pk);
      }
    }
  }

  private collect(pk: Pickup): void {
    switch (pk.kind) {
      case 'xp':
        this.runStats.gems++;
        this.addXp(pk.value);
        break;
      case 'heart':
        this.heal(pk.value);
        break;
      case 'magnet':
        this.magnetizeAll();
        this.events.push({ t: 'magnet' });
        break;
      case 'bomb':
        this.bomb();
        break;
      case 'core':
        this.runStats.coresCollected += pk.value;
        break;
      case 'cache':
        this.pendingCaches++;
        break;
    }
    this.events.push({ t: 'pickup', kind: pk.kind, value: pk.value });
  }

  bomb(): void {
    const p = this.player;
    const hw = this.viewHalfW + 40;
    const hh = this.viewHalfH + 40;
    for (const e of this.enemies) {
      if (e.dead || Math.abs(e.x - p.x) > hw || Math.abs(e.y - p.y) > hh) continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y) || 1;
      const dmg = e.boss || e.elite ? e.maxHp * 0.1 : e.hp + 1;
      this.damageEnemy(e, dmg, false, (e.x - p.x) / d, (e.y - p.y) / d, 300);
    }
    for (const b of this.bullets) b.dead = true;
    this.hitstop = Math.max(this.hitstop, 0.08);
    this.events.push({ t: 'bomb', x: p.x, y: p.y });
  }

  addXp(amount: number): void {
    this.xp += amount * this.stats.xpGain;
    while (this.xp >= this.xpNext) {
      this.xp -= this.xpNext;
      this.level++;
      this.xpNext = xpForLevel(this.level);
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
    this.comboTimer = this.stats.comboWindow;
    if (this.combo > this.runStats.maxCombo) this.runStats.maxCombo = this.combo;
    const tier = comboTier(this.combo);
    if (tier > this.comboTierIdx) this.events.push({ t: 'combo', tier, mult: comboMult(this.combo) });
    this.comboTierIdx = tier;
  }

  private triggerMilestone(name: 'MAGNET PULSE' | 'NOVA BURST' | 'OVERDRIVE'): void {
    const p = this.player;
    if (name === 'MAGNET PULSE') this.magnetizeAll();
    else if (name === 'NOVA BURST') this.addRing(p.x, p.y, 460, 0.55, 60, 500, true, '#ffffff');
    else this.overdriveT = 6;
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
