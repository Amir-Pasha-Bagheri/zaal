// `H useName` — a custom hook block (ROADMAP F1). A hook is a `C` block with no markup and a
// value instead: the same `s:`, `memo`, `cb`, `fx`, `ref`, `ctx` and `use` lines, in a function
// a component can call. Before this, a shared hook could only be hand-written `js`.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '../zaal.mjs';
import { projectDir, buildIn, read, inspect, cleanup } from './helpers/fixture.mjs';
import { domAvailable, mountApp, cleanupDom } from './helpers/dom.mjs';
import { available, renderZaal, parseJsx, cleanupReal } from './helpers/real-react.mjs';
import { diffAvailable, differs, report, cleanupDiff } from './helpers/differential.mjs';

after(cleanup);
after(cleanupDom);
after(cleanupReal);
after(cleanupDiff);

const jsx = (src, opts) => compile(src, 'jsx', opts);
const err = (src, opts) => { try { jsx(src, opts); return null; } catch (e) { return e.message; } };

/* ---------- what it generates ---------- */

test('H becomes a function whose parameters are positional', () => {
  const out = jsx('H useCounter p:start=0 p:step\n  ret start + step\n', { main: 'useCounter' });
  assert.match(out, /export default function useCounter\(start = 0, step\) \{/);
  assert.match(out, /return start \+ step;/);
  assert.doesNotMatch(out, /\{ start/, 'a hook is called with arguments, not with a props object');
});

test('s: and the hook lines mean exactly what they mean in a C block', () => {
  const out = jsx('H useCounter p:by=1 s:n=0\n  cb inc() = n = n + by\n  memo doubled = n * 2\n'
    + '  fx document.title = "{n}"\n', { main: 'useCounter' });
  assert.match(out, /const \[n, setN\] = useState\(0\);/);
  assert.match(out, /const inc = useCallback\(\(\) => setN\(n \+ by\), \[by, n\]\);/);
  assert.match(out, /const doubled = useMemo\(\(\) => n \* 2, \[n\]\);/);
  assert.match(out, /useEffect\(\(\) => \{\n\s*document\.title = n;\n\s*\}, \[n\]\);/);
});

test('with no `ret` it hands back everything it declares, memoised like a store', () => {
  const out = jsx('H useCounter s:n=0\n  cb inc() = n = n + 1\n  memo big = n > 9\n', { main: 'useCounter' });
  assert.match(out, /const value = useMemo\(\(\) => \(\{ n, setN, inc, big \}\), \[n, inc, big\]\);/);
  assert.match(out, /return value;/);
});

test('`ret` says what it hands back instead', () => {
  assert.match(jsx('H useT s:n=0\n  ret [n, setN]\n', { main: 'useT' }), /return \[n, setN\];/);
  assert.match(jsx('H useT s:n=0\n  ret n > 2 ? "big" : "small"\n', { main: 'useT' }),
    /return n > 2 \? "big" : "small";/);
});

test('a `ret` may run over several lines, its continuations indented under it', () => {
  // Indentation is the nesting everywhere in Zaal, so the closing brace is a child line too.
  const out = jsx('H useT s:n=0\n  ret {\n    n,\n    half: n / 2,\n    }\n', { main: 'useT' });
  assert.match(out, /return \{\s*n,\s*half: n \/ 2,\s*\};/);
});

test('a hook that declares nothing is a void hook, with no return at all', () => {
  const out = jsx('H useTitle p:t\n  fx document.title = t\n', { main: 'useTitle' });
  assert.match(out, /export default function useTitle\(t\) \{/);
  assert.doesNotMatch(out, /return/, 'useDocumentTitle(t) is all side effect — nothing to hand back');
});

test('the block named after the file is the default export; others are named', () => {
  const src = 'H useA s:n=0\nH useB s:m=0\n';
  assert.match(jsx(src, { main: 'useA' }), /export default function useA/);
  assert.match(jsx(src, { main: 'useA' }), /^export function useB/m);
  assert.match(jsx(src, { main: 'useB' }), /export default function useB/);
});

test('a hook and the component that calls it can share a file', () => {
  const out = jsx('H useCounter s:n=0\n  cb inc() = n = n + 1\n'
    + 'C Panel\n  use { n, inc } = useCounter()\n  button @click={inc} "{n}"\n', { main: 'Panel' });
  assert.match(out, /export function useCounter\(\) \{/);
  assert.match(out, /export default function Panel\(\) \{/);
  assert.match(out, /const \{ n, inc \} = useCounter\(\);/);
  assert.equal(parseJsx(out), null, 'and the module is real JSX');
});

test('a hook may read a store, and the store import comes along', () => {
  const stores = new Map([['Theme', 'stores/Theme']]);
  const out = jsx('H usePalette\n  use { dark } = Theme\n  memo bg = dark ? "#000" : "#fff"\n',
    { main: 'usePalette', stores });
  assert.match(out, /import \{ useTheme \} from '\.\/stores\/Theme\.jsx';/);
  assert.match(out, /const \{ dark \} = useTheme\(\);/);
  // everything it declares, `dark` included — the same rule a store's context value follows
  assert.match(out, /const value = useMemo\(\(\) => \(\{ dark, bg \}\), \[dark, bg\]\);/);
});

/* ---------- what it refuses ---------- */

test('a hook\'s name has to look like a hook', () => {
  for (const bad of ['H counter', 'H usecounter', 'H Counter', 'H use']) {
    assert.match(err(bad + '\n  ret 1\n'), /has to start with `use` and a capital/, bad);
  }
  assert.equal(err('H useCounter\n  ret 1\n'), null);
});

test('`ret` is the last line, and there is only one', () => {
  assert.match(err('H useT s:n=0\n  ret n\n  fx ping()\n'),
    /`ret` is the last line of a hook \u2014 everything below it would never run/);
  assert.match(err('H useT s:n=0\n  ret n\n  ret 2\n'), /two `ret` lines/);
  assert.match(err('H useT\n  ret\n'), /`ret` with nothing to return/);
});

test('a hook has no markup, and a component has no `ret`', () => {
  assert.match(err('H useT\n  div "hi"\n'), /a hook has no markup \u2014 it hands a value back with `ret`/);
  assert.match(err('C A\n  ret 1\n', { main: 'A' }), /`ret` belongs in an `H` block \u2014 a `C` block returns its markup/);
  assert.match(err('C A\n  div\n    ret 1\n', { main: 'A' }), /`ret` belongs in an `H` block/);
  assert.match(err('S T\n  ret 1\n'), /`ret` belongs in an `H` block \u2014 a store hands back everything it declares/);
  assert.match(err('ret 1\n'), /`ret` belongs in an `H` block/);
});

test('an `H` line takes only p: and s:', () => {
  assert.match(err('H useT memo\n  ret 1\n'), /unknown `memo` \u2014 an `H` line takes p: and s:/);
  assert.match(err('H useT persist\n  ret 1\n'), /unknown `persist`/);
});

test('two blocks of one name in a file, and a name an import already took', () => {
  assert.match(err('H useT\n  ret 1\nH useT\n  ret 2\n'), /H useT is declared twice in this file/);
  assert.match(err('i useT ./other\nH useT\n  ret 1\n'),
    /useT is declared twice in this file \u2014 an `i` line and `H useT`/);
});

/* ---------- a called hook has to be in scope ---------- */

test('calling a hook with no `i` line is an error, not a ReferenceError in the browser', () => {
  const hooks = new Map([['useCounter', { file: 'hooks/useCounter', named: false }]]);
  assert.match(err('C A\n  use { n } = useCounter()\n  p "{n}"\n', { main: 'A', hooks }),
    /useCounter\(\) is not in scope \u2014 add `i useCounter \.\/hooks\/useCounter`/);
  // ...and the hint follows the import shape: a hook that is not its file's default export
  const named = new Map([['useCounter', { file: 'hooks/all', named: true }]]);
  assert.match(err('C A\n  use { n } = useCounter()\n  p "{n}"\n', { main: 'A', hooks: named }),
    /add `i \{ useCounter \} from \.\/hooks\/all`/);
  assert.match(err('C A\n  use { n } = useWhatever()\n  p "{n}"\n', { main: 'A' }),
    /no `H useWhatever` in zaal\/, and no `i` line for it/);
});

test('an `i` line, a `js` declaration or an H block in the file all satisfy it', () => {
  assert.equal(err('i useCounter ./useCounter\nC A\n  use { n } = useCounter()\n  p "{n}"\n', { main: 'A' }), null);
  assert.equal(err('js function useCounter() { return { n: 1 }; }\nC A\n  use { n } = useCounter()\n  p "{n}"\n',
    { main: 'A' }), null);
  assert.equal(err('H useCounter s:n=0\nC A\n  use { n } = useCounter()\n  p "{n}"\n', { main: 'A' }), null);
});

test('React\'s own hooks, the router\'s and a store\'s need no import', () => {
  assert.equal(err('C A\n  use [a, b] = useReducer(r, 0)\n  p "{a}"\n', { main: 'A' }), null);
  assert.equal(err('C A\n  use q = useQuery()\n  p "{q}"\n', { main: 'A' }), null);
  assert.equal(err('C A\n  use { dark } = useTheme()\n  p "{dark}"\n',
    { main: 'A', stores: new Map([['Theme', 'stores/Theme']]) }), null);
});

test('a property or a longer word is not mistaken for a hook call', () => {
  assert.equal(err('C A p:api\n  use x = api.useThing()\n  p "{x}"\n', { main: 'A' }), null);
  assert.equal(err('js const usedCount = 1;\nC A\n  p "{usedCount}"\n', { main: 'A' }), null);
});

/* ---------- across a project ---------- */

test('a build writes the hook module and the project knows where it is', () => {
  const root = projectDir({
    'zaal/app.zaal': 'A App\n  / Home\n',
    'zaal/hooks/useCounter.zaal': 'H useCounter p:start=0 s:n=start\n  cb inc() = n = n + 1\n',
    'zaal/Home.zaal': 'i useCounter ./hooks/useCounter\nC Home\n  use { n, inc } = useCounter(5)\n'
      + '  button @click={inc} "{n}"\n',
  });
  const out = buildIn(root);
  assert.ok(out.made.includes('src/hooks/useCounter.jsx'));
  assert.deepEqual([...out.hooks], [['useCounter', { file: 'hooks/useCounter', named: false }]]);
  assert.match(read(root, 'application/src/Home.jsx'), /import useCounter from '\.\/hooks\/useCounter\.jsx';/);
  assert.match(read(root, 'application/src/hooks/useCounter.jsx'), /export default function useCounter\(start = 0\)/);
  assert.deepEqual(inspect(root).hooks.get('useCounter'), { file: 'hooks/useCounter', named: false });
});

test('one hook name in two files is reported', () => {
  const root = projectDir({
    'zaal/app.zaal': 'A App\n',
    'zaal/a.zaal': 'H useT s:n=0\n',
    'zaal/b.zaal': 'H useT s:m=0\n',
  });
  assert.ok(buildIn(root).warnings.some(w => /H useT is declared in both a\.zaal and b\.zaal/.test(w)));
});

test('the esm preview compiles a hook the same way', () => {
  const src = 'H useCounter s:n=0\n  cb inc() = n = n + 1\n'
    + 'C Panel\n  use { n, inc } = useCounter()\n  button @click={inc} "{n}"\n';
  const out = compile(src, 'esm', { main: 'Panel' });
  assert.match(out, /export function useCounter\(\) \{/);
  assert.match(out, /const \{ n, inc \} = useCounter\(\);/);
  assert.doesNotMatch(out, /<button/, 'the preview backend writes createElement calls');
});

/* ---------- and it has to work in real React ---------- */

const SHARED = `H useCounter p:start=0 s:n=start
  cb inc() = n = n + 1
  memo label = "count " + n
C App
  use { n, inc, label } = useCounter(2)
  div
    p "{label}"
    button @click={inc} "+"
`;

test('real React renders a component driven by a hook block', { skip: available ? false : 'needs devDependencies' },
  async () => {
    const out = await renderZaal(SHARED, {}, { main: 'App' });
    assert.equal(out.threw, null);
    assert.match(out.html, /count 2/);
    assert.deepEqual(out.warnings, [], 'no rules-of-hooks or DOM complaint');
  });

test('the hook holds state across a click, in a real DOM',
  { skip: domAvailable ? false : 'jsdom is a devDependency — run npm install' }, async () => {
    const app = await mountApp({ entry: 'App.jsx', files: { 'App.jsx': jsx(SHARED, { main: 'App' }) } });
    assert.match(app.text, /count 2/);
    await app.click(app.byText('button', '+'));
    assert.match(app.text, /count 3/, 'the state lives in the hook and survives the re-render');
    await app.click(app.byText('button', '+'));
    assert.match(app.text, /count 4/);
    assert.deepEqual(app.console, []);
    app.unmount();
  });

test('two components calling one hook each hold their own state',
  { skip: domAvailable ? false : 'jsdom is a devDependency — run npm install' }, async () => {
    const src = `H useCounter s:n=0
  cb inc() = n = n + 1
C Row p:tag
  use { n, inc } = useCounter()
  button @click={inc} "{tag}:{n}"
C App
  div
    Row tag="a"
    Row tag="b"
`;
    const app = await mountApp({ entry: 'App.jsx', files: { 'App.jsx': jsx(src, { main: 'App' }) } });
    await app.click(app.byText('button', 'a:0'));
    assert.match(app.text, /a:1/);
    assert.match(app.text, /b:0/, 'a hook is state per call, not shared state — that is what `S` is for');
    app.unmount();
  });

/* ---------- every hook line, inside an H block ---------- */

test('all six hook heads mean in H what they mean in C', () => {
  const out = jsx(`H useAll p:src s:n=0
  ref box
  ctx theme = ThemeCtx
  memo twice = n * 2
  cb bump(by) = n = n + by
  use [state, dispatch] = useReducer(r, 0)
  use useDebugValue(n)
  fx ping(src)
`, { main: 'useAll', scope: ['ThemeCtx', 'r', 'ping'] });
  assert.match(out, /const box = useRef\(null\);/);
  assert.match(out, /const theme = useContext\(ThemeCtx\);/);
  assert.match(out, /const twice = useMemo\(\(\) => n \* 2, \[n\]\);/);
  assert.match(out, /const bump = useCallback\(\(by\) => setN\(n \+ by\), \[n\]\);/);
  assert.match(out, /const \[state, dispatch\] = useReducer\(r, 0\);/);
  assert.match(out, /useDebugValue\(n\);/);
  assert.match(out, /useEffect\(\(\) => \{\n\s*ping\(src\);\n\s*\}, \[src\]\);/);
});

test('the fx suffixes pin dependencies the same way', () => {
  const src = n => `H useX p:a p:b s:n=0\n  ${n}\n`;
  assert.match(jsx(src('fx! ping(a)'), { main: 'useX', scope: ['ping'] }), /\}, \[\]\);/);
  assert.match(jsx(src('fx* ping(a)'), { main: 'useX', scope: ['ping'] }), /ping\(a\);\n\s*\}\);/);
  assert.match(jsx(src('fx[a b] ping(n)'), { main: 'useX', scope: ['ping'] }), /\}, \[a, b\]\);/);
});

test('an fx in a hook may clean up after itself', () => {
  const out = jsx('H useTick\n  fx!\n    const id = setInterval(tick, 1000)\n    off clearInterval(id)\n',
    { main: 'useTick', scope: ['tick'] });
  assert.match(out, /return \(\) => clearInterval\(id\);/);
});

test('a `js` line inside a hook is emitted as written', () => {
  const out = jsx('H useX s:n=0\n  js const LIMIT = 10;\n  memo over = n > LIMIT\n', { main: 'useX' });
  assert.match(out, /const LIMIT = 10;/);
  assert.match(out, /const over = useMemo\(\(\) => n > LIMIT, \[n\]\);/);
});

test('a name declared twice inside a hook is caught, as in a C block', () => {
  assert.match(err('H useX s:n=0\n  memo n = 1\n'), /already|declared|same name|taken|pick another/i);
  assert.match(err('H useX p:a s:a=1\n'), /p:a and s:a are the same name/);
  assert.match(err('H useX s:n=0 s:N=1\n'), /both need `setN`/);
  assert.match(err('H useX p:setN s:n=0\n'), /p:setN is also the setter that s:n needs/);
  assert.match(err('H useX s:1bad=0\n'), /is not a name|has to be a name/i);
});

test('`value` is reserved only when the hook builds it', () => {
  assert.match(err('H useX s:value=1\n'), /`value` is what the hook hands back/);
  assert.match(err('H useX\n  memo value = 1\n'), /`value` is what the hook hands back/);
  assert.equal(err('H useX s:value=1\n  ret value\n'), null, 'with `ret` no `value` const is written');
});

test('a hook with no body at all is a no-op function, not a crash', () => {
  assert.equal(jsx('H useX\n', { main: 'useX' }), 'export default function useX() {\n}\n');
  assert.equal(jsx('H useX p:a\n', { main: 'useX' }), 'export default function useX(a) {\n}\n');
});

test('p: defaults survive whatever they are', () => {
  const out = jsx('H useX p:s="hi" p:n=1 p:a=[] p:o={} p:f=(x)=>x p:nil=null\n  ret s\n', { main: 'useX' });
  assert.match(out, /function useX\(s = "hi", n = 1, a = \[\], o = \{\}, f = \(x\)=>x, nil = null\)/);
});

test('names may hold any letter, and `$` and `_`', () => {
  assert.match(jsx('H useCafé p:prénom\n  ret prénom\n', { main: 'useCafé' }),
    /function useCafé\(prénom\)/u);
  // `use` + a capital is the rule, so the capital cannot be `$` or `_` — but either may follow
  assert.match(jsx('H useX$ p:_a s:$n=0\n  ret [$n, _a]\n', { main: 'useX$' }), /function useX\$\(_a\)/);
  assert.match(err('H use$X\n  ret 1\n'), /has to start with `use` and a capital/);
});

/* ---------- blocks beside each other ---------- */

test('H, S and C can share one file', () => {
  const out = jsx(`S Theme s:dark=false
H useBg
  use { dark } = Theme
  ret dark ? "#000" : "#fff"
C Page
  use bg = useBg()
  div style={{ background: bg }}
`, { main: 'Page', stores: new Map([['Theme', 'stores/Theme']]) });
  assert.match(out, /export const ThemeContext = createContext\(null\);/);
  assert.match(out, /export function useBg\(\)/);
  assert.match(out, /export default function Page\(\)/);
  assert.equal(parseJsx(out), null);
});

test('a hook may call a hook declared above it in the same file', () => {
  const out = jsx('H useA s:n=0\nH useB\n  use { n } = useA()\n  ret n * 2\n', { main: 'useB' });
  assert.match(out, /export function useA\(\)/);
  assert.match(out, /const \{ n \} = useA\(\);/);
  assert.match(out, /return n \* 2;/);
});

test('an H name a store already generates is a clash', () => {
  assert.match(err('S Theme s:dark=false\nH useTheme\n  ret 1\n', { main: 'Theme' }),
    /useTheme is declared twice in this file — `S Theme` and `H useTheme`/);
});

test('when no block matches the file, the first one is the default export', () => {
  const out = jsx('H useA s:n=0\nC B\n  div "b"\n', { main: 'nothing' });
  assert.match(out, /export default function useA\(\)/);
  assert.match(out, /^export function B\(\)/m);
});

/* ---------- the two backends are two spellings of one hook ---------- */

test('the esm backend writes the same hook, line for line', () => {
  const src = `H useAll p:src s:n=0
  ref box
  memo twice = n * 2
  cb bump(by) = n = n + by
  fx ping(src)
  ret { box, twice, bump }
`;
  const a = jsx(src, { main: 'useAll', scope: ['ping'] });
  const b = compile(src, 'esm', { main: 'useAll', scope: ['ping'] });
  // only the import line differs (the esm backend always pulls createElement in)
  const bodyOf = s => s.slice(s.indexOf('export default'));
  assert.equal(bodyOf(a), bodyOf(b), 'a hook has no markup, so there is nothing for them to differ on');
});

test('a hook-driven component renders identically through both backends',
  { skip: diffAvailable ? false : 'esbuild/react are devDependencies — run npm install' }, async () => {
    const sources = [
      'H useN s:n=3\n  memo big = n > 2\nC App\n  use { n, big } = useN()\n  p "{n} {big}"\n',
      'H useT p:a=1 p:b=2\n  ret a + b\nC App\n  use t = useT(4)\n  div "{t}"\n',
      'H useL\n  ret ["a", "b", "c"]\nC App\n  use xs = useL()\n  ul\n    *xs as x k=x\n      li "{x}"\n',
      'H useNull\n  ret null\nC App\n  use v = useNull()\n  div\n    ?v\n      span "yes"\n    :\n      span "no"\n',
      'H useVoid p:t\n  fx! noop(t)\nC App\n  use useVoid("x")\n  div "done"\n',
    ];
    for (const src of sources) {
      const d = await differs(src, {}, { main: 'App', scope: ['noop'] });
      assert.equal(d, null, d && report(d));
    }
  });

/* ---------- a called hook has to be in scope: the awkward positions ---------- */

test('a hook call is found wherever code can live', () => {
  const hooks = new Map([['useX', { file: 'useX', named: false }]]);
  const cases = [
    'C A\n  use v = useX()\n  p "{v}"\n',                       // a use line
    'C A\n  memo v = useX()\n  p "{v}"\n',                      // a memo line (illegal, but found)
    'C A s:n=0\n  js const z = useX();\n  p "{n}"\n',           // a js line
    'H useY\n  ret useX()\n',                                   // a ret line
    'C A\n  p "{useX().v}"\n',                                  // an interpolation
    'C A\n  div title={useX().v}\n',                            // an attribute
  ];
  for (const src of cases) {
    const out = err(src, { main: 'A', hooks: new Map() });
    assert.ok(out && /useX\(\)/.test(out), src);
    // ...and with the import it is satisfied, or complains about something else entirely
    const fixed = err('i useX ./useX\n' + src, { main: 'A' });
    assert.ok(fixed === null || !/is not in scope/.test(fixed), `${src} -> ${fixed}`);
  }
  assert.match(err(cases[0], { main: 'A', hooks }), /add `i useX \.\/useX`/);
});

test('a word that only looks like a hook call is left alone', () => {
  const ok = [
    'C A p:api\n  use v = api.useThing()\n  p "{v}"\n',          // a method
    'C A\n  p "call useThing() yourself"\n',                     // text, not code
    'C A\n  p "{usedThing}"\n',                                  // a longer word
    'C A p:useThing\n  use v = useThing()\n  p "{v}"\n',         // a prop holding one
    'C A\n  js function useThing() { return 1; }\n  p "x"\n',    // declared here
  ];
  for (const src of ok) assert.equal(err(src, { main: 'A' }), null, src);
});

test('a hook called where a hook may not run is the better complaint', () => {
  // checkHooks must not shadow the rules-of-hooks error the block compilers raise
  assert.match(err('i useX ./useX\nC A s:n=0\n  cb go() = useX()\n  p "{n}"\n', { main: 'A' }),
    /cannot run inside `cb`/);
  assert.match(err('i useX ./useX\nC A s:n=0\n  memo v = useX()\n  p "{n}"\n', { main: 'A' }),
    /cannot run inside `memo`/);
});

/* ---------- across a project ---------- */

const PROJECT = {
  'zaal/app.zaal': 'A App\n  / Home\n',
  'zaal/hooks/useCounter.zaal': 'H useCounter p:start=0 s:n=start\n  cb inc() = n = n + 1\n',
  'zaal/hooks/shared.zaal': 'H useOne\n  ret 1\nH useTwo\n  ret 2\n',
  'zaal/Home.zaal': 'i useCounter ./hooks/useCounter\nC Home\n  use { n, inc } = useCounter(5)\n'
    + '  button @click={inc} "{n}"\n',
};

test('the import hint follows the hook\'s own file and the importer\'s directory', () => {
  const root = projectDir({ ...PROJECT,
    'zaal/pages/Deep.zaal': 'C Deep\n  use { n } = useCounter()\n  p "{n}"\n',
    'zaal/app.zaal': 'A App\n  / Home\n  /deep Deep\n',
  });
  assert.throws(() => buildIn(root), /add `i useCounter \.\.\/hooks\/useCounter`/,
    'from pages/, the hook is one directory up');
  // a hook that is not its file's default export is a named import
  const named = projectDir({ ...PROJECT,
    'zaal/pages/Deep.zaal': 'C Deep\n  use v = useTwo()\n  p "{v}"\n',
    'zaal/app.zaal': 'A App\n  / Home\n  /deep Deep\n',
  });
  assert.throws(() => buildIn(named), /add `i \{ useTwo \} from \.\.\/hooks\/shared`/);
});

test('two hooks in one file: one is the default export, the other named', () => {
  const root = projectDir({ ...PROJECT,
    'zaal/pages/Deep.zaal': 'i { useOne, useTwo } from ../hooks/shared\nC Deep\n'
      + '  use a = useOne()\n  use b = useTwo()\n  p "{a}{b}"\n',
    'zaal/app.zaal': 'A App\n  / Home\n  /deep Deep\n',
  });
  const out = buildIn(root);
  assert.ok(out.made.includes('src/hooks/shared.jsx'));
  const mod = read(root, 'application/src/hooks/shared.jsx');
  // shared.zaal matches neither block, so the first one is the default export — and the import
  // hint has to say the same thing the module does.
  assert.match(mod, /export default function useOne\(\)/);
  assert.match(mod, /export function useTwo\(\)/);
  assert.deepEqual([...out.hooks.keys()].sort(), ['useCounter', 'useOne', 'useTwo']);
  assert.deepEqual(out.hooks.get('useOne'), { file: 'hooks/shared', named: false });
  assert.deepEqual(out.hooks.get('useTwo'), { file: 'hooks/shared', named: true });
});

test('a deleted hook source has its module swept', () => {
  const root = projectDir(PROJECT);
  buildIn(root);
  assert.ok(read(root, 'application/src/hooks/shared.jsx'));
  rmSync(join(root, 'zaal/hooks/shared.zaal'));
  const out = buildIn(root);
  assert.deepEqual(out.stale, ['src/hooks/shared.jsx']);
  assert.deepEqual([...out.hooks.keys()], ['useCounter']);
});

test('a hook in a subdirectory resolves its own imports relative to itself', () => {
  const root = projectDir({ ...PROJECT,
    'zaal/data/nums.zaal': 'js export const ONE = 1;\n',
    'zaal/hooks/useCounter.zaal': 'i { ONE } from ../data/nums\nH useCounter s:n=ONE\n',
  });
  buildIn(root);
  assert.match(read(root, 'application/src/hooks/useCounter.jsx'),
    /import \{ ONE \} from '\.\.\/data\/nums\.jsx';/);
});

test('the esm preview builds hooks into its tree too', () => {
  const root = projectDir(PROJECT);
  const out = buildIn(root, 'esm');
  assert.ok(out.made.includes('src/hooks/useCounter.js'));
  assert.match(read(root, '.zaal-dev/src/Home.js'), /import useCounter from '\.\/hooks\/useCounter\.js';/);
});

/* ---------- the output is real JavaScript, and real React runs it ---------- */

test('every hook shape the compiler can write parses as JSX', () => {
  const corpus = [
    'H useX\n',
    'H useX p:a p:b=1\n  ret a + b\n',
    'H useX s:n=0\n  cb inc() = n = n + 1\n',
    'H useX s:n=0\n  ret [n, setN]\n',
    'H useX\n  ref box\n  fx! box.current?.focus()\n',
    'H useX p:t\n  fx document.title = t\n',
    'H useX s:a=0 s:b=0\n  memo sum = a + b\n  ret { sum, setA, setB }\n',
    'H useX\n  ret {\n    a: 1,\n    b: 2,\n    }\n',
    'H useA s:n=0\nH useB\n  use { n } = useA()\n  ret n\n',
  ];
  for (const src of corpus) {
    const name = /H (use\w+)/.exec(src)[1];
    for (const t of ['jsx', 'esm']) {
      const out = compile(src, t, { main: name });
      if (t === 'jsx') assert.equal(parseJsx(out, src), null, src);
      assert.doesNotMatch(out, /\{\s*\}\s*;/, `empty block in ${src}`);
    }
  }
});

const REAL = { skip: available ? false : 'esbuild/react are devDependencies — run npm install' };

test('real React: a tuple return, a void hook and a hook calling a hook', REAL, async () => {
  const tuple = await renderZaal('H useN s:n=7\n  ret [n, setN]\nC App\n'
    + '  use [n] = useN()\n  p "n={n}"\n', {}, { main: 'App' });
  assert.equal(tuple.threw, null);
  assert.match(tuple.html, /n=7/);

  const voidHook = await renderZaal('H useNoop p:x\n  fx! String(x)\nC App\n'
    + '  use useNoop(1)\n  p "ran"\n', {}, { main: 'App' });
  assert.equal(voidHook.threw, null);
  assert.match(voidHook.html, /ran/);

  const chained = await renderZaal('H useBase\n  ret 10\nH useDouble\n  use b = useBase()\n'
    + '  ret b * 2\nC App\n  use d = useDouble()\n  p "{d}"\n', {}, { main: 'App' });
  assert.equal(chained.threw, null);
  assert.match(chained.html, /20/);
  for (const out of [tuple, voidHook, chained]) assert.deepEqual(out.warnings, []);
});

const DOM = { skip: domAvailable ? false : 'jsdom is a devDependency — run npm install' };
const mount = async (src, opts = {}) =>
  mountApp({ entry: 'App.jsx', files: { 'App.jsx': jsx(src, { main: 'App', ...opts.compile }) }, ...opts });

test('a hook\'s effect runs, re-runs on its deps and cleans up on unmount', DOM, async () => {
  const app = await mount(`H useTitle p:label s:n=0
  fx document.title = "{label}:{n}"
  cb bump() = n = n + 1
C App
  use { n, bump } = useTitle("count")
  button @click={bump} "n={n}"
`);
  assert.equal(app.window.document.title, 'count:0', 'the hook\'s effect ran');
  await app.click(app.byText('button', 'n=0'));
  assert.equal(app.window.document.title, 'count:1', 'and re-ran on the new state');
  assert.deepEqual(app.console, []);
  app.unmount();
});

test('a hook\'s cleanup runs when the component that called it goes away', DOM, async () => {
  const app = await mount(`H useBeacon
  fx!
    globalThis.__hookUp = (globalThis.__hookUp ?? 0) + 1
    off globalThis.__hookUp -= 1
C App
  use useBeacon()
  p "up"
`);
  assert.equal(app.window.document.body.textContent, 'up');
  // the bundle runs inside jsdom, so its `globalThis` is that window, not this process's
  assert.equal(app.window.__hookUp, 1, 'the mount effect inside the hook ran');
  app.unmount();
  assert.equal(app.window.__hookUp, 0, 'and its cleanup ran on unmount');
});

test('a component may call several hooks, and a hook beside a store', DOM, async () => {
  const app = await mount(`H useA s:a=1
  cb bumpA() = a = a + 1
H useB s:b=10
  cb bumpB() = b = b + 1
C App
  use { a, bumpA } = useA()
  use { b, bumpB } = useB()
  div
    button @click={bumpA} "a={a}"
    button @click={bumpB} "b={b}"
    p "sum={a + b}"
`);
  await app.click(app.byText('button', 'a=1'));
  assert.match(app.text, /a=2/);
  assert.match(app.text, /b=10/, 'the other hook is untouched');
  assert.match(app.text, /sum=12/);
  await app.click(app.byText('button', 'b=10'));
  assert.match(app.text, /sum=13/);
  assert.deepEqual(app.console, []);
  app.unmount();
});

test('a hook survives StrictMode\'s double render', DOM, async () => {
  const app = await mount(`H useN s:n=0
  cb inc() = n = n + 1
C App
  use { n, inc } = useN()
  button @click={inc} "n={n}"
`, { strict: true });
  await app.click(app.byText('button', 'n=0'));
  assert.match(app.text, /n=1/, 'one click is one increment, not two');
  assert.deepEqual(app.console, []);
  app.unmount();
});

test('many states in one hook, and a chain of hooks, both hold up', DOM, async () => {
  const states = Array.from({ length: 20 }, (_, i) => `s:v${i}=${i}`).join(' ');
  const app = await mount(`H useWide ${states}
  memo total = ${Array.from({ length: 20 }, (_, i) => `v${i}`).join(' + ')}
C App
  use { total, setV0 } = useWide()
  button @click=setV0(100) "total={total}"
`);
  assert.match(app.text, /total=190/);
  await app.click(app.byText('button', 'total=190'));
  assert.match(app.text, /total=290/);
  assert.deepEqual(app.console, []);
  app.unmount();
});
