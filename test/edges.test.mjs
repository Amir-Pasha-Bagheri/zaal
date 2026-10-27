// Round five, aimed at whatever no app and no earlier round has touched: persistence that
// outlives a schema change, package specifiers, the single-file command, `ui.zaal` corners,
// and the sweep's handling of stylesheets.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { compile, parseUI, uiCss, parseApp } from '../zaal.mjs';
import { projectDir, buildIn, read, has, cleanup } from './helpers/fixture.mjs';

after(cleanup);

const jsx = (src, opts) => compile(src, 'jsx', opts);
const esm = (src, opts) => compile(src, 'esm', opts);
const ZAAL = new URL('../packages/zaal/bin/zaal', import.meta.url).pathname;

// ---- persistence across a schema change -------------------------------------------------

test('a persisted store seeds only the state it still declares', () => {
  const out = jsx('S T persist s:a=1 s:b=2\n');
  assert.match(out, /useState\(saved\.a \?\? 1\)/);
  assert.match(out, /useState\(saved\.b \?\? 2\)/);
  assert.doesNotMatch(out, /saved\.c/, 'a key that is no longer declared is simply not read');
});

test('a persisted store writes every state and nothing else', () => {
  const out = jsx('S T persist s:a=1\n  memo double = a * 2\n  cb set2() = a=2\n');
  assert.match(out, /JSON\.stringify\(\{ a \}\)/, 'derived values are recomputed, never stored');
  assert.match(out, /\}, \[a\]\);/);
});

// ---- package specifiers ------------------------------------------------------------------

test('a scoped package, a subpath and a version pin resolve together', () => {
  const pkgs = new Map();
  const out = esm('i { x } from @scope/pkg@2.1.0/sub\nC A\n  p "{x}"\n', { pkgs, pins: new Map() });
  assert.match(out, /import \{ x \} from '@scope\/pkg\/sub';/);
  assert.equal([...pkgs.values()][0].version, '2.1.0');
  assert.match([...pkgs.values()][0].url, /@scope\/pkg@2\.1\.0\/sub\?external=react,react-dom/);
});

test('a package stylesheet is a link in the preview and an import in the build', () => {
  const pkgs = new Map();
  assert.equal(esm('i pkg/dist/style.css\nC A\n  p "x"\n', { pkgs }).includes('style.css'), false,
    'the esm page links it in <head> instead');
  assert.match(jsx('i pkg/dist/style.css\nC A\n  p "x"\n', { pkgs: new Map() }),
    /import 'pkg\/dist\/style\.css';/);
});

test('every package an i line names reaches package.json', () => {
  const root = projectDir({
    'zaal/app.zaal': 'A P\n  pkg left-pad@1.3.0\n  / Home\n',
    'zaal/pages/Home.zaal': 'i pad left-pad\ni { x } from @scope/thing\nC Home\n  p "{pad(x)}"\n',
  });
  const out = buildIn(root, 'jsx');
  const deps = JSON.parse(read(root, 'application/package.json')).dependencies;
  assert.equal(deps['left-pad'], '^1.3.0');
  assert.equal(deps['@scope/thing'], 'latest');
  assert.match(out.warnings.join('\n'), /@scope\/thing is unpinned/);
});

// ---- the single-file command ---------------------------------------------------------------

test('`zaal <file> <dir>` writes one module and nothing else', () => {
  const root = projectDir({ 'Hi.zaal': 'C Hi p:n\n  p "{n}"\n' });
  execFileSync(process.execPath, [ZAAL, 'Hi.zaal', 'out'], { cwd: root, stdio: 'pipe' });
  assert.ok(has(root, 'out/Hi.js'));
  assert.match(read(root, 'out/Hi.js'), /export default function Hi/);
  assert.equal(has(root, 'out/main.js'), false, 'no app scaffolding for a single file');
});

// ---- ui.zaal corners -----------------------------------------------------------------------

test('a light scheme is the mirror of a dark one', () => {
  const css = uiCss(parseUI('D X\nt color\n  bg #fff\nscheme light\n  color.bg #eee\n'));
  assert.match(css, /@media \(prefers-color-scheme: light\) \{\n  :root:not\(\[data-theme="dark"\]\)/);
  assert.match(css, /:root\[data-theme="light"\]/);
});

test('raw css passthrough keeps its order, after everything the format wrote', () => {
  const css = uiCss(parseUI('D X\ncss @import url(a.css);\nk card\n  p 1rem\ncss .late { color: red }\n'));
  assert.ok(css.indexOf('.card') < css.indexOf('.late { color: red }'));
  assert.ok(css.indexOf('@import url(a.css);') < css.indexOf('.late'));
});

test('a kit entry with only variants emits no base rule but is still known', () => {
  const ui = parseUI('D X\nk tone\n  v warn\n    color red\n');
  assert.ok(ui.known.has('tone') && ui.known.has('warn'));
  assert.doesNotMatch(uiCss(ui), /^\.tone \{/m);
});

// ---- the sweep and stylesheets ---------------------------------------------------------------

test('a stylesheet dropped from app.zaal is swept from the output', () => {
  const root = projectDir({
    'zaal/app.zaal': 'A S\n  css ./styles/a.css\n  css ./styles/b.css\n  / Home\n',
    'zaal/pages/Home.zaal': 'C Home\n  p "x"\n',
    'zaal/styles/a.css': '.a{}',
    'zaal/styles/b.css': '.b{}',
  });
  buildIn(root, 'jsx');
  assert.ok(has(root, 'application/src/styles/a.css') && has(root, 'application/src/styles/b.css'));
  writeFileSync(join(root, 'zaal/app.zaal'), 'A S\n  css ./styles/a.css\n  / Home\n');
  const out = buildIn(root, 'jsx');
  assert.ok(has(root, 'application/src/styles/a.css'));
  assert.equal(has(root, 'application/src/styles/b.css'), false, 'the dropped sheet is gone');
  assert.deepEqual(out.stale, ['src/styles/b.css']);
});

test('index.html links the design system before the raw stylesheets', () => {
  const root = projectDir({
    'zaal/app.zaal': 'A S\n  ui ./ui.zaal\n  css ./styles/extra.css\n  / Home\n',
    'zaal/ui.zaal': 'D U\nk page main\n  p 0\n',
    'zaal/pages/Home.zaal': 'C Home\n  %page\n    p "x"\n',
    'zaal/styles/extra.css': '.x{}',
  });
  buildIn(root, 'jsx');
  const html = read(root, 'application/index.html');
  assert.ok(html.indexOf('ui.css') < html.indexOf('extra.css'));
});

// ---- module shape ---------------------------------------------------------------------------

test('the default export follows the file name, whatever the order', () => {
  const two = 'C Row\n  tr\n    td "r"\nC Table\n  table\n    Row\n';
  assert.match(jsx(two, { main: 'Table' }), /export default function Table/);
  assert.match(jsx(two, { main: 'Table' }), /^export function Row/m);
  assert.match(jsx(two, { main: 'Row' }), /export default function Row/);
});

test('a store and a component in one file both export', () => {
  const out = jsx('S T s:n=0\nC Panel\n  use { n } = T\n  p "{n}"\n',
    { stores: new Map([['T', 'T']]), main: 'T' });
  assert.match(out, /export function TProvider/);
  assert.match(out, /export default useT;/);
  assert.match(out, /export function Panel/);
});

test('a file of only js lines is a plain module', () => {
  const out = jsx('js export const add = (a, b) => a + b\njs export const PI = 3\n');
  assert.equal(out.trim(), 'export const add = (a, b) => a + b\nexport const PI = 3');
});

// ---- expression children and keys in the esm backend ------------------------------------------

test('esm: a keyed component, a keyed fragment and a keyed expression', () => {
  const comp = esm('i Row ./Row\nC A p:xs\n  div\n    *xs as x k=x.id\n      Row row=x\n');
  assert.match(comp, /h\(Row, \{ key: x\.id, "row": x \}\)/);
  const frag = esm('C A p:xs\n  div\n    *xs as x k=x.id\n      span "a"\n      span "b"\n');
  assert.match(frag, /h\(F, \{ key: x\.id \}/);
  const expr = esm('C A p:xs\n  div\n    *xs as x k=x.id\n      {x.label}\n');
  assert.match(expr, /h\(F, \{ key: x\.id \}, x\.label\)/);
});

test('esm: a component that only forwards props passes the object straight through', () => {
  assert.match(esm('i B ./B\nC A p:rest\n  B ...rest\n'), /h\(B, rest\)/);
  assert.match(esm('i B ./B\nC A p:rest\n  B x=1 ...rest\n'), /Object\.assign\(\{"x": 1\}, rest\)/);
});
