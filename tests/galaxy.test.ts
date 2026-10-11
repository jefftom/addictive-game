import { beforeAll, describe, expect, it } from 'vitest';
import { PLAYER_COLORS } from '../src/game/content/coop';
import { ENEMIES } from '../src/game/content/enemies';
import { WEAPONS } from '../src/game/content/weapons';
import { generateSectorSync, SECTORS } from '../src/render/galaxy';
import { GEM_TIERS, PAL } from '../src/render/palette';
import { anticipatedSector } from '../src/render/sectorwarp';
import { STORY } from '../src/story/script';

const linear = (c: number): number => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
function oklab(r8: number, g8: number, b8: number): number[] {
  const r = linear(r8 / 255), g = linear(g8 / 255), b = linear(b8 / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787081 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

const colors = [...new Set([
  ...Object.entries(PAL).filter(([key]) => key !== 'void' && key !== 'voidHi').flatMap(([, value]) => value),
  ...GEM_TIERS.map(x => x.color), ...Object.values(ENEMIES).map(x => x.color),
  ...Object.values(WEAPONS).map(x => x.color), ...PLAYER_COLORS,
].filter(c => /^#[\da-f]{6}$/i.test(c)))];
const glows = colors.map(hex => {
  const n = parseInt(hex.slice(1), 16);
  return oklab(((n >> 16) & 255) * 0.3, ((n >> 8) & 255) * 0.3, (n & 255) * 0.3);
});
const percentile = (xs: number[], p: number): number => xs.sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)]!;
type Metrics = { camo: number[]; lightP99: number; chromaP95: number; coloredShare: number; hue: number };
const metrics: Metrics[] = [];

beforeAll(() => {
  for (let sector = 0; sector < SECTORS.length; sector++) {
    const tile = generateSectorSync(sector, 0.5).images[0]!;
    const data = tile.data;
    const camo = glows.map(() => 0), light: number[] = [], chroma: number[] = [];
    let colored = 0, a = 0, b = 0;
    for (let i = 0; i < data.length; i += 8) {
      const lab = oklab(data[i]!, data[i + 1]!, data[i + 2]!);
      const c = Math.hypot(lab[1]!, lab[2]!);
      light.push(lab[0]!); chroma.push(c);
      if (c > 0.02) { colored++; a += lab[1]!; b += lab[2]!; }
      for (let j = 0; j < glows.length; j++) {
        const glow = glows[j]!;
        const dl = lab[0]! - glow[0]!, da = lab[1]! - glow[1]!, db = lab[2]! - glow[2]!;
        if (dl * dl + da * da + db * db < 0.05 * 0.05) camo[j]!++;
      }
    }
    metrics.push({ camo: camo.map(n => n / light.length), lightP99: percentile(light, 0.99),
      chromaP95: percentile(chroma, 0.95), coloredShare: colored / light.length,
      hue: (Math.atan2(b, a) * 180 / Math.PI + 360) % 360 });
  }
});

describe('galaxy readability and sector identity', () => {
  for (let sector = 0; sector < 4; sector++) {
    it(`sector ${sector + 1} does not camouflage any gameplay glow`, () => {
      for (let c = 0; c < colors.length; c++) expect(metrics[sector]!.camo[c], colors[c]).toBeLessThan(0.005);
    });
    it(`sector ${sector + 1} stays below the darkest gameplay glow`, () => {
      expect(metrics[sector]!.lightP99).toBeLessThan(Math.min(...glows.map(c => c[0]!)));
    });
    it(`sector ${sector + 1} keeps its rich colour identity`, () => {
      expect(metrics[sector]!.chromaP95).toBeGreaterThanOrEqual(0.035);
      expect(metrics[sector]!.coloredShare).toBeGreaterThanOrEqual(0.4);
    });
  }
  it('the four hue identities remain distinct', () => {
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) {
      const d = Math.abs(metrics[a]!.hue - metrics[b]!.hue);
      expect(Math.min(d, 360 - d), `sectors ${a + 1}/${b + 1}`).toBeGreaterThanOrEqual(35);
    }
  });
  it('has one backdrop per story sector', () => expect(SECTORS.length).toBe(STORY.sectors.length));
});

describe('presentation-only anticipation', () => {
  for (const [sector, threshold] of [[0, 357.4], [1, 537.4], [2, 597.4]]) {
    it(`anticipates sector ${sector + 1} at the existing forced boundary`, () => {
      expect(anticipatedSector(sector, threshold - 0.001)).toBeNull();
      expect(anticipatedSector(sector, threshold)).toBe(sector + 1);
      expect(anticipatedSector(sector, threshold + 1)).toBe(sector + 1);
    });
  }
  it('never advances beyond the last sector', () => expect(anticipatedSector(3, 10000)).toBeNull());
});
