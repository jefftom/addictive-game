import { formatNumber, formatTime } from '../core/math';
import type { Rng } from '../core/rng';
import type { RunResult } from './result';
import type { MissionState, SaveData } from './save';

export interface MissionDef {
  id: string;
  /** 'run': best single-run value counts. 'total': accumulates across runs. */
  scope: 'run' | 'total';
  targets: number[];
  text: (target: number) => string;
  metric: (r: RunResult) => number;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const MISSIONS: MissionDef[] = [
  { id: 'kills_run', scope: 'run', targets: [150, 400, 800, 1500, 2500], text: (n) => `Destroy ${formatNumber(n)} enemies in one run`, metric: (r) => r.kills },
  { id: 'combo', scope: 'run', targets: [25, 60, 120, 250, 500], text: (n) => `Reach a ${n} combo`, metric: (r) => r.maxCombo },
  { id: 'survive', scope: 'run', targets: [90, 180, 300, 450, 600], text: (n) => `Survive ${formatTime(n)}`, metric: (r) => Math.floor(r.time) },
  { id: 'level', scope: 'run', targets: [8, 14, 20, 28, 36], text: (n) => `Reach level ${n}`, metric: (r) => r.level },
  { id: 'score', scope: 'run', targets: [5000, 20000, 60000, 150000, 400000], text: (n) => `Score ${formatNumber(n)} in one run`, metric: (r) => r.score },
  { id: 'perfect_run', scope: 'run', targets: [3, 8, 15, 25, 40], text: (n) => `Pull off ${n} perfect dashes in one run`, metric: (r) => r.perfects },
  { id: 'nohit', scope: 'run', targets: [30, 60, 120, 180], text: (n) => `Go ${formatTime(n)} without taking damage`, metric: (r) => Math.floor(r.longestNoHit) },
  { id: 'boss', scope: 'run', targets: [1, 2, 3], text: (n) => `Defeat ${n} ${plural(n, 'boss', 'bosses')} in one run`, metric: (r) => r.bossesKilled.length },
  { id: 'evolve', scope: 'run', targets: [1, 2, 3], text: (n) => `Evolve ${n} ${plural(n, 'weapon', 'weapons')} in one run`, metric: (r) => r.evolutions },
  { id: 'arsenal', scope: 'run', targets: [3, 4], text: (n) => `Hold ${n} weapons at once`, metric: (r) => r.maxWeapons },
  { id: 'elites_total', scope: 'total', targets: [2, 6, 12, 25, 50], text: (n) => `Destroy ${n} elites`, metric: (r) => r.elites },
  { id: 'dashkills_total', scope: 'total', targets: [15, 50, 120, 250, 500], text: (n) => `Dash through ${n} enemies`, metric: (r) => r.dashKills },
  { id: 'gems_total', scope: 'total', targets: [300, 1000, 2500, 6000, 15000], text: (n) => `Collect ${formatNumber(n)} shards`, metric: (r) => r.gems },
  { id: 'daily', scope: 'total', targets: [1, 3, 7], text: (n) => `Play ${n} Daily ${plural(n, 'Run', 'Runs')}`, metric: (r) => (r.daily ? 1 : 0) },
];

export const MISSION_SLOTS = 3;

export function missionDef(id: string): MissionDef | undefined {
  return MISSIONS.find((m) => m.id === id);
}

export function missionReward(tier: number): number {
  return 20 + tier * 15;
}

export function missionText(m: MissionState): string {
  return missionDef(m.def)?.text(m.target) ?? m.def;
}

/** Chooses a new mission whose definition is not already active and not exhausted. */
export function pickMission(save: SaveData, rng: Rng): MissionState | null {
  const active = new Set(save.missions.map((m) => m.def));
  const options = MISSIONS.filter((d) => !active.has(d.id) && (save.missionTiers[d.id] ?? 0) < d.targets.length);
  // Early on, favour approachable mission types.
  const early = save.missionsCompleted < 3 ? options.filter((d) => ['kills_run', 'combo', 'survive', 'level', 'dashkills_total', 'gems_total'].includes(d.id)) : options;
  const pool = early.length > 0 ? early : options;
  if (pool.length === 0) return null;
  const def = rng.pick(pool);
  const tier = save.missionTiers[def.id] ?? 0;
  return { def: def.id, tier, target: def.targets[tier]!, progress: 0, done: false };
}

/** Removes completed missions and tops the list back up to MISSION_SLOTS. */
export function refillMissions(save: SaveData, rng: Rng): MissionState[] {
  save.missions = save.missions.filter((m) => !m.done && missionDef(m.def));
  const added: MissionState[] = [];
  let guard = 0;
  while (save.missions.length < MISSION_SLOTS && guard++ < 20) {
    const m = pickMission(save, rng);
    if (!m) break;
    save.missions.push(m);
    added.push(m);
  }
  return added;
}

/** Live check used during a run (no mutation): which active missions this run already satisfies. */
export function missionsSatisfiedLive(save: SaveData, r: RunResult): MissionState[] {
  return save.missions.filter((m) => {
    if (m.done) return false;
    const def = missionDef(m.def);
    if (!def) return false;
    const value = def.scope === 'run' ? def.metric(r) : m.progress + def.metric(r);
    return value >= m.target;
  });
}

/** Applies a finished run to missions. Returns the missions completed by this run. */
export function applyRunToMissions(save: SaveData, r: RunResult): MissionState[] {
  const completed: MissionState[] = [];
  for (const m of save.missions) {
    if (m.done) continue;
    const def = missionDef(m.def);
    if (!def) continue;
    const v = def.metric(r);
    m.progress = def.scope === 'run' ? Math.max(m.progress, v) : m.progress + v;
    if (m.progress >= m.target) {
      m.progress = m.target;
      m.done = true;
      completed.push(m);
      save.missionsCompleted++;
      save.missionTiers[m.def] = (save.missionTiers[m.def] ?? 0) + 1;
    }
  }
  return completed;
}
