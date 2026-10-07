// SHARDSTORM narrative script: "Bridge-Crew Melodrama" (v2 final).
// See docs (story bible) for premise, cast, running gags and tone rules. Content only:
// the StoryDirector (./director.ts) decides when lines play, ./logbook.ts unlocks entries.
//
// Premise: you captain ONE small starship of the Allied Beacon Fleet against the
// Resplendent Lattice, a crystalline alien armada that humans call "the Shardstorm".
//
// Speaker conventions: '@pilot' = current captain, '@ai' = W.I.N.K. (ship's computer),
// '@villain' = Overlord Facetius (ALWAYS ALL CAPS). Nocturne speaks only in lowercase.
// Lt. Gauge speaks in flat periods, never exclamation marks.
// Logbook unlock semantics: runs = runs finished, boss = boss id defeated once,
// rank = player rank reached, victory = total victories, combo = best combo,
// time = best survival time in seconds, ship = ship id unlocked, coop = co-op runs.
//
// Ids (ship ids, boss ids) match the simulation's ids in src/game.

import type { ShipId } from '../game/types';

export type Speaker = '@pilot' | '@ai' | '@villain' | string;
export interface Line { speaker: Speaker; text: string }
export interface CharacterDef { id: string; name: string; role: string; color: string; glyph: string; voice: string }
export type BarkTrigger =
  | 'run_start' | 'daily_start' | 'first_kill' | 'levelup' | 'evolve' | 'relic' | 'cache'
  | 'combo_x2' | 'combo_x5' | 'combo_x10' | 'milestone' | 'overdrive' | 'perfect'
  | 'low_hp' | 'heal' | 'shield_break' | 'elite' | 'surge' | 'boss_half' | 'new_best' | 'revive'
  | 'idle' | 'overtime' | 'coop_start' | 'coop_down' | 'coop_revive';
export type { ShipId };
/** Capital ships with scripted sequences (same ids as the boss enemy kinds). */
export type BossId = 'warden' | 'hydra' | 'voidheart';
export const BOSS_IDS: readonly BossId[] = ['warden', 'hydra', 'voidheart'];
export interface LogbookEntry { id: string; title: string; unlock: { kind: 'runs' | 'boss' | 'rank' | 'victory' | 'combo' | 'time' | 'ship' | 'coop'; value: number | string }; text: string }
export interface StoryScript {
  fleetName: string;
  enemyName: string;
  vessels: Record<ShipId, { className: string; shipName: string; blurb: string }>;
  characters: CharacterDef[];
  pilots: Record<ShipId, string>;
  aiId: string;
  villainId: string;
  intro: { title: string; paragraphs: string[] };
  sectors: { name: string; subtitle: string; arrival: Line[] }[];
  bosses: Record<BossId, { intro: Line[]; half: Line[]; defeat: Line[]; victoryTaunt: Line[] }>;
  barks: Record<BarkTrigger, Line[]>;
  pilotBarks: Record<string, Partial<Record<BarkTrigger, Line[]>>>;
  gameOver: Line[];
  victory: { title: string; paragraphs: string[] };
  overtime: Line[];
  logbook: LogbookEntry[];
}

const P = '@pilot';
const AI = '@ai';
const V = '@villain';
const SCI = 'gauge';
const ENG = 'gasket';
const COM = 'static';
const CAT = 'biscuit';

export const STORY: StoryScript = {
  fleetName: 'The Allied Beacon Fleet',
  enemyName: 'The Resplendent Lattice',

  vessels: {
    spark: {
      className: 'Kindle-class light frigate',
      shipName: 'the Glimmer of Hope',
      blurb: 'Small, balanced, plucky. Captain Starling insists it is "cinematic".',
    },
    vanguard: {
      className: 'Monolith-class heavy cruiser',
      shipName: 'the Immovable Object',
      blurb: 'Armour like a mountain, speed like one too. Blades orbit. No reverse gear.',
    },
    tempest: {
      className: 'Zephyr-class interceptor',
      shipName: 'the Already Gone',
      blurb: 'Fastest hull in the fleet. Also the thinnest. Throws lightning. Rarely stops.',
    },
    bastion: {
      className: 'Citadel-class shield dreadnought',
      shipName: 'the Big Warm Hug',
      blurb: 'Every dash ends in a shockwave. Every crew member gets cocoa.',
    },
    phantom: {
      className: 'Whisper-class stealth raider',
      shipName: 'the Definitely Not Here',
      blurb: 'Two dashes, homing seekers, and a stealth field that is mostly lights-off.',
    },
  },

  characters: [
    {
      id: 'wink',
      name: 'W.I.N.K.',
      role: "Ship's computer (Wisecracking Integrated Navigation Kernel)",
      color: '#5cffd6',
      glyph: ';)',
      voice: 'Chipper ship computer; groan-tier puns; rates every joke out of ten.',
    },
    {
      id: 'facetius',
      name: 'Overlord Facetius',
      role: 'Supreme Refractor of the Resplendent Lattice',
      color: '#ff2bd6',
      glyph: '◈',
      voice: 'ALL CAPS crystal poetry; begs for notes and applause; cannot rhyme "shard".',
    },
    {
      id: 'starling',
      name: 'Captain Ambrose Starling',
      role: 'Captain of the Glimmer of Hope (spark)',
      color: '#7ff9ff',
      glyph: '✦',
      voice: 'Every order is a closing speech... with... dramatic... pauses.',
    },
    {
      id: 'ironwake',
      name: 'Captain Hilde Ironwake',
      role: 'Captain of the Immovable Object (vanguard)',
      color: '#a6ffef',
      glyph: '▣',
      voice: 'Stoic old warhorse. Slow, grave, granite. Has never once reversed.',
    },
    {
      id: 'hotwire',
      name: 'Captain Skye Hotwire',
      role: 'Captain of the Already Gone (tempest)',
      color: '#c9b8ff',
      glyph: 'ϟ',
      voice: 'Talks fast, flies faster; her speeches end before they start.',
    },
    {
      id: 'rampart',
      name: 'Captain Theodora Rampart',
      role: 'Captain of the Big Warm Hug (bastion)',
      color: '#6fd2ff',
      glyph: '◎',
      voice: 'Booming, big-hearted coach. Calls the crew "my lambs". Hugs often.',
    },
    {
      id: 'nocturne',
      name: 'Captain Corvin Nocturne',
      role: 'Captain of the Definitely Not Here (phantom)',
      color: '#ffb3f0',
      glyph: '☾',
      voice: 'whispers everything, so only ever speaks in lowercase. thinks nobody sees him.',
    },
    {
      id: 'warden',
      name: 'The Warden',
      role: 'Keeper of the First Gate (gate fortress)',
      color: '#ff2d55',
      glyph: '⬡',
      voice: 'Velvet-rope doorman of the cosmos. Checks the list. You are never on it.',
    },
    {
      id: 'hydra',
      name: 'The Hydra',
      role: 'Hunter-cruiser with three heads (Glim, Glam, Glom); It Hunts in Spirals',
      color: '#ff7a1a',
      glyph: '✷',
      voice: 'Three heads pass one sentence between them, dash to dash. Never agree. Dizzy.',
    },
    {
      id: 'voidheart',
      name: 'The Void Heart',
      role: "Hive mothership; The Storm Has a Heart; Facetius's mother",
      color: '#9d4dff',
      glyph: '♥',
      voice: 'Smothering hive-mom. Drones are "my babies". Facetius is "Sweet Prism".',
    },
    {
      id: 'gauge',
      name: 'Lt. Prudence Gauge',
      role: 'Science officer',
      color: '#b4ff6a',
      glyph: '⌖',
      voice: 'Flat monotone; absurd sensor data; regulations she wrote; shields always "at 20%".',
    },
    {
      id: 'gasket',
      name: 'Chief Engineer Gus Gasket',
      role: 'Chief engineer; runs the Workshop',
      color: '#ffd23f',
      glyph: '⚙',
      voice: 'The engines ("Mabel") are always at their limit. Then: NEW LIMIT!',
    },
    {
      id: 'static',
      name: 'Ensign Tilly Static',
      role: 'Comms officer',
      color: '#ff8c42',
      glyph: '≋',
      voice: 'Over-eager comms ensign; opens hailing frequencies nobody asked for.',
    },
    {
      id: 'biscuit',
      name: 'Biscuit',
      role: "Ship's cat; honorary admiral",
      color: '#ffd9a0',
      glyph: 'ω',
      voice: 'Mrrp. Subtitled. Knocks things off consoles at the most dramatic moment.',
    },
  ],

  pilots: {
    spark: 'starling',
    vanguard: 'ironwake',
    tempest: 'hotwire',
    bastion: 'rampart',
    phantom: 'nocturne',
  },
  aiId: 'wink',
  villainId: 'facetius',

  intro: {
    title: 'Previously... in SPACE',
    paragraphs: [
      "Ship's log, battle-day one. A crystal armada has arrived: the Resplendent Lattice. It is so vast and so glittering that our sensors filed a complaint.",
      'Its ruler, Overlord Facetius, means to bend every light in the galaxy into his crown. He also writes poetry. Both must be stopped.',
      'Out here we call his armada the Shardstorm. Triangles. Darts. Diamonds that charge. Circles that split. Hexagons that shoot. Squares that are just... big.',
      'Against it stands the Allied Beacon Fleet: five brave ships, five brave captains, one cat, and one engineer who swears the engines are at their absolute limit.',
      'Your guns fire on their own. You steer, you dash, you survive ten minutes. If you fall, the Workshop builds a new ship in one second. The fleet has spares. Do not ask why.',
    ],
  },

  sectors: [
    {
      name: 'The Turquoise Whorl',
      subtitle: 'Sector One: where the storm breaks',
      arrival: [
        { speaker: COM, text: 'Hailing frequencies open! Nobody is calling. It just felt right.' },
        { speaker: SCI, text: 'Sensors read one spiral galaxy, teal. Also approximately a zillion triangles.' },
        { speaker: V, text: 'SMALL LIGHT, YOU ENTER MY GLITTERING DOMAIN. YOU SHINE ONCE. NEVER AGAIN.' },
      ],
    },
    {
      name: 'The Garnet Nebula',
      subtitle: 'Sector Two: past the First Gate',
      arrival: [
        { speaker: SCI, text: 'Crimson nebula ahead. One ringed gas giant. It appears to be judging us.' },
        { speaker: AI, text: 'A ringed gas giant! Now THAT is a well-rounded planet. 7/10.' },
        { speaker: ENG, text: 'That gate fight took Mabel to her limit, Captain! ...NEW LIMIT!' },
        { speaker: V, text: 'ONE GATE FALLS. A HAIRLINE CRACK. MY HYDRA SPIRALS. IT CIRCLES BACK.' },
      ],
    },
    {
      name: 'The Amethyst Abyss',
      subtitle: 'Sector Three: the edge of the black hole',
      arrival: [
        { speaker: SCI, text: 'Black hole detected. Regulation 9: do not fall into the black hole.' },
        { speaker: AI, text: 'Relax! A black hole is just a star that needed some space. 9/10.' },
        { speaker: COM, text: "Incoming call for the overlord from... 'Mom'? Putting it through!" },
        { speaker: V, text: 'MOTHER, NOT ON THE OPEN CHANNEL! ...AHEM. TREMBLE, LIGHT. THE HIVE IS NIGH.' },
      ],
    },
    {
      name: 'The Gilded Throne',
      subtitle: 'Sector Four: the heart of the storm',
      arrival: [
        { speaker: SCI, text: 'Sensors read one throne, gold. One overlord, sulking. Readings: dramatic.' },
        { speaker: V, text: 'YOU BROKE MY GATE, MY HYDRA, AND MY MOM. I WILL NOW WRITE A VERY SAD POEM.' },
        { speaker: V, text: 'THERE IS NO FOURTH STANZA! WHY ARE YOU HERE? GET OUT OF MY MARGINS!' },
        { speaker: P, text: 'Gold. Obsidian. Glory. Today, crew... we write our own ending.' },
      ],
    },
  ],

  bosses: {
    warden: {
      intro: [
        { speaker: COM, text: 'Captain, the gate fortress is hailing us! It is asking for... ID?' },
        { speaker: 'warden', text: 'Keeper of the First Gate. Name? ...Hm. You are not on the list.' },
        { speaker: P, text: 'Then we shall write ourselves... onto that list. In lasers.' },
      ],
      half: [
        { speaker: 'warden', text: 'Dress code violation. You are wearing explosions. Very rude.' },
        { speaker: V, text: 'WARDEN! DO THE "ABANDON HOPE" LINE! WITH FEELING!' },
        { speaker: 'warden', text: 'Abandon hope. Feeling attached. Moving on.' },
      ],
      defeat: [
        { speaker: 'warden', text: "Fine. FINE. Go in. Tell them the Warden said it's cool." },
        { speaker: AI, text: 'We crashed the gate! Literally! Gate-crashers! 10/10, no notes.' },
        { speaker: ENG, text: 'Mabel took the whole gate fight, Captain! She needs a lie-down!' },
      ],
      victoryTaunt: [
        { speaker: 'warden', text: 'Thank you for visiting the First Gate. Your feedback has been ignored.' },
        { speaker: 'warden', text: 'Told you. Not on the list. NEXT!' },
        { speaker: V, text: 'THE GATE STANDS FIRM. THE LIGHT GOES OUT. THAT IS WHAT GATES ARE ALL ABOUT.' },
      ],
    },
    hydra: {
      intro: [
        { speaker: SCI, text: 'Three heads detected. Four? No. Three. It keeps re-counting itself.' },
        { speaker: 'hydra', text: 'We hunt— —in spirals— —round and round— —oh no, I feel dizzy.' },
        { speaker: P, text: 'Then we fly straight, crew. In a galaxy of spirals... be a line.' },
      ],
      half: [
        { speaker: 'hydra', text: 'You hit Glom— —rude— —I had plans for this face.' },
        { speaker: 'hydra', text: 'One head is furious— —one is seasick— —one is asleep.' },
        { speaker: ENG, text: "It's going in circles, Captain, and so is Mabel's fuel needle!" },
      ],
      defeat: [
        { speaker: 'hydra', text: 'Retreat!— —Advance!— —I am taking a personal day.' },
        { speaker: 'hydra', text: 'We hunted in spirals— —now we spiral down— —wheee— —ugh.' },
        { speaker: AI, text: 'Hydra down! It finally lost its head. All three, actually. 10/10.' },
      ],
      victoryTaunt: [
        { speaker: 'hydra', text: 'Round and round— —and caught you— —please hold, we need a moment.' },
        { speaker: V, text: 'ROUND AND ROUND MY HYDRA SPUN. ITS HEADS: THREE. YOUR SHIPS: NONE.' },
      ],
    },
    voidheart: {
      intro: [
        { speaker: COM, text: "Captain! The mothership is hailing! Caller ID says... 'MOM'." },
        { speaker: 'voidheart', text: "So YOU'RE the one shooting my babies. Sweet Prism told me ALL about you." },
        { speaker: V, text: 'MOTHER! I AM ONE THOUSAND YEARS OLD! DO NOT CALL ME SWEET PRISM!' },
      ],
      half: [
        { speaker: 'voidheart', text: 'Half my hive, gone! Babies, go to your rooms. Mommy is UPSET now.' },
        { speaker: V, text: 'MOTHER, STOP IMPROVISING! I WROTE YOU A PERFECTLY GOOD THREAT!' },
        { speaker: 'voidheart', text: 'Hush, Sweet Prism. Mommy is working.' },
      ],
      defeat: [
        { speaker: 'voidheart', text: 'Oh, my heart... Sweet Prism, eat a vegetable. Wear a scarf. Goodbye!' },
        { speaker: V, text: 'MOTHERRRR! ...YOU WILL PAY FOR THIS. IN VERSE. LONG VERSE.' },
        { speaker: AI, text: 'Void Heart down! Talk about a change of heart. 9/10.' },
      ],
      victoryTaunt: [
        { speaker: 'voidheart', text: 'Time-out, little ship. Sit in the void and think about what you did.' },
        { speaker: V, text: 'THE STORM HAS A HEART AND THE HEART HAS A RULE: NOBODY SHOOTS HER BABIES.' },
      ],
    },
  },

  barks: {
    run_start: [
      { speaker: P, text: 'Crew... the galaxy is watching. Let us give it... a show.' },
      { speaker: ENG, text: "Mabel's warm, Captain! She'll hold! For now! Probably!" },
      { speaker: SCI, text: 'Shields at 20%. They are full. Regulation 20 keeps us humble.' },
      { speaker: AI, text: 'Previously, on this ship: we exploded. Let us try the other thing!' },
      { speaker: V, text: 'ANOTHER SPARK TO SNUFF, ANOTHER LIGHT TO BEND. BEGIN.' },
      { speaker: COM, text: "Hailing frequencies open! Hi, everyone! ...It's just us. Hi." },
    ],
    daily_start: [
      { speaker: COM, text: 'Daily orders from Fleet Command! Same storm for every captain!' },
      { speaker: SCI, text: 'Daily Run parameters received. Regulation 1: do your best.' },
      { speaker: AI, text: 'Daily Run! Everyone gets the same storm. A shard experience!' },
      { speaker: V, text: 'EACH DAY YOU COME. EACH DAY YOU FALL. ONE POEM WILL DO FOR ALL.' },
    ],
    first_kill: [
      { speaker: AI, text: 'First kill! That drone got a crystal-clear message. 7/10.' },
      { speaker: SCI, text: 'Confirmed: one hostile is now many tiny hostiles. Of glitter.' },
      { speaker: P, text: 'The first of many. Let the record show... we drew first light.' },
      { speaker: V, text: 'ONE DRONE FALLS. HOW CRUDE. HOW CRASS. I CUT THAT DRONE FROM FINE GLASS.' },
      { speaker: COM, text: 'Enemy count down by one! Remaining: roughly all of them!' },
    ],
    levelup: [
      { speaker: ENG, text: "Upgrade fitted mid-battle! Don't tell the safety board!" },
      { speaker: AI, text: 'Level up! Shard work pays off. Ha! Shard work! 9/10.' },
      { speaker: SCI, text: 'Shard intake sufficient. Installing upgrade. Remain calm.' },
      { speaker: P, text: 'We grow stronger, crew... one glittering shard... at a time.' },
      { speaker: AI, text: "Level up! Now THAT is what I call a glow-up. 8/10." },
    ],
    evolve: [
      { speaker: SCI, text: 'Weapon has evolved. This is unprecedented. Also very sparkly.' },
      { speaker: ENG, text: "It EVOLVED! I didn't build that, but I'm still emotional!" },
      { speaker: AI, text: "Weapon evolved! It's going through a phase. A shooty phase. 9/10." },
      { speaker: V, text: 'YOU EVOLVED A WEAPON? I AM STILL EVOLVING MY FIRST STANZA!' },
      { speaker: P, text: 'Behold... what we have become. Brighter. Bolder. Sparklier.' },
    ],
    relic: [
      { speaker: SCI, text: 'Relic recovered. Origin: unknown. Smell: ancient. Value: big.' },
      { speaker: AI, text: 'A relic! Older than my jokes. Barely.' },
      { speaker: COM, text: 'The fleet archive wants a photo with the relic! Smile, Captain!' },
      { speaker: V, text: 'THAT RELIC WAS MINE. I KEPT IT NEXT TO MY OTHER RELIC.' },
      { speaker: CAT, text: 'Mrrp! (Biscuit would like to knock the relic off a shelf.)' },
    ],
    cache: [
      { speaker: AI, text: "A Cache! Like cash, but you can't spend it on snacks." },
      { speaker: ENG, text: 'Bonus parts! Oh, these are gorgeous. Mabel, look!' },
      { speaker: SCI, text: 'Elite cache secured. Contents: upgrades. Packaging: excessive.' },
      { speaker: V, text: 'THAT WAS A PERFORMANCE BONUS! GIVE IT BACK!' },
      { speaker: P, text: 'A gift... from a fallen foe. We will use it... with honour.' },
    ],
    combo_x2: [
      { speaker: AI, text: 'Combo x2! Double the shards, double the fun!' },
      { speaker: SCI, text: 'Multiplier: two. Kill rate: rising. Captain smugness: rising.' },
      { speaker: P, text: 'Two in a row. A fine start... to a finer legend.' },
      { speaker: COM, text: "Someone on the fleet channel just said 'nice'!" },
    ],
    combo_x5: [
      { speaker: AI, text: "x5! You're on fire! Not literally. Please don't be literally." },
      { speaker: ENG, text: "x5! Mabel's purring, Captain! That's either joy or a leak!" },
      { speaker: SCI, text: 'Combo x5. The sensors are blushing. I did not know they could.' },
      { speaker: V, text: 'STOP COMBO-ING MY DRONES! THEY HAVE FAMILIES! SMALL, POINTY ONES!' },
    ],
    combo_x10: [
      { speaker: AI, text: "x10! MAXIMUM! I've run out of exclamation marks!!!!!!" },
      { speaker: SCI, text: 'Multiplier: ten. This exceeds regulations. I am thrilled. Calmly.' },
      { speaker: ENG, text: "TEN?! Captain, the combo counter can't go higher! It'll pop!" },
      { speaker: V, text: 'TEN?! MY FACETS CRACK! MY STANZAS SHAKE!' },
      { speaker: CAT, text: 'MRRP! (Biscuit has knocked a mug off the console. In celebration.)' },
      { speaker: P, text: 'Ten... times... the glory. Write it down, crew. In gold ink.' },
    ],
    milestone: [
      { speaker: AI, text: 'Milestone! Magnets, novas, overdrive... it is a birthday party!' },
      { speaker: SCI, text: 'Milestone confirmed. Payload released. Please enjoy responsibly.' },
      { speaker: ENG, text: 'Everything is glowing! Is it supposed to glow? GOOD glowing?' },
      { speaker: P, text: 'A milestone, crew. Remember this moment... when we are statues.' },
    ],
    overdrive: [
      { speaker: ENG, text: "OVERDRIVE! Mabel's past her limit! NEW LIMIT! NEW LIMIT!" },
      { speaker: AI, text: 'Overdrive! Pew-pew is now pew-pew-pew-pew-pew. Technical term.' },
      { speaker: SCI, text: 'Fire rate +50%. Regulation 88 permits this. I wrote Regulation 88.' },
      { speaker: V, text: 'STOP! STOP THE BRIGHTNESS! MY LATTICE IS NOT RATED FOR THIS!' },
    ],
    perfect: [
      { speaker: AI, text: 'PERFECT DASH! So smooth that time slowed down to watch.' },
      { speaker: SCI, text: 'Attack passed through us. Damage: zero. Textbook. My textbook.' },
      { speaker: P, text: 'Through the fire... and out the other side. As planned.' },
      { speaker: ENG, text: 'Right through the bolt?! My poor heart! Do it again!' },
      { speaker: V, text: 'YOU DODGED MY VERSE? NOBODY DODGES MY VERSE!' },
    ],
    low_hp: [
      { speaker: SCI, text: 'Shields at 20%. For once, that is accurate. Trend: bad.' },
      { speaker: ENG, text: "She's at her limit, Captain! The REAL one! The real real one!" },
      { speaker: AI, text: "Hull critical! On the bright side, we're very aerodynamic now." },
      { speaker: P, text: 'Steady, crew... if this is the end... it will be gorgeous.' },
      { speaker: COM, text: "Fleet Command says 'please stop getting hit'! Passing it on!" },
      { speaker: V, text: 'FLICKER, LITTLE LIGHT. FLICKER, FADE, AND FLEE.' },
    ],
    heal: [
      { speaker: ENG, text: 'Hull patched! Mostly tape! Space tape! But still tape!' },
      { speaker: AI, text: 'Repairs done! Back in mint condition. Mint. Fresh. 6/10.' },
      { speaker: SCI, text: 'Hull integrity rising. Crew panic returning to baseline.' },
      { speaker: P, text: 'We are mended, crew. And mended things... hold the line.' },
    ],
    shield_break: [
      { speaker: SCI, text: 'Shield down. Repeat: the pretty bubble has popped.' },
      { speaker: ENG, text: "The shield took that hit so Mabel didn't have to! A hero!" },
      { speaker: AI, text: 'Shield broken! It had a good life. About four seconds of one.' },
      { speaker: V, text: 'YOUR SHIELD SHATTERED! SEE? SHATTERING! IT IS OUR WHOLE BRAND!' },
    ],
    elite: [
      { speaker: SCI, text: 'Elite signature. Gold rim. Employee of the Month. Has a Cache.' },
      { speaker: COM, text: "A gold-rimmed hostile is hailing! It just said 'AHEM' really loud." },
      { speaker: AI, text: 'Gold-plated bad guy! My bling-dar says: pop it for loot.' },
      { speaker: V, text: 'BEHOLD MY ELITE, RIMMED IN GOLD! ITS FACETS: MANY. ITS TEMPER: BOLD.' },
    ],
    surge: [
      { speaker: COM, text: 'Red alert! Redder than usual! Everything is incoming!' },
      { speaker: SCI, text: "Massive surge. Sensors read 'a LOT'. That is all they say." },
      { speaker: V, text: 'RISE, MY LATTICE! SURGE AND SHINE! EVERY FACET, FALL IN LINE!' },
      { speaker: ENG, text: 'If they all hit at once, Mabel is going to be very upset!' },
      { speaker: P, text: 'They come in waves, crew. Then so shall we... a bigger wave.' },
    ],
    boss_half: [
      { speaker: SCI, text: 'Boss hull at 50%. Its dramatic music remains at 100%.' },
      { speaker: AI, text: 'Half-shattered! Glass half full! 8/10.' },
      { speaker: P, text: 'Halfway, crew. The second half... is where legends live.' },
      { speaker: ENG, text: "Half its hull is gone! Ours is... let's not compare!" },
      { speaker: V, text: 'HALF?! ALREADY? I HAD NOT EVEN FINISHED THE OVERTURE!' },
    ],
    new_best: [
      { speaker: AI, text: 'NEW BEST! Saved to permanent memory. Right next to my best pun.' },
      { speaker: SCI, text: 'Personal record exceeded. Statistically, you are getting good.' },
      { speaker: COM, text: "The whole fleet is cheering! I can hear it! It's SO loud!" },
      { speaker: V, text: 'A NEW RECORD? I AM NOT IMPRESSED. I AM SLIGHTLY IMPRESSED.' },
      { speaker: CAT, text: 'Mrrp. (Biscuit is unimpressed. Biscuit is secretly impressed.)' },
    ],
    revive: [
      { speaker: ENG, text: "Jump-start! She LIVES! Mabel's back, Captain!" },
      { speaker: AI, text: 'Revived! I jiggled the cable. Classic repair. 10/10.' },
      { speaker: SCI, text: 'Revive successful. You were briefly a statistic. Not anymore.' },
      { speaker: V, text: 'YOU RETURN? I ALREADY WROTE YOUR EULOGY. IT RHYMED!' },
      { speaker: ENG, text: 'Revive modules cost 600 cores, Captain! Make this one count!' },
    ],
    idle: [
      { speaker: AI, text: 'Captain? Should I tell a joke to fill the silence? Too late.' },
      { speaker: SCI, text: 'We are drifting, Captain. Regulation 3: move the ship.' },
      { speaker: COM, text: 'Fleet Command is asking if we are okay. Are we okay?' },
      { speaker: ENG, text: 'Mabel loves a rest, Captain, but the triangles do not!' },
      { speaker: CAT, text: 'Mrrp? (Biscuit is sitting on the helm controls.)' },
      { speaker: V, text: 'YOU PAUSE? SPLENDID. A CAPTIVE AUDIENCE. STANZA ONE...' },
    ],
    overtime: [
      { speaker: AI, text: 'Overtime! I hope we are getting paid for this. Are we?' },
      { speaker: ENG, text: "Overtime?! Mabel's union is going to hear about this!" },
      { speaker: SCI, text: 'Mission complete. Continuing anyway. Irregular. I love it.' },
      { speaker: V, text: 'TEN MINUTES? FINE. OVERTIME! MANDATORY! UNPAID!' },
      { speaker: P, text: 'The battle is won, crew... but the speech... continues.' },
    ],
    coop_start: [
      { speaker: COM, text: 'Fleet channel open! Several captains on the line! Hi, all!' },
      { speaker: AI, text: 'Co-op detected! More ships! More friends! More pun victims!' },
      { speaker: SCI, text: 'Formation flight confirmed. Regulation 7: share the shards.' },
      { speaker: V, text: 'MORE OF YOU? SPLENDID. MORE LIGHTS FOR MY CHANDELIER.' },
    ],
    coop_down: [
      { speaker: COM, text: 'Ally down! Ally down! Someone fly over and help!' },
      { speaker: SCI, text: 'Wingmate disabled. Regulation 7b: go and get them.' },
      { speaker: ENG, text: 'Their engines are cold! Get close and give them a jump!' },
      { speaker: P, text: 'No captain is left behind, crew. Not today. Not ever.' },
    ],
    coop_revive: [
      { speaker: AI, text: 'Ally revived! Friendship is the real weapon. Also the weapons.' },
      { speaker: COM, text: "They're back! The fleet channel is cheering! I'm cheering!" },
      { speaker: ENG, text: 'Jump-start worked! Their engines are humming again!' },
      { speaker: P, text: 'Rise, friend. We fly as one... or as two very close ones.' },
    ],
  },

  pilotBarks: {
    starling: {
      run_start: [
        { speaker: 'starling', text: 'Crew... they say the dark is endless. Well... so is my speech.' },
        { speaker: 'starling', text: 'Today we fly... for every light that ever flickered. Forward.' },
        { speaker: 'starling', text: 'Ladies, gentlemen, sensors... let us make history. Then lunch.' },
      ],
      perfect: [
        { speaker: 'starling', text: 'Did you see that, crew? Paint it. Hang it in the mess hall.' },
        { speaker: 'starling', text: 'Time itself... paused... to applaud. As it should.' },
      ],
      low_hp: [
        { speaker: 'starling', text: 'If we fall... let them say we fell beautifully. But let us not.' },
        { speaker: 'starling', text: 'Hull... failing. Spirit... intact. Speech... continuing.' },
      ],
      new_best: [
        { speaker: 'starling', text: 'A new record! I thank the crew, the engines... and my jawline.' },
        { speaker: 'starling', text: 'Raise the banner. Roll the credits. Hold the applause. No, keep it.' },
      ],
      revive: [
        { speaker: 'starling', text: 'They say a hero never falls. Correction: a hero gets back up.' },
      ],
    },
    ironwake: {
      run_start: [
        { speaker: 'ironwake', text: 'This ship has no reverse gear. Neither do I. Forward.' },
        { speaker: 'ironwake', text: 'The Immovable Object is underway. Slowly. Inevitably.' },
      ],
      perfect: [
        { speaker: 'ironwake', text: 'I do not dodge. I simply arrive elsewhere first.' },
        { speaker: 'ironwake', text: 'Hm. Graceful. Tell no one I can do that.' },
      ],
      low_hp: [
        { speaker: 'ironwake', text: 'Hull breached. Resolve intact. We hold this patch of space.' },
        { speaker: 'ironwake', text: 'Ironwake does not fall. She leans. Dramatically.' },
        { speaker: 'ironwake', text: "I've had worse. Mostly yesterday." },
      ],
      new_best: [
        { speaker: 'ironwake', text: 'A new record. I will allow myself one smile. ...There. Done.' },
        { speaker: 'ironwake', text: 'Carve it into the hull, Gasket. Next to the other dents.' },
      ],
    },
    hotwire: {
      run_start: [
        { speaker: 'hotwire', text: 'Crew, today we— nope, already moving! Speech later!' },
        { speaker: 'hotwire', text: 'Friends, fleet, fellow pilots, lend me your— FLOOR IT!' },
        { speaker: 'hotwire', text: 'Skip the intro! Why is there no skip on the INTRO?!' },
      ],
      perfect: [
        { speaker: 'hotwire', text: 'Too fast for physics! Keep up, physics!' },
        { speaker: 'hotwire', text: 'Missed me! Missed me! Now you have to— oh, they all popped.' },
      ],
      low_hp: [
        { speaker: 'hotwire', text: 'We are in pieces! FAST pieces! Gasket, tape, quick!' },
        { speaker: 'hotwire', text: 'Low hull, high speed! Fair trade, right? RIGHT?' },
      ],
      new_best: [
        { speaker: 'hotwire', text: 'New best! Already beat it in my head! Go again!' },
        { speaker: 'hotwire', text: "Record! Speech! 'Thanks!' Done! Next run!" },
      ],
    },
    rampart: {
      run_start: [
        { speaker: 'rampart', text: 'Helmets on, hearts out, my lambs! Nobody gets hurt but THEM!' },
        { speaker: 'rampart', text: "The Big Warm Hug is rolling out! Cocoa's on! Let's GO!" },
      ],
      perfect: [
        { speaker: 'rampart', text: 'Dodged it AND shockwaved it! Gold stars for everyone!' },
        { speaker: 'rampart', text: 'Ooh! A hug they did not see coming!' },
      ],
      low_hp: [
        { speaker: 'rampart', text: 'Hull is cracking, lambs! But this heart? Triple-plated!' },
        { speaker: 'rampart', text: 'Stay behind me, crew! ...There is no behind. Stay CLOSE!' },
      ],
      new_best: [
        { speaker: 'rampart', text: 'New best! Group hug! Everyone! Even you, Gauge!' },
        { speaker: 'rampart', text: 'Fridge door, lambs! This one goes on the BIG fridge!' },
        { speaker: 'rampart', text: "I'm not crying, the shield is leaking! So proud of you!" },
      ],
    },
    nocturne: {
      run_start: [
        { speaker: 'nocturne', text: 'psst. the definitely not here is... here. shh.' },
        { speaker: 'nocturne', text: "they can't see us, crew. i turned the lights off." },
      ],
      perfect: [
        { speaker: 'nocturne', text: 'two dashes. zero witnesses. well. one cat.' },
        { speaker: 'nocturne', text: 'they shot where i was. rookie mistake. never be where you are.' },
      ],
      low_hp: [
        { speaker: 'nocturne', text: 'they found us. how? i was being SO quiet.' },
        { speaker: 'nocturne', text: "how can they see me? oh. i'm on fire. that's how." },
      ],
      new_best: [
        { speaker: 'nocturne', text: 'new record. celebrate silently, crew. yay. ...sorry, too loud?' },
        { speaker: 'nocturne', text: 'nobody saw that. a shame, honestly. it was incredible.' },
      ],
    },
  },

  gameOver: [
    { speaker: ENG, text: 'Mabel is in pieces! Good news: the Workshop has more Mabels.' },
    { speaker: SCI, text: 'We exploded. Shields at 0%. Finally, a new number.' },
    { speaker: V, text: 'SO BRIEF A SPARK, SO SHORT A SHINE. THE LOSS IS YOURS. THE POEM IS MINE.' },
    { speaker: AI, text: 'Ship destroyed. Rebooting crew morale... done. Puns reloaded.' },
    { speaker: COM, text: "Fleet Command says 'nice try!' and also 'here is another ship'." },
    { speaker: P, text: 'We fell, crew... but a good captain always gets... a sequel.' },
    { speaker: V, text: 'VICTORY! AHEM. WAS THE CACKLE TOO LONG? I TIMED IT AT NINE SECONDS.' },
    { speaker: SCI, text: 'Cause of defeat: crystals. Mostly triangles. The triangles were rude.' },
    { speaker: ENG, text: 'Rebuilt her in under a second! Personal record, Captain! Go again!' },
    { speaker: 'warden', text: 'Your guest pass has expired. Please reapply at the back of the queue.' },
    { speaker: V, text: 'AGAIN YOU FALL. AGAIN I RHYME. I AM RUNNING OUT OF RHYMES FOR TIME.' },
    { speaker: AI, text: 'Good news: the cores made it home. Unlike the ship. 5/10.' },
    { speaker: COM, text: "The escape pod is playing our theme song! ...It's just beeping." },
    { speaker: CAT, text: "Mrrp. (Biscuit has sat on your results. They are Biscuit's now.)" },
    { speaker: P, text: "Ship's log: we lost. Correction: we learned. Loudly." },
    { speaker: 'hydra', text: 'We got them— —I got them— —can we stop spinning now?' },
    { speaker: ENG, text: 'Spend those cores in the Workshop, Captain! Mabel wants new shoes!' },
    { speaker: V, text: 'YOUR SHIP IS SHATTERED, YOUR HULL IS MARRED... AND NOTHING RHYMES WITH SHARD.' },
    { speaker: SCI, text: 'Regulation 2: try again immediately. I am invoking Regulation 2.' },
    { speaker: 'voidheart', text: 'Oh, sweetie. Come back tomorrow. And bring a scarf.' },
    { speaker: AI, text: "You got shattered! Don't worry, it happens to the best of us. Often." },
    { speaker: V, text: 'RATE MY VICTORY POEM, ONE TO FIVE SHARDS! ...HELLO? ANYONE?' },
  ],

  victory: {
    title: 'The Light Holds',
    paragraphs: [
      'Ten minutes. Three capital ships. One very sad overlord. The Shardstorm breaks against your hull like waves against a very stubborn rock.',
      'Overlord Facetius retreats to the Gilded Throne to write a 400-verse poem about you. It does not rhyme. Lt. Gauge has already filed a critique.',
      'Chief Engineer Gasket reports that Mabel went past every limit she ever had and is now "just vibing". W.I.N.K. rates the battle a rare 11/10. Biscuit sleeps on the trophy.',
      'The Allied Beacon Fleet salutes you, Captain. The galaxy shines again. Mostly. Something on the long-range sensors is still sparkling...',
    ],
  },

  overtime: [
    { speaker: V, text: 'YOU THOUGHT THE POEM WAS OVER? THAT WAS MERELY THE INTERMISSION.' },
    { speaker: COM, text: 'Hailing frequencies open! The armada is back! They brought MORE armada!' },
    { speaker: ENG, text: "Overtime?! Mabel already clocked out! ...She's clocking back in!" },
    { speaker: SCI, text: 'Post-credits hostiles detected. Count: endless. Score potential: also endless.' },
    { speaker: V, text: 'I HAVE USED ALL MY RHYMES! DO... DO YOU LIKE MIME?' },
    { speaker: AI, text: 'Stay after the credits! There is a bonus scene. Spoiler: it is you, exploding.' },
  ],

  logbook: [
    {
      id: 'first-light',
      title: "Ship's Log: First Light",
      unlock: { kind: 'runs', value: 1 },
      text: "Ship's log, battle-day one. The Resplendent Lattice came out of the dark like a chandelier falling up a staircase. Their overlord opened a channel to every ship in the fleet and recited a poem. It was eleven minutes long. Lt. Gauge timed it. Ensign Static tried to hang up and accidentally put it on speaker. We have flown our first sortie and lost our first ship. Chief Engineer Gasket rebuilt it before I finished saying 'we have lost our first ship'. The crew is in good spirits. The overlord is on verse two.",
    },
    {
      id: 'mabel',
      title: 'The Engineer and Mabel',
      unlock: { kind: 'runs', value: 5 },
      text: "Chief Engineer Gasket has named the engines Mabel. He talks to her. He reads to her. When the alarms sound he shouts that Mabel is at her limit, and every time she survives he declares a NEW LIMIT and writes it on the wall in grease pencil. The wall is now full. He has started on the ceiling. Between battles he lives in the Workshop, spending cores on upgrades and on a small knitted cover that Mabel does not need. He insists she does. Biscuit sleeps on it.",
    },
    {
      id: 'regulations',
      title: 'Regulation Zero',
      unlock: { kind: 'time', value: 180 },
      text: "Lt. Prudence Gauge carries the Fleet Book of Regulations at all times. It has 412 regulations. She wrote 409 of them. Regulation 3 says 'move the ship'. Regulation 9 says 'do not fall into the black hole'. Regulation 20 says shields are always reported at 20%, 'to keep the crew humble'. Today we survived three full minutes and she read the crew Regulation Zero, which she keeps on a separate card: 'Come home.' Then she put the card away and pretended nothing happened. Nobody mentioned it. Everybody saw.",
    },
    {
      id: 'not-on-the-list',
      title: 'Not on the List',
      unlock: { kind: 'boss', value: 'warden' },
      text: "The Warden has guarded the First Gate for nine thousand years. In that time it has let exactly nobody through, including Overlord Facetius, who is apparently not on the list either and has to use a side door. It reads his threats off cue cards in the voice of a fire-safety notice. We did not get on the list. We went through the gate anyway, in pieces of it. Its last transmission: 'Fine. Tell them I said it's cool.' Lt. Gauge has filed this as a formal treaty.",
    },
    {
      id: 'pun-ledger',
      title: "W.I.N.K.'s Pun Ledger",
      unlock: { kind: 'combo', value: 100 },
      text: "The ship's computer keeps a private file called the Pun Ledger. Every joke W.I.N.K. tells is logged with a score out of ten, which W.I.N.K. also awards. The average is 8.7. The crew's average for the same jokes is 2.1. Today we chained a hundred kills, and for one full second W.I.N.K. said nothing at all. Then it logged a new entry, score 10, titled 'the captain'. It was not a pun. W.I.N.K. claims it was a typo. The ledger says otherwise.",
    },
    {
      id: 'closing-speeches',
      title: 'Five Captains, One Podium',
      unlock: { kind: 'rank', value: 3 },
      text: "The fleet's five captains met at the Workshop to decide who gives the best speech. Starling paused for so long the lights switched off. Ironwake said one word and sat down; it was a very good word. Hotwire finished before anyone noticed she had started. Rampart made everyone cry and then handed out cocoa. Nocturne whispered his speech and nobody heard it, which he called a triumph. The vote was a five-way tie. Gauge has proposed a regulation requiring shorter speeches. All five captains gave speeches against it.",
    },
    {
      id: 'round-and-round',
      title: 'Round and Round',
      unlock: { kind: 'boss', value: 'hydra' },
      text: "The Hydra hunts in spirals because its three heads, Glim, Glam and Glom, cannot agree on a direction. Each head gets one vote, every vote is different, and so the whole ship turns in circles forever. Lt. Gauge reports that one head was furious during our battle, one was seasick and one was asleep. When it broke apart, the heads finished one last sentence together, in order, for the first time in history. Ensign Static recorded it. The sentence was 'wheee'. We are told this is a sacred word now.",
    },
    {
      id: 'fleet-channel',
      title: 'Hailing Frequencies',
      unlock: { kind: 'coop', value: 1 },
      text: "Ensign Tilly Static opens hailing frequencies about forty times a battle. Usually no one is there. Today, someone was: other captains of the Beacon Fleet, flying right beside us. Static said hello to all of them, twice, and then cried a little. Gauge reminded everyone of Regulation 7, 'share the shards', and Regulation 7b, 'if a wingmate goes down, go and get them'. We did. Static says this was the best call she has ever had, and she has had a lot of calls.",
    },
    {
      id: 'sweet-prism',
      title: "A Mother's Hive",
      unlock: { kind: 'boss', value: 'voidheart' },
      text: "We now know the truth about the Void Heart. The hive mothership that births the Shardstorm's drones is Overlord Facetius's mother. She calls him Sweet Prism. She calls every drone 'my baby'. She called us 'that rude little ship' and sent him a reminder to wear a scarf in the middle of the battle. Facetius has asked the whole galaxy, in ALL CAPS, to forget this ever happened. The crew has voted. We will not forget. Gasket has already made a scarf.",
    },
    {
      id: 'overlord-notebook',
      title: "The Overlord's Notebook",
      unlock: { kind: 'rank', value: 5 },
      text: "Ensign Static intercepted a page from Facetius's private notebook. It reads, in full: 'SHARD. HARD. CARD. LARD? NO. BARD? YES, ME. GUARD. MARRED. SCARRED. NOTHING RHYMES WITH SHARD, AND I AM SO TIRED.' At the bottom, in smaller capitals: 'PERHAPS THEY WOULD LIKE MY POEMS IF I ASKED FOR NOTES.' Lt. Gauge read it twice and then, without being asked, wrote three rhymes for 'shard' on a sticky note. She has not sent it. She keeps it in her regulation book, under Zero.",
    },
    {
      id: 'lights-off',
      title: 'Whispers in the Dark',
      unlock: { kind: 'ship', value: 'phantom' },
      text: "Captain Corvin Nocturne commands the Definitely Not Here, the fleet's only stealth raider. Gasket finally inspected its famous stealth field. It is a light switch. When Nocturne flips it, the cabin goes dark and he whispers 'they can't see us now'. The enemy can absolutely see him. However, the switch also routes all power to the dash thrusters, which is why the ship dashes twice. Gasket has decided this counts as stealth technology. The only crew member who truly cannot be found aboard is Biscuit.",
    },
    {
      id: 'the-light-holds',
      title: 'Silence on Every Channel',
      unlock: { kind: 'victory', value: 1 },
      text: "Ship's log, final battle-day. Ten minutes. The Warden, the Hydra and the Void Heart all fell, and the Shardstorm broke against us like a wave against a stubborn rock. Facetius has gone quiet on the Gilded Throne. For the first time since this war began, no poem is playing on any channel. The crew should be cheering. Instead, Lt. Gauge is staring at her sticky note, Static is staring at the comms panel, and W.I.N.K. has gone suspiciously silent. I think we all miss the poems.",
    },
    {
      id: 'new-limit',
      title: 'Past Every Limit',
      unlock: { kind: 'time', value: 900 },
      text: "Fifteen minutes. We are deep into overtime, and Mabel has passed every limit on the wall, the ceiling, and now the floor. Gasket has stopped shouting 'NEW LIMIT'. He just sits beside the engine with his hand on the casing, very quietly saying 'good girl, good girl'. Lt. Gauge reports the engines are reading at a level her instruments describe only as 'proud'. W.I.N.K. tried to make a joke about it and, for once, decided not to. The armada keeps coming. So do we.",
    },
    {
      id: 'last-stanza',
      title: 'The Last Stanza',
      unlock: { kind: 'victory', value: 5 },
      text: "Lt. Gauge finally sent the sticky note. Facetius read it on an open channel, in ALL CAPS, for the whole galaxy: 'I AM THE LATTICE, PROUD AND HARD. BUT EVEN STARS NEED SOME REGARD.' Then, after a long pause: 'IT RHYMES. IT RHYMES WITH SHARD.' The armada stopped firing for eleven seconds. His mother cried. Gasket cried. W.I.N.K. logged it in the Pun Ledger at 11/10. Then the Shardstorm came back, of course, because it always does. But now, between waves, he reads us his poems. And we clap.",
    },
  ],
};
