// Build-level edge cases: an app with nothing in it, missing optional files, renames and
// deletions, the two output directories side by side, and a big tree.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { projectDir, buildIn, inspect, read, has, cleanup } from './helpers/fixture.mjs';

after(cleanup);

const UI = 'D T\nt color\n  bg #fff\nk page main\n  bg $color.bg\n';

test('an app with no routes still builds a runnable page', () => {
  const root = projectDir({ 'zal/app.zal': 'A Empty\n  t "Nothing"\n', 'zal/Home.zal': 'C Home\n  h1 "h"\n' });
  const out = buildIn(root);
  assert.deepEqual(out.app.routes, []);
  const main = read(root, 'application/src/main.jsx');
  assert.match(main, /const routes = \[\n*\];/);
  buildIn(root, 'esm');
  execFileSync(process.execPath, ['--check', join(root, '.zal-dev/src/main.js')]);
});

test('an app with no sources at all builds the shell', () => {
  const root = projectDir({ 'zal/app.zal': 'A Bare\n  ui ./ui.zal\n', 'zal/ui.zal': UI });
  const out = buildIn(root);
  assert.deepEqual(out.made, []);
  assert.ok(has(root, 'application/index.html'));
  assert.ok(has(root, 'application/src/main.jsx'));
  assert.ok(has(root, 'application/src/styles/ui.css'));
});

test('`ui` naming a file that is not there leaves the app unstyled, without failing', () => {
  const root = projectDir({ 'zal/app.zal': 'A U\n  ui ./nope.zal\n  / Home\n', 'zal/Home.zal': 'C Home\n  h1 "h"\n' });
  const out = buildIn(root);
  assert.equal(out.ui, null);
  assert.ok(!has(root, 'application/src/styles/ui.css'));
  assert.doesNotMatch(read(root, 'application/index.html'), /ui\.css/,
    'a stylesheet the build never wrote must not be linked');
  assert.deepEqual(out.warnings, ['zal/app.zal: ui zal/nope.zal is not there — no design system']);
});

test('a missing `css` file is skipped, an http one is linked but not copied', () => {
  const root = projectDir({
    'zal/app.zal': 'A C\n  css ./styles/gone.css\n  css https://cdn.test/x.css\n  / Home\n',
    'zal/Home.zal': 'C Home\n  h1 "h"\n',
  });
  buildIn(root);
  const html = read(root, 'application/index.html');
  assert.match(html, /<link rel="stylesheet" href="https:\/\/cdn\.test\/x\.css" \/>/);
  assert.match(html, /href="\.\/src\/styles\/gone\.css"/, 'the link is written even so');
  assert.ok(!has(root, 'application/src/styles/gone.css'));
});

test('several css files keep their order after ui.css', () => {
  const root = projectDir({
    'zal/app.zal': 'A C\n  ui ./ui.zal\n  css ./a.css\n  css ./b.css\n  / Home\n',
    'zal/ui.zal': UI,
    'zal/a.css': '.a{}\n',
    'zal/b.css': '.b{}\n',
    'zal/Home.zal': 'C Home\n  h1 "h"\n',
  });
  buildIn(root);
  const html = read(root, 'application/index.html');
  assert.ok(html.indexOf('ui.css') < html.indexOf('a.css'));
  assert.ok(html.indexOf('a.css') < html.indexOf('b.css'));
  assert.ok(has(root, 'application/src/styles/a.css') && has(root, 'application/src/styles/b.css'));
});

test('a changed stylesheet is copied again on the next build', () => {
  const root = projectDir({
    'zal/app.zal': 'A C\n  css ./a.css\n  / Home\n',
    'zal/a.css': '.a{color:red}\n',
    'zal/Home.zal': 'C Home\n  h1 "h"\n',
  });
  buildIn(root);
  writeFileSync(join(root, 'zal/a.css'), '.a{color:blue}\n');
  buildIn(root);
  assert.equal(read(root, 'application/src/styles/a.css'), '.a{color:blue}\n');
});

test('dropping a `css` line sweeps the copy out of the output', () => {
  const root = projectDir({
    'zal/app.zal': 'A C\n  css ./a.css\n  / Home\n',
    'zal/a.css': '.a{}\n',
    'zal/Home.zal': 'C Home\n  h1 "h"\n',
  });
  buildIn(root);
  assert.ok(has(root, 'application/src/styles/a.css'));
  writeFileSync(join(root, 'zal/app.zal'), 'A C\n  / Home\n');
  const out = buildIn(root);
  assert.ok(out.stale.includes('src/styles/a.css'));
  assert.ok(!has(root, 'application/src/styles'), 'the emptied styles directory goes too');
});

test('the two backends write to their own directories and sweep independently', () => {
  const root = projectDir({
    'zal/app.zal': 'A Two\n  / Home\n',
    'zal/Home.zal': 'C Home\n  h1 "h"\n',
    'zal/Extra.zal': 'C Extra\n  p "e"\n',
  });
  buildIn(root, 'jsx');
  buildIn(root, 'esm');
  assert.ok(has(root, 'application/src/Extra.jsx') && has(root, '.zal-dev/src/Extra.js'));
  rmSync(join(root, 'zal/Extra.zal'));
  const esm = buildIn(root, 'esm');
  assert.deepEqual(esm.stale, ['src/Extra.js']);
  assert.ok(!has(root, '.zal-dev/src/Extra.js'));
  assert.ok(has(root, 'application/src/Extra.jsx'), 'the jsx output is untouched until it rebuilds');
  const jsx = buildIn(root, 'jsx');
  assert.deepEqual(jsx.stale, ['src/Extra.jsx']);
});

test('renaming a source moves its module and fixes the importer', () => {
  const root = projectDir({
    'zal/app.zal': 'A R\n  / Home\n',
    'zal/Home.zal': 'i Card ./widgets/Card\nC Home\n  Card\n',
    'zal/widgets/Card.zal': 'C Card\n  p "c"\n',
  });
  buildIn(root);
  rmSync(join(root, 'zal/widgets'), { recursive: true });
  mkdirSync(join(root, 'zal/parts'), { recursive: true });
  writeFileSync(join(root, 'zal/parts/Card.zal'), 'C Card\n  p "c"\n');
  writeFileSync(join(root, 'zal/Home.zal'), 'i Card ./parts/Card\nC Home\n  Card\n');
  const out = buildIn(root);
  assert.deepEqual(out.stale, ['src/widgets/Card.jsx']);
  assert.ok(has(root, 'application/src/parts/Card.jsx'));
  assert.match(read(root, 'application/src/Home.jsx'), /from '\.\/parts\/Card\.jsx'/);
});

test('a four-level deep source reaches the root with ../../../..', () => {
  const root = projectDir({
    'zal/app.zal': 'A D\n  / Home\n',
    'zal/Home.zal': 'C Home\n  h1 "h"\n',
    'zal/a/b/c/d/Deep.zal': 'C Deep\n  use { n } = Counter\n  Link to="/" "{n}"\n',
    'zal/stores/Counter.zal': 'S Counter s:n=0\n  cb up() = n++\n',
  });
  buildIn(root);
  const deep = read(root, 'application/src/a/b/c/d/Deep.jsx');
  assert.match(deep, /import \{ useCounter \} from '\.\.\/\.\.\/\.\.\/\.\.\/stores\/Counter\.jsx';/);
  assert.match(deep, /import \{ Link \} from '\.\.\/\.\.\/\.\.\/\.\.\/router\.jsx';/);
});

test('project() reports every block, with named exports flagged', () => {
  const root = projectDir({
    'zal/app.zal': 'A P\n  / Home\n',
    'zal/Home.zal': 'C Home\n  h1 "h"\n',
    'zal/Table.zal': 'C Table\n  Row\nC Row\n  tr\n',
    'zal/stores/Cart.zal': 'S Cart s:items=[]\n  cb add(x) = items=[...items,x]\n',
  });
  const p = inspect(root);
  assert.deepEqual([...p.stores], [['Cart', 'stores/Cart']]);
  assert.deepEqual(p.comps.get('Table'), { file: 'Table', named: false });
  assert.deepEqual(p.comps.get('Row'), { file: 'Table', named: true });
  assert.deepEqual([...p.sources.keys()].sort(), ['Home.zal', 'Table.zal', 'stores/Cart.zal']);
});

test('a named export is importable with braces from another file', () => {
  const root = projectDir({
    'zal/app.zal': 'A N\n  / Home\n',
    'zal/Table.zal': 'C Table\n  Row\nC Row\n  tr\n',
    'zal/Home.zal': 'i { Row } from ./Table\nC Home\n  table\n    Row\n',
  });
  buildIn(root);
  assert.match(read(root, 'application/src/Home.jsx'), /import \{ Row \} from '\.\/Table\.jsx';/);
  assert.match(read(root, 'application/src/Table.jsx'), /export function Row/);
});

test('stores with no `store` line are mounted in alphabetical order', () => {
  const root = projectDir({
    'zal/app.zal': 'A S\n  / Home\n',
    'zal/Home.zal': 'C Home\n  h1 "h"\n',
    'zal/stores/Zeta.zal': 'S Zeta s:a=0\n  cb up() = a++\n',
    'zal/stores/Alpha.zal': 'S Alpha s:b=0\n  cb up() = b++\n',
  });
  buildIn(root);
  const main = read(root, 'application/src/main.jsx');
  assert.ok(main.indexOf('<AlphaProvider>') < main.indexOf('<ZetaProvider>'));
});

test('a partial `store` line puts the rest after it, still alphabetical', () => {
  const root = projectDir({
    'zal/app.zal': 'A S\n  store Zeta\n  / Home\n',
    'zal/Home.zal': 'C Home\n  h1 "h"\n',
    'zal/stores/Zeta.zal': 'S Zeta s:a=0\n  cb up() = a++\n',
    'zal/stores/Alpha.zal': 'S Alpha s:b=0\n  cb up() = b++\n',
    'zal/stores/Mid.zal': 'S Mid s:c=0\n  cb up() = c++\n',
  });
  buildIn(root);
  const main = read(root, 'application/src/main.jsx');
  const order = ['Zeta', 'Alpha', 'Mid'].map(n => main.indexOf(`<${n}Provider>`));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('unicode survives text, titles and the page', () => {
  const root = projectDir({
    'zal/app.zal': 'A Uni\n  t "Zál — déjà ✨"\n  / Home\n',
    'zal/Home.zal': 'C Home\n  h1 "سلام — ☾ ✨"\n',
  });
  buildIn(root);
  assert.match(read(root, 'application/index.html'), /<title>Zál — déjà ✨<\/title>/);
  assert.match(read(root, 'application/src/Home.jsx'), /<h1>سلام — ☾ ✨<\/h1>/);
});

test('a sixty-component app builds, syntax-checks and sweeps', () => {
  const files = { 'zal/app.zal': 'A Big\n  ui ./ui.zal\n  / Home\n', 'zal/ui.zal': UI };
  const names = Array.from({ length: 60 }, (_, i) => `W${i}`);
  for (const [i, n] of names.entries()) {
    files[`zal/widgets/g${i % 6}/${n}.zal`] = `C ${n} p:x=${i}\n  %page\n    p "${n} {x}"\n`;
  }
  files['zal/Home.zal'] = names.map((n, i) => `i ${n} ./widgets/g${i % 6}/${n}`).join('\n')
    + '\nC Home\n  %page\n' + names.map(n => `    ${n}`).join('\n') + '\n';
  const root = projectDir(files);
  const out = buildIn(root);
  assert.equal(out.made.length, 61);
  assert.deepEqual(out.warnings, []);
  buildIn(root, 'esm');
  const all = readdirSync(join(root, '.zal-dev/src'), { recursive: true })
    .map(String).filter(f => f.endsWith('.js'));
  assert.ok(all.length >= 62);
  for (const f of all) execFileSync(process.execPath, ['--check', join(root, '.zal-dev/src', f)]);

  // now delete a whole group and watch the tree shrink
  rmSync(join(root, 'zal/widgets/g3'), { recursive: true });
  files['zal/Home.zal'] = 'C Home\n  %page\n    p "trimmed"\n';
  writeFileSync(join(root, 'zal/Home.zal'), files['zal/Home.zal']);
  const after = buildIn(root);
  assert.equal(after.stale.length, 10, '60 / 6 groups = 10 modules gone');
  assert.ok(!existsSync(join(root, 'application/src/widgets/g3')));
  assert.ok(existsSync(join(root, 'application/src/widgets/g2')));
});

test('index.html is rewritten only with the content it should have', () => {
  const root = projectDir({
    'zal/app.zal': 'A H\n  t "First"\n  / Home\n',
    'zal/Home.zal': 'C Home\n  h1 "h"\n',
  });
  buildIn(root);
  assert.match(read(root, 'application/index.html'), /<title>First<\/title>/);
  writeFileSync(join(root, 'zal/app.zal'), 'A H\n  t "Second"\n  m #app\n  / Home\n');
  buildIn(root);
  const html = read(root, 'application/index.html');
  assert.match(html, /<title>Second<\/title>/);
  assert.match(html, /<div id="app"><\/div>/);
  assert.doesNotMatch(html, /First/);
});
