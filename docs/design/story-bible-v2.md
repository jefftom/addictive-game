# SHARDSTORM Story Bible (v2: starship premise)

Source of truth: `story-script-v2.ts` (target `src/story/script.ts`). This bible explains the premise, the cast, the running gags, the tone rules, and where each content type appears in the game. If the two disagree, the script wins.

## Premise in one breath

You captain one small starship of the **Allied Beacon Fleet**. You are up against the **Resplendent Lattice**, a crystalline alien armada that humans call **the Shardstorm**. Its ruler, **Overlord Facetius**, wants to bend every light in the galaxy into his crown. He also writes poetry, and both must be stopped.

The tone is a cheesy, affectionate homage to classic TV bridge-crew adventure: captains making speeches, a ship's log, red alerts, hailing frequencies, melodramatic aliens and a sidekick computer with terrible puns. Every name, catchphrase, rank and ship design is original. See "Originality rules" below.

## The two sides

**The Allied Beacon Fleet.** Five small ships, five captains who give speeches, and one shared bridge crew that talks to you on every ship. The Workshop is the fleet shipyard and runs on cores. It rebuilds a destroyed ship in one second. The official explanation is "the fleet has spares, do not ask why".

**The Resplendent Lattice (the Shardstorm).** A crystal armada made of the game's enemy shapes:
- triangles (drones)
- darts (swarms)
- diamonds (lancers that telegraph, then charge)
- circles (cells that split in two)
- hexagons (gunships that fire bolts)
- big squares (bulwark haulers)

Gold-rimmed elites are the overlord's "Employee of the Month" and drop Caches. Destroyed crystals leave shards (XP, levelled up mid-run) and cores (Workshop currency). Its three capital ships each have a commander with a personality. The overlord's mother is one of them.

## Cast

**W.I.N.K. (`@ai`, id `wink`).** The ship's computer, short for Wisecracking Integrated Navigation Kernel. W.I.N.K. is chipper and tells groan-tier crystal, shard and light puns, then scores each one out of ten ("9/10"). W.I.N.K. keeps a secret Pun Ledger and, very rarely, goes quiet when something actually moves it. W.I.N.K. has the most barks, so its puns must stay short.

**Overlord Facetius (`@villain`, id `facetius`).** The Supreme Refractor of the Lattice. He speaks only in ALL CAPS crystal poetry and couplets. He is a needy artist: he asks for notes, times his own cackle ("NINE SECONDS"), and cannot find a rhyme for "shard". He is a thousand years old and still gets embarrassed by his mother. Late in the logbook he becomes oddly sympathetic: Gauge writes him a rhyme, and he reads his poems to the fleet between waves.

**Captain Ambrose Starling (spark, id `starling`).** Captain of the Glimmer of Hope. Every order becomes a closing speech, full of... dramatic... pauses. He is vain about his jawline but sincerely brave. He is the default captain, so his lines must also work for a first-time player.

**Captain Hilde Ironwake (vanguard, id `ironwake`).** Captain of the Immovable Object. A stoic old warhorse whose ship has no reverse gear, and neither does she. She speaks in short, granite sentences. Her rare smiles are events.

**Captain Skye Hotwire (tempest, id `hotwire`).** Captain of the Already Gone. She talks fast and flies faster, and her speeches end before they start ("lend me your— FLOOR IT!"). She wants to skip every intro.

**Captain Theodora Rampart (bastion, id `rampart`).** Captain of the Big Warm Hug. A booming, big-hearted coach who calls the crew "my lambs", hands out cocoa and gold stars, and treats each shockwave as a hug the enemy didn't see coming. Proud moments go on the BIG fridge.

**Captain Corvin Nocturne (phantom, id `nocturne`).** Captain of the Definitely Not Here. He whispers, so his lines are always lowercase. He believes nobody can see him. His "stealth field" is a light switch, though it also powers his double dash. The only witness to his best moves is the cat.

**The Warden (boss, 3:00, id `warden`).** Keeper of the First Gate, a cosmic velvet-rope doorman. "Name? ...Hm. You are not on the list." It reads the overlord's threats off cue cards in the tone of a fire-safety notice ("Abandon hope. Feeling attached. Moving on."). When it loses: "Tell them the Warden said it's cool."

**The Hydra (boss, 6:00, id `hydra`).** A hunter-cruiser with three heads, Glim, Glam and Glom, that pass one sentence between them in em-dashed pieces ("We hunt— —in spirals— —oh no, I feel dizzy."). The heads never agree, which is why it hunts in spirals. One is always furious, one seasick and one asleep. Its sacred last word is "wheee".

**The Void Heart (boss, 9:00, id `voidheart`).** The hive mothership and Facetius's MOM. She calls her drones "my babies" and her son "Sweet Prism", improvises over his scripted threats, and reminds him to wear a scarf mid-battle. Her taunts are time-outs ("Sit in the void and think about what you did.").

**Lt. Prudence Gauge (crew, id `gauge`).** Science officer. She speaks in a flat monotone with periods and never uses exclamation marks. She reads absurd sensor data ("Readings: dramatic.") and cites the Fleet Book of Regulations, 409 of whose 412 rules she wrote. Under Regulation 20 she always reports the shields "at 20%". Regulation Zero, kept on a separate card, says "Come home."

**Chief Engineer Gus Gasket (crew, id `gasket`).** Runs the engines and the Workshop. He calls the engines "Mabel" and Mabel is always at her limit... until he yells "NEW LIMIT!" and writes it on the wall, then the ceiling, then the floor. He is emotional about upgrades and gets the cores and Workshop lines.

**Ensign Tilly Static (crew, id `static`).** An over-eager comms officer who opens hailing frequencies nobody asked for ("Nobody is calling. It just felt right."). She passes on messages from Fleet Command and puts the overlord's mom through on the open channel.

**Biscuit (crew, id `biscuit`).** The ship's cat and honorary admiral. Biscuit speaks only in "Mrrp", with subtitles in parentheses, and knocks things off consoles at dramatic moments. Use sparingly, at most one Biscuit line per trigger.

## Vessel classes

| Ship id | Class | Name | Captain | Hook |
|---|---|---|---|---|
| spark | Kindle-class light frigate | the Glimmer of Hope | Starling | balanced, "cinematic" |
| vanguard | Monolith-class heavy cruiser | the Immovable Object | Ironwake | armour, orbit blades, no reverse gear |
| tempest | Zephyr-class interceptor | the Already Gone | Hotwire | fastest and thinnest, arc lightning |
| bastion | Citadel-class shield dreadnought | the Big Warm Hug | Rampart | dash shockwave, nova, cocoa |
| phantom | Whisper-class stealth raider | the Definitely Not Here | Nocturne | two dashes, homing seekers, lights-off "stealth" |

## Sectors (galaxy backdrop changes after each boss)

1. **The Turquoise Whorl** (0:00-3:00): teal spiral galaxy, "where the storm breaks".
2. **The Garnet Nebula** (after the Warden): crimson nebula with a judgmental ringed gas giant.
3. **The Amethyst Abyss** (after the Hydra): violet abyss and black hole. "Regulation 9: do not fall into the black hole."
4. **The Gilded Throne** (after the Void Heart, then Victory and Overtime): the storm's gold and obsidian heart. Facetius sulks: "THERE IS NO FOURTH STANZA!"

## Running gags (keep them consistent)

- **"Shields at 20%."** Under Gauge's Regulation 20 the shields are always reported at 20%. The payoffs: on low HP she says "For once, that is accurate", and on death she says "Shields at 0%. Finally, a new number."
- **"NEW LIMIT!"** Gasket's engine Mabel is always at her limit until she isn't.
- **Regulations by number.** 1: do your best. 2: try again immediately. 3: move the ship. 7: share the shards. 7b: go and get them. 9: black hole. 20: shields at 20%. 88: Overdrive. Zero: come home. Reuse these numbers and don't invent conflicting ones.
- **W.I.N.K.'s x/10 self-ratings.** The rare 10/10 and 11/10 are saved for big moments.
- **Nothing rhymes with "shard".** This pays off in the logbook entry "The Last Stanza".
- **Facetius is a needy author.** He asks for notes, times his cackle, rates his own victory poem, and asks "DO... DO YOU LIKE MIME?" in Overtime.
- **Mom.** Calls from "Mom" come through the open channel. She calls him "Sweet Prism" and keeps bringing up scarves.
- **Not on the list.** The Warden as a doorman with feedback forms.
- **The one-second rebuild.** "The fleet has spares. Do not ask why."
- **Unneeded hails.** Static opens frequencies nobody asked for.
- **Elites are "Employee of the Month"**, and new bests go on the fridge.

## Tone rules

1. **Cheesy on purpose.** Puns get groans and the cast knows it. Melodrama is affectionate, never mean-spirited. Family-friendly: no swearing, gore or romance.
2. **Short.** Barks are at most 72 characters, boss, sector and results lines at most 90. Players read these while dodging, so aim for 40-60 characters with one joke per line.
3. **Voice markers carry the character**, so a line works without a portrait:
   - Facetius always writes in ALL CAPS.
   - Nocturne always writes in lowercase.
   - Gauge uses flat periods.
   - Starling uses ellipses.
   - Hotwire cuts herself off with an em dash.
   - The Hydra passes the sentence between heads with em dashes.
   - Biscuit says "Mrrp. (subtitle)".
4. **The player is always the hero.** The villain may gloat on game over, but the crew never blames the player.
5. **Game-over lines must survive more than 50 deaths.** There are 22 lines across 9 speakers. Add new ones rather than repeating jokes, and keep them pointed at a quick retry.
6. **Stick to game facts.** Only mention shards, cores, Caches, relics, evolutions, combos (x2-x10), milestones (Magnet Pulse, Nova Burst, Overdrive at +50% fire rate), perfect dashes, revives (600-core Workshop module), the Daily Run, and co-op revives by flying over a downed ally.
7. **Originality rules.** Don't use franchise names, catchphrases, species, ranks-as-brands or ship designs. For example, never "stardate", "captain's log" (use "Ship's log"), "make it so", "engage", "beam", "phaser" or "torpedo" (use "bolts", "lasers" or "seekers"), "cloak" (use "stealth field"), "shields up", "turn it off and on again", "up to eleven", "shiny", "the Force" or "hyperspace". Generic vocabulary is fine: shields, hull, red alert, hailing frequencies, sensors, helm, ship's log, captain, ensign, lieutenant. Run `tools-v2/check-story-final.mjs` after every edit.

## Where each content type appears

| Field | Where it appears in-game | Notes |
|---|---|---|
| `intro` | Opening crawl on first launch, replayable from the Logbook | 5 paragraphs |
| `sectors[i].arrival` | Comms strip as the galaxy backdrop changes (0:00, after each boss) | 3-4 lines each; the background transition plays underneath |
| `bosses.*.intro` | Boss warning banner when the capital ship spawns (3:00, 6:00, 9:00) | `@pilot` responds in the current captain's voice |
| `bosses.*.half` | Comms when the boss reaches 50% HP | |
| `bosses.*.defeat` | Comms on the boss kill, before the sector transition | |
| `bosses.*.victoryTaunt` | Results screen header line when that boss killed the player | |
| `barks[trigger]` | In-run comms toast with portrait glyph and color, picked at random without repeats | Throttle so at most one bark plays every 4-6 s; boss and sector lines take priority |
| `pilotBarks[captainId]` | Overrides or mixes into `barks` for the active captain (about a 50% chance when a trigger has a captain entry) | Required for run_start, perfect, low_hp and new_best; some captains have extras |
| `gameOver` | Results screen quip under the score | Avoid repeating the last N lines shown |
| `victory` | Ending card at 10:00 | Then the Overtime prompt |
| `overtime` | Post-credits comms once Overtime begins | Distinct from the `barks.overtime` trigger lines |
| `logbook` | Ship's Log menu entries that unlock across the meta arc (runs 1 and 5, 3:00 survived, each boss, combo 100, rank 3 and 5, phantom unlock, first co-op, victories 1 and 5, 15:00 survived) | 82-93 words each |

## Draft lineage

- **Base: v2 draft 1** ("Bridge-crew drama"). Kept its cast, vessels, sectors and nearly all of its logbook.
- **From v2 draft 2:**
  - Biscuit the cat
  - the Hydra's named heads Glim, Glam and Glom
  - "Shields at 0%! Finally, a new number"
  - "OVERTIME! MANDATORY! UNPAID!"
  - "a star that needed some space"
  - Employee of the Month
  - the fridge door
  - "Your feedback has been ignored"
  - "I'm taking a personal day"
  - the glow-up and well-rounded-planet puns
- **From v2 draft 3:**
  - the Warden's flat cue-card reading ("Abandon hope. Feeling attached. Moving on.")
  - the cackle timing
  - Facetius asking for notes
  - "DO YOU LIKE MIME?"
  - "GET OUT OF MY MARGINS!"
  - "STOP COMBO-ING MY DRONES"
  - "IT IS OUR WHOLE BRAND"
  - "I had plans for that head" (now "for this face")
  - the 600-core revive
  - "two dashes. zero witnesses."
  - "oh. i'm on fire. that's how."
  - "I've had worse. Mostly yesterday."
  - "Skip the intro!"
- **IP fixes applied to the base:**
  - "cloak" became "stealth field"
  - "off and on again" became "jiggled the cable"
  - "brrrr" became "pew-pew"
  - "Shinier" became "Sparklier"
  - "beam" became "bolt"
