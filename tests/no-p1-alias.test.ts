import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
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

/**
 * World and upgrade/bot APIs whose trailing `pid`/`owner` parameter defaults to
 * 0 (P1), with the argument count that passes it explicitly. Leaving the pid
 * out is the same P1 alias in disguise, so production code must always pass
 * it. Method calls are checked on `world.`/`w.` receivers (and `this.` inside
 * the World class).
 */
const PID_METHODS: Record<string, number> = {
  addWeapon: 2,
  hasRelic: 2,
  refreshStats: 1,
  cooldownMult: 1,
  moveSpeed: 1,
  isPlayerInvulnerable: 1,
  hurtPlayer: 4,
  heal: 2,
  rollDamage: 2,
  damageEnemy: 8,
  killEnemy: 3,
  addRing: 10,
  explode: 7,
  bomb: 1,
  addXp: 2,
};
const PID_FUNCTIONS: Record<string, number> = {
  botInput: 4,
  botPick: 4,
  availableEvolutions: 2,
  offerCandidates: 3,
  generateOffers: 4,
  applyOffer: 3,
};
const WORLD_RECEIVER = /^(?:world|w|this\.world)$/;

function defaultPidCalls(file: string, text = readFileSync(file, 'utf8')): string[] {
  const rel = relative(ROOT, file).split('\\').join('/');
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      let need: number | undefined;
      let name = '';
      if (ts.isPropertyAccessExpression(callee)) {
        name = callee.name.text;
        const recv = callee.expression.getText(src);
        const isWorld = WORLD_RECEIVER.test(recv) || (recv === 'this' && rel === 'src/game/world.ts');
        if (isWorld) need = PID_METHODS[name];
      } else if (ts.isIdentifier(callee)) {
        name = callee.text;
        need = PID_FUNCTIONS[name];
      }
      if (need !== undefined && node.arguments.length < need) {
        const line = src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1;
        out.push(`${rel}:${line}: ${node.getText(src).split('\n')[0]!.trim()}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
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
        return offenders(full).length === 0 && defaultPidCalls(full).length === 0;
      } catch {
        return true;
      }
    });
    expect(stale, 'remove migrated files from PENDING_MIGRATION').toEqual([]);
  });

  it('src/ passes the pid explicitly to pid-taking APIs (no silent P1 default)', () => {
    const bad = files.filter((f) => !PENDING_MIGRATION.has(relative(ROOT, f).split('\\').join('/'))).flatMap((f) => defaultPidCalls(f));
    expect(bad).toEqual([]);
  });

  it('the pid check flags calls that rely on the default pid', () => {
    const sample = [
      "world.hasRelic('shield');",
      "w.hasRelic('shield', pid);",
      'applyOffer(w, o);',
      'applyOffer(w, o, pid);',
      'generateOffers(w, 3,\n  cache);',
      'this.world.heal(5);',
      'audio.heal(5);',
    ].join('\n');
    const hits = defaultPidCalls(join(SRC, 'sample.ts'), sample).map((h) => h.replace(/^src\/sample\.ts:/, ''));
    expect(hits).toEqual(["1: world.hasRelic('shield')", '3: applyOffer(w, o)', '5: generateOffers(w, 3,', '7: this.world.heal(5)']);
  });
});
