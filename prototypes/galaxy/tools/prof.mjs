// Node profile of generation: node tools/prof.mjs [quality] [sectors...]  (cold pass, then warm pass)
import { generateSectorSync } from '../dist/galaxy.mjs';
const q = Number(process.argv[2] ?? 1);
const list = process.argv.slice(3).map(Number);
for (const pass of ['cold', 'warm']) {
  for (const i of list.length ? list : [0, 1, 2, 3]) {
    const t0 = performance.now();
    const r = generateSectorSync(i, q);
    const t = Object.fromEntries(Object.entries(r.timings).filter(([k]) => !k.endsWith('MaxSlice') && k !== 'wall').map(([k, v]) => [k, Math.round(v)]));
    console.log(pass, i, Math.round(performance.now() - t0), JSON.stringify(t));
  }
}
