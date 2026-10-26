// Hook lines: fx, memo, cb, ref, ctx, use — bodies, cleanup and dependency inference.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../zaal.mjs';

const jsx = (src, opts) => compile(src, 'jsx', opts);

test('s: becomes useState, with the initial value and a setter', () => {
  const out = jsx('C A s:n=0 s:name="x" s:bare\n  p "{n}"\n');
  assert.match(out, /const \[n, setN\] = useState\(0\);/);
  assert.match(out, /const \[name, setName\] = useState\("x"\);/);
  assert.match(out, /const \[bare, setBare\] = useState\(null\);/);
});

test('p: props become destructured params, `=` a default', () => {
  const out = jsx('C A p:a p:b=1 p:c="s" p:d=[]\n  p "{a}"\n');
  assert.match(out, /function A\(\{ a, b = 1, c = "s", d = \[\] \}\)/);
});

test('fx: interpolates strings and infers deps from props and state', () => {
  const out = jsx('C A p:label s:n=0\n  fx document.title = "{label}: {n}"\n  p "x"\n');
  assert.match(out, /useEffect\(\(\) => \{\n\s*document\.title = `\$\{label\}: \$\{n\}`;\n\s*\}, \[label, n\]\);/);
});

test('fx! is mount-only, fx* has no array, fx[..] is exactly those', () => {
  const src = n => `C A p:a p:b s:n=0\n  ${n}\n  p "x"\n`;
  assert.match(jsx(src('fx! ping(a)')), /\}, \[\]\);/);
  assert.match(jsx(src('fx* ping(a)')), /ping\(a\);\n\s*\}\);/);
  assert.match(jsx(src('fx[a b] ping(n)')), /\}, \[a, b\]\);/);
  assert.match(jsx(src('fx[a, b] ping(n)')), /\}, \[a, b\]\);/);
});

test('fx with child lines, and `off` as the cleanup return', () => {
  const out = jsx(`C A s:n=0
  fx!
    const id = setInterval(tick, 1000)
    off clearInterval(id)
  p "x"
`);
  assert.match(out, /const id = setInterval\(tick, 1000\);/);
  assert.match(out, /return \(\) => clearInterval\(id\);/);
});

test('a property access is not a dependency, but a spread of a name is', () => {
  const out = jsx('C A p:user s:n=0\n  fx log(user.name)\n  p "x"\n');
  assert.match(out, /\}, \[user\]\);/);
  const spread = jsx('C A p:xs\n  fx log(...xs)\n  p "x"\n');
  assert.match(spread, /\}, \[xs\]\);/);
});

test('memo becomes useMemo on its own deps, and is itself a dep later', () => {
  const out = jsx('C A s:n=0\n  memo even = n % 2 == 0\n  memo label = even ? "even" : "odd"\n  p "{label}"\n');
  assert.match(out, /const even = useMemo\(\(\) => n % 2 == 0, \[n\]\);/);
  assert.match(out, /const label = useMemo\(\(\) => even \? "even" : "odd", \[even\]\);/);
});

test('cb becomes useCallback with its params and state setters', () => {
  const out = jsx('C A s:n=0\n  cb tick(by) = n+=by\n  button @click=tick(1) "x"\n');
  assert.match(out, /const tick = useCallback\(\(by\) => setN\(n \+ \(by\)\), \[n\]\);/);
});

test('cb with no params, and a multi-statement body', () => {
  const out = jsx('C A s:n=0 s:d=""\n  cb reset() = n=0;d=""\n  button @click=reset "x"\n');
  assert.match(out, /const reset = useCallback\(\(\) => \{ setN\(0\); setD\(""\) \}, \[\]\);/);
});

test('ref is stable and never a dependency', () => {
  const out = jsx('C A\n  ref box\n  ref count = 0\n  fx! box.current?.focus()\n  input ref=box\n');
  assert.match(out, /const box = useRef\(null\);/);
  assert.match(out, /const count = useRef\(0\);/);
  assert.match(out, /useEffect\(\(\) => \{\n\s*box\.current\?\.focus\(\);\n\s*\}, \[\]\);/);
  const auto = jsx('C A\n  ref box\n  fx box.current?.focus()\n  input ref=box\n');
  assert.match(auto, /\}, \[\]\);/, 'a ref is not reactive, so it is not inferred as a dep');
});

test('ctx reads a context, use is the escape hatch', () => {
  const out = jsx('i Ctx ./Ctx\nC A\n  ctx theme = Ctx\n  use [log, dispatch] = useReducer(reduce, [])\n  use id = useId()\n  p "{theme} {id} {log.length}"\n');
  assert.match(out, /const theme = useContext\(Ctx\);/);
  assert.match(out, /const \[log, dispatch\] = useReducer\(reduce, \[\]\);/);
  assert.match(out, /const id = useId\(\);/);
  assert.match(out, /import \{ useContext, useReducer, useId \} from 'react';/);
});

test('a hook value is a dependency of later hooks', () => {
  const out = jsx('C A\n  use id = useId()\n  fx log(id)\n  p "x"\n');
  assert.match(out, /\}, \[id\]\);/);
});

test('React hooks are imported on sight, custom ones are not', () => {
  const out = jsx('i useFetch ./useFetch\nC A\n  use data = useFetch("/x")\n  p "{data}"\n');
  assert.match(out, /import useFetch from '\.\/useFetch\.jsx';/);
  assert.doesNotMatch(out, /from 'react'/);
});

test('a js line inside a component is emitted verbatim in the body', () => {
  const out = jsx('C A\n  js const k = 2\n  p "{k}"\n');
  assert.match(out, /function A\(\) \{\n\s*const k = 2\n/);
});

test('hooks keep source order relative to each other', () => {
  const out = jsx('C A s:n=0\n  memo a = n\n  cb f() = log(a)\n  fx f()\n  p "x"\n');
  const body = out.slice(out.indexOf('function A'));
  const order = ['useState(0)', 'useMemo', 'useCallback', 'useEffect'].map(s => body.indexOf(s));
  assert.ok(order.every(i => i >= 0));
  assert.deepEqual(order, [...order].sort((x, y) => x - y));
});

test('`memo` on the C line wraps the component instead', () => {
  const out = jsx('C Row memo p:x\n  p "{x}"\n');
  assert.match(out, /const Row = memo\(function Row\(\{ x \}\) \{/);
  assert.match(out, /export default Row;/);
  assert.match(out, /import \{ memo \} from 'react';/);
});

test('`C X catch` is an error boundary class with error and reset in scope', () => {
  const out = jsx('C Oops catch p:title="broke"\n  %card\n    h2 "{title}"\n    p "{error.message}"\n    button @click=reset "try again"\n',
    { ui: { kit: { card: { el: 'section' } }, known: new Set(['card']) } });
  assert.match(out, /export default class Oops extends Component \{/);
  assert.match(out, /static getDerivedStateFromError\(error\) \{ return \{ error \}; \}/);
  assert.match(out, /const \{ children, title = "broke" \} = this\.props;/);
  assert.match(out, /const reset = \(\) => this\.setState\(\{ error: null \}\);/);
  assert.match(out, /if \(!error\) return children;/);
  assert.match(out, /import \{ Component \} from 'react';/);
});

test('Suspense, StrictMode and Link need no import line', () => {
  const out = jsx('C A\n  Suspense fallback={null}\n    Link to="/" "home"\n');
  assert.match(out, /import \{ Suspense \} from 'react';/);
  assert.match(out, /import \{ Link \} from '\.\/router\.jsx';/);
});

test('`i { startTransition } from react` folds into the react import', () => {
  const out = jsx('i { startTransition } from react\nC A s:n=0\n  button @click=startTransition(()=>n++) "x"\n');
  assert.match(out, /import \{ startTransition, useState \} from 'react';/);
  assert.equal(out.match(/from 'react'/g).length, 1);
});

/* ---------- more hook shapes ---------- */

test('an fx may have several statements and several off lines', () => {
  const out = jsx(`C A p:id
  fx[id]
    const a = open(id)
    const b = watch(id)
    off a.close()
    off b.stop()
  p "x"
`);
  assert.match(out, /const a = open\(id\);\n\s*const b = watch\(id\);/);
  assert.match(out, /return \(\) => \{ a\.close\(\); b\.stop\(\) \};/);
});

test('a statement containing a semicolon inside a string stays one statement', () => {
  const out = jsx('C A\n  fx! log("a; b; c")\n  p "x"\n');
  assert.match(out, /useEffect\(\(\) => \{\n\s*log\("a; b; c"\);\n\s*\}, \[\]\);/,
    'one statement, not three');
});

test('a for loop with semicolons survives as one statement', () => {
  const out = jsx('C A\n  fx! for (let i = 0; i < 3; i++) log(i)\n  p "x"\n');
  assert.match(out, /for \(let i = 0; i < 3; i\+\+\) log\(i\);/);
});

test('cb params may carry defaults and destructuring', () => {
  const out = jsx('C A s:n=0\n  cb step(by = 1) = n+=by\n  cb fromEvent({ target }) = n=target.value\n'
    + '  button @click=step() "x"\n');
  assert.match(out, /const step = useCallback\(\(by = 1\) => setN\(n \+ \(by\)\), \[n\]\);/);
  assert.match(out, /const fromEvent = useCallback\(\(\{ target \}\) => setN\(target\.value\), \[\]\);/);
});

test('a cb may call an earlier cb', () => {
  const out = jsx('C A s:n=0\n  cb inc() = n++\n  cb twice() = inc(); inc()\n  button @click=twice "x"\n');
  assert.match(out, /const twice = useCallback\(\(\) => \{ inc\(\); inc\(\) \}, \[inc\]\);/);
});

test('a ref initial value interpolates', () => {
  assert.match(jsx('C A p:label\n  ref name = "{label}-1"\n  p "x"\n'),
    /const name = useRef\(`\$\{label\}-1`\);/);
});

test('a `use` line may rename what it destructures', () => {
  const out = jsx('C A\n  use { items: todos, left: open } = Todos\n  p "{todos.length}{open}"\n',
    { stores: new Map([['Todos', 'Todos']]) });
  assert.match(out, /const \{ items: todos, left: open \} = useTodos\(\);/);
  assert.match(out, /\{todos\.length\}\{open\}/);
});

test('ctx may read a context a package exported', () => {
  const out = jsx('i { ThemeCtx } from some-ui\nC A\n  ctx t = ThemeCtx\n  p "{t.mode}"\n');
  assert.match(out, /import \{ ThemeCtx \} from 'some-ui';/);
  assert.match(out, /const t = useContext\(ThemeCtx\);/);
});

test('three effects with different suffixes in one component', () => {
  const out = jsx('C A p:a s:n=0\n  fx! mount()\n  fx[a] onA(a)\n  fx* always(n)\n  p "x"\n');
  assert.match(out, /mount\(\);\n\s*\}, \[\]\);/);
  assert.match(out, /onA\(a\);\n\s*\}, \[a\]\);/);
  assert.match(out, /always\(n\);\n\s*\}\);/);
});

test('a memo expression may hold an object or a ternary with braces', () => {
  const out = jsx('C A p:a s:n=0\n  memo style = { color: a ? "red" : "blue", width: n }\n  div style=style\n');
  assert.match(out, /const style = useMemo\(\(\) => \{ color: a \? "red" : "blue", width: n \}, \[a, n\]\);/);
});

test('hooks and js lines interleave in source order', () => {
  const out = jsx('C A s:n=0\n  js const base = 2\n  memo a = n * base\n  js const c = a + 1\n  cb f() = log(c)\n  p "x"\n');
  const body = out.slice(out.indexOf('function A'));
  const order = ['const base = 2', 'const a = useMemo', 'const c = a + 1', 'const f = useCallback']
    .map(x => body.indexOf(x));
  assert.ok(order.every(i => i >= 0), body);
  assert.deepEqual(order, [...order].sort((x, y) => x - y));
});

test('every React hook the body names is imported, once', () => {
  const out = jsx(`C A s:n=0
  use [v, setV] = useState(0)
  use id = useId()
  use deferred = useDeferredValue(n)
  use [pending, start] = useTransition()
  ref box
  memo m = n
  cb f() = log(m)
  fx f()
  p "{v}{id}{deferred}{pending}"
`);
  assert.equal((out.match(/from 'react'/g) || []).length, 1);
  for (const h of ['useState', 'useId', 'useDeferredValue', 'useTransition', 'useRef', 'useMemo',
    'useCallback', 'useEffect']) assert.ok(out.includes(h), h);
});

// A hook that hands nothing back still has to run on every render: `use <call>` with no binding.
test('`use <call>` runs a hook that binds nothing', () => {
  const out = jsx('C A p:x\n  use useLayoutEffect(() => {})\n  use useDebugValue(x)\n  p "y"\n');
  assert.match(out, /import \{ useLayoutEffect, useDebugValue \} from 'react';/);
  assert.match(out, /\n  useLayoutEffect\(\(\) => \{\}\);\n  useDebugValue\(x\);\n/);
});

test('`use` with neither a binding nor a call is reported', () => {
  assert.throws(() => jsx('C A\n  use thing\n  p "x"\n'), /use <name> = <expr>/);
});

// Interpolation is per string literal: a `{` in a *later* string must not swallow the text
// between them — `setStatus("live")` beside `setList({…})` used to become one template.
test('two string literals on one line stay two strings', () => {
  const out = jsx('C A s:s=""\n  cb go() = a("x"); b(() => { c() }); s="y"\n  p "{s}"\n');
  assert.match(out, /a\("x"\); b\(\(\) => \{ c\(\) \}\); setS\("y"\)/);
});

test('only the literal that holds braces becomes a template', () => {
  const out = jsx('C A p:n\n  cb go() = a("plain"); b("n is {n}")\n  p "x"\n');
  assert.match(out, /a\("plain"\); b\(`n is \$\{n\}`\)/);
});
