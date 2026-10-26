// Dependency inference: what lands in a hook's array, in what order, and what is deliberately
// left out. These are the arrays React lints people about, so they are worth pinning down.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../zal.mjs';

const jsx = (src, opts) => compile(src, 'jsx', opts);
const deps = out => [...out.matchAll(/\}, \[([^\]]*)\]\);/g)].map(m => m[1]);
const memoDeps = out => [...out.matchAll(/use(?:Memo|Callback)\([\s\S]*?, \[([^\]]*)\]\);/g)].map(m => m[1]);

test('deps follow scope order, not the order the body names them', () => {
  const out = jsx('C A p:a p:b s:n=0\n  fx log(n, b, a)\n  p "x"\n');
  assert.deepEqual(deps(out), ['a, b, n']);
});

test('only names the body actually mentions are deps', () => {
  const out = jsx('C A p:a p:b p:c s:n=0\n  fx log(b)\n  p "{a}{c}"\n');
  assert.deepEqual(deps(out), ['b']);
});

test('a name inside a longer identifier is not a dep', () => {
  const out = jsx('C A p:n\n  fx log(count)\n  fx log(nx)\n  fx log(x.n)\n  p "y"\n');
  assert.deepEqual(deps(out), ['', '', '']);
});

test('a property of a dep counts the object, not the property', () => {
  const out = jsx('C A p:user\n  fx log(user.name.first)\n  p "x"\n');
  assert.deepEqual(deps(out), ['user']);
});

test('a spread of a dep counts it', () => {
  assert.deepEqual(deps(jsx('C A p:xs\n  fx log(...xs)\n  p "x"\n')), ['xs']);
});

test('an interpolated string pulls its names in', () => {
  const out = jsx('C A p:label s:n=0\n  fx document.title = "{label} {n}"\n  p "x"\n');
  assert.deepEqual(deps(out), ['label, n']);
});

test('a dep named only in the cleanup still counts', () => {
  const out = jsx('C A p:id\n  fx\n    start()\n    off stop(id)\n  p "x"\n');
  assert.deepEqual(deps(out), ['id']);
});

test('a ref is never a dep, but a ref created later does not leak backwards', () => {
  const out = jsx('C A s:n=0\n  ref box\n  fx box.current = n\n  p "x"\n');
  assert.deepEqual(deps(out), ['n']);
});

test('a memo value becomes a dep of the hooks after it, not before', () => {
  const out = jsx('C A s:n=0\n  fx log(even)\n  memo even = n % 2\n  fx log(even)\n  p "x"\n');
  assert.deepEqual(deps(out), ['', 'even']);
});

test('a cb is a dep of an fx that calls it', () => {
  const out = jsx('C A s:n=0\n  cb tick() = n++\n  fx tick()\n  p "x"\n');
  assert.deepEqual(deps(out), ['tick']);
  assert.deepEqual(memoDeps(out), ['n']);
});

test('a ctx value is reactive', () => {
  const out = jsx('i C ./C\nC A\n  ctx theme = C\n  fx log(theme)\n  p "x"\n');
  assert.deepEqual(deps(out), ['theme']);
});

test('useState through `use` contributes the value, not the setter', () => {
  const out = jsx('C A\n  use [v, setV] = useState(0)\n  fx log(v, setV)\n  p "x"\n');
  assert.deepEqual(deps(out), ['v']);
});

test('useReducer through `use` contributes the state only', () => {
  const out = jsx('C A\n  use [log, dispatch] = useReducer(r, [])\n  fx dispatch(log)\n  p "x"\n');
  assert.deepEqual(deps(out), ['log']);
});

test('any other `use` value is reactive, destructured or not', () => {
  const out = jsx('i useFetch ./useFetch\nC A p:url\n  use { data, error } = useFetch(url)\n  fx log(data, error)\n  p "x"\n');
  assert.deepEqual(deps(out), ['data, error']);
});

test('store values read through `use` are deps', () => {
  const out = jsx('C A\n  use { items, add } = Cart\n  fx log(items.length)\n  memo n = items.length\n  p "x"\n',
    { stores: new Map([['Cart', 'Cart']]) });
  assert.deepEqual(deps(out), ['items']);
  assert.deepEqual(memoDeps(out), ['items']);
});

test('an explicit list wins, even when it names nothing in the body', () => {
  const out = jsx('C A p:a p:b\n  fx[b] log(a)\n  p "x"\n');
  assert.deepEqual(deps(out), ['b']);
});

test('an explicit empty list is `[]`', () => {
  assert.deepEqual(deps(jsx('C A p:a\n  fx[] log(a)\n  p "x"\n')), ['']);
});

test('`*` leaves the array off entirely', () => {
  const out = jsx('C A p:a\n  fx* log(a)\n  p "x"\n');
  assert.deepEqual(deps(out), []);
  assert.match(out, /log\(a\);\n\s*\}\);/);
});

test('memo and cb take the same suffixes', () => {
  assert.deepEqual(memoDeps(jsx('C A p:a\n  memo! x = a\n  p "{x}"\n')), ['']);
  assert.deepEqual(memoDeps(jsx('C A p:a p:b\n  cb[b] f() = log(a)\n  button @click=f "x"\n')), ['b']);
  assert.match(jsx('C A p:a\n  memo* x = a\n  p "{x}"\n'), /useMemo\(\(\) => a\);/);
});

test('a prop default does not become a dep', () => {
  const out = jsx('C A p:step=1\n  fx log(step)\n  p "x"\n');
  assert.deepEqual(deps(out), ['step']);
});

test('a js line in the body declares a name that is not reactive', () => {
  const out = jsx('C A s:n=0\n  js const twice = n * 2\n  fx log(twice)\n  p "x"\n');
  assert.deepEqual(deps(out), ['']);
});

test('one hook can depend on several kinds of value at once', () => {
  const out = jsx(`i C ./C
C A p:url s:q=""
  ctx theme = C
  ref box
  memo key = q + url
  cb load() = fetch(url)
  fx log(theme, box.current, key, load, q, url)
  p "x"
`);
  assert.deepEqual(deps(out), ['url, q, theme, key, load']);
});

test('a store action memoises on the state it reads', () => {
  const out = jsx('S Cart s:items=[] s:tax=0\n  cb add(x) = items=[...items,x]\n  cb total() = items.length * tax\n');
  assert.deepEqual(memoDeps(out).slice(0, 2), ['items', 'items, tax']);
});

test('the store value memo lists state and every reactive declaration', () => {
  const out = jsx('S Cart s:items=[]\n  ref seen\n  memo n = items.length\n  cb add(x) = items=[...items,x]\n');
  assert.match(out, /const value = useMemo\(\(\) => \(\{ items, setItems, seen, n, add \}\), \[items, n, add\]\);/);
});
