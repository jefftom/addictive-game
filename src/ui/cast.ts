/**
 * Pure helpers for the Ship's Log "Crew & cast" cards (no DOM, unit-tested).
 */
import { STORY, type CharacterDef } from '../story/script';

/**
 * Role line for the cast list: keeps the explanation, drops the ship-id tag and any
 * part the name already says ("Chief Engineer Gus Gasket" + "Chief engineer; runs the
 * Workshop" -> "Runs the Workshop").
 */
export function castRole(c: Pick<CharacterDef, 'name' | 'role'>): string {
  const name = c.name.toLowerCase();
  const out = c.role
    .replace(/\s*\((spark|vanguard|tempest|bastion|phantom)\)/g, '')
    .split(/;\s*/)
    .map((p) => p.trim())
    .filter((p) => p && !name.startsWith(p.toLowerCase()))
    .join(' · ');
  return out.charAt(0).toUpperCase() + out.slice(1);
}

const signatureCache = new Map<string, string>();

/**
 * A short line the character really says in the game, shown on the cast cards as a
 * sample of their voice (the script's `voice` field is direction for the writers).
 */
export function signatureLine(id: string): string {
  const hit = signatureCache.get(id);
  if (hit !== undefined) return hit;
  const lines: { speaker: string; text: string }[] = [];
  const walk = (v: unknown, speaker?: string): void => {
    if (Array.isArray(v)) v.forEach((x) => walk(x, speaker));
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (typeof o.speaker === 'string' && typeof o.text === 'string') lines.push({ speaker: o.speaker === '@pilot' && speaker ? speaker : o.speaker, text: o.text });
      else Object.values(o).forEach((x) => walk(x, speaker));
    }
  };
  // A captain's own barks first, then everyday chatter before boss scenes (fewer spoilers).
  walk(STORY.pilotBarks[id], id);
  walk(STORY.barks);
  walk(STORY.sectors);
  walk(STORY.bosses);
  const alias = id === STORY.aiId ? '@ai' : id === STORY.villainId ? '@villain' : id;
  const pick = lines.find((l) => (l.speaker === id || l.speaker === alias) && l.text.length >= 30 && l.text.length <= 95);
  const out = pick?.text ?? '';
  signatureCache.set(id, out);
  return out;
}
