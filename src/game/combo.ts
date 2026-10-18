/** Combo count thresholds for each multiplier tier. */
export const COMBO_TIERS = [0, 15, 40, 80, 150, 250, 400, 600] as const;
export const COMBO_MULTS = [1, 2, 3, 4, 5, 6, 8, 10] as const;

export function comboTier(combo: number): number {
  let tier = 0;
  for (let i = 0; i < COMBO_TIERS.length; i++) if (combo >= COMBO_TIERS[i]!) tier = i;
  return tier;
}

export function comboMult(combo: number): number {
  return COMBO_MULTS[comboTier(combo)]!;
}

/** Progress (0..1) from the current tier threshold to the next one. */
export function comboTierProgress(combo: number): number {
  const tier = comboTier(combo);
  if (tier >= COMBO_TIERS.length - 1) return 1;
  const a = COMBO_TIERS[tier]!;
  const b = COMBO_TIERS[tier + 1]!;
  return (combo - a) / (b - a);
}

export type MilestoneName = 'MAGNET PULSE' | 'NOVA BURST' | 'OVERDRIVE';

/** Combo milestones: 50, 100, 200, then every 100. */
export function milestoneAt(combo: number): MilestoneName | null {
  if (combo === 50) return 'MAGNET PULSE';
  if (combo === 100) return 'NOVA BURST';
  if (combo >= 200 && combo % 100 === 0) return combo % 200 === 0 ? 'OVERDRIVE' : 'NOVA BURST';
  return null;
}
