import { MAX_PASSIVES, PASSIVES } from '../game/content/passives';
import { MAX_WEAPON_LEVEL, WEAPONS } from '../game/content/weapons';
import type { WeaponId } from '../game/types';
import type { Build } from '../game/world';

/** Read-only presentation of the same requirements used by availableEvolutions. */
export function evolutionPath(build: Build, id: WeaponId) {
  const def = WEAPONS[id], weapon = build.weapons.find(w => w.id === id);
  const level = weapon?.level ?? 0;
  const partnerOwned = (build.passives[def.evolvesWith] ?? 0) > 0;
  const blocked = !partnerOwned && Object.keys(build.passives).length >= MAX_PASSIVES;
  const state = weapon?.evolved ? 'evolved' : blocked ? 'blocked' : level >= MAX_WEAPON_LEVEL && partnerOwned ? 'ready' : 'building';
  const requirements = state === 'evolved' ? 'Evolution complete'
    : state === 'blocked' ? `Passive slots full — ${PASSIVES[def.evolvesWith].name} cannot be added this run`
    : state === 'ready' ? 'Requirements met — eligible for an evolution offer'
    : [level < MAX_WEAPON_LEVEL ? `${def.name} level ${MAX_WEAPON_LEVEL}` : '', !partnerOwned ? PASSIVES[def.evolvesWith].name : ''].filter(Boolean).join(' + ');
  return { id, name: def.name, evolvedName: def.evolvedName, description: def.evolvedBlurb,
    level, maxLevel: MAX_WEAPON_LEVEL, partner: PASSIVES[def.evolvesWith].name, partnerOwned, state, requirements };
}
