# SHARDSTORM — Game Design Document

> A neon arena-survival roguelite built for "one more run".
> Runs last 2–10 minutes, restart in under a second, and every run —
> win or lose — moves a progress bar forward.

---

## 1. Pitch

You are a spark of light adrift in the void. Endless swarms of dark geometry
close in from every side. Your weapons fire on their own — **you** decide where
to move, when to **dash straight through** the swarm, and which upgrade to take
each time you level up. Chain kills to build a combo multiplier, survive the
three bosses, and take 10:00 on the clock.

**Genre:** arena survival roguelite (in the family of *Vampire Survivors*,
*Brotato*, *20 Minutes Till Dawn*), with an arcade score-chase layer
(combo multiplier, perfect dashes, personal bests) on top.

**Platform:** browser (desktop + mobile), zero install. Keyboard, mouse,
touch and gamepad.

**Session length:** 2–10 minute runs; a typical sitting is 3–6 runs.

---

## 2. Design pillars

1. **Instant in, instant again.** From page load to playing is one keypress.
   From death to the next run is one keypress (< 1 s). No loading screens.
2. **Every second is a decision.** Movement, dash timing and upgrade picks all
   matter. Auto-fire removes busywork so attention goes to positioning.
3. **Constant, layered progress.** Something always fills up: the XP bar
   (seconds), the combo meter (seconds), the run timer toward the next boss
   (minutes), missions and rank (runs), workshop and ship unlocks (days).
4. **Juice everything.** Every action gets visual + audio feedback: hit flash,
   particles, screen shake, hit-stop, rising pickup chimes, combo call-outs.
5. **Fair, readable chaos.** Enemies telegraph attacks. Dash gives reliable
   invulnerability. Deaths should feel like *my* mistake, never the game's.

---

## 3. The loops

### 3.1 Core loop (≈ 3 seconds)

```
move ──► weapons auto-fire ──► enemies die ──► shards drop ──► collect ──┐
  ▲                                                                       │
  └──────────────── dash through danger / chain kills ◄──────────────────┘
```

- **Move** with WASD / arrows / left stick / touch-drag joystick.
- **Weapons auto-fire** at the nearest enemies.
- **Dash** (Space / Shift / right-click / A / dash button): a short burst with
  full invulnerability that *damages everything you pass through*.
- **Perfect dash:** dashing *through* an attack that would have hit you
  triggers a brief slow-motion, refunds half the dash cooldown and adds +3
  combo. This is the core skill expression and the most satisfying moment in
  the game.

### 3.2 Combo loop (≈ 10–60 seconds)

- Each kill adds +1 combo and refreshes a 2.5 s timer.
- The combo multiplies score: ×1 → ×2 (15) → ×3 (40) → ×4 (80) → ×5 (150) →
  ×6 (250) → ×8 (400) → ×10 (600).
- Getting hit **halves** the combo (tension without a hard reset).
- **Milestones** pay out at 50 (Magnet Pulse — vacuum all shards),
  100 (Nova Burst — screen-wide blast) and 200 (Overdrive — 6 s of +50%
  fire rate), then repeat every 100.

### 3.3 Run loop (2–10 minutes)

- Shards fill the XP bar. **Level up → pick 1 of 3 cards** (weapon, passive,
  or a rare relic). Rerolls are limited, which makes them feel valuable.
- **Build crafting:** up to 4 weapons and 4 passives, max level 5 each.
  A max-level weapon plus its paired passive unlocks an **Evolution** card
  (gold, guaranteed in the next offer).
- **Elites** (gold-rimmed) appear every ~50 s and drop a **Cache**: a bonus
  level-up with boosted relic odds.
- **Bosses** at 3:00 (Warden), 6:00 (Hydra) and 9:00 (Void Heart), each with a
  "WARNING" intro and their own attack patterns.
- **10:00 = Victory**, then optional **Overtime**: endless scaling for score.

### 3.4 Meta loop (runs → days)

| System            | Fills up from                    | Pays out                                   |
| ----------------- | -------------------------------- | ------------------------------------------ |
| **Cores**         | score, bosses, missions, streak  | Workshop upgrades (permanent stat boosts)  |
| **Rank**          | every run's score + time         | new weapons/relics into the pool, cores    |
| **Missions** (3)  | specific goals, tiered           | cores; replaced with harder ones           |
| **Achievements**  | milestones                       | unlock new ships                           |
| **Daily Run**     | one seeded run per day           | streak bonus cores, daily best             |
| **Personal best** | score / time / combo             | "NEW BEST" fanfare, ghost bar in the HUD   |

---

## 4. Retention techniques used (and why)

| Technique | Where it shows up | Psychology |
| --- | --- | --- |
| **Short sessions + instant restart** | < 1 s from results to new run | Lowers the cost of "just one more" |
| **Variable rewards** | card offers, relic rarity, caches, elite drops | Unpredictable rewards are more compelling than fixed ones |
| **Near-miss framing** | results show "312 short of your best", "0:19 from the Warden", missions at 271/300 | A near miss motivates a retry more than a clear loss does |
| **Goal gradient** | XP bar, rank bar, "need 12 more cores" for the next upgrade | Effort speeds up as a goal gets closer |
| **Nested progress** | combo → level → boss → mission → rank → ship | There's always a goal seconds, minutes and runs away |
| **Mastery curve** | perfect dash, combo upkeep, build synergies | Skill growth is the long-lasting hook |
| **Progressive reveal** | weapons and relics unlock by rank | New content keeps arriving after the first few hours |
| **Daily ritual + streak** | seeded daily run, flame streak counter | A reason to come back tomorrow |
| **Loss → progress** | every run pays cores and rank XP | Losing still moves you forward, so it doesn't sting |
| **Sensory reward** | rising-pitch pickup chimes, hit-stop, shake, slow-mo | Moment-to-moment satisfaction |

### Ethical guardrails

This game is meant to be *compelling*, not *exploitative*:

- No real money, no ads, no loot boxes, no energy/stamina timers.
- No punishment for leaving (streaks only add bonuses and never take
  progress away).
- An optional **break reminder** (default: every 60 minutes, non-blocking
  toast) and a **reduced flashing** accessibility setting.
- All progress is stored locally; nothing is collected about the player.

---

## 5. Content

### 5.1 Ships

| Ship | Start weapon | Trait | Unlock |
| --- | --- | --- | --- |
| **Spark** | Pulse Blaster | balanced | default |
| **Vanguard** | Orbit Blades | +40 HP, +2 armor, −8% speed | survive 3:00 |
| **Tempest** | Arc Lightning | +15% speed, +10% crit, −20 HP | reach a 150 combo |
| **Bastion** | Nova | dash releases a shockwave, +20 HP | defeat the Warden |
| **Phantom** | Seeker Swarm | 2 dash charges, −30% dash cooldown, −30 HP | 10 perfect dashes in one run |

### 5.2 Weapons (max level 5 + Evolution)

| Weapon | Behaviour | Evolution (+ passive) |
| --- | --- | --- |
| Pulse Blaster | bolts at nearest enemy | **Photon Storm** (+ Overclock) |
| Orbit Blades | blades circle the ship | **Halo Saw** (+ Amplifier) |
| Nova | periodic expanding ring, knockback | **Supernova** (+ Power Core) |
| Arc Lightning | chains between enemies | **Tempest Arc** (+ Targeting Matrix) |
| Seeker Swarm | homing missiles, splash | **Hive** (+ Velocity Coil) — rank 2 |
| Gravity Mines | dropped mines explode | **Singularity** (+ Tractor Field) — rank 4 |
| Prism Lance | piercing beam toward movement | **Comet Lance** (+ Thrusters) — rank 5 |

### 5.3 Passives (max level 5)

Power Core (+damage), Overclock (−cooldown), Amplifier (+area),
Thrusters (+move speed), Tractor Field (+pickup radius), Hull Plating
(+max HP, +armor), Nanites (+regen), Fortune Engine (+luck, +XP),
Velocity Coil (+projectile speed, +duration), Dash Coil (−dash cooldown,
+dash damage), Targeting Matrix (+crit).

### 5.4 Relics (one-time, rarity-weighted; unlocked at rank 3)

Glass Cannon, Second Wind, Vampiric Core, Chrono Field, Combo Engine,
Prism Shield, Executioner, Fever, Twin Dash, Bounty Hunter.

### 5.5 Enemies

| Enemy | Shape | Behaviour | Appears |
| --- | --- | --- | --- |
| Drifter | triangle | slow chaser | 0:00 |
| Swarmling | small dart | fast, packs of 6–10 | 0:30 |
| Dasher | diamond | telegraphs, then charges | 1:00 |
| Splitter | circle | splits in two on death | 1:30 |
| Shooter | hexagon | keeps distance, fires slow bolts | 2:00 |
| Brute | square | slow, tanky, heavy hitter | 2:30 |
| *Elite* | any, gold rim | ×6 HP, drops a Cache | every ~50 s |

Bosses: **Warden** (radial bursts + minion rings), **Hydra** (telegraphed
charges + spirals), **Void Heart** (rotating spiral walls + summons).

---

## 6. Balance targets

Tuned with a headless bot simulation (`npm run sim`) that plays with random
upgrade picks and simple dodging, plus hand playtesting.

| Metric | Target | Bot result |
| --- | --- | --- |
| First level-up | ≤ 8 s | ~3.5 s (opening wave spawns close) |
| Level at 1:00 | 4–6 | 6 |
| Fresh save beats the Warden | roughly 30–60% | 31% (clumsy bot) – 62% (competent bot) |
| Median *bot* survival, fresh save | 2:30–6:30 | 3:46 – 6:16 depending on bot skill |
| Veteran save (rank 8, half workshop) | usually survives 10:00 | median 10:00+, 14/16 beat a boss |
| Enemies on screen at 3:00 | 80–250 | ~85 |
| First run | affords 1–3 workshop upgrades | yes |
| Frame budget | 60 fps with 400 enemies + 2,500 particles on a mid laptop | 52–60 fps in headless software rendering |

### Lessons from tuning

- **Cheap enemies starved expensive ones.** The first director spent its budget
  on whatever it rolled, so brutes and shooters almost never spawned. It now
  commits to the next enemy and saves up for it, so the mix follows the weights.
- **Shards dropped out of reach.** Enemies died at the screen edge, so a new
  player was still level 1 after ten kills. A shorter Pulse Blaster lock-on
  range and an opening wave close to the player fixed the first ten seconds.
- **Pure-passive offers stalled builds.** Each offer now includes at least
  one weapon card when one is available, which smooths the power curve.
- **The Warden was a cliff.** Survival clustered within 30 s of 3:00, so its
  bullets became slower and lighter, and damage scaling was eased.
- **Small samples lie.** An 8-run batch suggested a 4:40 median; 16 runs
  showed 9:00, because surviving the Warden snowballs. Late enemy HP now
  grows faster (`(t/220)^2.4`) so 10:00 needs meta progression or real skill.
  Because outcomes are bimodal, the Warden win rate is tracked instead of
  the median.

Difficulty curve: the spawn budget is `1.2 + 0.03t + 0.45(t/60)²` threat points per
second; enemy HP scales by `1 + t/100 + (t/220)^2.4`. Player power grows faster than
that early (to create the power fantasy) and slower late (to create tension
toward 10:00).

---

## 7. Feel and feedback spec

| Event | Visual | Audio |
| --- | --- | --- |
| Enemy hit | white flash 60 ms, knockback, damage number | soft tick (rate-limited) |
| Kill | colored particle burst, score popup | pop, random pitch |
| Shard pickup | XP bar pulse | chime rising through a pentatonic scale |
| Level-up | time freeze, radial burst, cards stagger in | rising arpeggio |
| Combo tier | big call-out "×3" | whoosh + chord |
| Dash | afterimages, speed lines | whoosh |
| Perfect dash | 0.3 s slow-mo, ring, "PERFECT" | bright chime |
| Player hurt | red vignette, strong shake | crunch |
| Boss intro | darken, "WARNING" banner | siren |
| Boss death | hit-stop, slow-mo, huge burst | boom + fanfare |
| Death | 1 s slow-mo, ship shatters | descending tone |
| New best | gold stamp, confetti | fanfare |

Music is procedural (WebAudio): a bass + arpeggio + drums loop whose layers
fade in with intensity (enemy count, combo), shifting key for boss fights.

---

## 8. Controls

| Action | Keyboard / mouse | Gamepad | Touch |
| --- | --- | --- | --- |
| Move | WASD / arrows | left stick / d-pad | drag anywhere (floating stick) |
| Dash | Space / Shift / right-click | A / RB | dash button, or tap with a second finger |
| Pause | Esc / P | Start | ⏸ button |
| Pick card | 1 / 2 / 3, arrows + Enter, click | d-pad + A | tap |
| Reroll | R | X | tap |

---

## 9. Technical architecture

- **TypeScript + Vite**, no runtime dependencies.
- **Fixed-timestep simulation (60 Hz)** in `src/game/` that has no DOM or
  canvas access, so it runs headless in tests and the balance simulator.
- The simulation emits **events** (kill, hit, levelup…) that the renderer and
  audio consume, which keeps feedback separate from game rules.
- **Seeded RNG streams** (spawns, loot) so the Daily Run is the same for
  everyone on a given day.
- **Spatial hash grid** rebuilt each tick (counting sort into typed arrays)
  for collisions with hundreds of entities.
- **Canvas 2D renderer** with pre-rendered glow sprites and additive particles.
- **DOM overlay** for menus (crisp text, accessible focus, keyboard nav).
- **Versioned localStorage save** with migration, guarded by try/catch.
