# SHARDSTORM — Game Design Document

> A neon arena-survival roguelite built for "one more run".
> Runs last 2–10 minutes, restart in under a second, and every run —
> win or lose — moves a progress bar forward.

---

## 1. Pitch

You captain one small starship of the **Allied Beacon Fleet**. Against you:
the **Resplendent Lattice**, a crystal armada the fleet calls *the Shardstorm*,
ruled by Overlord Facetius, who wants to bend every light in the galaxy into
his crown (and writes poetry about it). Its crystal ships close in from every
side. Your guns fire on their own — **you** decide where to fly, when to
**dash straight through** the swarm, and which upgrade to take each time you
level up. Chain kills to build a combo multiplier, beat the armada's three
capital ships, and hold the line for 10:00.

The tone is a cheesy, affectionate bridge-crew adventure: captains who give
speeches, a ship's computer with terrible puns, red alerts and hailing
frequencies (see §5.6).

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

### 3.5 Co-op (local, 2–4 captains)

- **Flow.** Title → Co-op → lobby: each device presses its join key, picks one of the save's unlocked ships, and readies up; 2 s after 2+ captains are ready the squad launches. Slots stay packed, so the P# and colour shown in the lobby are the ones flown (P1 ▲ cyan, P2 ● lime, P3 ■ azure, P4 ◆ white-violet). Results → Play again relaunches the same squad (or reopens the lobby if a controller is gone).
- **Level-ups.** XP and level are shared. A team level-up opens a round where every captain picks once, P1→P4, on a screen headed by whose turn it is (number, colour, ship, round chips, that device's key hints); caches go to whoever collected them and are picked first. Only the picker's device steers; mouse clicks are always accepted.
- **Downs.** A captain at 0 HP is downed; a teammate flying over them for ~2.5 s revives them. The run ends when everyone is down.
- **Meta.** One shared save. Lifetime totals, best time/level, victories, missions and ship unlocks count team values; the solo best score and best combo do not move, and the squad's score goes to a separate co-op best per pilot count. Cores and rank XP use score ÷ the co-op spawn multiplier. The score and Daily missions ignore co-op, perfect-dash goals use the best single captain, and the Daily Run is solo-only. Achievements: *Squad Goals* (win a co-op run) and *No Pilot Left Behind* (10 revives).

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

| Ship (code id) | Class · captain | Start weapon | Trait | Unlock |
| --- | --- | --- | --- | --- |
| **Glimmer of Hope** (`spark`) | Kindle-class light frigate · Capt. Starling | Pulse Blaster | balanced | default |
| **Immovable Object** (`vanguard`) | Monolith-class heavy cruiser · Capt. Ironwake | Orbit Blades | +40 HP, +2 armor, −8% speed | survive 3:00 |
| **Already Gone** (`tempest`) | Zephyr-class interceptor · Capt. Hotwire | Arc Lightning | +15% speed, +10% crit, −20 HP | reach a 150 combo |
| **Big Warm Hug** (`bastion`) | Citadel-class shield dreadnought · Capt. Rampart | Nova | dash releases a shockwave, +20 HP | defeat the Warden |
| **Definitely Not Here** (`phantom`) | Whisper-class stealth raider · Capt. Nocturne | Seeker Swarm | 2 dash charges, −30% dash cooldown, −30 HP | 10 perfect dashes in one run |

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

The Resplendent Lattice's crystal ships (display names; code ids in brackets):

| Enemy | Shape | Behaviour | Appears |
| --- | --- | --- | --- |
| Drone (`drifter`) | triangle | slow chaser | 0:00 |
| Swarm Dart (`swarmling`) | small dart | fast, packs of 6–10 | 0:30 |
| Lancer (`dasher`) | diamond | telegraphs, then charges | 1:00 |
| Cell (`splitter`) | circle | splits in two on death | 1:30 |
| Gunship (`shooter`) | hexagon | keeps distance, fires slow bolts | 2:00 |
| Bulwark Hauler (`brute`) | square | slow, tanky, heavy hitter | 2:30 |
| *Elite* ("Employee of the Month") | any, gold rim | ×6 HP, drops a Cache | every ~50 s |

Capital ships (bosses): **The Warden**, keeper of the First Gate (radial bursts
+ minion rings), **The Hydra** (telegraphed charges + spirals), **The Void
Heart**, the hive mothership and the overlord's mother (rotating spiral walls
+ summons). Destroyed crystals leave **shards** (XP) and **cores** (Workshop
currency). The galaxy backdrop moves through four sectors as each capital ship
falls: the Turquoise Whorl, the Garnet Nebula, the Amethyst Abyss and the
Gilded Throne.

### 5.6 Story and presentation

The script lives in `src/story/script.ts` (content only); `director.ts` decides
when lines play and `logbook.ts` unlocks log entries. Code ids (ships, enemies,
achievements) never change; only display text is themed.

| Where | What | Code |
| --- | --- | --- |
| First launch | **Opening crawl**: a paced fleet briefing over the attract mode; any key/tap skips it (after a short grace); replayable from the Ship's Log; static under reduced motion | `src/ui/crawl.ts` |
| In a run | **Comms panel**: the `StoryDirector`'s current line, with the speaker's portrait glyph and colour, name and role, a quick typewriter reveal and a timer bar. Story lines (sector arrivals, capital-ship sequences, Overtime) stand out, rare barks are standard, common barks are small and quiet. Never takes pointer input. Setting **Crew chatter**: All / Important only / Off | `src/ui/comms.ts`, `src/story/runlink.ts` |
| Results | A game-over quip (rotation persisted in the save), or the capital ship's victory taunt when the run ended during a boss fight; newly unlocked log entries with a Read button | `src/ui/ui.ts` |
| Victory | The ending card ("The Light Holds"), then the Overtime choice; continuing plays the post-credits comms | `src/ui/ui.ts` |
| Title menu | **Ship's Log**: 14 entries that unlock across the meta arc (with hints and progress), unread badges, briefing replay, the cast and the vessel classes | `src/ui/ui.ts`, `src/story/logbook.ts` |

Pacing is the director's job: at most one common bark every 4–6 s, rare lines
queue briefly, and story lines take priority. `StoryRunLink` feeds it from the
simulation each frame: events go through with their own `pid` (so co-op lines
resolve per pilot's captain), `sector`/`downed`/`revived` events become
signals, and it detects low-HP crossings per pilot and the boss crossing 50%.

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

**Co-op (local, 1 screen, 2–4 captains).** Solo merges every device into P1; in co-op each pilot owns one device (`src/core/bindings.ts`). Touch is solo-only, so the title's Co-op button is hidden on touch-only devices unless a gamepad is connected.

| Action | kbA (left hand) | kbB (right hand) | Gamepad *n* |
| --- | --- | --- | --- |
| Move | WASD (mouse steers kbA too) | arrows | left stick / d-pad |
| Dash | Space / LeftShift | RightShift / Numpad0 (RightCtrl in the desktop build only) | A / LB / RB / LT / RT |
| Lobby join · ready | Space or E | Enter | A |
| Lobby ship ◀ ▶ · leave | A / D · Q | ← / → · Backspace | d-pad · B |
| Level-up choose · take · direct · reroll | A / D · E · 1 2 3 · R | ← / → · Enter · Num1–3 · Backspace | d-pad · A · — · X |
| Pause (anyone) | Esc / P | Esc / P | Start |

Enter is never a dash key, so no pilot's dash key can confirm a card (anti-mash); the 350 ms grace restarts for every picker. RightCtrl is opt-in because in a browser RightCtrl+W closes the tab. Every game key is `preventDefault`ed during co-op play.

---

## 9. Technical architecture

- **TypeScript + Vite**, no runtime dependencies.
- **Fixed-timestep simulation (60 Hz)** in `src/game/` that has no DOM or
  canvas access, so it runs headless in tests and the balance simulator.
- **Deterministic math** (`src/core/dmath.ts`): the simulation uses fdlibm-based
  replacements built from exactly specified operations instead of approximated
  `Math` functions (`sin`, `cos`, `atan2`, `exp`, `pow`, `hypot`, etc.) or `**`.
  A seed and input sequence therefore compute identical bits across CPUs, OSes
  and browsers. `tests/determinism.guard.test.ts` enforces the boundary with
  static scanning and runtime traps. CI checks Windows/Linux x64 and macOS arm64;
  Firefox and Safari have not been exercised in CI.
- The simulation emits **events** (kill, hit, levelup…) that the renderer and
  audio consume, which keeps feedback separate from game rules.
- **Seeded RNG streams** (spawns, loot) so the Daily Run is the same for
  everyone on a given day.
- **Spatial hash grid** rebuilt each tick (counting sort into typed arrays)
  for collisions with hundreds of entities.
- **Canvas 2D renderer** with pre-rendered glow sprites and additive particles.
- **DOM overlay** for menus (crisp text, accessible focus, keyboard nav),
  the in-run comms panel and the opening crawl.
- **Story layer** (`src/story/`): a deterministic `StoryDirector` on its own
  cosmetic RNG stream turns simulation events into paced comms lines; it never
  affects the simulation.

- **Versioned localStorage save** with migration, guarded by try/catch.
