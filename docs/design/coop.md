# SHARDSTORM local co-op (1–4 players): implementation design

Status: design, ready to implement. Based on commit `18b7adc` (all of `src/`, `tests/`, `e2e/` and `docs/GAME_DESIGN.md` read).
Scope: shared-screen local co-op for 1–4 pilots. On Steam, Remote Play Together makes it online. Solo play must stay **bit-for-bit identical**.

Line numbers below refer to files at `18b7adc`.

---

## 0. Decisions at a glance

| # | Rule (from brief) | Final decision | Refinement and reason |
|---|---|---|---|
| D1 | XP and level are shared | One team `xp/level/xpNext`. XP needed per level is `xpForLevel(l) × scaling.xpReq`. | XP gain uses the **collector's** `xpGain` stat. That way Fortune/Growth still matter for whoever collects. |
| D2 | Every living player picks on level-up, from their own build, one after another | One team level-up starts a **level round**: each player picks once, in P1→P4 order. Caches are resolved first. | **Downed players pick too.** Before a team wipe nobody is "dead", and skipping a pick would leave a revived player permanently behind (a death spiral). The `heal` filler card is hidden while downed. |
| D3 | Each player has their own ship, stats, build, rerolls, dash, HP and revives | `PlayerState` holds all of these. | Dash hit ids come from one **world-wide sequence**, and orbit hit cooldowns are tracked **per player**, so two players never block each other's hits. |
| D4 | Combo and score are team values; any hit halves the combo | As stated. | Combo window = **max** `comboWindow` over all players, so Combo Engine on anyone helps the team. |
| D5 | A Cache goes to the player who collects it | `p.pendingCaches++` on the collector. | A boss drops **one cache and one heart per player** (bosses are team milestones). Elites still drop one cache, but they spawn more often in co-op. |
| D6 | Enemies target the nearest living, non-downed player | `e.tgt` holds the target pid. | 15 % distance **hysteresis**, so enemies don't jitter between two equidistant players. |
| D7 | Pickups magnetize to the nearest player whose magnet reaches them. Hearts heal the collector. Cores and XP are team-wide. | `pk.owner` stores the magnet target. If the owner goes down, the pickup retargets the nearest active player. | Solo keeps its old pickup routine verbatim as a fast path (§2.6). |
| D8 | At 0 HP with no revives a player is DOWNED (ghost). A teammate within ~70 units for ~2.5 s revives them at 40 % HP. | `REVIVE_RADIUS 70`, `REVIVE_TIME 2.5 s`, `REVIVE_HP 0.4`. | Ghosts **drift at 55 % speed** so they can float toward help. Revive progress **decays at 0.5×** instead of resetting. Each later down of the same player takes **+50 % longer** (2.5 → 3.75 → 5.0 s, cap 6 s), so infinite revives are not free. Self-revives (Second Wind, Revival) are spent first. |
| D9 | The run ends when everyone is downed | Team wipe: every `alive = false`, `gameOver = true`, one `death` event. | — |
| D10 | Camera follows the centroid of living players and zooms out to fit them, up to a cap. Players are leashed to that maximum view. | Uses the **bounding-box midpoint** of all *present* players (active plus ghosts). Zoom is in `[1, 1.45]`. The leash blocks movement and never drags anyone. | Ghosts are included because they must stay on screen to be revived. They are leashed too, so the box stays bounded. A bbox midpoint fits better than a centroid when 3 players bunch up and 1 strays. |
| D11 | Difficulty scales with player count | Table in §2.10 (spawn, enemy HP, boss HP, XP needed, elite frequency, surge size, enemy cap). | Total enemy HP grows about N× (spawn × HP). XP needed grows with the spawn rate, so **each player's level pace matches solo**. |
| D12 | Solo behaviour and determinism stay EXACTLY as today | Single-player is the N = 1 case of the same code. A few systems keep explicit solo fast paths. P1 aliases (`world.player/stats/build/rerolls/pendingCaches`) and default `pid = 0` parameters mean **no existing test changes at all**. | A golden-master test is committed **before** the refactor (§11.1; values computed in Appendix A). |
| D13 | The bot can drive any player | `botInput(world, rng, opts, pid = 0)`. In co-op it adds two behaviours: go revive a teammate, and stay with the team. | — |
| D14 | Input: solo merges every device into P1. Co-op uses `kbA` (WASD + Space/Shift), `kbB` (arrows + Enter/RightCtrl/Numpad0) and pads 0–3. Touch is solo-only. | As stated, with two changes for kbB. | **kbB dash = RightShift, Numpad0, RightCtrl (desktop build only).** Enter is **not** a dash key: it is kbB's confirm/join key. (a) The level-up screen's anti-mash guard bans each picker's dash keys, so kbB needs a confirm key that isn't one of them. (b) In a browser, **RightCtrl + kbA's W = Ctrl+W, which closes the tab and cannot be prevented in Chrome.** RightCtrl is only enabled in the Electron build. |
| D15 | Daily Run is solo-only | No Daily in the lobby. `makeRunConfig` forces `daily = null` when there is more than one player. | — |

---

## 1. Data model

### 1.1 `src/game/types.ts`

```ts
// Player: body plus kinematics. All existing fields keep their names and meaning.
export interface Player {
  pid: number;              // NEW: 0..3, index into world.players
  ship: ShipId;             // NEW
  x: number; y: number; vx: number; vy: number; r: number; hp: number;
  facingX: number; facingY: number; invuln: number; hurtT: number;
  dashT: number; dashDirX: number; dashDirY: number; dashCharges: number;
  dashRecharge: number; dashId: number; dashBuffer: number; perfectThisDash: boolean;
  shieldT: number; shieldReady: boolean;
  /** false only after a TEAM wipe (or solo death). Stays true while downed. */
  alive: boolean;
  revivesUsed: number;
  downed: boolean;          // NEW: ghost state (co-op only, never set in solo)
  reviveT: number;          // NEW: seconds of revive progress while downed
  downs: number;            // NEW: times downed this run (raises the revive time)
}

export interface PlayerRunStats {          // NEW: per-player numbers for the results screen and meta
  kills: number; dashKills: number; perfects: number; damage: number;
  hitsTaken: number; damageTaken: number; gems: number; downs: number;
  revivesGiven: number; evolutions: number; maxWeapons: number;
}

export interface Enemy {
  // ...unchanged fields...
  tgt: number;              // NEW: pid currently targeted (0 in solo)
  orbitHitT: number[];      // CHANGED from number: one per player, initialised to -99
}

export interface Projectile { /* ... */ owner: number }   // NEW: pid
export interface Ring       { /* ... */ owner: number }   // NEW
export interface Mine       { /* ... */ owner: number }   // NEW
export interface Beam       { /* ... */ owner: number }   // NEW
export interface Pickup     { /* ... */ owner: number }   // NEW: magnet target pid, -1 = none

export interface PlayerConfig { ship: ShipId }            // NEW
export interface RunConfig {
  // ...unchanged...
  ship: ShipId;               // kept; always equals players[0].ship (meta and achievements read it)
  players: PlayerConfig[];    // NEW: length 1..4
}
```

Event payload changes (all additive; `pid` is required wherever it appears):

| Event | Change |
|---|---|
| `pickup` | `+ pid` (collector) |
| `dash`, `perfect`, `hurt`, `shieldbreak`, `revive` (self-revive), `death` | `+ pid` |
| `dashready` | `{ t: 'dashready'; pid }` |
| `heal` | `{ t: 'heal'; amount; pid }` |
| `kill` | `+ pid` (credited owner) |
| **new** `downed` | `{ t: 'downed'; pid; x; y }` |
| **new** `revived` | `{ t: 'revived'; pid; by; x; y }` (`by` = reviver pid) |
| **new** `laststand` | `{ t: 'laststand'; pid }`: only one active player is left while others are downed |

`levelup`, `combo`, `milestone`, `boss`, `surge`, `victory`, `newbest` and `magnet` stay team events with no pid. Consumers place them at `world.teamCenter()`, which in solo is the player's position.

### 1.2 Per-player state (`src/game/world.ts`)

```ts
export interface Build { weapons: WeaponInstance[]; passives: Partial<Record<PassiveId, number>>; relics: RelicId[] } // unchanged

export interface PlayerState extends Player {
  stats: Stats;            // computeStats(cfg, build.passives, build.relics, ship)
  build: Build;
  rerolls: number;
  pendingCaches: number;
  run: PlayerRunStats;
}
```

### 1.3 Team state (stays on `World`)

`time, enemies, projectiles, bullets, pickups, rings, mines, beams, blades (+pid per blade), events, grid, level, xp, xpNext, pendingLevelUps, combo, comboTimer, comboTierIdx, overdriveT, score, boss, director, victory, gameOver, hitstop, slowmo*, runStats (team totals), noHitT (team: any hit resets it), viewHalfW/H (base, set by the app)`, plus these new fields:

```ts
readonly players: PlayerState[];       // fixed for the run, index = pid
readonly coop: boolean;                // players.length > 1
readonly scaling: CoopScaling;         // row of COOP_SCALING for N
readonly maxEnemies: number;           // scaling.maxEnemies (420 solo)
zoom = 1;                              // sim-owned, 1 forever in solo
levelRound: number[] = [];             // pids still to pick in the current level round
private dashSeq = 0;                   // global dash id sequence
```

`runStats` keeps its shape. In co-op its fields mean:

- `kills`, `elites`, `dashKills`, `perfects`, `gems`, `hitsTaken`, `damageTaken`, `evolutions`, `coresCollected`: team **sums**.
- `maxCombo`: team combo.
- `longestNoHit`: team value (any hit resets it).
- `maxWeapons`: **max** over players.
- `bossesKilled`: team.

### 1.4 Solo-compat aliases (P1) and default parameters

Remove the old field declarations. Because `useDefineForClassFields` is on, a leftover field would shadow the getter. Add:

```ts
/** P1 aliases for tests, debug and the e2e harness. Production code must use players[pid]. */
get player(): PlayerState { return this.players[0]!; }
get stats(): Stats { return this.players[0]!.stats; }
get build(): Build { return this.players[0]!.build; }
get rerolls(): number { return this.players[0]!.rerolls; }
set rerolls(v: number) { this.players[0]!.rerolls = v; }
get pendingCaches(): number { return this.players[0]!.pendingCaches; }
set pendingCaches(v: number) { this.players[0]!.pendingCaches = v; }
```

With default `pid = 0` / `owner = 0` parameters on `hurtPlayer`, `isPlayerInvulnerable`, `heal`, `addXp`, `addWeapon`, `hasRelic`, `refreshStats`, `damageEnemy`, `killEnemy`, `rollDamage`, `explode`, `addRing`, `generateOffers`, `applyOffer`, `availableEvolutions` and `offerCandidates`, every call in `tests/game.test.ts` and `e2e/smoke.spec.ts` compiles and passes unchanged.

A guard test (`tests/no-p1-alias.test.ts`) uses `fs` to scan `src/**/*.ts` and fails if it finds `\bworld\.(player|stats|build|rerolls|pendingCaches)\b` or `\bthis\.(player|stats|build)\b`. Only the alias block in `world.ts` is allow-listed. This keeps co-op bugs from hiding behind the aliases.

### 1.5 New `src/game/content/coop.ts`

```ts
export interface CoopScaling {
  spawn: number; hp: number; bossHp: number; xpReq: number;
  eliteEvery: number; surge: number; opening: number; maxEnemies: number;
}
export const COOP_SCALING: Record<1 | 2 | 3 | 4, CoopScaling> = {
  1: { spawn: 1,    hp: 1,    bossHp: 1,   xpReq: 1,    eliteEvery: 1,    surge: 1,    opening: 1,   maxEnemies: 420 },
  2: { spawn: 1.6,  hp: 1.25, bossHp: 1.8, xpReq: 1.6,  eliteEvery: 0.8,  surge: 1.35, opening: 1.5, maxEnemies: 500 },
  3: { spawn: 2.15, hp: 1.45, bossHp: 2.5, xpReq: 2.15, eliteEvery: 0.68, surge: 1.65, opening: 2,   maxEnemies: 560 },
  4: { spawn: 2.6,  hp: 1.6,  bossHp: 3.2, xpReq: 2.6,  eliteEvery: 0.6,  surge: 1.9,  opening: 2.4, maxEnemies: 600 },
};
export const coopScaling = (n: number): CoopScaling => COOP_SCALING[Math.min(4, Math.max(1, n)) as 1 | 2 | 3 | 4];

export const MAX_PLAYERS = 4;
export const SPAWN_SPACING = 70;          // co-op start positions: x = (i - (n-1)/2) * 70
export const REVIVE_RADIUS = 70;
export const REVIVE_TIME = 2.5;
export const REVIVE_GROWTH = 0.5;         // extra fraction per previous down
export const REVIVE_TIME_MAX = 6;
export const REVIVE_DECAY = 0.5;          // progress lost per second while nobody is near
export const REVIVE_HP = 0.4;
export const REVIVE_INVULN = 2;
export const GHOST_SPEED = 0.55;
export const TARGET_HYSTERESIS = 0.85;    // switch only if the new target is < 85 % of the current distance
export const ZOOM_MAX = 1.45;
export const CAM_MARGIN = 160;            // world units kept around the player box when zooming
export const LEASH_EDGE = 70;             // min distance from a player to the view edge at max zoom
export const ZOOM_OUT_RATE = 4;           // damp() rates
export const ZOOM_IN_RATE = 1.2;
export const SPAWN_CLEARANCE = 220;       // co-op spawn points must be at least this far from every player
```

Every N = 1 multiplier is exactly 1. `x * 1 === x` in IEEE-754, so applying the row is free in solo. `maxEnemies` 420 equals today's `MAX_ENEMIES`, which stays exported for tests.

Player colours live in `src/render/palette.ts`. They are cool hues kept away from the warm enemy palette, and each player also gets a shape mark so colour-blind players can tell them apart:

```ts
export const PLAYER_COLORS = ['#7ff9ff', '#b4ff6a', '#5aa8ff', '#f5f0ff'] as const; // cyan, lime, azure, white-violet
export const PLAYER_MARKS  = ['▲', '●', '■', '◆'] as const;
```

(The pink `#ff4fd2` was rejected because it is the Shooter's colour, and yellow because it is the Dasher's.)

---

## 2. Simulation rules (exact semantics)

### 2.1 Tick order (`World.update(dt, input: ControlInput | readonly ControlInput[])`)

A single `ControlInput` drives P1. Other players get `NO_INPUT = {mx:0,my:0,dash:false}`, which keeps the tests' `w.update(DT, still)` working.

```
if gameOver return
time += dt; overdriveT
director.update(this, dt)
for p of players (pid order): updatePlayer(p, dt, inputs[pid] ?? NO_INPUT)
if coop: applyLeash(); updateRevives(dt); updateZoom(dt)
updateEnemies(this, dt)
grid.build(enemies, teamCenter().x, teamCenter().y)        // solo: player x,y (identical)
separateEnemies(this)
updateWeapons(this, dt)                                      // loops active players
updateProjectiles / Rings / Mines / Beams / Bullets          // owner-aware
playerContacts()                                             // loops active players
updatePickups(dt)                                            // solo fast path
updateCombo(dt); score tick; victory; cleanup
```

### 2.2 Helpers (World public API, used by everything below)

```ts
isUp(p: Player): boolean                  // p.alive && !p.downed
alivePlayers(): PlayerState[]             // up players (new array; not for hot loops)
presentPlayers(): PlayerState[]           // alive, including ghosts
teamCenter(): Readonly<{x:number;y:number}>   // bbox midpoint of present players; solo returns {p.x,p.y} directly
teamVelocity(): Readonly<{x:number;y:number}> // mean v of present players; solo {p.vx,p.vy}
effHalfW(): number; effHalfH(): number    // viewHalfW * zoom, viewHalfH * zoom
nearestUpPlayer(x, y): PlayerState | null
teamHasRelic(id): boolean                 // any player
comboWindow(): number                     // max stats.comboWindow over players
reviveNeed(p): number                     // min(REVIVE_TIME_MAX, REVIVE_TIME * (1 + REVIVE_GROWTH * (p.downs - 1)))
hasPendingPicks(): boolean
beginPick(): PickRequest | null           // see 2.8
pendingPicksFor(pid): number              // for HUD chips
```

`teamCenter` and `teamVelocity` write into two reused scratch objects, so they don't allocate. Hot loops (targeting, contacts, pickups) iterate `this.players` with `isUp()` checks and never allocate.

### 2.3 Damage ownership and stat scope

Every damage source carries `owner` (pid). `rollDamage(base, owner)` uses `players[owner].stats` (damage, crit, critMult) and the shared `rng`. Kill credit goes to `owner` (`p.run.kills++`, `runStats.kills++`). `p.run.damage += dmg` in `damageEnemy`.

| Stat or relic | Scope |
|---|---|
| damage, crit, critMult, area, duration, projSpeed, amount, cooldown, dash* | owner/player |
| luck | the **killer's** luck for drop rolls; the **picker's** luck for relic offer weights |
| magnet | per player (D7) |
| xpGain | collector (D1) |
| coreGain | `max` over players (meta reward) |
| regen, armor, maxHp, revives, rerolls | per player |
| Glass Cannon, Second Wind, Twin Dash, Prism Shield | per player |
| Vampiric Core | heals the **killer** (if up) |
| Executioner | applies to hits whose owner has it |
| Bounty Hunter | the killer's relic doubles elite/boss core drops; it also adds to that player's coreGain |
| Fever | per player, gated by the **team** combo ≥ 40 |
| Combo Engine | team combo window = max over players |
| Chrono Field | **team-wide** if any player has it (enemy speed × 0.88, bullet speed × 0.8; does not stack) |
| Overdrive milestone | team (all players' `cooldownMult`) |
| Magnet Pulse milestone | team (`magnetizeAll`) |
| Nova Burst milestone | one ring per **up** player, owned by that player |

### 2.4 Enemy targeting (`enemyai.ts`)

```ts
function targetOf(world: World, e: Enemy): Player {
  const ps = world.players;
  if (ps.length === 1) return ps[0]!;                       // solo fast path
  let best: Player | null = null; let bestD2 = Infinity;
  for (const p of ps) { if (!world.isUp(p)) continue; const d2 = (p.x-e.x)**2 + (p.y-e.y)**2; if (d2 < bestD2) { bestD2 = d2; best = p; } }
  if (!best) return ps[e.tgt]!;                             // impossible mid-run (wipe sets gameOver)
  const cur = ps[e.tgt]!;
  if (cur !== best && world.isUp(cur)) {
    const curD2 = (cur.x-e.x)**2 + (cur.y-e.y)**2;
    if (bestD2 > curD2 * TARGET_HYSTERESIS * TARGET_HYSTERESIS) return cur;   // keep the current target
  }
  e.tgt = best.pid; return best;
}
```

Far recycling uses the **team view**, not the target. Solo: `d` (distance to the target) equals the distance to the team centre, so the result is identical.

```ts
const far = world.coop ? Math.hypot(e.x - c.x, e.y - c.y) : d;
const farLimit = Math.max(world.effHalfW(), world.effHalfH()) * 1.5 + 350;
```

### 2.5 Player update, contacts, bullets

- `updatePlayer(p, dt, input)`:
  - If `p.downed`: ghost movement only, at `moveSpeed(p) * GHOST_SPEED`, with the same `damp(16)` steering. `dashBuffer = 0`. No regen, shield or noHit. Return.
  - Otherwise the old code, with `p`/`p.stats` and these changes:
    - `p.dashId = ++this.dashSeq`.
    - The `dashNova` ring gets `owner = p.pid`.
    - Dash auto-aim calls `nearestEnemy(p.x, p.y, 400)`.
  - `noHitT` accumulation (old L346–347, including the `runStats.longestNoHit` update) moves **out** of `updatePlayer` into `update()`, once per tick, right after the player loop, and only when at least one player is up. In solo this runs at the same point in the tick under the same condition (old code skipped it when `!p.alive`), so the values are identical.
- `playerContacts()`: for each up player, the old body with `p`. A dash hit calls `perfectDash(p)` and `damageEnemy(..., true, p.pid)`. Contact calls `hurtPlayer(e.damage, e.x, e.y, p.pid)`.
- `updateBullets()`: the off-screen cull is relative to `teamCenter()` with `limit = max(effHalfW, effHalfH) * 2 + 200`. For each bullet, loop the up players in pid order: on a graze call `perfectDash(p)`; on a hit call `hurtPlayer(..., p.pid)`, set `b.dead` and `break`. `b.grazed` is per bullet.
- `perfectDash(p)`: `runStats.perfects++`, `p.run.perfects++`, then the same refund and combo. Slow-mo is `coop ? slowmo(0.6, 0.15) : slowmo(0.35, 0.22)`, so co-op doesn't stutter for everyone.
- `hurtPlayer(raw, sx, sy, pid = 0)`: the old body using `p`. At hp ≤ 0:
  1. `p.revivesUsed < p.stats.revives`: self-revive exactly as today (ring owner = p, clear bullets, slow-mo, `revive` event).
  2. Else, if any **other** player is up: `downPlayer(p)`.
  3. Else: `teamWipe(p)`, which sets `p.hp = 0`, all `alive = false`, `gameOver = true`, and pushes `death {x, y, pid}`.

  In solo, step 2 never happens, so steps 1 and 3 reproduce today's behaviour exactly.
- `downPlayer(p)`:
  - Sets `hp = 0`, `downed = true`, `downs++`, `run.downs++`, `reviveT = 0`, `dashT = 0`, `vx *= 0.2`, `vy *= 0.2`.
  - `hitstop = max(hitstop, 0.06)`, `slowmo(0.4, 0.5)`.
  - Pushes `downed`. If exactly one player is still up, also pushes `laststand`.
- `refreshStats(pid)`: as today. If `p.downed`, don't add the HP gain and keep `hp = 0`.
- `heal(amount, pid)`: no-op for a downed player.

### 2.6 Pickups

- **Solo fast path:** `if (!this.coop) return this.updatePickupsSolo(dt)`. This is today's routine verbatim, with `p = players[0]` and `magnet = p.stats.magnet`. It is kept verbatim because the old code magnetizes even on the death tick, which a generalised version would not.
- **Co-op**, for each pickup:
  1. `age += dt`.
  2. Target:
     - If `magnetized` and `owner ≥ 0` and the owner is up: the owner.
     - Otherwise, find the nearest up player `q` with `d(q) < radius(q, kind)`. `radius` = `q.stats.magnet` for xp/core, else `min(magnet, 60)`. If found and `age > 0.15`: magnetize, `owner = q.pid`.
     - If magnetized and there is still no target: the nearest up player, who also becomes the owner.
  3. Movement is the same formula, using the target's radius.
  4. Collection uses the pre-move distance: the **nearest** up player with `d < q.r + 12` collects.
- `collect(pk, pid)`:
  - xp → `runStats.gems++`, `p.run.gems++`, `addXp(value, pid)`.
  - heart → `heal(value, pid)`.
  - magnet → `magnetizeAll()` (owner = −1 on all, which retargets to the nearest).
  - bomb → `bomb(pid)`.
  - core → team.
  - cache → `p.pendingCaches++`.
  - Event: `pickup {pid}`.
- `bomb(pid)`: the box is centred on `teamCenter()` with `effHalfW + 40` / `effHalfH + 40`. In solo that is the player's position at zoom 1, which is identical. Damage owner = pid, and the `bomb` event fires at the centre.

### 2.7 Downed and revive (`updateRevives(dt)`, co-op only)

```ts
for (const p of players) {
  if (!p.alive || !p.downed) continue;
  let by = -1;
  for (const q of players) if (q !== p && isUp(q) && (q.x-p.x)**2 + (q.y-p.y)**2 <= REVIVE_RADIUS**2) { by = q.pid; break; }
  p.reviveT = by >= 0 ? p.reviveT + dt : Math.max(0, p.reviveT - dt * REVIVE_DECAY);
  if (by >= 0 && p.reviveT >= reviveNeed(p)) {
    p.downed = false; p.reviveT = 0; p.hp = p.stats.maxHp * REVIVE_HP; p.invuln = REVIVE_INVULN;
    p.dashCharges = p.stats.dashCharges; p.dashRecharge = 0;
    addRing(p.x, p.y, 220, 0.4, 40, 600, false, '#ffffff', 0, p.pid);   // shoves the crowd back
    players[by].run.revivesGiven++;
    events.push({ t: 'revived', pid: p.pid, by, x: p.x, y: p.y });
  }
}
```

A ghost keeps its build, rerolls and pending caches, and its weapons stop firing (`updateWeapons` skips players who aren't up). Projectiles, rings and mines it already fired play out normally. Enemies, bullets and pickups ignore ghosts. The reviver is **not** invulnerable while reviving: standing still in the swarm is the price.

### 2.8 XP, level rounds, caches (`PickRequest = { pid: number; cache: boolean }`)

```ts
addXp(amount, pid = 0) { this.xp += amount * this.players[pid]!.stats.xpGain; while (...) { ...; this.xpNext = Math.round(xpForLevel(this.level) * this.scaling.xpReq); this.pendingLevelUps++; ... } }

beginPick(): PickRequest | null {
  for (const p of this.players) if (p.pendingCaches > 0) { p.pendingCaches--; return { pid: p.pid, cache: true }; }
  if (this.levelRound.length === 0 && this.pendingLevelUps > 0) {
    this.pendingLevelUps--;
    for (const p of this.players) if (p.alive) this.levelRound.push(p.pid);   // downed players included (D2)
  }
  const pid = this.levelRound.shift();
  return pid === undefined ? null : { pid, cache: false };
}
hasPendingPicks() { return this.pendingLevelUps > 0 || this.levelRound.length > 0 || this.players.some(p => p.pendingCaches > 0); }
```

In solo this is exactly the old `openLevelUp`/`botResolvePending` order: a cache first, otherwise one level-up, and each counter is decremented before offers are generated, so the `lootRng` draw order is unchanged. `xpNext` is initialised in the constructor as `Math.round(xpForLevel(1) * scaling.xpReq)`; `xpForLevel` returns integers, so solo gets the identical value.

### 2.9 Weapons (`weapons.ts`)

`updateWeapons(world, dt)`: clear `blades` once, then `for (const p of world.players) { if (!world.isUp(p)) continue; const cdMult = world.cooldownMult(p); for (const w of p.build.weapons) ... }`. Every `fire*`/`updateOrbit` gets `p` (player state) and uses `p.stats` instead of `world.stats`. Every pushed projectile, ring, mine and beam gets `owner: p.pid`. Every `rollDamage` and `damageEnemy` passes `p.pid`. Orbit uses `e.orbitHitT[p.pid]` and pushes `{x, y, r, pid}` into `blades`. Evolved lance beams and `follow` rings track `players[owner]`. Missiles retarget from the projectile's position (unchanged) and explode with `pr.owner`.

### 2.10 Difficulty scaling (`director.ts` and `spawnEnemy`)

| Knob | Where | Solo value |
|---|---|---|
| Spawn budget rate | `rate(t) * scaling.spawn` | ×1 |
| Budget cap | `min(60 * scaling.spawn, …)` | 60 |
| Enemy HP | `hpMult(t) * scaling.hp` (non-boss) | ×1 |
| Boss HP | `bossHpMult() * scaling.bossHp` | ×1 |
| Elite interval | `(daily === 'bounty' ? 25 : 50) * scaling.eliteEvery`; initial `45 * eliteEvery` | 50/45 |
| Surge size | `Math.round((12 + t/10) * giants * scaling.surge)` | ×1 |
| Opening ring | `Math.round(12 * scaling.opening)` enemies | 12 |
| Enemy cap | `world.maxEnemies` | 420 |
| XP per level | `xpForLevel × scaling.xpReq` | ×1 |

The reasoning: total enemy HP per second (spawn × HP) ≈ 1.0 / 2.0 / 3.1 / 4.2, which tracks N× player DPS. Bosses get a bit less than N× because a single target soaks less of a crowd-clearing kit. XP needed scales with spawn rate, so per-player level pace ≈ solo. The balance sim (§11.4) tunes these numbers. Enemy damage and speed do **not** scale.

---

## 3. Change list per file

### `src/game/types.ts`

See §1.1. Add `pid`, `ship`, `downed`, `reviveT` and `downs` to `Player`. Add `PlayerRunStats` and `PlayerConfig`. Add `Enemy.tgt` and change `orbitHitT: number[]`. Add `owner` to Projectile, Ring, Mine, Beam and Pickup. Add `RunConfig.players`, then apply the event changes.

### `src/game/runconfig.ts`

- `RunConfigInput` gains `players?: PlayerConfig[]`.
- `makeRunConfig`:
  - `const players = input.players?.length ? input.players.slice(0, MAX_PLAYERS) : [{ ship: input.ship ?? 'spark' }]`
  - `ship: players[0].ship`
  - `daily: players.length > 1 ? null : (input.daily ?? null)`

### `src/game/stats.ts`

- `computeStats(cfg, passives, relics, ship: ShipId = cfg.ship)`: L39 becomes `SHIPS[ship].apply(s)`. `xpForLevel` is unchanged.

### `src/game/content/coop.ts` (new)

See §1.5.

### `src/game/world.ts`

| Lines | Change |
|---|---|
| L32–37 | Keep the constants. `MAX_ENEMIES` stays exported (solo cap). Import the coop constants. |
| L39–59 | `RunStats` and `Build` unchanged. Add `PlayerState` and `PickRequest` exports. |
| L61–64 | `WorldOptions` unchanged (the caller passes the right best score). |
| L78–80, L101, L100 | Remove the `player`, `stats`, `build`, `rerolls` and `pendingCaches` fields. Add `players`, `coop`, `scaling`, `maxEnemies`, `zoom`, `levelRound` and `dashSeq`, plus the alias getters and setters (§1.4). |
| L98 | `xpNext` is initialised in the constructor (scaled). |
| L113–115 | `viewHalfW/H` keep their meaning: the **base** (zoom 1) half extents set by the app. |
| L146–184 | Constructor: same rng fork order (1, 2, 3, 4). Then `scaling`, `maxEnemies`, `xpNext`, `director`, and `players = cfg.players.map(makePlayer)` (spawn offsets per `SPAWN_SPACING`, solo at 0, 0). Then **per player, in pid order**: `addWeapon(SHIPS[ship].weapon, pid)`, `refreshStats(pid)`, `hp = maxHp`, `dashCharges = stats.dashCharges`, `rerolls = stats.rerolls`. |
| L188–192 | `addWeapon(id, pid = 0)`: uses `players[pid].build`. `runStats.maxWeapons = max(...)`. Updates `p.run.maxWeapons`. |
| L194–196 | `hasRelic(id, pid = 0)`. Add `teamHasRelic(id)`. |
| L198–208 | `refreshStats(pid = 0)`: `computeStats(cfg, b.passives, b.relics, p.ship)`. Downed guard (§2.5). |
| L211–216 | `cooldownMult(p: Player = players[0])`: `p.stats.cooldown`, team overdrive, `hasRelic('fever', p.pid)`. |
| L218–223 | `moveSpeed(p = players[0])`: same, per player. |
| L231–262 | `update(dt, input | input[])`: tick order per §2.1. L239 grid centre = `teamCenter()`. Add `noHitT += dt` after the player loop. |
| L266–348 | `updatePlayer(p, dt, input)`: ghost branch. `p.stats` everywhere. L294 aim from p. L307 `p.dashId = ++this.dashSeq`. L310 dash event pid. L321–323 ring owner. L346–347 noHit moves to `update()`. |
| L350–352 | `isPlayerInvulnerable(pid = 0)`. |
| L354–366 | `perfectDash(p)`: per-player stats, co-op slow-mo, event pid. |
| L369–377 | `settleDashRecharge(p)`: `dashready {pid}`. |
| L379–403 | `playerContacts()`: loop up players (§2.5). L396 `rollDamage(…, p.pid)`. L397 owner. |
| L405–447 | `hurtPlayer(raw, sx, sy, pid = 0)`: §2.5 (self-revive, then down, then wipe). L425–428 combo halving unchanged (team). |
| L449–454 | `heal(amount, pid = 0)`: `heal {pid}`. No-op when downed. |
| L458–530 | `spawnEnemy`: L461 `this.maxEnemies`. L465: HP uses `d.hpMult(t)` / `d.bossHpMult()`, which now include scaling (put the multiplication **inside** the Director methods). Init `tgt: 0` and `orbitHitT: new Array(players.length).fill(-99)`. |
| L532–537 | `rollDamage(base, owner = 0)`: `players[owner].stats`. |
| L540–552 | `damageEnemy(e, dmg, crit, dx, dy, knock, viaDash = false, owner = 0)`: L550 `hasRelic('exec', owner)`. `p.run.damage += dmg`. L551 `killEnemy(e, viaDash, owner)`. |
| L554–618 | `killEnemy(e, viaDash = false, owner = 0)`: credit (`run.kills`, `run.dashKills`). L570 bounty uses the owner. Boss: L572–573 loop `players.length` times for cache and heart (solo: once, identical rng use). L581 elite bounty uses the owner. L585 luck uses the owner's. L605 vamp heals the owner if up. L607 `kill` event pid. |
| L620–634 | `nearestEnemy` unchanged (callers pass their origin). |
| L637–652 | `spawnPoint(margin)`: centre and velocity from `teamCenter()`/`teamVelocity()`, `hw/hh = effHalfW/H()`. Co-op only: up to 3 retries (more `posRng` draws) while within `SPAWN_CLEARANCE` of any up player. Solo never retries, so the rng sequence is identical. |
| L654–669 | `fireBullet`: L656 `teamHasRelic('chrono')`. |
| L673–700 | `addRing(..., delay = 0, owner = 0)`: stores the owner. |
| L706–770 | `updateProjectiles`: `rollDamage(pr.damage, pr.owner)`. `damageEnemy(..., false, pr.owner)`. `explode(..., pr.owner)`. |
| L773–791 | `explode(x, y, radius, base, color, skipId = -1, owner = 0)`. |
| L793–824 | `updateRings`: drop `const p`. `follow` uses `players[ring.owner]`. Rolls use the owner. |
| L826–877 | `updateMines`: explode with `m.owner`. |
| L879–913 | `updateBeams`: evolved beams follow `players[b.owner]`. Rolls use the owner. |
| L915–942 | `updateBullets`: §2.5. |
| L946–982 | `dropXp` unchanged. `dropPickup`: `owner: -1`. |
| L984–986 | `magnetizeAll`: also set `owner = -1`. |
| L988–1015 | `updatePickups`: solo fast path plus the co-op version (§2.6). |
| L1017–1041 | `collect(pk, pid)`. |
| L1043–1056 | `bomb(pid = 0)`: §2.6. |
| L1058–1067 | `addXp(amount, pid = 0)`: §2.8. |
| L1079–1090 | `addCombo`: L1085 `comboTimer = this.comboWindow()`. |
| L1092–1098 | `triggerMilestone`: Nova Burst loops up players (owner = pid). |
| new | `isUp`, `alivePlayers`, `presentPlayers`, `teamCenter`, `teamVelocity`, `effHalfW/H`, `nearestUpPlayer`, `comboWindow`, `reviveNeed`, `beginPick`, `hasPendingPicks`, `pendingPicksFor`, `applyLeash`, `updateZoom`, `updateRevives`, `downPlayer`, `teamWipe`, `makePlayer`. |

### `src/game/weapons.ts`

| Lines | Change |
|---|---|
| L6–22 | `updateWeapons`: per up player loop (§2.9). Drop L8 `if (!world.player.alive) return`. `shoot` event unchanged. |
| L24–41 | `fireWeapon(world, p, w, st)`. |
| L43–77 | `firePulse`: `p` param, `s = p.stats`, owner on the projectile. |
| L79–112 | `updateOrbit`: `p`, `s = p.stats`, L97/L102 `e.orbitHitT[p.pid]`, blades `pid`, L109–110 owner. |
| L114–124 | `fireNova`: `p`, ring owner (`addRing(..., i*0.25, p.pid)`). |
| L126–158 | `fireArc`: `p`, `rollDamage(st.damage, p.pid)`, crit bonus uses `p.stats.critMult`, `damageEnemy(..., false, p.pid)`. |
| L160–191 | `fireSeeker`: `p`, owner. |
| L193–213 | `fireMines`: `p`, owner. |
| L215–244 | `fireLance`: `p`, owner. |

### `src/game/enemyai.ts`

| Lines | Change |
|---|---|
| L7–10 | Drop `const p`. `slow` uses `teamHasRelic('chrono')`. `farLimit` uses `effHalfW/H`. Compute `c = world.teamCenter()` once (solo: the player). |
| L18–20 | `const p = targetOf(world, e)` per enemy, then `dx/dy/d` from p. |
| L23–32 | Recycle test `far > farLimit` (§2.4). After respawning, recompute relative to `p`. |
| L158–178 (`updateShooter`) | Unchanged (it receives `d` to the target). |
| L180–190 | Unchanged (`fireBullet` handles chrono). |
| new | `targetOf` (§2.4). |

### `src/game/director.ts`

| Lines | Change |
|---|---|
| L14–29 | **Keep the private field names** (`openingDone`, `surgeT`, `eliteT`, `budget`, `bossIdx`, `nextOvertimeBoss`): `tests/game.test.ts quiet()` pokes them. Add `private readonly scale = coopScaling(cfg.players.length)`. `eliteT = 45 * scale.eliteEvery` (set in the constructor). |
| L32–38 | `rate`: `* this.scale.spawn` at the end. |
| L40–44 | `hpMult`: `return m * this.scale.hp`. |
| L54–56 | `bossHpMult`: `(1 + overtimeCycle * 0.8) * this.scale.bossHp`. |
| L73–83 | Opening wave around `world.teamCenter()`, `n = Math.round(12 * scale.opening)`. |
| L98–99 | `min(60 * scale.spawn, …)`. |
| L119–136 | Surge: `n *= scale.surge` inside `Math.round`. Radius `max(effHalfW, effHalfH) * 0.95 + 40`. Centre = team centre. |
| L139–146 | Elite interval `* scale.eliteEvery`. |
| L168–179 | `spawnBoss` around the team centre, `d = min(effHalfW, effHalfH) * 0.9 + 120`. |

### `src/game/upgrades.ts`

| Lines | Change |
|---|---|
| L34–42 | `availableEvolutions(world, pid = 0)`: `players[pid].build`. |
| L49–87 | `offerCandidates(world, cache, pid = 0)`: `const p = world.players[pid]; const { build, stats } = p`. |
| L93–149 | `generateOffers(world, count, cache = false, pid = 0)`. Fillers (L139–143): skip `heal` if `p.downed`. |
| L151–192 | `applyOffer(world, offer, pid = 0)`: `build = players[pid].build`. `addWeapon(id, pid)`. Evolve bumps `runStats.evolutions` and `p.run.evolutions`. Shield sets `p.shieldReady`. Heal: `world.heal(p.stats.maxHp * 0.4, pid)`. `refreshStats(pid)`. |

### `src/game/bot.ts`

| Lines | Change |
|---|---|
| L16–79 | `botInput(world, rng, opts, pid = 0)`: `p = world.players[pid]`. If `p.downed`, steer toward the nearest up teammate and return `{dash: false}` without drawing from the rng. Co-op only, applied after the threat sum: **(a) revive duty**: when `pressure < 2.5` and a downed teammate is within 900, add `2.0 ×` the unit vector toward them, which overrides shard hunting; **(b) cohesion**: when the distance to `teamCenter()` exceeds `0.35 × maxSpanX`, add `0.8 ×` the unit vector toward it. Solo skips both, so its rng use is identical. |
| L81–89 | `botPick(world, offers, rng, pid = 0)`: L87 `world.players[pid].build`. |
| L92–101 | `botResolvePending(world, rng, applyFn: (o: Offer, pid: number) => void)`: `while (guard++ < 50 * players.length && world.hasPendingPicks()) { const r = world.beginPick()!; applyFn(botPick(world, generateOffers(world, 3, r.cache, r.pid), rng, r.pid), r.pid); }`. Old callers `(o) => applyOffer(w, o)` stay correct for solo. Update the production callers to `(o, pid) => applyOffer(w, o, pid)`. |

### `src/core/bindings.ts` (new)

Key tables shared by `Input` and `UI` (§6.2).

### `src/core/input.ts`

| Lines | Change |
|---|---|
| L5–16 | Keep `MOVE_KEYS`, `DASH_KEYS` and `PAUSE_KEYS` as the **solo** maps (unchanged). Import the kbA/kbB tables from `bindings.ts`. |
| L42–60 | Add `mode: 'solo' \| 'coop'`, `slots: InputSlot[]`, `menuMode: 'none' \| 'slots'`, `dashQueuedBy: Record<InputSlot, boolean>`, `pads: PadState[4]` (`{connected, id, axes, prev, navPrev}`), `allowCtrlDash = false` (the app sets it true in Electron), `onMenu: ((slot, action) => void) \| null`, `onSlotLost: ((slot) => void) \| null`. |
| L64–81 | keydown: solo behaves exactly as today. In co-op, classify via `slotForKey(code)`: queue a dash for that slot, `preventDefault` every game key while `gameActive` (including Enter, Numpad0, ShiftRight and ControlRight). When `menuMode === 'slots'`, emit `onMenu(slot, action)` and `preventDefault`. |
| L104–135 | Pointer: touch is ignored in co-op (`mode === 'coop'`). The mouse steers/dashes the **kbA** slot if it has joined, otherwise it is ignored (it still clicks DOM buttons). |
| L173–228 | `pollGamepad()`: poll **all** pads into `pads[i]` (by `gamepad.index`). Solo still reads "first connected pad" as today, so `padAxes`, `dashQueued` and `onPadNav` stay the same. Co-op: per-pad dash edges go to `dashQueuedBy['pad'+i]`, Start on any pad sets `pauseQueued`. Nav edges go to `onMenu('pad'+i, …)` when `menuMode === 'slots'`, otherwise to `onPadNav(nav)` (any pad can drive the pause and results menus). A pad that was connected and now isn't, while in `slots`, calls `onSlotLost`. |
| L231–271 | `read()` unchanged (solo). **New** `readSlot(slot, psx, psy): ControlInput` sums only that slot's keys/pad (plus the mouse for kbA), normalises, and consumes `dashQueuedBy[slot]`. |
| new | `setMode('solo')`, `setMode('coop', slots)`, `padConnected(i)`, `connectedPads(): number[]`, `anyGamepad()`. `releaseAll()` also clears `dashQueuedBy`. |

### `src/render/palette.ts`

Add `PLAYER_COLORS` and `PLAYER_MARKS` (§1.5).

### `src/render/renderer.ts`

| Lines | Change |
|---|---|
| L60 | `trail` becomes `trails: {x,y}[][]` (one per pid). |
| L117–129 | `reset(world)`: camera = `world.teamCenter()`. Clear the trails. Add `hud.hpFlash` per pid. |
| new | `worldToScreen(x, y): [sx, sy]` (device px, zoom-aware), used by the app for mouse steering. |
| L139–276 `consume` | Helper `at(ev)` = `ev.pid !== undefined ? world.players[ev.pid] : world.teamCenter()`. **L167, 169, 171 (pickup), L183 (dashready), L203 (heal)**: use `at(ev)`. **L176 (levelup)**: a ring on every present player. **L213, 261, 265, 269 (milestone, magnet, newbest, victory)**: `world.teamCenter()`. `hurt`: co-op flash 0.2 instead of 0.35, plus `hud.hpFlash[pid] = 1`. `cache` subtitle `P2 · Bonus upgrade` in co-op. New cases: `downed` (grey shatter burst plus callout `P2 DOWN` / "Get close to revive", shake 0.4), `revived` (callout `P2 BACK IN THE FIGHT`, ring in the player colour), `laststand` (callout `LAST PILOT STANDING`). Solo `death` and `revive` are unchanged. |
| L303–309 | Camera. Solo: identical (`p` = players[0], look-ahead 0.12, `damp(7)`). Co-op: target = `teamCenter() + teamVelocity() * 0.08`, `damp(10)`, then clamp so every present player is ≥ 30 world units inside the view (§5.4). |
| L311 | `const k = this.scale * this.dpr / world.zoom` (solo: `/1`, identical). Background and culling (L316–324) then follow automatically. |
| L486–488 | Blades: unchanged colour. Optionally tint by `bl.pid` in co-op. |
| L507–568 | Player block becomes `for (const p of world.players) drawShip(p, …)`. Colour: solo `settings.trail` (unchanged); co-op `PLAYER_COLORS[pid]`. Ghosts (`downed`): sprite at alpha 0.35 in `#8890b0`, no trail, a dashed `REVIVE_RADIUS` circle, a progress arc `reviveT / reviveNeed(p)` in the player colour, and "REVIVE" text the first time. Co-op only: a name tag `▲P1` 14 world units above the ship, a mini HP arc under ships below max HP, and the magnet hint per player. Ships and tags are drawn at `mul = Math.sqrt(world.zoom)` so they stay readable when zoomed out. |
| L576–584 | Low-HP vignette: **solo only** (co-op shows per-player panel flashes and an arc instead). |
| L594 | `drawHud(…)` dispatches solo or co-op (see `hud.ts`). |

### `src/render/hud.ts`

- Split into `drawTopStrip(ctx, world, …)`: the XP bar (L45–51), timer and boss (L166–188), and score, best and combo (L190–243). L224 `stats.comboWindow` becomes `world.comboWindow()`.
- `drawSoloHud` keeps L53–164 and L245–279 verbatim with `p = world.players[0]`.
- `drawCoopHud` is new (§7).
- `HudState` gains `hpFlash: number[]` (solo uses `hpFlash[0]`; keep the scalar `hpFlash` as an alias or migrate both call sites).
- The FPS line moves above the co-op panels.

### `src/render/background.ts`

No logic change: it already takes `k`, so the zoomed `k` makes the grid and stars scale. **Coordinate with the galaxy-backdrop workstream**: sector backdrops must take the effective `k` (zoom-aware), and the warp transition should key off `teamCenter()`.

### `src/audio/audio.ts`

`consume` (L194–336) adds `downed` (`tone(330, 0.5, saw → 90)` plus noise 0.4), `revived` (the existing revive arpeggio, transposed up a fourth) and `laststand` (two low saw stabs). The existing `ok()` rate limits already cap N× `shoot`/`hit` spam.

### `src/app.ts`

| Lines | Change |
|---|---|
| L22 | `State` adds `'lobby'`. |
| L38–39 | `offers`/`offerIsCache` become `offers` plus `currentPick: PickRequest \| null`. Add `coop: { roster: RosterEntry[] } \| null`, `lobby: CoopLobby \| null`, `botRngs: Rng[]`. |
| L62–67 | `input.onPadNav` unchanged. New `input.onMenu = (slot, a) => this.onMenu(slot, a)` routes to the lobby or co-op level-up. `input.onSlotLost` auto-pauses with the toast `P2's controller disconnected`. `input.allowCtrlDash = platform.isDesktop` (from the Steam/Electron workstream). |
| L69–108 | UI callbacks: add `openCoop()`, `startCoop()`, `lobbyMouse(slotIdx, action)`, `again()`; change to `pick(i, slot?)` and `reroll(slot?)`. |
| L137, L326 | `showTitle(save, daily, touch, coopAvailable)` where `coopAvailable = !touchOnly \|\| input.anyGamepad()`. |
| L175–182 | `newAttractWorld`: optional (nice-to-have) every other attract world is 2P (`players: [{ship:'spark'},{ship:'vanguard'}]`), driven by `botInput(w, rng, …, pid)`. |
| L186–235 | `startRun(daily, roster?)`. Co-op: `cfg.players = roster.map(r => ({ship: r.ship}))`, daily false, `best = save.coop.best[n] ?? 0`, `input.setMode('coop', roster.map(r => r.device))`, no tutorial. Solo: `input.setMode('solo')`, unchanged. Warp: `botResolvePending(w, rng, (o, pid) => applyOffer(w, o, pid))`, bots for every pid. |
| L237–243 | `pause` unchanged (the UI renders co-op builds). |
| L256–268 | `openLevelUp()`: `const r = w.beginPick(); if (!r) return this.resume(); this.currentPick = r; this.offers = generateOffers(w, 3, r.cache, r.pid); input.menuMode = coop ? 'slots' : 'none'; ui.showLevelUp(offers, { cache, rerolls: p.rerolls, level, world, pid, coop: !!this.coop, round: {...}, device: roster[pid].device })`. |
| L270–284 | `pick(i, slot?)`: in co-op, if `slot` is given and isn't `roster[currentPick.pid].device`, return. Mouse clicks and autoplay pass no slot and are accepted. Then `applyOffer(w, offer, pid)`. Next: `w.hasPendingPicks() ? openLevelUp() : resume()`. |
| L286–297 | `reroll(slot?)`: same slot gate. Uses `w.players[pid].rerolls`, regenerating with `(…, cache, pid)`. |
| L299–318 | `endRun`: `resultFromWorld` (co-op aware). Then `input.setMode('solo')`, `input.menuMode = 'none'`. `ui.showResults(summary, save, touch)`; the co-op layout is chosen from `result.players`. |
| L320–327 | `toTitle`: clears `coop`/`lobby`. |
| L341–361 | `frame`: the `lobby` state calls `this.lobby.update(realDt)` and starts the run on `'start'`, and keeps stepping the attract world behind the lobby. |
| L382–419 | `stepGame`. Solo input path unchanged. Co-op: `const inputs = w.players.map((p, i) => this.debug.autoplay \|\| roster[i].device === 'bot' ? botInput(w, this.botRngs[i], {skill: 0.9}, i) : this.input.readSlot(roster[i].device, ...this.renderer.worldToScreen(p.x, p.y)))`. Tutorial hooks are solo only (L407–411). L416 break condition: `w.gameOver \|\| w.hasPendingPicks()`. |
| L444–450 | Autoplay `pick(0)` (no slot) works for every pid. |
| L468 | `if (w.hasPendingPicks()) this.openLevelUp()`. |
| L505–512 | `readDebugParams` adds `coop=N` (start an N-player run immediately, with kbA/kbB/pads auto-assigned or `bot` for missing devices) and `bots` (shows "Add bot" in the lobby). |

### `src/ui/lobby.ts` (new, pure, unit-testable)

```ts
export type RosterDevice = InputSlot | 'bot';
export interface RosterEntry { device: RosterDevice; ship: ShipId }
export interface LobbySlot extends RosterEntry { ready: boolean }
export class CoopLobby {
  slots: (LobbySlot | null)[] = [null, null, null, null];
  countdown = -1;                                   // seconds; -1 = idle
  constructor(private unlocked: ShipId[], private p1Ship: ShipId, prev?: RosterEntry[]) {}
  action(device: RosterDevice, a: MenuAction): boolean   // returns true if the state changed (UI re-renders)
  update(dt: number): 'start' | null
  roster(): RosterEntry[]                                // joined slots, compacted in slot order
}
```

Rules:

- Join puts the player in the lowest free slot. One slot per device.
- The default ship is `p1Ship` for the first slot, then the next unlocked ship not already taken (duplicates are allowed once all are taken).
- `left`/`right` cycles through unlocked ships while not ready. `confirm` toggles ready. `back` un-readies, or leaves if not ready.
- When ≥ 2 slots are joined and all are ready, `countdown = 2.0`. Any change resets it to −1. Reaching 0 returns `'start'` once.

### `src/ui/ui.ts`

| Lines | Change |
|---|---|
| L19 | `ScreenId` adds `'lobby'`. L65: add `'lobby'` to the screen ids. |
| L21–46 | Callbacks per the `app.ts` section. |
| L146–197 `onKey` | `lobby`: only Escape (back to title). `levelup` in co-op: return early, because the Input slot router handles it (§8). `results`: Enter calls `cb.again()`. In co-op, `pause`/`victory`/`results` also accept W/A/S/D for focus moves and E for activate. |
| L200–219 `padNav` | Unchanged. In co-op it receives nav from every pad on non-slot screens. |
| L248–307 `showTitle` | Add `<button class="btn" data-act="coop"><span>Co-op</span><span class="meta">1–4 pilots</span></button>` to `.menu-grid` when `coopAvailable`. |
| new `showLobby(lobby, save)` / `renderLobby()` | §6.3. |
| L508–565 `showLevelUp` | Extra opts `{ pid, coop, color, shipName, round: { level, index, total }, hints }`. Co-op header, chips and hint row (§8). Cards get `--pc`. L526 uses `opts.world.players[pid].build`. L551 reroll label with the per-device key. |
| L573–595 `showPause` | Co-op: one `.build-list` column per player, headed `▲ P1 · SPARK`. |
| L597–612 `showVictory` | Co-op copy: "Your squad outlasted the storm…". |
| L616–722 `showResults` | Co-op: eyebrow `Co-op · 2 pilots`. A `.coop-table` with one row per player (mark, ship, kills, damage, perfects, downs, revives) plus awards. Best score and stamp compare against co-op best for N. "Play again" calls `cb.again()` (same roster). |
| L406–443 `showRecords` | Add rows `Co-op runs`, `Co-op best (2P / 3P / 4P)`, `Co-op victories`. |
| new `menuAction(slot, action)` | Called by the app for lobby and co-op level-up actions. |

### `src/ui/style.css`

New styles:

- `.lobby` (4-column grid, which wraps to 2×2 under 900 px).
- `.slot-card` with `--pc`, `.slot-card.empty` (pulsing "press to join"), `.slot-card.ready` (border glow), `.countdown`.
- `.lu-who`, `.lu-chips` and `.lu-hints`.
- `.offer` border tinted by `--pc` in co-op.
- `.coop-table` and `.award`.

### `src/meta/result.ts`

- `RunResult` gains **optional** fields, so the `run()` literal in `tests/meta.test.ts` still type-checks:
  - `players?: number` (absent = solo)
  - `team?: { ship: ShipId; kills: number; damage: number; perfects: number; downs: number; revivesGiven: number; maxWeapons: number }[]`
  - `perfectsTeam?: number`
  - `scoreNorm?: number`
- `resultFromWorld`, co-op:
  - `perfects` = **best individual** (keeps the "10 perfect dashes in one run" achievement and mission honest).
  - `perfectsTeam` = team total (lifetime stat).
  - `maxWeapons` = per-player max.
  - `coreGain` = max over players. L52: in solo, `players[0].stats.coreGain` is identical.
  - `scoreNorm = floor(score / scaling.spawn)`.
  - `daily` false.

### `src/meta/save.ts`

- `SAVE_VERSION = 2` (L73).
- `SaveData` (L54) adds `coop: { runs: number; victories: number; best: Record<string, number>; revives: number; lastRoster: { device: string; ship: ShipId }[] }`.
- `defaultSave` adds `coop: { runs: 0, victories: 0, best: {}, revives: 0, lastRoster: [] }`.
- `migrate` (L128) merges `coop: { ...base.coop, ...(r.coop ?? {}), best: { ...(r.coop?.best ?? {}) } }`, drops roster entries whose ship isn't in `SHIPS`, and forces `lastRoster` to an array.
- `RunRecord` gains `players?: number`.

### `src/meta/progression.ts`

`applyRun`, when `(r.players ?? 1) > 1`:

- Lifetime: `runs`, `kills`, `timePlayed`, `bossKills`, `elites`, `dashKills`, `gems`, `evolutions` and `victories` add **team** values. `perfects += r.perfectsTeam`. `bestTime` and `bestLevel` update (survival unlocks progress in co-op).
- **`bestScore` and `bestCombo` are NOT updated.** These solo score-chase records stay comparable.
- `coop.runs++`, `coop.victories`, `coop.best[n] = max(…)`, `coop.revives += Σ revivesGiven`.
- `newBest.score` compares against `coop.best[n]`. `prevBest.score` = `coop.best[n]` before the run.
- Cores: `baseCores(r.scoreNorm, r.time, r.coreGain)`. Rank XP: `rankXpForRun(r.scoreNorm, r.time)`. Normalising stops co-op from being a core or rank farm.
- Missions: `applyRunToMissions(save, r)`, but definitions flagged `coop: false` are skipped (see `missions.ts`).
- Daily: never.
- `history.push({…, players: n})`.
- `nearMiss` compares against the co-op best for N.

### `src/meta/missions.ts`

- `MissionDef` gains `coop?: boolean` (default true). Set `coop: false` on `score` (team score is inflated by the spawn multiplier) and `daily`.
- `missionsSatisfiedLive` and `applyRunToMissions` skip those defs when `(r.players ?? 1) > 1`.
- All other missions use team values. That makes co-op a little easier, which is acceptable for a social mode on a shared save.

### `src/meta/achievements.ts`

Ruling for all 21:

- **Count unchanged in co-op:** `first_run`, `survive3`, `survive5`, `victory`, `warden`, `hydra`, `voidheart`, `perfect10` (best individual), `evolve`, `arsenal` (per-player max), `kills1k`, `kills10k`, `nohit2` (team no-hit), `level30`, `rank10`, `nightmare`.
- **Code change:** `combo150` and `combo500` become `s.stats.bestCombo >= N || has(r, x => x.maxCombo >= N)`, so they can unlock from co-op even though `bestCombo` stays solo-only.
- **Solo-only by construction:** `score100k` (it reads `stats.bestScore`).
- **Not applicable:** `daily3`, `investor`.
- **Optional new achievements** (coordinate with the Steam achievement list): `squad` "Squad Goals: win a co-op run" (`s.coop.victories >= 1`), and `medic` "No Pilot Left Behind: revive teammates 10 times" (`s.coop.revives >= 10`, with progress).

### `src/meta/daily.ts`

No change. Co-op never reaches it.

### Tests and e2e

See §11:

- `tests/helpers.ts`: `simulateRun` accepts `players?: ShipId[]`. `SimResult` gains `downs`, `revives`, `players`.
- `tests/balance.sim.ts`: new 2P profiles.
- New `tests/coop.test.ts`, `tests/golden.solo.test.ts`, `tests/lobby.test.ts`, `tests/bindings.test.ts`, `tests/no-p1-alias.test.ts`, `e2e/coop.spec.ts`.
- `tests/game.test.ts`, `tests/meta.test.ts`, `tests/core.test.ts` and `e2e/smoke.spec.ts`: **no edits**.

### `docs/GAME_DESIGN.md`

Add "§3.5 Co-op". Update the controls table (§8) with kbA/kbB. Add the co-op rows to balance (§6).

---

## 4. Consumer API (what app, renderer, HUD and UI read)

```ts
world.players: readonly PlayerState[]          // length N, index = pid
world.coop: boolean
world.players[i].{ pid, ship, x, y, vx, vy, facingX, facingY, hp, alive, downed, reviveT, downs,
                   dashT, dashCharges, dashRecharge, invuln, hurtT, shieldReady, shieldT,
                   stats: Stats, build: Build, rerolls, pendingCaches, run: PlayerRunStats }
world.isUp(p) / world.alivePlayers() / world.presentPlayers()
world.teamCenter() / world.teamVelocity()       // camera, team-event placement
world.zoom / world.effHalfW() / world.effHalfH()
world.reviveNeed(p)                             // ghost progress ring and HUD bar
world.level / xp / xpNext / pendingLevelUps     // team
world.levelRound: readonly number[]             // pids still to pick this round (level-up chips)
world.pendingPicksFor(pid): number              // HUD "2 picks queued"
world.hasPendingPicks(): boolean
world.beginPick(): PickRequest | null           // app and bot only
world.combo / comboTimer / comboWindow() / overdriveT / score   // team
world.blades: { x, y, r, pid }[]
world.events (with pid on per-player events)

// upgrades.ts
generateOffers(world, count, cache, pid) / applyOffer(world, offer, pid) / availableEvolutions(world, pid)
// bot.ts
botInput(world, rng, opts, pid) / botPick(world, offers, rng, pid) / botResolvePending(world, rng, (o, pid) => …)
// input.ts
input.setMode('solo' | 'coop', slots?) / input.readSlot(slot, sx, sy) / input.menuMode / input.onMenu / input.onSlotLost
// renderer.ts
renderer.worldToScreen(x, y)
```

---

## 5. Camera, zoom and leash math

Definitions: `B` = base half extents `(Wb, Hb) = (viewHalfW, viewHalfH)`, set by the app from the canvas exactly as today. `Z` = zoom. Effective half extents: `(Wb·Z, Hb·Z)`. `S` = the present players (`alive`, including ghosts).

### 5.1 Team centre

`box = [minX, maxX] × [minY, maxY]` over S. `centre = ((minX + maxX) / 2, (minY + maxY) / 2)`. Solo returns the player's position directly (no arithmetic).

### 5.2 Zoom (sim, `updateZoom(dt)`, co-op only; solo `Z ≡ 1`)

```
spanX = maxX - minX, spanY = maxY - minY
zFit    = max((spanX/2 + CAM_MARGIN) / Wb, (spanY/2 + CAM_MARGIN) / Hb)
zTarget = clamp(zFit, 1, ZOOM_MAX)
Z += (zTarget - Z) * damp(zTarget > Z ? ZOOM_OUT_RATE : ZOOM_IN_RATE, dt)
// Hard guarantee: never let a lagging zoom put a player outside the view
zNeed   = max((spanX/2 + LEASH_EDGE) / Wb, (spanY/2 + LEASH_EDGE) / Hb)
Z = clamp(max(Z, zNeed), 1, ZOOM_MAX)
```

Zooming out is fast (rate 4) so nobody falls off screen. Zooming in is slow (rate 1.2) so the camera doesn't pump when players oscillate.

### 5.3 Leash (sim, `applyLeash()`, co-op only, runs right after all players move)

```
maxSpanX = 2 * (Wb * ZOOM_MAX - LEASH_EDGE)
maxSpanY = 2 * (Hb * ZOOM_MAX - LEASH_EDGE)
for p in S (pid order):
  [oMinX, oMaxX, oMinY, oMaxY] = bbox of S \ {p}       (skip if S \ {p} is empty)
  lo = oMaxX - maxSpanX; hi = oMinX + maxSpanX
  if lo > hi: p.x = (lo + hi) / 2                      // only after a window shrink
  else if p.x < lo: p.x = lo; if p.vx < 0: p.vx = 0
  else if p.x > hi: p.x = hi; if p.vx > 0: p.vx = 0
  (same for y with maxSpanY)
```

This **blocks** a player at the edge and never drags the others. Processing in pid order guarantees `span ≤ maxSpan` after the pass. A dash into the leash simply stops on that axis; dash invulnerability continues. Worked example, 1366×768 desktop (Wb ≈ 700, Hb ≈ 400): maxSpan = 1890 × 1020 world units, which is plenty of room. On a 1280×720 window (Wb ≈ 656, Hb ≈ 369): 1762 × 930.

Renderer feedback: when a player is pinned (`p.x === lo` or `hi`), draw a soft vertical gradient glow on that screen edge in their colour (alpha 0.25, pulsing).

### 5.4 Renderer camera (co-op)

```
target = teamCenter() + teamVelocity() * 0.08
cam += (target - cam) * damp(10, realDt)
k = scale * dpr / Z
// keep every present player at least 30 units inside the visible rect despite smoothing
viewW = w/2/k; viewH = h/2/k
camX = clamp(camX, maxX - (viewW - 30), minX + (viewW - 30))   // if the interval is inverted, use the bbox centre
camY likewise
```

Spawning uses the sim's view (`teamCenter`, `effHalfW/H`), not the renderer camera, so the simulation stays deterministic and screen-independent apart from the base half extents (true today too).

### 5.5 Grid coverage

`SpatialGrid(64, 2048)` covers ±2048 around the team centre. At `ZOOM_MAX`, 1366-wide: effHalfW 1015, spawn ring about 1100, recycle limit 1015 × 1.5 + 350 ≈ 1870, all inside. Ultrawide 2560×1080 reaches about 2070. Items outside the window clamp into the border cells, and the grid stays correct (documented in `grid.ts`), so no change is needed.

---

## 6. Input devices and the co-op lobby

### 6.1 Modes

- **Solo** (default, and always for touch): `Input.read()` exactly as today. Every keyboard key, the mouse, touch and the first pad merge into P1.
- **Co-op**: `Input.setMode('coop', roster devices)`. Each player reads only their device through `readSlot`. Touch is ignored. The mouse merges into kbA if kbA has joined. Pause: Esc/P (keyboard) or Start (any pad).

### 6.2 Bindings (`src/core/bindings.ts`)

| Action | kbA | kbB | Gamepad *i* (standard mapping) |
|---|---|---|---|
| Move | W A S D | ← ↑ → ↓ | left stick / d-pad (dead zone 0.2) |
| Dash | Space, ShiftLeft | ShiftRight, Numpad0, ControlRight (**desktop build only**) | A(0), LB(4), RB(5), LT(6), RT(7) |
| Pause (anyone) | Esc / P | Esc / P | Start(9) |
| Lobby join / ready | Space or E | Enter | A |
| Lobby ship ◀ ▶ | A / D | ← / → | d-pad / stick |
| Lobby un-ready / leave | Q | Backspace | B(1) |
| Level-up move focus | A / D (W/S also) | ← / → (↑/↓ also) | d-pad / stick |
| Level-up confirm | E | Enter / NumpadEnter | A |
| Level-up direct pick | 1 2 3 | Numpad1 2 3 | — |
| Reroll | R | Backspace | X(2) |

```ts
export type InputSlot = 'kbA' | 'kbB' | 'pad0' | 'pad1' | 'pad2' | 'pad3';
export type MenuAction = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'back' | 'reroll' | 'pick0' | 'pick1' | 'pick2';
export function slotForKey(code: string, allowCtrl: boolean):
  { slot: 'kbA' | 'kbB'; move?: [number, number]; dash?: boolean; menu?: MenuAction } | null;
```

Why the deviations from the brief:

1. Enter is kbB's confirm, not a dash key, so the level-up anti-mash rule ("the picker's dash keys never confirm") holds for both keyboard players.
2. RightCtrl only in Electron, because of the browser's Ctrl+W/Ctrl+D shortcuts.
3. ShiftRight is the reliable kbB dash on laptops without a numpad.

Keep the solo extras (`KeyJ`, `KeyK`) in solo only.

**Rollover note:** two people on one keyboard can hit key-rollover and ghosting limits (WASD + Space together with arrows + RShift). Shift keys are usually safe modifiers. The lobby shows "Tip: gamepads are best for 3–4 pilots". Steam Remote Play Together sends a remote guest's keyboard as host key events, and since kbA and kbB use **disjoint** keys, a remote keyboard guest just plays as kbB.

### 6.3 Lobby UX (`#screen-lobby`)

```
CO-OP · LOCAL                                            ESC back
┌─ P1 ▲ ──────────┐ ┌─ P2 ● ──────────┐ ┌─ P3 ■ ─────────┐ ┌─ P4 ◆ ─────────┐
│  [ship art,     │ │  [ship art,     │ │                │ │                │
│   tinted cyan]  │ │   tinted lime]  │ │  PRESS TO JOIN │ │  PRESS TO JOIN │
│ ◀  SPARK   ▶    │ │ ◀ VANGUARD ▶    │ │  SPACE  (WASD) │ │  Ⓐ  controller │
│ Balanced…       │ │ +40 HP, +2 armor│ │  ENTER (arrows)│ │                │
│ Starts: Pulse   │ │ Starts: Orbit   │ │  Ⓐ controller  │ │                │
│ [ READY ✓ ]     │ │ [ Ready? ENTER ]│ │                │ │                │
│ WASD · SPACE    │ │ ARROWS · RSHIFT │ │                │ │                │
└─────────────────┘ └─────────────────┘ └────────────────┘ └────────────────┘
          Need 2+ pilots · all ready to launch · 2 controllers detected
                         LAUNCHING IN 2…  (when all ready)
```

- Opened by the title's **Co-op** button. `app.state = 'lobby'` and `input.menuMode = 'slots'`, and the attract world keeps playing behind the scrim.
- Device hints on empty slots list only devices that haven't joined. Pads appear when the browser exposes them, which needs a button press per pad; "press Ⓐ to join" covers that.
- Each card has mouse buttons (◀ ▶ Ready Leave) acting for that slot, for accessibility and e2e. With `?bots`, an "Add bot" button fills the next slot with `device: 'bot'` (bot-driven, used for testing and attract).
- Ships: only `unlockedShips(save)` can be chosen. Locked ships are skipped. Workshop, rank and hard mode come from the shared save.
- Countdown 2.0 s when ≥ 2 players have joined and all are ready. Any change cancels it. When it ends: `save.coop.lastRoster = roster`, then `startRun(false, roster)`.
- When the lobby opens it pre-fills nothing, but it **remembers ships per device** from `lastRoster` when that device joins.
- Results → "Play again" restarts with the same roster if all of its pads are still connected. Otherwise it opens the lobby with the roster pre-joined, minus missing devices.
- A pad disconnecting mid-run auto-pauses with "P2's controller disconnected · reconnect it, or press Ⓐ / ENTER / SPACE on a free device to take over P2". Any **unassigned** device's confirm rebinds that slot. Resuming without a device leaves P2 idle (its ship still auto-fires).

---

## 7. HUD layout (co-op, canvas, `drawCoopHud`)

Top strip (shared with solo): full-width team XP bar; top-left `LV 14` (team) and a small `2 PILOTS`; top-centre timer and boss bar; top-right score, best (co-op best for N), combo, overdrive. The touch controls never show in co-op.

Bottom row of player panels, `m = 16ui`, `gap = 12ui`, `ph = 76ui`, `pw = min(250ui, (w − 2m − (N−1)·gap) / N)`, `y = h − m − ph`:

- N = 2: P1 at `x = m`, P2 at `x = w − m − pw` (corners, keeping the middle clear).
- N = 3: left, centred, right.
- N = 4: four equal columns from `x = m`.

```
2P:
┌▲ P1 SPARK ────────── ◆1┐                                  ┌● P2 VANGUARD ─────────┐
│██████████████░░ 84/100 │                                  │███████████░░░ 96/140  │
│◆ ◆  ⬡ SHIELD           │                                  │◆                      │
│[✦3][⌁2][◎1]  ▲2 ∪1 ◆◆  │                                  │[⟲4][◉2]  ▣3 ✚1        │
└────────────────────────┘                                  └───────────────────────┘
4P (one panel downed):
┌▲ P1 ──────┐┌● P2 ──────┐┌■ P3  DOWN ──────────┐┌◆ P4 ──────┐
│███████░ 61││█████████ 9││ REVIVE ▓▓▓▓░░░ 58%  ││██████░ 70 │
│◆◆ [✦3][⌁2]││◆ [⟲4][◉2] ││ get close · 3.8s    ││◆ [☄2][✧1] │
└───────────┘└───────────┘└─────────────────────┘└───────────┘
```

Panel contents:

| Row | Contents |
|---|---|
| Header | mark + `P#` in the player colour, ship name (dim). Right side: `◆n` for pending caches. |
| HP | bar `pw − 16ui` × `10ui` with `hp / max` text, flashing on `hpFlash[pid]`. |
| Dash and shield | dash pips (7ui) and shield (`⬡` or a countdown). |
| Build | weapon boxes 18ui (level pips 2ui), passive boxes 13ui, relic `◆` count. When `pw < 180ui`, weapons only. |
| Downed | panel at 50 % alpha, `DOWN`, a revive progress bar in the player colour (`reviveT / reviveNeed`), and the text "get close · Xs". |

World space (co-op only): a name tag above each ship, a mini HP arc under the ship when below max, the ghost revive ring, and an edge glow while pinned by the leash. Callouts (`P2 DOWN`, `LAST PILOT STANDING`, `P2 BACK IN THE FIGHT`) use the existing `Callouts` in the centre.

---

## 8. Level-up UX (sequential, per player)

- **Order:** pending caches (P1→P4), then the team level round (P1→P4, downed players included). One modal per pick. The sim stays paused until `hasPendingPicks()` is false.
- **Header:** `<div class="lu-who" style="--pc:#b4ff6a">● P2 · VANGUARD</div>`, then the eyebrow `Level 7 · pick 2 of 3` (or `Elite cache · P2`), then the title `LEVEL UP` / `CACHE`.
- **Chips:** `▲P1 ✓  ●P2 …  ■P3 ·`. ✓ = picked this round, … = picking now, · = waiting. Built from `levelRound` and the current pick.
- **Cards:** 3 offers from P2's build, border and glow in `--pc`, with keyboard digits for P2's device (`Num1-3` for kbB, `1-3` for kbA, none for pads).
- **Hint row:** device-specific, for example `← → choose · ENTER take · BACKSPACE reroll (2)` or `Ⓐ take · Ⓧ reroll (2)`. The reroll button shows **that player's** rerolls.
- **Who may act:**
  - Only the current picker's slot. `Input` routes kbA/kbB/pad menu actions with the slot, and `app.pick/reroll` drop anything from other slots.
  - Mouse clicks are always accepted (shared screen, players trust each other) and also serve as the fallback for a disconnected picker.
  - DOM focus moves follow the picker's left and right.
- **Anti-mash:**
  - The grace period (350 ms) restarts **on every picker change**.
  - The picker's dash keys never confirm (Space/LShift for kbA; RShift/Num0/RCtrl for kbB; A is the pad confirm, but a pad dash *mash* is covered by the 350 ms grace plus edge detection).
  - Repeats are ignored.
- **Transition:** cards slide out and the next player's slide in (`.offer` stagger animation reused). No sim time passes in between.
- **Solo:** the screen, keys (1/2/3, R, Enter after grace, Space blocked) and flow are unchanged.
- **Downtime risk:** see §10 for a deterministic parallel-pick variant kept as a follow-up.

---

## 9. Meta and save

- **One shared save** (same device). Co-op uses the save's unlocked ships, workshop levels, rank and hard-mode setting for **every** player.
- **Records kept apart:**
  - `stats.bestScore` and `stats.bestCombo` = **solo only**.
  - `coop.best['2' | '3' | '4']` = co-op best score per player count. The HUD "BEST" and `newbest` use it.
  - `bestTime`, `bestLevel`, `victories`, kills and other lifetime totals include co-op, so co-op sessions progress ship unlocks.
- **Rewards:** cores and rank XP from `scoreNorm = score / scaling.spawn`. Collected cores count as-is (they're scarce). Mission rewards as usual. No Daily bonus.
- **Missions and achievements:** see the `missions.ts` and `achievements.ts` subsections of §3. In short: team values count, `score` mission and `score100k` are solo-only, `perfect10` and `perfect_run` use the best individual, and the combo achievements also check the run.
- **Daily Run:** solo only (button absent from the lobby; `makeRunConfig` enforces it).
- **Tutorial:** solo only; co-op never touches `tutorialDone`.
- **Save v2 migration:** additive (defaults fill `coop`). A v1 save loads with all of its fields intact. The existing `migrate` test keeps passing.

---

## 10. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Solo drift (rng order, float paths) | Breaks "exactly as today", the Daily fairness and the tests | Golden master captured **before** refactoring (§11.1). N = 1 multipliers are exactly 1. Solo fast paths for pickups, targeting, leash, zoom and revive. `noHitT` moved with the same per-tick semantics. Private Director field names kept. |
| P1 aliases hide co-op bugs | Wrong player's stats used | `tests/no-p1-alias.test.ts` grep guard. Every co-op unit test targets `players[1]`. |
| Ctrl+W, Ctrl+D browser shortcuts | Tab closes mid-run | RightCtrl only in Electron. `preventDefault` on all game keys in co-op. |
| Keyboard rollover and ghosting | Missed inputs for 2 keyboard players | Modifier-based dash keys, a lobby tip, gamepads recommended. |
| Level-up downtime × N | 4 picks per level stalls the action | Fast direct-pick keys, grace only 350 ms, no animation waits. **Follow-up option (deterministic):** generate all N offer sets at round start in pid order, show 2×2 quadrants, apply in pid order once all confirm. Rerolls then draw from `lootRng` in real-time order, which is fine because bots and tests stay sequential. |
| Performance (600 enemies, 4 kits, zoomed out = more on screen) | FPS drops | `?coop=4&autoplay` profiling target ≥ 55 fps on a mid laptop. Co-op `particles.density × 0.75`. Cap `damageNumbers` in co-op to crits only. Sprites reuse the base resolution (no cache churn on zoom). |
| Readability at zoom 1.45 | Small ships, lost players | `sqrt(zoom)` ship scale, name tags with shape marks, edge glow, slower zoom-in. |
| Spawns on top of an edge player | Unfair hits | `SPAWN_CLEARANCE` 220 with up to 3 `posRng` retries (co-op only). |
| Global slow-mo and hitstop × N | Choppy feel | Co-op perfect-dash slow-mo reduced. The `downed` hitstop is small. |
| Revive griefing or abuse (ghost scouting, infinite revives) | Trivialises difficulty | Ghosts can't collect or attack. Revive time grows per down. The wipe still ends the run. |
| Balance unknowns | 2P/3P/4P too easy or hard | Sim profiles plus manual playtests. All knobs in one table (`COOP_SCALING`). |
| Gamepad index churn on reconnect | Wrong pad drives a slot | Bind by `gamepad.index`. On reconnect with the same index, resume. Otherwise use the "take over" flow (§6.3). Chromium exposes up to 4 XInput pads. |
| Save v2 rollback (old build reads v2 save) | Lost co-op fields | The old `migrate` ignores unknown fields but would drop `coop` on the next write. Acceptable (no downgrade path). |
| Workstream overlap (galaxy backgrounds, story, Steam) | Merge conflicts in renderer/app | `background.draw` must accept the zoomed `k`. The story layer listens to `downed`/`revived`/`laststand` for cheesy lines. Steam achievements include `squad` and `medic`. Electron sets `input.allowCtrlDash`. |

---

## 11. Test plan

### 11.1 Golden master for solo (commit FIRST, before any refactor)

`tests/golden.solo.test.ts` plays 5 configs with the existing bot (`skill 0.6`, `rng = new Rng(seed ^ 0xabcdef)`, `botResolvePending` with `applyOffer`) to 45 s, 120 s and 300 s (or death). At each checkpoint it asserts:

- `score`, `kills`, `level`, `enemies.length`, `combo`, `hp`, `x`, `y` (exact)
- `weapons` string
- `world.rng.next()`, which fingerprints the combat rng stream

Expected values are in Appendix A. They were computed on `18b7adc` from a scratch copy using Node's TypeScript stripping; re-capture with vitest on main to confirm they match before committing. The test must pass unchanged after every refactor commit.

### 11.2 Unit tests: `tests/coop.test.ts`

Helper: `coopWorld(ships = ['spark','vanguard'], seed = 1)` plus `quiet(w)` (same as `game.test.ts`).

1. **Config:** `makeRunConfig({seed, players: [...]})` sets `cfg.players.length` and `cfg.ship === players[0].ship`. `daily` is forced null. More than 4 players are truncated.
2. **Per-player state:** Vanguard P2 has `maxHp` 140 and an orbit start weapon, while P1 Spark has 100 and pulse. `refreshStats(1)` doesn't touch P1.
3. **Shared XP and rounds:** `addXp(xpNext, 1)` gives `level 2` and `pendingLevelUps 1`. `beginPick()` returns `{pid:0}` then `{pid:1}` then null, and `pendingLevelUps` is decremented once. `xpNext` = `round(xpForLevel(2) × 1.6)`. The collector's `xpGain` applies (give P2 Fortune, compare).
4. **Per-player offers:** `generateOffers(w, 3, false, 1)` never contains `weapon:pulse` with `isNew: false` (P2 doesn't own pulse) and can contain `weapon:orbit` level 2. `applyOffer(w, o, 1)` changes only P2's build.
5. **Caches first and to the collector:** kill an elite next to P2 and tick → `players[1].pendingCaches === 1`, P1 0. `beginPick()` returns `{pid: 1, cache: true}` before any level pick.
6. **Hearts heal the collector:** a damaged P2 picks up a heart → P2's HP rises, P1's doesn't.
7. **Targeting:** an enemy closer to P2 moves toward P2. Down P2 → it retargets P1. With players equidistant (±5 %), `tgt` doesn't change for 60 ticks (hysteresis).
8. **Downed:** a lethal hit on P2 with P1 up gives `downed`, `!gameOver`, a `downed` event, combo halved. Contact and bullets don't hurt the ghost. No projectile has `owner === 1` after 2 s. The ghost moves at `GHOST_SPEED`.
9. **Self-revive before downing:** P2 with Second Wind survives the first lethal hit (`revive` event, not `downed`).
10. **Revive:** P1 within 60 units for `2.5 s + 1 tick` gives P2 up, `hp ≈ 0.4 × max`, `invuln > 0`, a `revived {by: 0}` event, and `players[0].run.revivesGiven === 1`. Leaving at 1.0 s and returning shows the progress decayed at 0.5×. A second down needs 3.75 s.
11. **Wipe:** down P2, then a lethal hit on P1 gives `gameOver`, both `alive === false`, exactly one `death` event.
12. **Leash:** P1 holds right for 20 s while P2 stands still. The span stays ≤ `maxSpanX + 1e-9`, P1's `vx` is 0 at the wall, and P2 is not dragged (x unchanged).
13. **Zoom:** solo `zoom` stays exactly 1 over a 30 s bot run. Co-op zoom rises with the span, never exceeds `ZOOM_MAX`, and returns toward 1 when players regroup.
14. **Pickup magnet:** a gem inside P2's magnet radius only flies to P2, and `owner === 1`. If P2 is downed, it retargets P1.
15. **Kill credit and relic scope:** a kill by P2's projectile adds `players[1].run.kills++`. P2's Executioner doesn't affect P1's hits. P2's Chrono slows every enemy.
16. **Scaling:** for N = 1, `Director.rate(t)`, `hpMult` and `bossHpMult` equal today's formulas exactly (`toBe`). For N = 2 they equal the formula × the table values.
17. **Determinism with 2 players:** two identical 45 s bot runs (`botInput(w, rngs[i], …, i)`, `botResolvePending` with `(o, pid)`) give `toEqual` on `{score, kills, level, enemies, players[*].x/y/hp, players[*].build}`.
18. **Bot drives P2:** with a lone enemy east of P2, `botInput(w, rng, {skill: 1}, 1).mx < 0`. With P1 downed 300 units away and no threats, P2's bot moves toward P1.
19. **Spawn clearance:** in co-op, 200 `spawnPoint()` calls are all ≥ 220 from both players (or show 3 retries used). In solo, the `posRng` state after N calls matches a pre-refactor recording (covered by the golden master).

Other new test files:

- **`tests/lobby.test.ts`:** join puts players in the lowest slot. A device can't join twice. Ship cycling skips locked ships. Ready, countdown, cancel on change. `roster()` compacts.
- **`tests/bindings.test.ts`:** `slotForKey('ControlRight', false) === null` and its dash is allowed with `allowCtrl`. `Enter` maps to kbB confirm, not dash. kbA and kbB key sets are disjoint.
- **`tests/meta.coop.test.ts`:**
  - A co-op `applyRun` leaves `stats.bestScore` unchanged and sets `coop.best['2']`. Cores use `scoreNorm`. No daily is recorded. The `score` mission is not progressed.
  - `perfect10` unlocks from the best individual, not the team sum. `combo150` unlocks from the run combo.
  - `migrate` of a v1 save fills in `coop`.
- **`tests/no-p1-alias.test.ts`:** grep guard (§1.4).

### 11.3 e2e: `e2e/coop.spec.ts` (desktop project only; `test.skip(isMobile)`)

Before each test, seed `localStorage` with a save that has `achievements.survive3`, so Vanguard is unlocked.

1. **Lobby with two keyboard players:**
   - Title → `[data-act="coop"]` → `#screen-lobby` visible.
   - `Space` puts kbA in P1; `Enter` puts kbB in P2. Assert two `.slot-card:not(.empty)`.
   - `ArrowRight` → P2 ship text becomes `Vanguard`.
   - `Space` (P1 ready), `Enter` (P2 ready) → `.countdown` visible.
   - Poll `state === 'playing'` and `world.players.length === 2`.
2. **Independent movement:** hold `KeyD` for 600 ms → P1 x rises by more than 40 and P2 x moves less than 5. Hold `ArrowLeft` → P2 x falls. Spread for 3 s → `world.zoom > 1`.
3. **Sequential level-up:**
   - `world.addXp(world.xpNext)` → `.lu-who` contains `P1`.
   - `Enter` (kbB) does nothing. `Space` does nothing.
   - Wait 400 ms, press `Digit1` → `.lu-who` contains `P2`. `KeyE` (kbA) does nothing.
   - Wait 400 ms, press `Enter` → `playing`.
   - Assert P1's and P2's builds each changed (weapon count or level sum +1).
4. **Downed and revive:** `world.hurtPlayer(1e6, …, 1)` → the P2 HUD panel is greyed out; snapshot `players[1].downed === true`. Teleport P1 onto P2 (evaluate) and wait 3 s → `downed === false`.
5. **Results:** pause → End run → `#screen-results .coop-table tr` count is 2. `localStorage` `coop.best['2'] > 0` and `stats.bestScore` unchanged.
6. **Regression:** the existing `smoke.spec.ts` passes untouched (solo).

### 11.4 Balance sim (`npm run sim`)

`simulateRun({ seed, rank, workshop, players: ShipId[] }, maxTime, skill)` creates N bots with `rngs[i] = new Rng(seed ^ 0xabcdef ^ Math.imul(i + 1, 0x9e3779b1))`. It records `downs`, `revives`, `levelAt` and `peakEnemies`.

New profiles:

- `co-op 2P fresh (spark + vanguard, skill 0.6)`
- `co-op 2P veteran (rank 8 workshop)`
- `co-op 4P fresh (perf and sanity, 6 runs)`

Targets:

| Metric | Target |
|---|---|
| 2P fresh median survival | within ±25 % of solo fresh |
| 2P Warden kill rate | 40–75 % |
| Level at 60 s | solo ± 1 |
| Peak enemies | ≤ `maxEnemies` |
| Revives per run (2P fresh) | ≥ 1 |
| Runs ending on the first down | rare |

Tune only `COOP_SCALING` and the revive constants.

---

## 12. Implementation order (suggested PR slices)

1. **Golden master** (§11.1) on main. No code change.
2. **Model refactor, solo-only behaviour:** `types`, `runconfig`, `stats`, `coop.ts`, the `world.ts` players array with aliases and owners, `weapons`, `enemyai`, `director`, `upgrades`, `bot`. Golden plus all existing tests stay green, plus the `no-p1-alias` guard.
3. **Co-op sim rules:** targeting, downed/revive/wipe, leash, zoom, pickups, scaling, bot co-op behaviours. `coop.test.ts` and the sim profiles.
4. **Input:** bindings, `readSlot`, pad polling for all pads, menu routing. Lobby model, with unit tests.
5. **Presentation:** renderer (zoom, ships, ghosts, tags), co-op HUD, lobby screen, co-op level-up, pause, victory, results, title button, CSS.
6. **Meta:** save v2, progression, missions, achievements, records. Meta tests.
7. **e2e and tuning:** `coop.spec.ts`, balance passes, perf profiling with `?coop=4&autoplay`. Update `docs/GAME_DESIGN.md`.

---

## Appendix A: solo golden-master values (commit `18b7adc`)

Procedure: `w = new World(makeRunConfig(case))`, `rng = new Rng(seed ^ 0xabcdef)`. Each tick: `w.update(1/60, botInput(w, rng, {skill: 0.6}))`, then `botResolvePending(w, rng, o => applyOffer(w, o))`, then `w.events.length = 0`. Stop at each checkpoint T (`while (!w.gameOver && w.time < T - 1e-9)`) or on death. `x`, `y` and `hp` are rounded to 6 decimals, and `next` = `w.rng.next()` taken at the checkpoint (it advances the stream, so take the checkpoints in order).

| Case | T | t | score | kills | level | x | y | hp | enemies | combo | weapons | rng.next() |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| seed 77, rank 1 | 45 | 45 | 2395 | 94 | 5 | 449.371294 | -320.430724 | 100 | 41 | 94 | pulse3 arc1 | 0.4707469723653048 |
| | 120 | 120 | 23075 | 610 | 12 | 213.704975 | -460.705533 | 100 | 49 | 457 | pulse4 arc3 orbit2 nova1 | 0.7262125718407333 |
| | 300 | 300 | 175695 | 2785 | 23 | 1079.694247 | -1120.274146 | 100 | 62 | 869 | pulse5 arc* orbit* nova5 | 0.7282984314952046 |
| seed 1001, rank 6, vanguard, ws {hull 3, might 2} | 45 | 45 | 265 | 4 | 1 | -433.497459 | -3581.225211 | 170 | 140 | 1 | orbit1 | 0.7677986866328865 |
| | 120 | 120 | 10955 | 432 | 10 | 2596.338968 | -6025.447712 | 190 | 224 | 86 | orbit4 mines1 lance1 nova1 | 0.8021853652317077 |
| | 300 | 300 | 142035 | 2840 | 25 | 2779.778505 | -9074.493196 | 190 | 89 | 601 | orbit5 mines5 lance5 nova* | 0.04205190297216177 |
| seed 2024, rank 10, phantom, ws {revival 1, reflex 2} | 45 | 45 | 3045 | 114 | 5 | 1423.415625 | -514.493781 | 70 | 17 | 114 | seeker2 arc1 lance1 | 0.9613311791326851 |
| | 120 | 120 | 29545 | 628 | 11 | 1425.382158 | -751.040965 | 70 | 35 | 628 | seeker4 arc3 lance4 | 0.8939121991861612 |
| | death | 207.1167 | 78705 | 1468 | 18 | 2590.587306 | -762.688616 | 0 | 21 | 28 | seeker5 arc5 lance5 mines1 | 0.9223126692231745 |
| seed 31337, rank 8, bastion, hardMode | 45 | 45 | 3288 | 106 | 5 | 441.241455 | -508.185778 | 120 | 43 | 89 | nova2 mines2 pulse1 | 0.6961507233791053 |
| | 120 | 120 | 34466 | 678 | 12 | 1144.061311 | -1052.431913 | 120 | 20 | 302 | nova4 mines3 pulse4 | 0.8975157043896616 |
| | death | 243.7833 | 135049 | 1837 | 20 | 1870.140797 | -1345.766018 | 0 | 34 | 24 | nova5 mines3 pulse5 arc3 | 0.9760231697000563 |
| seed 4242, rank 3, tempest, daily swarm | 45 | 45 | 4630 | 158 | 7 | 497.883627 | -226.757463 | 80 | 45 | 158 | arc5 seeker1 | 0.44685144373215735 |
| | 120 | 120 | 60765 | 1183 | 16 | -1047.925628 | -2809.137867 | 80 | 17 | 1183 | arc5 seeker* nova1 | 0.5074346985202283 |
| | 300 | 300 | 498565 | 6345 | 32 | -1139.58578 | -4675.734858 | 80 | 60 | 1807 | arc5 seeker* nova5 orbit* | 0.8076114489231259 |

The Phantom case has the Revival workshop upgrade, so the solo self-revive path is in play before the final death. The Bastion case covers `dashNova` rings and hard mode. The Tempest case covers the Daily-modifier path.
