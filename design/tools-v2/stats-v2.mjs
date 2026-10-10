// Usage: node --experimental-strip-types tools-v2/stats-v2.mjs <story.ts>  -- prints headroom stats
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const { STORY } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const mx = (arr) => Math.max(...arr.map((l) => (typeof l === 'string' ? l : l.text).length));
console.log('intro max', mx(STORY.intro.paragraphs), 'victory max', mx(STORY.victory.paragraphs));
console.log('barks max', mx(Object.values(STORY.barks).flat()), 'pilotBarks max', mx(Object.values(STORY.pilotBarks).flatMap((o) => Object.values(o).flat())));
console.log('bosses max', mx(Object.values(STORY.bosses).flatMap((b) => Object.values(b).flat())), 'gameOver max', mx(STORY.gameOver), 'overtime max', mx(STORY.overtime));
console.log('sector arrival max', mx(STORY.sectors.flatMap((s) => s.arrival)), 'blurb max', mx(Object.values(STORY.vessels).map((v) => v.blurb)));
for (const e of STORY.logbook) console.log('log', e.id, e.text.trim().split(/\s+/).length, 'words');
