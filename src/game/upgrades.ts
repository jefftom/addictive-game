import { pow } from '../core/dmath';
import { MAX_PASSIVE_LEVEL, MAX_PASSIVES, PASSIVES, PASSIVE_IDS, RARITY_WEIGHT, RELICS, RELIC_IDS } from './content/passives';
import { MAX_WEAPONS, MAX_WEAPON_LEVEL, WEAPONS } from './content/weapons';
import type { PassiveId, Rarity, RelicId, WeaponId } from './types';
import type { World } from './world';

export type Offer =
  | { kind: 'weapon'; id: WeaponId; level: number; isNew: boolean }
  | { kind: 'evolve'; id: WeaponId }
  | { kind: 'passive'; id: PassiveId; level: number; isNew: boolean }
  | { kind: 'relic'; id: RelicId }
  | { kind: 'heal' }
  | { kind: 'cores'; amount: number }
  | { kind: 'score'; amount: number };

export function offerKey(o: Offer): string {
  switch (o.kind) {
    case 'weapon':
    case 'evolve':
    case 'passive':
    case 'relic':
      return `${o.kind}:${o.id}`;
    default:
      return o.kind;
  }
}

export function offerRarity(o: Offer): Rarity {
  if (o.kind === 'relic') return RELICS[o.id].rarity;
  if (o.kind === 'evolve') return 'legendary';
  return 'common';
}

/** Weapons whose evolution is currently available. */
export function availableEvolutions(world: World, pid = 0): WeaponId[] {
  const out: WeaponId[] = [];
  const build = world.players[pid]!.build;
  for (const w of build.weapons) {
    if (w.evolved || w.level < MAX_WEAPON_LEVEL) continue;
    const partner = WEAPONS[w.id].evolvesWith;
    if ((build.passives[partner] ?? 0) > 0) out.push(w.id);
  }
  return out;
}

interface Candidate {
  offer: Offer;
  weight: number;
}

export function offerCandidates(world: World, cache: boolean, pid = 0): Candidate[] {
  const { cfg } = world;
  const { build, stats } = world.players[pid]!;
  const out: Candidate[] = [];
  const ownedWeapons = new Set(build.weapons.map((w) => w.id));

  for (const w of build.weapons) {
    if (!w.evolved && w.level < MAX_WEAPON_LEVEL) {
      out.push({ offer: { kind: 'weapon', id: w.id, level: w.level + 1, isNew: false }, weight: 11 });
    }
  }
  if (build.weapons.length < MAX_WEAPONS) {
    for (const id of cfg.weaponPool) {
      if (!ownedWeapons.has(id)) out.push({ offer: { kind: 'weapon', id, level: 1, isNew: true }, weight: 7 });
    }
  }

  const passiveCount = Object.keys(build.passives).length;
  for (const id of PASSIVE_IDS) {
    const lvl = build.passives[id] ?? 0;
    if (lvl > 0 && lvl < MAX_PASSIVE_LEVEL) {
      out.push({ offer: { kind: 'passive', id, level: lvl + 1, isNew: false }, weight: 9 });
    } else if (lvl === 0 && passiveCount < MAX_PASSIVES) {
      out.push({ offer: { kind: 'passive', id, level: 1, isNew: true }, weight: 5 });
    }
  }

  if (cfg.relicsEnabled) {
    const luck = stats.luck;
    for (const id of RELIC_IDS) {
      if (build.relics.includes(id)) continue;
      const rarity = RELICS[id].rarity;
      const tier = rarity === 'legendary' ? 2 : rarity === 'epic' ? 1.5 : 1;
      let weight = RARITY_WEIGHT[rarity] * 0.35 * pow(luck, tier);
      if (cache) weight *= 4;
      out.push({ offer: { kind: 'relic', id }, weight });
    }
  }
  return out;
}

/**
 * Builds a set of distinct offers. Evolutions (if available) are always
 * included first; caches guarantee one relic when relics are unlocked.
 */
export function generateOffers(world: World, count: number, cache = false, pid = 0): Offer[] {
  const rng = world.lootRng;
  const offers: Offer[] = [];
  const used = new Set<string>();

  for (const id of availableEvolutions(world, pid)) {
    if (offers.length >= count) break;
    const o: Offer = { kind: 'evolve', id };
    offers.push(o);
    used.add(offerKey(o));
  }

  const candidates = offerCandidates(world, cache, pid);

  if (cache && offers.length < count) {
    const relics = candidates.filter((c) => c.offer.kind === 'relic');
    const idx = rng.weightedIndex(relics.map((c) => c.weight));
    if (idx >= 0) {
      const o = relics[idx]!.offer;
      offers.push(o);
      used.add(offerKey(o));
    }
  }

  const pool = candidates.filter((c) => !used.has(offerKey(c.offer)));
  while (offers.length < count && pool.length > 0) {
    const idx = rng.weightedIndex(pool.map((c) => c.weight));
    if (idx < 0) break;
    const [picked] = pool.splice(idx, 1);
    offers.push(picked!.offer);
    used.add(offerKey(picked!.offer));
  }

  // Keep power growth steady: make sure at least one weapon card is on offer when any exists.
  const isWeapon = (o: Offer) => o.kind === 'weapon' || o.kind === 'evolve';
  if (!offers.some(isWeapon)) {
    const weaponPool = candidates.filter((c) => c.offer.kind === 'weapon');
    const idx = rng.weightedIndex(weaponPool.map((c) => c.weight));
    if (idx >= 0) {
      const replaceAt = offers.findIndex((o) => o.kind === 'passive' || o.kind === 'heal' || o.kind === 'cores' || o.kind === 'score');
      if (replaceAt >= 0) offers[replaceAt] = weaponPool[idx]!.offer;
      else if (offers.length < count) offers.push(weaponPool[idx]!.offer);
    }
  }

  // Fallbacks once the build is complete.
  const fillers: Offer[] = [
    // A downed pilot can't be healed, so the heal card is hidden for them.
    ...(world.players[pid]!.downed ? [] : [{ kind: 'heal' } as const]),
    { kind: 'cores', amount: 5 + Math.floor(world.time / 60) * 2 },
    { kind: 'score', amount: 500 + Math.floor(world.time) * 10 },
  ];
  for (const f of fillers) {
    if (offers.length >= count) break;
    offers.push(f);
  }
  return offers;
}

export function applyOffer(world: World, offer: Offer, pid = 0): void {
  const p = world.players[pid]!;
  const { build } = p;
  switch (offer.kind) {
    case 'weapon': {
      const existing = build.weapons.find((w) => w.id === offer.id);
      if (existing) existing.level = Math.min(MAX_WEAPON_LEVEL, existing.level + 1);
      else if (build.weapons.length < MAX_WEAPONS) world.addWeapon(offer.id, pid);
      break;
    }
    case 'evolve': {
      const w = build.weapons.find((x) => x.id === offer.id);
      if (w) {
        w.evolved = true;
        w.timer = 0;
        world.runStats.evolutions++;
        p.run.evolutions++;
      }
      break;
    }
    case 'passive': {
      build.passives[offer.id] = Math.min(MAX_PASSIVE_LEVEL, (build.passives[offer.id] ?? 0) + 1);
      break;
    }
    case 'relic': {
      if (!build.relics.includes(offer.id)) build.relics.push(offer.id);
      if (offer.id === 'shield') {
        p.shieldReady = true;
        p.shieldT = 0;
      }
      break;
    }
    case 'heal':
      world.heal(p.stats.maxHp * 0.4, pid);
      break;
    case 'cores':
      world.runStats.coresCollected += offer.amount;
      break;
    case 'score':
      world.addScore(offer.amount);
      break;
  }
  world.refreshStats(pid);
}

export function offerTitle(o: Offer): string {
  switch (o.kind) {
    case 'weapon':
      return WEAPONS[o.id].name;
    case 'evolve':
      return WEAPONS[o.id].evolvedName;
    case 'passive':
      return PASSIVES[o.id].name;
    case 'relic':
      return RELICS[o.id].name;
    case 'heal':
      return 'Field Repair';
    case 'cores':
      return 'Core Cache';
    case 'score':
      return 'Shard Hoard';
  }
}

export function offerText(o: Offer): string {
  switch (o.kind) {
    case 'weapon':
      return o.isNew ? WEAPONS[o.id].blurb : WEAPONS[o.id].levelText[o.level - 2] ?? '';
    case 'evolve':
      return WEAPONS[o.id].evolvedBlurb;
    case 'passive':
      return PASSIVES[o.id].text;
    case 'relic':
      return RELICS[o.id].text;
    case 'heal':
      return 'Restore 40% of your max HP.';
    case 'cores':
      return `+${o.amount} cores, kept even if you die.`;
    case 'score':
      return `+${o.amount.toLocaleString('en-US')} score.`;
  }
}

export function offerIcon(o: Offer): string {
  switch (o.kind) {
    case 'weapon':
    case 'evolve':
      return WEAPONS[o.id].icon;
    case 'passive':
      return PASSIVES[o.id].icon;
    case 'relic':
      return RELICS[o.id].icon;
    case 'heal':
      return '✚';
    case 'cores':
      return '◈';
    case 'score':
      return '★';
  }
}

export function offerColor(o: Offer): string {
  switch (o.kind) {
    case 'weapon':
    case 'evolve':
      return WEAPONS[o.id].color;
    case 'passive':
      return PASSIVES[o.id].color;
    case 'relic':
      return '#ffffff';
    case 'heal':
      return '#6dff8a';
    case 'cores':
      return '#ffc93c';
    case 'score':
      return '#fff4a8';
  }
}
