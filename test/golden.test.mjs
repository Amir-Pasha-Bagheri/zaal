// Byte-for-byte snapshots of what the compiler writes for the example sources. Any change to
// codegen shows up here as a diff, so a formatting or ordering change has to be deliberate.
// To accept a new snapshot: node --test test/golden.test.mjs with ZAL_GOLDEN=update.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { compile, project, uiCss } from '../zal.mjs';

const dir = new URL('./golden/', import.meta.url).pathname;
const example = new URL('../example/', import.meta.url).pathname;
const p = project({ root: example });
const update = process.env.ZAL_GOLDEN === 'update';

const check = (name, actual) => {
  const file = join(dir, name);
  if (update) { writeFileSync(file, actual); return; }
  assert.equal(actual, readFileSync(file, 'utf8'),
    `${name} changed — rerun with ZAL_GOLDEN=update if the new output is intended`);
};

const module_ = (path, target) => {
  const src = readFileSync(join(example, 'zal', `${path}.zal`), 'utf8');
  const slash = path.lastIndexOf('/');
  return compile(src, target, { ui: p.ui, stores: p.stores, comps: p.comps, pins: p.app.pins,
    main: path.slice(slash + 1), dir: path.slice(0, slash) });
};

for (const file of readdirSync(dir)) {
  const m = /^(.+)\.(jsx|esm)\.txt$/.exec(file);
  if (!m) continue;
  test(`golden: ${m[1]} (${m[2]})`, () => check(file, module_(m[1].replace('-', '/'), m[2])));
}

test('golden: the compiled design system', () => check('ui.css.txt', uiCss(p.ui)));

test('every golden file is covered by a test', () => {
  const files = readdirSync(dir);
  assert.ok(files.length >= 10, `${files.length} snapshots`);
  for (const f of files) assert.match(f, /\.(jsx|esm)\.txt$|^ui\.css\.txt$/, f);
});

test('compiling the same source twice gives the same module', () => {
  for (const path of ['components/Counter', 'pages/Home', 'stores/Todos']) {
    assert.equal(module_(path, 'jsx'), module_(path, 'jsx'), path);
    assert.equal(module_(path, 'esm'), module_(path, 'esm'), path);
  }
});

test('compiling other files in between changes nothing', () => {
  const first = module_('components/Counter', 'jsx');
  module_('pages/About', 'esm');
  try { compile('C Bad\n  Missing\n'); } catch {}      // a failed compile must not leak state
  module_('stores/Theme', 'jsx');
  assert.equal(module_('components/Counter', 'jsx'), first);
});
