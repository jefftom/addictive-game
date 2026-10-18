import { formatNumber, formatTime } from '../core/math';
import { ENEMIES } from '../game/content/enemies';
import { PASSIVES, RELICS } from '../game/content/passives';
import { WEAPONS } from '../game/content/weapons';
import type { PassiveId, WeaponId } from '../game/types';
import type { World } from '../game/world';
import { missionDef, missionText } from '../meta/missions';
import type { SaveData } from '../meta/save';
import { evolutionPath } from './evolution';

export interface RunReview {
  weapons: string[];
  equipment: string[];
  goal?: { title: string; detail: string };
  cause?: string;
}

/** Snapshot presentation after rewards settle. Never changes the run or offer RNG. */
export function reviewRun(w: World, save: SaveData, pinned: WeaponId | null): RunReview {
  const b = w.players[0]!.build;
  const out: RunReview = {
    weapons: b.weapons.map(v => v.evolved ? `${WEAPONS[v.id].evolvedName} · Evolved` : `${WEAPONS[v.id].name} · Lv ${v.level}`),
    equipment: [
      ...Object.entries(b.passives).map(([id, level]) => `${PASSIVES[id as PassiveId].name} · Lv ${level}`),
      ...b.relics.map(id => RELICS[id].name),
    ],
  };
  if (w.gameOver && !w.victory) {
    const hit = w.defeat;
    const source = hit?.cause.kind === 'contact' ? `contact with ${ENEMIES[hit.cause.enemy].name}`
      : hit?.cause.kind === 'projectile' ? 'a hostile projectile' : null;
    out.cause = source ? `${w.coop ? `Final pilot P${hit!.pid + 1} lost to` : 'Lethal hit:'} ${source}.`
      : 'Lethal hit source unavailable.';
  }
  if (w.coop) return out;
  if (pinned && b.weapons.some(v => v.id === pinned && !v.evolved)) {
    const p = evolutionPath(b, pinned);
    out.goal = { title: `Next run: ${p.evolvedName}`,
      detail: `Finished at weapon ${p.level}/${p.maxLevel}; ${p.partner} ${p.partnerOwned ? 'owned' : 'missing'}. Start fresh: reach weapon level ${p.maxLevel} and pick ${p.partner}${p.state === 'blocked' ? ' before passive slots fill' : ''}. Evolution offers are random.` };
  } else {
    const m = save.missions.find(m => !m.done && m.progress < m.target && missionDef(m.def) && (m.def !== 'daily' || w.cfg.daily !== null));
    if (m) {
      const def = missionDef(m.def)!;
      const fmt = m.def === 'survive' || m.def === 'nohit' ? formatTime : formatNumber;
      out.goal = { title: `Next goal: ${missionText(m)}`, detail: `${def.scope === 'run' ? 'Best single run' : 'Total progress'}: ${fmt(m.progress)} / ${fmt(m.target)}.` };
    }
  }
  return out;
}
