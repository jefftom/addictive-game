// Bundled fonts: the game must not depend on a third-party font host (privacy, offline desktop build).
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

describe('bundled fonts', () => {
  const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');

  it('index.html makes no third-party requests (no Google Fonts)', () => {
    const html = read('index.html');
    expect(html).not.toMatch(/<(link|script)[^>]+(href|src)="https?:/);
    expect(html).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  });

  it('declares the three families from local WOFF2 files, with font-display: swap and the OFL licence', () => {
    const css = read('src/ui/style.css');
    const faces = css.match(/@font-face\s*{[^}]*}/g) ?? [];
    const families = new Set(faces.map((f) => /font-family:\s*'([^']+)'/.exec(f)?.[1]));
    expect([...families].sort()).toEqual(['Chakra Petch', 'Kode Mono', 'Tektur']);
    for (const f of faces) {
      expect(f).toMatch(/font-display:\s*swap/);
      const url = /url\('([^']+\.woff2)'\)/.exec(f)?.[1];
      expect(url, f).toBeDefined();
      expect(statSync(join(ROOT, 'src', 'ui', url!)).size).toBeGreaterThan(5000);
    }
    expect(read('src/assets/fonts/OFL.txt')).toMatch(/SIL OPEN FONT LICENSE Version 1\.1/);
  });

  it('the desktop CSP allows no remote hosts', () => {
    const csp = /const CSP = \[([\s\S]*?)\]\.join/.exec(read('desktop/main.cjs'))?.[1] ?? '';
    expect(csp).toMatch(/font-src 'self'/);
    expect(csp.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n')).not.toMatch(/https?:/);
  });
});
