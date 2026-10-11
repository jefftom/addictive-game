// Inlines the Vite build (dist/) into self-contained HTML files:
//   dist-single/shardstorm.html  – a complete document you can open or host anywhere
//   dist-single/embed.html       – body-only markup (no <html>/<head>/<body> wrappers)
//                                  for hosts that supply their own document skeleton
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const out = join(root, 'dist-single');
let html = readFileSync(join(dist, 'index.html'), 'utf8');

// The bundled fonts are separate files in dist/assets/ (see vite.config.ts); here they become
// data: URIs, so the single file needs no network and no neighbouring files.
const inlineFonts = (text) =>
  text.replace(/url\((['"]?)\.\/([\w.-]+\.woff2)\1\)/g, (_m, _q, file) => {
    const b64 = readFileSync(join(dist, 'assets', file)).toString('base64');
    return `url(data:font/woff2;base64,${b64})`;
  });
const css = [];
html = html.replace(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/g, (_m, file) => {
  css.push(inlineFonts(readFileSync(join(dist, file), 'utf8')));
  return '';
});
if (css.some((c) => /url\((['"]?)\.\//.test(c))) throw new Error('build-single: the CSS still references a relative asset');
let js = '';
html = html.replace(/<script type="module" crossorigin src="\.\/(assets\/[^"]+\.js)"><\/script>/g, (_m, file) => {
  js += readFileSync(join(dist, file), 'utf8');
  return '';
});
if (!js) throw new Error('build-single: no module script found in dist/index.html');
const safeJs = js.replace(/<\/script/gi, '<\\/script');
const style = `<style>\n${css.join('\n')}\n</style>`;
const script = `<script type="module">\n${safeJs}\n</script>`;

// Function replacements: the bundle contains `$` sequences that string replacements would expand.
const full = html.replace('</head>', () => `${style}\n</head>`).replace('</body>', () => `${script}\n</body>`);

const pick = (re) => (html.match(re)?.[0] ?? '');
const title = pick(/<title>[\s\S]*?<\/title>/);
const body = html.match(/<body>([\s\S]*?)<\/body>/)?.[1] ?? '';
const embed = `${title}\n${style}\n${body.trim()}\n${script}\n`;

mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'shardstorm.html'), full);
writeFileSync(join(out, 'embed.html'), embed);
const kb = (s) => `${(Buffer.byteLength(s) / 1024).toFixed(1)} KB`;
console.log(`dist-single/shardstorm.html  ${kb(full)}`);
console.log(`dist-single/embed.html       ${kb(embed)}`);
