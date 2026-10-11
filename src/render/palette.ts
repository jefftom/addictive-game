/** Visual identity: deep indigo void, cool player-side neons, warm enemy-side neons. */
export const PAL = {
  void: '#05040f',
  voidHi: '#0d0a26',
  grid: 'rgba(96, 120, 255, 0.07)',
  gridMajor: 'rgba(120, 150, 255, 0.13)',
  player: '#e9fbff',
  playerGlow: '#3ff3ff',
  bolt: '#7ff9ff',
  bullet: '#ff4f7a',
  bulletCore: '#fff0f4',
  hp: '#ff4d6d',
  hpBack: 'rgba(255, 77, 109, 0.18)',
  xp: '#45e8ff',
  gold: '#ffc93c',
  text: '#eaf2ff',
  textDim: 'rgba(214, 226, 255, 0.62)',
  danger: '#ff2d55',
  combo: ['#9fdcff', '#7ff9ff', '#6dff8a', '#ffd23f', '#ff9f43', '#ff4fd2', '#c46bff', '#ffffff'],
} as const;

export const GEM_TIERS: { min: number; color: string; size: number }[] = [
  { min: 0, color: '#45e8ff', size: 5 },
  { min: 4, color: '#6dff8a', size: 6.5 },
  { min: 20, color: '#8f7bff', size: 8 },
  { min: 80, color: '#fff1a8', size: 10 },
];

export function gemTier(value: number): { color: string; size: number } {
  let t = GEM_TIERS[0]!;
  for (const g of GEM_TIERS) if (value >= g.min) t = g;
  return t;
}

export const FONT_DISPLAY = 'Tektur, "Chakra Petch", system-ui, sans-serif';
export const FONT_BODY = '"Chakra Petch", system-ui, sans-serif';
export const FONT_MONO = '"Kode Mono", ui-monospace, "SFMono-Regular", Menlo, monospace';
