import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { dailyInfo } from '../src/meta/daily';
import { simulateRun } from './helpers';

/**
 * Grep guard: the simulation must compute the same bits on every engine and
 * CPU, or the golden master, the Daily Run and co-op desync per platform.
 * ECMAScript leaves Math.sin/cos/atan2/exp/pow/hypot/... (and `**`)
 * "implementation-approximated", and V8 really returns different last bits on
 * arm64 than on x64. Every file the sim can execute must use src/core/dmath.ts
 * (or plain + - * / and Math.sqrt) instead.
 *
 * Scan every game file plus the runtime import closure of the sim entry
 * points, including orphan game files and newly imported helpers. Type-only
 * imports are skipped: they never run. A runtime trap also checks bot runs.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** What the golden master, Daily Run and co-op tests drive. */
const SIM_ENTRIES = ['src/game/world.ts', 'src/game/bot.ts', 'src/game/runconfig.ts', 'src/game/upgrades.ts', 'src/meta/daily.ts'];

/** Math functions the spec lets engines approximate differently. */
const APPROXIMATED = new Set([
  'acos',
  'acosh',
  'asin',
  'asinh',
  'atan',
  'atanh',
  'atan2',
  'cbrt',
  'cos',
  'cosh',
  'exp',
  'expm1',
  'hypot',
  'log',
  'log1p',
  'log10',
  'log2',
  'pow',
  'sin',
  'sinh',
  'tan',
  'tanh',
]);

/** Exactly specified Math operations and constants; everything else is rejected. */
const ALLOWED = new Set([
  'abs', 'floor', 'ceil', 'round', 'trunc', 'sign', 'min', 'max', 'sqrt', 'fround', 'imul', 'clz32',
  'PI', 'E', 'LN2', 'LN10', 'LOG2E', 'LOG10E', 'SQRT2', 'SQRT1_2',
]);

const rel = (file: string): string => relative(ROOT, file).split('\\').join('/');

function parse(file: string, text = readFileSync(file, 'utf8')): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
}

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = join(dir, entry.name);
    return entry.isDirectory() ? tsFiles(file) : entry.name.endsWith('.ts') ? [file] : [];
  });
}

/** Relative module specifiers that are loaded at runtime (not `import type`). */
function runtimeImports(src: ts.SourceFile): string[] {
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      if (!node.importClause?.isTypeOnly && ts.isStringLiteral(node.moduleSpecifier)) out.push(node.moduleSpecifier.text);
    } else if (ts.isExportDeclaration(node)) {
      if (!node.isTypeOnly && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) out.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const arg = node.arguments[0];
      if (arg && ts.isStringLiteralLike(arg)) out.push(arg.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
  return out.filter((s) => s.startsWith('.'));
}

function resolveModule(from: string, spec: string): string {
  const base = resolve(dirname(from), spec);
  for (const cand of [base, `${base}.ts`, join(base, 'index.ts')]) {
    if (cand.endsWith('.ts') && existsSync(cand)) return cand;
  }
  throw new Error(`${rel(from)}: cannot resolve import '${spec}'`);
}

function simClosure(): string[] {
  const seen = new Set<string>();
  const stack = [...SIM_ENTRIES.map((f) => join(ROOT, f)), ...tsFiles(join(ROOT, 'src/game'))];
  while (stack.length > 0) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of runtimeImports(parse(file))) stack.push(resolveModule(file, spec));
  }
  return [...seen].map(rel).sort();
}

/**
 * file:line for every implementation-approximated operation: Math.<fn> used in
 * any form (call, alias, Math['fn'], destructuring) and `**` / `**=`. Works on
 * the syntax tree, so comments, strings and JSDoc never count.
 */
function offenders(file: string, text?: string): string[] {
  const src = parse(file, text);
  const name = rel(file);
  const out: string[] = [];
  const hit = (node: ts.Node, what: string): void => {
    const line = src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1;
    out.push(`${name}:${line}: ${what}`);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && node.text === 'Math') {
      const parent = node.parent;
      const direct = ts.isPropertyAccessExpression(parent) && parent.expression === node;
      // randomSeed chooses a run's initial seed outside the tick; runtime runs
      // below trap Math.random too, so it cannot silently enter seeded play.
      const allowed = direct && (ALLOWED.has(parent.name.text) || (name === 'src/core/rng.ts' && parent.name.text === 'random'));
      if (!allowed) hit(node, direct ? parent.getText(src) : 'unapproved Math reference');
    } else if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === 'Math') {
      hit(node, 'unapproved Math reference');
    } else if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.AsteriskAsteriskToken ||
        node.operatorToken.kind === ts.SyntaxKind.AsteriskAsteriskEqualsToken)
    ) {
      hit(node.operatorToken, node.operatorToken.getText(src));
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
  return out;
}

describe('deterministic math in the simulation', () => {
  const closure = simClosure();

  it('the import closure covers the whole sim', () => {
    for (const f of [
      'src/core/dmath.ts',
      'src/core/math.ts',
      'src/core/rng.ts',
      'src/game/director.ts',
      'src/game/enemyai.ts',
      'src/game/stats.ts',
      'src/game/weapons.ts',
      'src/game/content/passives.ts',
      'src/game/content/workshop.ts',
      ...SIM_ENTRIES,
    ]) {
      expect(closure, f).toContain(f);
    }
    // Rendering and UI are not part of the sim.
    expect(closure.filter((f) => /^src\/(render|ui|audio)\//.test(f))).toEqual([]);
  });

  it('no implementation-approximated Math function or ** in the sim closure', () => {
    const bad = closure.flatMap((f) => offenders(join(ROOT, f)));
    expect(bad, 'use src/core/dmath.ts (or x * x) instead').toEqual([]);
  });

  it('the scanner flags every form and ignores comments and strings', () => {
    const sample = [
      '/** Doc with Math.sin(x) and 2 ** 3 in it. */',
      'const a = Math.sin(t) + Math.sqrt(2);',
      "const s = 'Math.cos(1) ** 2'; // Math.exp(1) ** 2",
      'const b = x ** 2;',
      'b **= 3;',
      'const f = Math.hypot;',
      "const g = Math['atan2'](y, x);",
      'const { pow, abs } = Math;',
      'const h = Math.floor(Math.abs(t) * Math.PI);',
    ].join('\n');
    const hits = offenders(join(ROOT, 'src/sample.ts'), sample).map((h) => h.replace(/^src\/sample\.ts:/, ''));
    expect(hits).toEqual(['2: Math.sin', '4: **', '5: **=', '6: Math.hypot', '7: unapproved Math reference', '8: unapproved Math reference']);
  });

  it('rejects aliases, globals, destructuring, computed keys and orphan helpers', () => {
    const sample = [
      'const M = Math; M.sin(t);',
      'globalThis.Math.sin(t); window.Math.cos(t); self.Math.exp(t);',
      '({ sin: f } = Math);',
      'Math[name](t);',
      'const square = `${x ** 2}`;',
      'globalThis["Math"].sin(t);',
      'Math.random();',
      'Math.newApproximation(t);',
      'const allowed = Math.sqrt(Math.abs(t)) + Math.PI;',
    ].join('\n');
    const hits = offenders(join(ROOT, 'src/game/orphan.ts'), sample);
    expect(hits.map((h) => Number(h.split(':')[1]))).toEqual([1, 2, 2, 2, 3, 4, 5, 6, 7, 8]);
    expect(hits.every((h) => h.startsWith('src/game/orphan.ts:'))).toBe(true);
    expect(offenders(join(ROOT, 'src/core/rng.ts'), 'Math.random(); Math.sin(1);')).toEqual(['src/core/rng.ts:1: Math.sin']);
    for (const file of tsFiles(join(ROOT, 'src/game'))) expect(closure).toContain(rel(file));
  });

  it('seeded solo, co-op and daily runs never call approximated Math at runtime', () => {
    const math = Math as unknown as Record<string, (...args: number[]) => number>;
    const originals = new Map([...APPROXIMATED, 'random'].map((name) => [name, math[name]!]));
    const calls = new Map<string, string>();
    try {
      for (const [name, original] of originals) {
        math[name] = (...args) => {
          if (!calls.has(name)) calls.set(name, new Error(`Math.${name}`).stack ?? name);
          return original(...args);
        };
      }
      simulateRun({ seed: 1000, rank: 1 }, 90);
      simulateRun({ seed: 31337, rank: 8, players: ['spark', 'vanguard', 'bastion'] }, 90);
      const daily = dailyInfo('2026-10-10');
      simulateRun({ seed: daily.seed, rank: 8, daily: daily.modifier.id }, 90);
    } finally {
      for (const [name, original] of originals) math[name] = original;
    }
    expect([...calls.values()]).toEqual([]);
  });

  it('type-only imports are not part of the runtime closure', () => {
    const src = parse(
      join(ROOT, 'src/sample.ts'),
      ["import type { A } from './a';", "import { b, type C } from './b';", "export { d } from './d';", "export type { E } from './e';", "import x from 'pkg';"].join('\n'),
    );
    expect(runtimeImports(src)).toEqual(['./b', './d']);
  });
});
