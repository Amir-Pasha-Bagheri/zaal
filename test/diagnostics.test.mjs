// A second pass over the compiler's diagnostics: the mistakes that used to reach the output as
// broken JavaScript, plus the warnings a build reports without failing.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { compile, parseApp } from '../zal.mjs';
import { projectDir, buildIn, cleanup } from './helpers/fixture.mjs';

after(cleanup);

const throws = (src, re, opts) => assert.throws(() => compile(src, 'jsx', opts), re);
const stores = new Map([['Cart', 'stores/Cart'], ['Theme', 'stores/Theme']]);

test('a hook cannot be called inside memo, cb or fx', () => {
  throws('C A\n  memo path = useRoute()\n  p "{path}"\n',
    /useRoute\(\) is a hook, so it cannot run inside `memo` — put it on its own line: `use <name> = useRoute\(…\)`/);
  throws('C A\n  cb load() = useFetch("/x")\n  button @click=load "go"\n', /cannot run inside `cb`/);
  throws('C A\n  fx useRoute()\n  p "x"\n', /cannot run inside `fx`/);
});

test('a `use` line may call a hook, that is what it is for', () => {
  assert.match(compile('C A\n  use path = useRoute()\n  p "{path}"\n'), /const path = useRoute\(\);/);
});

test('`useX` as a property or a longer word is not mistaken for a hook', () => {
  assert.match(compile('C A p:api\n  memo v = api.useCache(1)\n  p "{v}"\n'), /useMemo/);
  assert.match(compile('C A\n  memo v = user(1)\n  p "{v}"\n'), /useMemo/);
});

test('two blocks of one name in a file is an error', () => {
  throws('C A\n  p "1"\nC A\n  p "2"\n', /C A is declared twice in this file/);
  throws('S A s:n=0\n  cb up() = n++\nC A\n  p "x"\n', /A is declared twice in this file/);
});

test('a prop or state name has to be a name', () => {
  throws('C A p:1x\n  p "x"\n', /p:1x: `1x` is not a name/);
  throws('C A s:2y=0\n  p "x"\n', /s:2y=0: `2y` is not a name/);
  throws('S B s:3z=0\n  cb up() = log(1)\n', /s:3z=0: `3z` is not a name/);
  throws('C A catch p:4w\n  p "x"\n', /p:4w: `4w` is not a name/);
});

test('an unknown directive in app.zal is an error, not a silent no-op', () => {
  assert.throws(() => parseApp('A D\n  stores Theme\n  / Home\n'), /app: unknown directive `stores`/);
  assert.throws(() => parseApp('A D\n  title "x"\n'), /app: unknown directive `title`/);
});

test('an unknown backend is rejected', () => {
  assert.throws(() => compile('C A\n  p "x"\n', 'tsx'), /unknown backend: tsx/);
});

test('a store may not read a store that does not exist', () => {
  throws('S Cart s:items=[]\n  use { mode } = Nope\n', /no store `S Nope`/, { stores });
});

test('a store may not assign another store\'s state', () => {
  throws('S Cart s:items=[]\n  use { mode } = Theme\n  cb dark() = mode="dark"\n',
    /mode comes from a store/, { stores });
});

test('a slot on a kit entry names the tag it expanded to', () => {
  throws('C A\n  %card\n    slot head\n      p "x"\n',
    /slot head: <section> is not a component/,
    { ui: { kit: { card: { el: 'section' } }, known: new Set(['card']) } });
});

test('a bad package specifier is reported', () => {
  throws('i x @bad\nC A\n  p "x"\n', /bad package specifier: @bad/);
});

test('an fx whose only statement is `off` is allowed', () => {
  assert.match(compile('C A\n  fx!\n    off teardown()\n  p "x"\n'),
    /useEffect\(\(\) => \{\n\s*return \(\) => teardown\(\);\n\s*\}, \[\]\);/);
});

test('a component may render itself', () => {
  const out = compile('C Tree p:node\n  ul\n    *node.kids as k\n      Tree node=k\n', 'jsx', { main: 'Tree' });
  assert.match(out, /<Tree key=\{i\} node=\{k\} \/>/);
});

test('errors from a nested source name the full path and line', () => {
  const root = projectDir({
    'zal/app.zal': 'A D\n  / Home\n',
    'zal/Home.zal': 'C Home\n  h1 "h"\n',
    'zal/a/b/Broken.zal': 'C Broken\n  div\n    p "ok"\n    fx log(1)\n',
  });
  assert.throws(() => buildIn(root), e => {
    assert.match(e.message, /^zal\/a\/b\/Broken\.zal:4 {2}hook lines must be direct children of `C`/);
    return true;
  });
});

test('one component name in two files is a warning that names both', () => {
  const root = projectDir({
    'zal/app.zal': 'A D\n  / Home\n',
    'zal/Home.zal': 'C Home\n  h1 "h"\n',
    'zal/a/Row.zal': 'C Row\n  tr\n',
    'zal/b/Row.zal': 'C Row\n  tr\n',
  });
  const out = buildIn(root);
  assert.deepEqual(out.warnings, ['C Row is declared in both a/Row.zal and b/Row.zal']);
});

test('one store name in two files is a warning too', () => {
  const root = projectDir({
    'zal/app.zal': 'A D\n  / Home\n',
    'zal/Home.zal': 'C Home\n  h1 "h"\n',
    'zal/x/Cart.zal': 'S Cart s:items=[]\n  cb add(i) = items=[...items,i]\n',
    'zal/y/Cart.zal': 'S Cart s:items=[]\n  cb add(i) = items=[...items,i]\n',
  });
  assert.ok(buildIn(root).warnings.some(w => /S Cart is declared in both x\/Cart\.zal and y\/Cart\.zal/.test(w)));
});

test('the same name in one file across C and S is still caught per file', () => {
  const root = projectDir({
    'zal/app.zal': 'A D\n  / Home\n',
    'zal/Home.zal': 'C Home\n  h1 "h"\nS Home s:n=0\n  cb up() = n++\n',
  });
  assert.throws(() => buildIn(root), /Home is declared twice in this file/);
});

test('a route pointing at a store says there is no such component', () => {
  const root = projectDir({
    'zal/app.zal': 'A D\n  / Cart\n',
    'zal/Cart.zal': 'S Cart s:items=[]\n  cb add(i) = items=[...items,i]\n',
  });
  assert.throws(() => buildIn(root), /route \/: no `C Cart` in zal\//);
});

test('warnings do not stop a build from writing its output', () => {
  const root = projectDir({
    'zal/app.zal': 'A D\n  ui ./ui.zal\n  / Home\n',
    'zal/ui.zal': 'D U\nk page main\n  p 0\n',
    'zal/Home.zal': 'i d lodash/debounce\nC Home\n  %page.mystery "{d}"\n',
  });
  const out = buildIn(root);
  assert.equal(out.warnings.length, 2, out.warnings.join(' | '));
  assert.ok(out.made.includes('src/Home.jsx'));
});
