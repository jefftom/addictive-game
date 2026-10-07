import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Grep guard: `world.player / stats / build / rerolls / pendingCaches` are P1
 * aliases kept for tests, debug and the e2e harness. Production code must use
 * `world.players[pid]`, or co-op bugs hide behind the aliases (P2 silently
 * using P1's stats).
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = join(ROOT, 'src');
const ALIAS = /\b(?:world|w)\.(?:player|stats|build|rerolls|pendingCaches)\b|\bthis\.(?:player|stats|build)\b/;

/**
 * Presentation and meta files that still read the P1 aliases for solo. They
 * belong to the co-op presentation/meta wave, which must migrate them to
 * `players[pid]` and then delete them from this list.
 */
const PENDING_MIGRATION = new Set(['src/app.ts', 'src/render/renderer.ts', 'src/render/hud.ts', 'src/ui/ui.ts', 'src/meta/result.ts']);

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

function offenders(file: string): string[] {
  const rel = relative(ROOT, file).split('\\').join('/');
  const lines = readFileSync(file, 'utf8').split('\n');
  const out: string[] = [];
  let inAliasBlock = false;
  lines.forEach((line, i) => {
    if (rel === 'src/game/world.ts') {
      if (line.includes('P1 aliases')) inAliasBlock = true;
      else if (inAliasBlock && line.includes('// ─────')) inAliasBlock = false;
      if (inAliasBlock) return;
    }
    if (ALIAS.test(line)) out.push(`${rel}:${i + 1}: ${line.trim()}`);
  });
  return out;
}

describe('no P1 aliases in production code', () => {
  const files = tsFiles(SRC);

  it('src/ uses players[pid] instead of the P1 aliases', () => {
    const bad = files.filter((f) => !PENDING_MIGRATION.has(relative(ROOT, f).split('\\').join('/'))).flatMap(offenders);
    expect(bad).toEqual([]);
  });

  it('the pending-migration list only names files that still need it', () => {
    const stale = [...PENDING_MIGRATION].filter((rel) => {
      const full = join(ROOT, rel);
      try {
        return offenders(full).length === 0;
      } catch {
        return true;
      }
    });
    expect(stale, 'remove migrated files from PENDING_MIGRATION').toEqual([]);
  });
});
