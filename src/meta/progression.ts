import { formatNumber, formatTime } from '../core/math';
import { Rng, dateKey } from '../core/rng';
import { BOSS_SCHEDULE, ENEMIES } from '../game/content/enemies';
import { SHIPS, SHIP_IDS } from '../game/content/ships';
import { WORKSHOP, workshopCost, type WorkshopDef } from '../game/content/workshop';
import type { ShipId } from '../game/types';
import { checkAchievements, type AchievementDef } from './achievements';
import { recordDaily, dailyBonus } from './daily';
import { applyRunToMissions, missionDef, missionReward, missionText, refillMissions } from './missions';
import { rankCoreBonus, rankReward, rankXpForRun, rankXpNeeded } from './rank';
import type { RunResult } from './result';
import type { MissionState, SaveData } from './save';

export interface RewardLine {
  label: string;
  amount: number;
}

export interface RankUp {
  rank: number;
  reward: string;
}

export interface RunSummary {
  result: RunResult;
  rewards: RewardLine[];
  totalCores: number;
  missionsCompleted: { mission: MissionState; text: string; reward: number }[];
  achievements: AchievementDef[];
  unlockedShips: ShipId[];
  rankBefore: number;
  rankXpBefore: number;
  rankXpGained: number;
  rankUps: RankUp[];
  newBest: { score: boolean; time: boolean; combo: boolean };
  prevBest: { score: number; time: number; combo: number };
  nearMiss: string | null;
  daily: { streak: number; first: boolean; best: boolean; bonus: number } | null;
}

/** Core reward for score and survival time (before collected cores, missions, etc.). */
export function baseCores(score: number, time: number, coreGain: number): number {
  return Math.round((Math.sqrt(Math.max(0, score)) * 0.35 + (time / 60) * 3) * coreGain);
}

export function isShipUnlocked(save: SaveData, id: ShipId): boolean {
  const ach = SHIPS[id].unlockAchievement;
  return ach === null || !!save.achievements[ach];
}

export function unlockedShips(save: SaveData): ShipId[] {
  return SHIP_IDS.filter((id) => isShipUnlocked(save, id));
}

/** Applies a finished run to the save. Mutates `save`; returns what happened for the results screen. */
export function applyRun(save: SaveData, r: RunResult, rng: Rng = new Rng(Date.now() >>> 0), today: string = dateKey()): RunSummary {
  const shipsBefore = new Set(unlockedShips(save));
  const prevBest = { score: save.stats.bestScore, time: save.stats.bestTime, combo: save.stats.bestCombo };

  // Lifetime stats.
  const st = save.stats;
  st.runs++;
  st.kills += r.kills;
  st.timePlayed += r.time;
  st.bossKills += r.bossesKilled.length;
  st.elites += r.elites;
  st.dashKills += r.dashKills;
  st.gems += r.gems;
  st.perfects += r.perfects;
  st.evolutions += r.evolutions;
  if (r.victory) st.victories++;
  const newBest = {
    score: r.score > st.bestScore && st.runs > 1,
    time: r.time > st.bestTime && st.runs > 1,
    combo: r.maxCombo > st.bestCombo && st.runs > 1,
  };
  st.bestScore = Math.max(st.bestScore, r.score);
  st.bestTime = Math.max(st.bestTime, r.time);
  st.bestCombo = Math.max(st.bestCombo, r.maxCombo);
  st.bestLevel = Math.max(st.bestLevel, r.level);
  save.history.push({ score: r.score, time: Math.round(r.time), date: today, daily: r.daily });
  if (save.history.length > 30) save.history.splice(0, save.history.length - 30);

  // Cores.
  const rewards: RewardLine[] = [];
  rewards.push({ label: 'Score & survival', amount: baseCores(r.score, r.time, r.coreGain) });
  if (r.coresCollected > 0) rewards.push({ label: 'Cores collected', amount: Math.round(r.coresCollected) });

  let daily: RunSummary['daily'] = null;
  if (r.daily) {
    const d = recordDaily(save, r.score, today);
    const bonus = d.first ? dailyBonus(d.streak) : 0;
    daily = { ...d, bonus };
    if (bonus > 0) rewards.push({ label: `Daily streak ×${d.streak}`, amount: bonus });
  }

  const completed = applyRunToMissions(save, r);
  const missionsCompleted = completed.map((m) => ({ mission: { ...m }, text: missionText(m), reward: missionReward(m.tier) }));
  for (const m of missionsCompleted) rewards.push({ label: `Mission: ${m.text}`, amount: m.reward });

  // Rank.
  const rankBefore = save.rank;
  const rankXpBefore = save.rankXp;
  const gained = rankXpForRun(r.score, r.time);
  save.rankXp += gained;
  const rankUps: RankUp[] = [];
  while (save.rankXp >= rankXpNeeded(save.rank)) {
    save.rankXp -= rankXpNeeded(save.rank);
    save.rank++;
    rankUps.push({ rank: save.rank, reward: rankReward(save.rank) });
    rewards.push({ label: `Rank ${save.rank} bonus`, amount: rankCoreBonus(save.rank) });
  }

  const totalCores = rewards.reduce((a, b) => a + b.amount, 0);
  save.cores += totalCores;
  st.coresEarned += totalCores;

  const achievements = checkAchievements(save, r);
  const unlocked = unlockedShips(save).filter((id) => !shipsBefore.has(id));
  save.tutorialDone = true;

  // Replace finished missions for next time (shown as "new" on the menu).
  refillMissions(save, rng);

  return {
    result: r,
    rewards,
    totalCores,
    missionsCompleted,
    achievements,
    unlockedShips: unlocked,
    rankBefore,
    rankXpBefore,
    rankXpGained: gained,
    rankUps,
    newBest,
    prevBest,
    nearMiss: nearMiss(save, r, prevBest),
    daily,
  };
}

/** One motivating line about how close the player came to something. */
export function nearMiss(save: SaveData, r: RunResult, prevBest: { score: number; time: number }): string | null {
  if (prevBest.score > 0 && r.score < prevBest.score && r.score >= prevBest.score * 0.7) {
    return `Only ${formatNumber(prevBest.score - r.score)} short of your best score.`;
  }
  const nextBoss = BOSS_SCHEDULE.find((b) => b.at > r.time);
  if (nextBoss && nextBoss.at - r.time <= 30) {
    return `${Math.ceil(nextBoss.at - r.time)} seconds from facing ${ENEMIES[nextBoss.kind].name}.`;
  }
  let best: { k: number; text: string } | null = null;
  for (const m of save.missions) {
    if (m.done) continue;
    const def = missionDef(m.def);
    if (!def) continue;
    const k = m.progress / m.target;
    if (k >= 0.6 && k < 1 && (!best || k > best.k)) {
      best = { k, text: `${formatNumber(m.progress)} / ${formatNumber(m.target)} on “${missionText(m)}”.` };
    }
  }
  if (best) return best.text;
  if (prevBest.time > 0 && r.time < prevBest.time && r.time >= prevBest.time - 20) {
    return `${Math.ceil(prevBest.time - r.time)} seconds short of your longest run (${formatTime(prevBest.time)}).`;
  }
  return null;
}

// ───────────────────────── Workshop ─────────────────────────

export function workshopLevel(save: SaveData, id: string): number {
  return save.workshop[id] ?? 0;
}

export function nextCost(save: SaveData, def: WorkshopDef): number | null {
  const lvl = workshopLevel(save, def.id);
  return lvl >= def.maxLevel ? null : workshopCost(def, lvl);
}

export function buyUpgrade(save: SaveData, id: string): boolean {
  const def = WORKSHOP.find((d) => d.id === id);
  if (!def) return false;
  const cost = nextCost(save, def);
  if (cost === null || save.cores < cost) return false;
  save.cores -= cost;
  save.workshop[id] = workshopLevel(save, id) + 1;
  save.stats.upgradesBought++;
  return true;
}

export function affordableUpgrades(save: SaveData): number {
  return WORKSHOP.filter((d) => {
    const c = nextCost(save, d);
    return c !== null && c <= save.cores;
  }).length;
}

/** The cheapest upgrade not yet affordable (a "next goal" for the results screen). */
export function nextWorkshopGoal(save: SaveData): { def: WorkshopDef; cost: number; missing: number } | null {
  let best: { def: WorkshopDef; cost: number; missing: number } | null = null;
  for (const def of WORKSHOP) {
    const cost = nextCost(save, def);
    if (cost === null || cost <= save.cores) continue;
    if (!best || cost < best.cost) best = { def, cost, missing: cost - save.cores };
  }
  return best;
}
