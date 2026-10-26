// `S Name` — context + provider + use<Name>(), persistence, and reading a store from a component.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../zal.mjs';

const stores = new Map([['Todos', 'stores/Todos'], ['Theme', 'stores/Theme']]);
const jsx = (src, opts = {}) => compile(src, 'jsx', { stores, ...opts });

const TODOS = `S Todos s:items=[]
  memo left = items.filter(t => !t.done).length
  cb add(text) = items=[...items,{id:1,text}]
  cb drop(id) = items=items.filter(t => t.id !== id)
`;

test('a store compiles to a context, a provider and a hook', () => {
  const out = jsx(TODOS);
  assert.match(out, /export const TodosContext = createContext\(null\);/);
  assert.match(out, /export function TodosProvider\(\{ children \}\) \{/);
  assert.match(out, /export function useTodos\(\) \{/);
  assert.match(out, /if \(!value\) throw new Error\('useTodos\(\) used outside <TodosProvider>'\);/);
  assert.match(out, /export default useTodos;/);
  assert.match(out, /<TodosContext\.Provider value=\{value\}>\{children\}<\/TodosContext\.Provider>/);
});

test('the context value is state, setters and every declared name', () => {
  const out = jsx(TODOS);
  assert.match(out, /const value = useMemo\(\(\) => \(\{ items, setItems, left, add, drop \}\), \[items, left, add, drop\]\);/);
});

test('store state assignment inside its own actions becomes a setter', () => {
  const out = jsx(TODOS);
  assert.match(out, /const add = useCallback\(\(text\) => setItems\(\[\.\.\.items,\{id:1,text\}\]\), \[items\]\);/);
});

test('persist seeds from localStorage and writes back on change', () => {
  const out = jsx('S Theme persist s:mode="light"\n  cb toggle() = mode = mode == "dark" ? "light" : "dark"\n');
  assert.match(out, /const KEY = "zal:theme";/);
  assert.match(out, /JSON\.parse\(localStorage\.getItem\(KEY\)\)/);
  assert.match(out, /useState\(saved\.mode \?\? "light"\)/);
  assert.match(out, /localStorage\.setItem\(KEY, JSON\.stringify\(\{ mode \}\)\)/);
});

test('persist=my:key overrides the storage key', () => {
  assert.match(jsx('S Theme persist=my:key s:mode="light"\n  cb t() = mode="dark"\n'), /const KEY = "my:key";/);
});

test('a store may run effects', () => {
  const out = jsx('S Theme s:mode="light"\n  fx document.documentElement.dataset.theme = mode\n');
  assert.match(out, /useEffect\(\(\) => \{\n\s*document\.documentElement\.dataset\.theme = mode;\n\s*\}, \[mode\]\);/);
});

test('`use { a } = Store` reads the store and imports its hook', () => {
  const out = jsx('C List s:draft=""\n  use { items, left, add } = Todos\n  p "{left} {items.length} {draft}"\n',
    { dir: 'components' });
  assert.match(out, /const \{ items, left, add \} = useTodos\(\);/);
  assert.match(out, /import \{ useTodos \} from '\.\.\/stores\/Todos\.jsx';/);
});

test('a store read from a nested directory resolves its path', () => {
  const out = compile('C A\n  use { items } = Todos\n  p "{items.length}"\n', 'esm', { stores, dir: 'a/b' });
  assert.match(out, /import \{ useTodos \} from '\.\.\/\.\.\/stores\/Todos\.js';/);
});

test('store values are read-only in a component', () => {
  assert.throws(() => jsx('C A\n  use { items } = Todos\n  button @click=items=[] "x"\n'),
    /items comes from a store/);
});

test('an unknown store name on a `use` line is an error', () => {
  assert.throws(() => jsx('C A\n  use { x } = Nope\n  p "{x}"\n'), /no store `S Nope`/);
});

test('markup in a store is an error', () => {
  assert.throws(() => jsx('S Bad s:n=0\n  p "markup"\n'), /a store has no markup/);
});

test('extra blocks in a file are named exports, the file-named one is the default', () => {
  const out = jsx('C Table\n  Row\nC Row\n  tr\n', { main: 'Table', comps: new Map() });
  assert.match(out, /export default function Table/);
  assert.match(out, /export function Row/);
});

/* ---------- more store shapes ---------- */

test('a store may have no state at all', () => {
  const out = jsx('S Facts\n  use { items } = Todos\n  memo count = items.length\n');
  assert.match(out, /const count = useMemo\(\(\) => items\.length, \[items\]\);/);
  assert.match(out, /const value = useMemo\(\(\) => \(\{ items, count \}\), \[items, count\]\);/);
  assert.doesNotMatch(out, /useState/);
});

test('ref, ctx and use values all join the context value', () => {
  const out = jsx('i Ctx ./Ctx\nS Mixed s:n=0\n  ref seen\n  ctx outer = Ctx\n  use id = useId()\n  memo d = n * 2\n');
  assert.match(out, /const value = useMemo\(\(\) => \(\{ n, setN, seen, outer, id, d \}\), \[n, outer, id, d\]\);/);
  assert.doesNotMatch(out, /\[n, seen/, 'a ref is not a dependency of the value');
});

test('persist writes every state field in one record', () => {
  const out = jsx('S Many persist s:a=1 s:b="x" s:c=[]\n  cb up() = a++\n');
  assert.match(out, /useState\(saved\.a \?\? 1\)/);
  assert.match(out, /useState\(saved\.b \?\? "x"\)/);
  assert.match(out, /useState\(saved\.c \?\? \[\]\)/);
  assert.match(out, /JSON\.stringify\(\{ a, b, c \}\)/);
  assert.match(out, /\}, \[a, b, c\]\);/);
});

test('a store may hold a js line', () => {
  const out = jsx('S Cfg s:on=false\n  js const LIMIT = 10\n  memo room = LIMIT - (on ? 1 : 0)\n');
  assert.match(out, /function CfgProvider\(\{ children \}\) \{\n\s*const \[on, setOn\] = useState\(false\);\n\s*const LIMIT = 10/);
});

test('a store reading two other stores imports both hooks', () => {
  const out = jsx('S Both s:n=0\n  use { items } = Todos\n  use { mode } = Theme\n  memo tag = "{mode}:{items.length}"\n',
    { dir: 'stores' });
  assert.match(out, /import \{ useTodos \} from '\.\/Todos\.jsx';/);
  assert.match(out, /import \{ useTheme \} from '\.\/Theme\.jsx';/);
  assert.match(out, /const tag = useMemo\(\(\) => `\$\{mode\}:\$\{items\.length\}`, \[items, mode\]\);/);
});

test('a store action may take several parameters', () => {
  const out = jsx('S Grid s:cells=[]\n  cb put(x, y, v) = cells=[...cells,{x,y,v}]\n');
  assert.match(out, /const put = useCallback\(\(x, y, v\) => setCells\(\[\.\.\.cells,\{x,y,v\}\]\), \[cells\]\);/);
});

test('explicit dep suffixes work inside a store', () => {
  const out = jsx('S Pin s:a=0 s:b=0\n  memo[a] sum = a + b\n  cb! reset() = a=0\n');
  assert.match(out, /const sum = useMemo\(\(\) => a \+ b, \[a\]\);/);
  assert.match(out, /const reset = useCallback\(\(\) => setA\(0\), \[\]\);/);
});

test('the store module exports its context, provider, hook and a default', () => {
  const out = jsx(TODOS);
  const names = ['export const TodosContext', 'export function TodosProvider',
    'export function useTodos', 'export default useTodos;'];
  for (const n of names) assert.ok(out.includes(n), n);
  assert.equal((out.match(/export default/g) || []).length, 1);
});

test('a store with extra blocks keeps one default export', () => {
  const out = jsx('S Todos s:items=[]\n  cb add(x) = items=[...items,x]\nC Row p:x\n  tr "{x}"\n',
    { main: 'Todos' });
  assert.match(out, /export default useTodos;/);
  assert.match(out, /export function Row/);
  assert.equal((out.match(/export default/g) || []).length, 1);
});

test('a component may read the same store twice without clashing', () => {
  const out = jsx('C A\n  use { items } = Todos\n  use { left } = Todos\n  p "{items.length}{left}"\n');
  assert.equal((out.match(/useTodos\(\)/g) || []).length, 2);
  assert.equal((out.match(/import \{ useTodos \}/g) || []).length, 1);
});
