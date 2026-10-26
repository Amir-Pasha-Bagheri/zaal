// The build as a whole: the mirrored tree, sweeping stale output, idempotency, and the
// syntactic validity of every module written.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, writeFileSync, rmSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { projectDir, buildIn, read, has, cleanup, exampleDir } from './helpers/fixture.mjs';

after(cleanup);

const tree = (root, dir) => {
  const out = [];
  const walk = p => {
    for (const e of readdirSync(join(root, dir, p), { withFileTypes: true })) {
      const next = p ? `${p}/${e.name}` : e.name;
      e.isDirectory() ? walk(next) : out.push(next);
    }
  };
  walk('');
  return out.sort();
};

const NESTED = {
  'zal/app.zal': 'A Nest\n  ui ./ui.zal\n  / Home\n  /about About\n',
  'zal/ui.zal': 'D N\nk page main\n  p 0\nk card section\n  p 0\n',
  'zal/pages/Home.zal': 'i Card ../widgets/ui/Card\nC Home\n  %page\n    Card title="hi"\n',
  'zal/pages/About.zal': 'C About\n  %page\n    h1 "about"\n',
  'zal/widgets/ui/Card.zal': 'C Card p:title\n  %card\n    h2 "{title}"\n    {children}\n',
};

test('the output mirrors zal/ at any depth', () => {
  const root = projectDir(NESTED);
  buildIn(root);
  assert.deepEqual(tree(root, 'application/src'), [
    'main.jsx', 'pages/About.jsx', 'pages/Home.jsx', 'router.jsx',
    'styles/ui.css', 'widgets/ui/Card.jsx',
  ]);
  assert.match(read(root, 'application/src/pages/Home.jsx'),
    /import Card from '\.\.\/widgets\/ui\/Card\.jsx';/);
  assert.match(read(root, 'application/src/main.jsx'), /import Home from '\.\/pages\/Home\.jsx';/);
});

test('a rebuild with no changes writes identical files', () => {
  const root = projectDir(NESTED);
  buildIn(root);
  const first = tree(root, 'application').map(f => [f, read(root, `application/${f}`)]);
  buildIn(root);
  for (const [f, body] of first) assert.equal(read(root, `application/${f}`), body, f);
});

test('a renamed source has its stale module and empty directory swept', () => {
  const root = projectDir(NESTED);
  buildIn(root);
  assert.ok(has(root, 'application/src/widgets/ui/Card.jsx'));
  rmSync(join(root, 'zal/widgets'), { recursive: true });
  writeFileSync(join(root, 'zal/pages/Home.zal'), 'C Home\n  %page\n    h1 "no card"\n');
  const out = buildIn(root);
  assert.deepEqual(out.stale, ['src/widgets/ui/Card.jsx']);
  assert.ok(!has(root, 'application/src/widgets/ui/Card.jsx'));
  assert.ok(!has(root, 'application/src/widgets'), 'the emptied directory goes too');
});

test('assets and node_modules in the output are left alone', () => {
  const root = projectDir(NESTED);
  buildIn(root);
  mkdirSync(join(root, 'application/src/assets'), { recursive: true });
  writeFileSync(join(root, 'application/src/assets/logo.png'), 'png');
  mkdirSync(join(root, 'application/node_modules/vite'), { recursive: true });
  writeFileSync(join(root, 'application/node_modules/vite/index.js'), '// installed');
  writeFileSync(join(root, 'application/src/hand-written.js'), '// mine');
  const out = buildIn(root);
  assert.ok(has(root, 'application/src/assets/logo.png'));
  assert.ok(has(root, 'application/node_modules/vite/index.js'));
  assert.ok(out.stale.includes('src/hand-written.js'),
    'inside src/ the compiler is the author, so a stray .js is swept');
});

test('project() reports the blocks it found', () => {
  const root = projectDir({
    ...NESTED,
    'zal/stores/Todos.zal': 'S Todos s:items=[]\n  cb add(x) = items=[...items,x]\n',
  });
  const out = buildIn(root);
  assert.deepEqual([...out.stores], [['Todos', 'stores/Todos']]);
  assert.deepEqual([...out.app.routes.map(r => r.component)], ['Home', 'About']);
});

/* ---------- the output has to be real JavaScript ---------- */

const check = (root, dir) => {
  const files = tree(root, dir).filter(f => f.endsWith('.js'));
  assert.ok(files.length, 'something to check');
  for (const f of files) {
    try { execFileSync(process.execPath, ['--check', join(root, dir, f)], { stdio: 'pipe' }); }
    catch (e) { assert.fail(`${f} is not valid JavaScript:\n${e.stderr}`); }
  }
  return files;
};

test('every module the esm backend writes parses as JavaScript', () => {
  const root = projectDir(NESTED);
  buildIn(root, 'esm');
  check(root, '.zal-dev');
});

test('the example project parses as JavaScript, module for module', () => {
  const root = exampleDir();
  const out = buildIn(root, 'esm');
  assert.ok(out.made.length >= 8, `${out.made.length} modules`);
  const files = check(root, '.zal-dev');
  for (const f of ['src/components/Counter.js', 'src/components/TodoList.js', 'src/pages/Home.js',
    'src/pages/About.js', 'src/stores/Todos.js', 'src/stores/Theme.js', 'src/main.js',
    'src/router.js']) assert.ok(files.includes(f), f);
});

test('the example project builds the jsx deliverable with no warnings', () => {
  const root = exampleDir();
  const out = buildIn(root, 'jsx');
  assert.deepEqual(out.warnings, []);
  assert.deepEqual(out.stale, []);
  assert.deepEqual(out.deps, ['canvas-confetti@^1.9.3', 'framer-motion@^11.11.9']);
  assert.deepEqual(tree(root, 'application').filter(f => !f.startsWith('src/')),
    ['.gitignore', 'index.html', 'package.json', 'vite.config.js']);
  // the jsx tree is the same shape, with .jsx modules
  assert.deepEqual(tree(root, 'application/src'), [
    'components/Badge.jsx', 'components/Boom.jsx', 'components/Counter.jsx',
    'components/Field.jsx', 'components/Item.jsx', 'components/Nav.jsx', 'components/Oops.jsx',
    'components/Panel.jsx', 'components/Sparkline.jsx', 'components/Spinner.jsx',
    'components/TodoList.jsx', 'data/dex.jsx', 'img/logo.png', 'main.jsx', 'pages/About.jsx',
    'pages/Dex.jsx', 'pages/Home.jsx', 'pages/NotFound.jsx', 'pages/Pokemon.jsx',
    'pages/Stats.jsx', 'router.jsx', 'stores/Caught.jsx', 'stores/Theme.jsx',
    'stores/Todos.jsx', 'styles/extra.css', 'styles/ui.css',
  ]);
});

test('the checked-in example/application matches a fresh build', () => {
  const root = exampleDir();
  buildIn(root, 'jsx');
  const shipped = new URL('../example/application/', import.meta.url).pathname;
  if (!statSync(shipped, { throwIfNoEntry: false })) return;      // not built yet: nothing to compare
  for (const f of tree(root, 'application/src')) {
    const mine = read(root, `application/src/${f}`);
    const theirs = readFileSync(join(shipped, 'src', f), 'utf8');
    assert.equal(mine, theirs, `example/application/src/${f} is out of date — run \`zal build\``);
  }
});

test('a single-file compile is the same module the build writes', async () => {
  const root = exampleDir();
  buildIn(root, 'esm');
  const { compile, project } = await import('../zal.mjs');
  const p = project({ root });
  const src = read(root, 'zal/components/Counter.zal');
  const one = compile(src, 'esm', { ui: p.ui, stores: p.stores, comps: p.comps,
    pins: p.app.pins, cdn: p.app.cdn, main: 'Counter' });
  assert.equal(one, read(root, '.zal-dev/src/components/Counter.js'));
});

// `i logo ./logo.png` names a file, not a module: the specifier keeps its extension and the
// file is copied to the mirrored path beside the module that imports it.
const ASSETS = {
  'zal/app.zal': 'A Assets\n  / Home\n',
  'zal/pages/Home.zal': 'i logo ../img/logo.png\nC Home\n  img src=logo\n',
  'zal/img/logo.png': 'PNG',
};

test('a local asset import keeps its path and the file is copied', () => {
  const root = projectDir(ASSETS);
  const out = buildIn(root);
  assert.match(read(root, 'application/src/pages/Home.jsx'), /import logo from '\.\.\/img\/logo\.png';/);
  assert.equal(read(root, 'application/src/img/logo.png'), 'PNG');
  assert.deepEqual(out.warnings, []);
});

test('an asset that is not there is a warning, not a crash', () => {
  const root = projectDir(ASSETS);
  rmSync(join(root, 'zal/img/logo.png'));
  const out = buildIn(root);
  assert.match(out.warnings.join('\n'), /img\/logo\.png is imported but not in zal\//);
});

test('the esm preview copies assets too', () => {
  const root = projectDir(ASSETS);
  buildIn(root, 'esm');
  assert.equal(read(root, '.zal-dev/src/img/logo.png'), 'PNG');
});
