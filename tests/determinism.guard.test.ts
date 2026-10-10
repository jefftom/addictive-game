import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Grep guard: the simulation must compute the same bits on every engine and
 * CPU, or the golden master, the Daily Run and co-op desync per platform.
 * ECMAScript leaves Math.sin/cos/atan2/exp/pow/hypot/... (and `**`)
 * "implementation-approximated", and V8 really returns different last bits on
 * arm64 than on x64. Every file the sim can execute must use src/core/dmath.ts
 * (or plain + - * / and Math.sqrt) instead.
 *
 * The scanned set is the runtime import closure of the sim entry points, so a
 * new helper file imported by the sim is covered automatically. Type-only
 * imports are skipped: they never run.
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

const rel = (file: string): string => relative(ROOT, file).split('\\').join('/');

function parse(file: string, text = readFileSync(file, 'utf8')): ts.SourceFile {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
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
  const stack = SIM_ENTRIES.map((f) => join(ROOT, f));
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
  const isMath = (e: ts.Expression): boolean => ts.isIdentifier(e) && e.text === 'Math';
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && isMath(node.expression) && APPROXIMATED.has(node.name.text)) {
      hit(node, `Math.${node.name.text}`);
    } else if (
      ts.isElementAccessExpression(node) &&
      isMath(node.expression) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      APPROXIMATED.has(node.argumentExpression.text)
    ) {
      hit(node, `Math['${node.argumentExpression.text}']`);
    } else if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer && isMath(node.initializer)) {
      for (const el of node.name.elements) {
        const key = el.propertyName ?? el.name;
        if (ts.isIdentifier(key) && APPROXIMATED.has(key.text)) hit(el, `{ ${key.text} } = Math`);
      }
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
    expect(hits).toEqual(['2: Math.sin', '4: **', '5: **=', '6: Math.hypot', "7: Math['atan2']", '8: { pow } = Math']);
  });

  it('type-only imports are not part of the runtime closure', () => {
    const src = parse(
      join(ROOT, 'src/sample.ts'),
      ["import type { A } from './a';", "import { b, type C } from './b';", "export { d } from './d';", "export type { E } from './e';", "import x from 'pkg';"].join('\n'),
    );
    expect(runtimeImports(src)).toEqual(['./b', './d']);
  });
});
