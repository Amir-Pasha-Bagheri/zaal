// `provide` (ROADMAP F4) — a context a component declares and fills itself. `S` was the only
// way to make one, and an `S` provider wraps the whole app from outside every component: it can
// never hand down a value that belongs to one *instance* of a component. That is what a
// compound component is — a <Tabs> telling its own panels which one is open — so until now it
// meant a hand-written `createContext` in a `js` line and a `<Ctx.Provider>` that markup could
// not say at all.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../zaal.mjs';
import { checkJsx } from './helpers/jsx-check.mjs';
import { projectDir, buildIn, read, cleanup } from './helpers/fixture.mjs';
import { domAvailable, mountApp, cleanupDom } from './helpers/dom.mjs';
import { available, parseJsx, cleanupReal } from './helpers/real-react.mjs';
import { diffAvailable, differs, report, cleanupDiff } from './helpers/differential.mjs';

after(cleanupDom);
after(cleanupReal);
after(cleanupDiff);
after(cleanup);

const jsx = (src, opts) => compile(src, 'jsx', opts);
const esm = (src, opts) => compile(src, 'esm', opts);
const err = (src, opts) => { try { jsx(src, opts); return null; } catch (e) { return e.message; } };

// The shape the feature exists for: one component hands its own descendants a value.
const TABS = 'C Tabs p:labels s:active=0\n  memo api = { active, setActive }\n'
  + '  provide Tabs = api\n    .tabs\n      *labels as l\n'
  + '        button @click=setActive(i) "{l}"\n      {children}\n';

/* ---------- what it generates ---------- */

test('provide writes the context and the hook that reads it', () => {
  const out = jsx(TABS, { main: 'Tabs' });
  assert.match(out, /export const TabsContext = createContext\(null\);/);
  assert.match(out, /export function useTabs\(\) \{\n\s*const value = useContext\(TabsContext\);/);
  assert.match(out, /throw new Error\('useTabs\(\) used outside a `provide Tabs`'\)/);
  assert.match(out, /<TabsContext\.Provider value=\{api\}>/);
  assert.deepEqual(checkJsx(out), []);
});

test('createContext and useContext are imported only where they are used', () => {
  assert.match(jsx(TABS, { main: 'Tabs' }), /import \{[^}]*createContext[^}]*\} from 'react';/);
  assert.doesNotMatch(jsx('C A\n  p "x"\n'), /createContext/);
});

test('the value is the expression as written — no provider memoises for you', () => {
  // A fresh object every render re-renders every consumer; `memo` is how a block says otherwise,
  // and it is already the line that infers its own dependencies. Hoisting a `useMemo` out of a
  // `provide` would also be a conditional hook the moment the line sits under a `?`.
  const out = jsx('C A s:n=0\n  provide Box = { n, setN }\n    {children}\n', { main: 'A' });
  assert.match(out, /<BoxContext\.Provider value=\{\{ n, setN \}\}>/);
  assert.doesNotMatch(out, /useMemo/);
});

test('the esm backend writes the same provider', () => {
  const out = esm('C A p:v\n  provide Box = v\n    p "x"\n', { main: 'A' });
  assert.match(out, /h\(BoxContext\.Provider, \{ value: v \}, h\("p", null, "x"\)\)/);
  assert.match(out, /export const BoxContext = createContext\(null\);/);
});

test('a quoted value interpolates, the way every other value does', () => {
  assert.match(jsx('C A p:name\n  provide Box = "hi {name}"\n    p "x"\n', { main: 'A' }),
    /value=\{`hi \$\{name\}`\}/);
  // an expression, the way a hook line's value is — so a plain string stays a string literal
  assert.match(jsx('C A\n  provide Box = "plain"\n    p "x"\n', { main: 'A' }), /value=\{"plain"\}/);
});

test('a provide at the root is the return value, with no fragment around it', () => {
  const out = jsx('C A p:v\n  provide Box = v\n    .inner "x"\n', { main: 'A' });
  assert.match(out, /return \(\n\s*<BoxContext\.Provider/);
  assert.doesNotMatch(out, /<>/);
  assert.match(esm('C A p:v\n  provide Box = v\n    .inner "x"\n', { main: 'A' }),
    /return h\(BoxContext\.Provider/);
});

test('a provide is ordinary markup: nested, among siblings, inside a branch', () => {
  const sib = jsx('C A p:v\n  h1 "t"\n  provide Box = v\n    p "x"\n  footer "f"\n', { main: 'A' });
  assert.match(sib, /<h1>t<\/h1>\n\s*<BoxContext\.Provider value=\{v\}>/);
  assert.deepEqual(checkJsx(sib), []);
  const branch = jsx('C A p:v p:on\n  ?on\n    provide Box = v\n      p "x"\n', { main: 'A' });
  assert.match(branch, /\{on \? \(\n\s*<BoxContext\.Provider/);
  assert.deepEqual(checkJsx(branch), []);
});

test('a provide in a map carries the key the `*` line gives it', () => {
  const src = 'C A p:rows\n  *rows as r k=r.id\n    provide Row = r\n      p "{r.t}"\n';
  assert.match(jsx(src, { main: 'A' }), /<RowContext\.Provider key=\{r\.id\} value=\{r\}>/);
  assert.match(esm(src, { main: 'A' }), /h\(RowContext\.Provider, \{ key: r\.id, value: r \}/);
  assert.deepEqual(checkJsx(jsx(src, { main: 'A' })), []);
});

test('one context per name, however many lines hand it out', () => {
  const out = jsx('C A p:v p:on\n  ?on\n    provide Box = v\n      p "y"\n  :\n'
    + '    provide Box = v\n      p "n"\n\nC B p:v\n  provide Box = v\n    p "b"\n', { main: 'A' });
  assert.equal(out.match(/createContext\(/g).length, 1);
  assert.equal(out.match(/export function useBox\(/g).length, 1);
  assert.equal(out.match(/<BoxContext\.Provider/g).length, 3);
  assert.deepEqual(checkJsx(out), []);
});

test('a component may provide more than one context, and nest them', () => {
  const out = jsx('C A p:a p:b\n  provide Outer = a\n    provide Inner = b\n      p "x"\n', { main: 'A' });
  assert.match(out, /<OuterContext\.Provider value=\{a\}>\n\s*<InnerContext\.Provider value=\{b\}>/);
  assert.deepEqual(checkJsx(out), []);
});

/* ---------- reading one ---------- */

test('a consumer in the same file reads it without importing itself', () => {
  const out = jsx(TABS + '\nC Panel p:index\n  use { active } = Tabs\n  ?active==index\n    {children}\n',
    { main: 'Tabs' });
  assert.match(out, /const \{ active \} = useTabs\(\);/);
  assert.doesNotMatch(out, /^import .*useTabs/m);
  assert.deepEqual(checkJsx(out), []);
});

test('a consumer in another file gets the import, pointed at the providing file', () => {
  const ctxs = new Map([['Tabs', 'components/Tabs']]);
  const out = jsx('C Panel p:index\n  use { active } = Tabs\n  ?active==index\n    {children}\n',
    { main: 'Panel', ctxs, dir: 'pages' });
  assert.match(out, /import \{ useTabs \} from '\.\.\/components\/Tabs\.jsx';/);
  assert.match(esm('C P\n  use { active } = Tabs\n  p "{active}"\n', { main: 'P', ctxs, dir: 'pages' }),
    /import \{ useTabs \} from '\.\.\/components\/Tabs\.js';/);
});

test('a provided value is read-only in a consumer, exactly as a store value is', () => {
  const src = 'C P\n  use { active, setActive } = Tabs\n  button @click=active=2 "go"\n';
  assert.match(err(src, { main: 'P', ctxs: new Map([['Tabs', 'Tabs']]) }),
    /active comes from a store — call one of its actions, or setActive\(…\)/);
});

test('an `H` block may read a context — a hook runs inside the component that calls it', () => {
  const out = jsx('H useTab\n  use { active } = Tabs\n  ret active\n',
    { main: 'useTab', ctxs: new Map([['Tabs', 'Tabs']]) });
  assert.match(out, /const \{ active \} = useTabs\(\);/);
  assert.match(out, /import \{ useTabs \} from '\.\/Tabs\.jsx';/);
});

test('`ctx name = SomeContext` still reads the context object directly', () => {
  // the exported `<Name>Context` is a real binding, so the older form reaches it too
  const out = jsx(TABS + '\nC Panel\n  ctx t = TabsContext\n  p "{t.active}"\n', { main: 'Tabs' });
  assert.match(out, /const t = useContext\(TabsContext\);/);
  assert.deepEqual(checkJsx(out), []);
});

/* ---------- what it reports ---------- */

test('a provide needs a name and a value', () => {
  assert.match(err('C A\n  provide\n    p "x"\n'), /provide: expected `provide <Name> = <value>`/);
  assert.match(err('C A\n  provide Box\n    p "x"\n'), /provide Box: expected `provide Box = <value>`/);
  assert.match(err('C A p:v\n  provide box = v\n    p "x"\n'),
    /provide box: a context's name has to start with a capital letter/);
});

test('a provide with nothing under it is an error', () => {
  assert.match(err('C A p:v\n  provide Box = v\n'), /provide Box has nothing under it/);
});

test('a slot under a provide is reported, not silently made a prop', () => {
  // the tag is `BoxContext.Provider`, which is capitalized, so the component test waves it by
  assert.match(err('C A p:v\n  provide Box = v\n    slot head\n      p "x"\n'),
    /slot head: `provide Box` passes one value, the one on its own line/);
});

test('a name a store already owns is declared twice', () => {
  assert.match(err('S Box s:n=0\n\nC A p:v\n  provide Box = v\n    p "x"\n', { main: 'Box' }),
    /BoxContext is declared twice in this file — `S Box` and `provide Box`/);
  assert.match(err('js const useBox = mine\nC A p:v\n  provide Box = v\n    p "x"\n', { main: 'A' }),
    /useBox is declared twice in this file/);
});

test('reading a name nothing provides names both ways of making one', () => {
  assert.match(err('C P\n  use { a } = Nope\n  p "{a}"\n', { main: 'P' }),
    /use …= Nope: no store `S Nope` and no `provide Nope` in this app/);
});

test('a store cannot read a context — its own provider is outside every component', () => {
  assert.match(err('S T s:n=0\n  use { a } = Box\n', { main: 'T', ctxs: new Map([['Box', 'Box']]) }),
    /a store's provider wraps the whole app from outside it — a store cannot read one/);
  // and it still reads another store the way it always did
  assert.match(jsx('S T s:n=0\n  use { a } = Other\n', { main: 'T', stores: new Map([['Other', 'Other']]) }),
    /const \{ a \} = useOther\(\);/);
});

test('a store and a hook block have no markup, so neither has a provide', () => {
  assert.match(err('S T s:n=0\n  provide Box = n\n    p "x"\n', { main: 'T' }), /a store has no markup/);
  assert.match(err('H useX\n  provide Box = 1\n    p "x"\n', { main: 'useX' }), /a hook has no markup/);
});

test('`provide` is a reserved head, so no element is named one', () => {
  // it reads as the line it is, and complains as that line — never as a `<provide>` element
  assert.match(err('C A\n  provide "text"\n'),
    /provide "text": a context's name has to start with a capital letter/);
  assert.match(err('C A\n  provide c="x"\n'), /a context's name has to start with a capital letter/);
});

test('two files providing one name is a clash, like two stores of one name', () => {
  const root = projectDir({
    'zaal/app.zaal': 'A Demo\n  / Home\n',
    'zaal/Home.zaal': 'C Home\n  p "x"\n',
    'zaal/One.zaal': 'C One p:v\n  provide Box = v\n    p "1"\n',
    'zaal/Two.zaal': 'C Two p:v\n  provide Box = v\n    p "2"\n',
  });
  const out = buildIn(root);
  assert.ok(out.warnings.some(w => /provide Box is in both One\.zaal and Two\.zaal/.test(w)),
    out.warnings.join('\n'));
});

/* ---------- the whole project ---------- */

test('a build resolves a context across files, and only the consumer imports it', () => {
  const root = projectDir({
    'zaal/app.zaal': 'A Demo\n  / Home\n',
    'zaal/Home.zaal': 'i Tabs ./components/Tabs\ni { Panel } from ./components/Tabs\n'
      + 'C Home\n  Tabs labels={["a","b"]}\n    Panel index=0\n      p "first"\n',
    'zaal/components/Tabs.zaal': TABS
      + '\nC Panel p:index\n  use { active } = Tabs\n  ?active==index\n    {children}\n',
  });
  buildIn(root);
  const tabs = read(root, 'application/src/components/Tabs.jsx');
  assert.match(tabs, /export const TabsContext = createContext\(null\);/);
  assert.doesNotMatch(tabs, /^import \{ useTabs \}/m, 'the file that declares it does not import it');
  assert.deepEqual(checkJsx(tabs), []);
  assert.deepEqual(checkJsx(read(root, 'application/src/Home.jsx')), []);
});

test('a consumer in a different directory gets a relative import that resolves', () => {
  const root = projectDir({
    'zaal/app.zaal': 'A Demo\n  / Home\n',
    'zaal/Home.zaal': 'i Shell ./components/Shell\ni Crumb ./pages/Crumb\n'
      + 'C Home\n  Shell\n    Crumb\n',
    'zaal/components/Shell.zaal': 'C Shell\n  provide Nav = { at: "home" }\n    {children}\n',
    'zaal/pages/Crumb.zaal': 'C Crumb\n  use { at } = Nav\n  span "{at}"\n',
  });
  buildIn(root);
  assert.match(read(root, 'application/src/pages/Crumb.jsx'),
    /import \{ useNav \} from '\.\.\/components\/Shell\.jsx';/);
});

/* ---------- the oracles ---------- */

test('every shape writes structurally valid JSX', () => {
  const srcs = [
    TABS,
    'C A p:v\n  provide Box = v\n    p "a < b"\n',
    'C A p:rows\n  *rows as r k=r.id\n    provide Row = r\n      p "{r.t}"\n',
    'C A p:v\n  provide Box = v\n    portal\n      p "away"\n',
    'C A p:v p:as\n  provide Box = v\n    {as} c="row"\n      {children}\n',
    'C A p:v\n  provide Box = v\n    provide Deep = v.x\n      p "nested"\n',
    'C A p:v\n  provide Box = {...v, extra: 1}\n    p "x"\n',
  ];
  for (const src of srcs) assert.deepEqual(checkJsx(jsx(src, { main: 'A' }), src), [], src);
});

const realSkip = available ? false : 'esbuild/react are devDependencies — run npm install';

test('the output parses as real JSX', { skip: realSkip }, () => {
  for (const src of [TABS, 'C A p:rows\n  *rows as r k=r.id\n    provide Row = r\n      p "{r.t}"\n']) {
    assert.equal(parseJsx(jsx(src, { main: 'A' }), src), null);
  }
});

const diffSkip = diffAvailable ? false : 'esbuild/react are devDependencies — run npm install';

test('both backends render a provider the same way', { skip: diffSkip }, async () => {
  const cases = [
    ['C A p:v\n  provide Box = v\n    p "x"\n', {}],
    ['C A p:rows\n  *rows as r k=r.id\n    provide Row = r\n      p "{r.t}"\n',
      { rows: [{ id: 1, t: 'a' }, { id: 2, t: 'b' }] }],
    ['C A p:on p:v\n  ?on\n    provide Box = v\n      p "y"\n  :\n    p "n"\n', { on: true }],
    ['C A p:v\n  h1 "t"\n  provide Box = v\n    p "x"\n  footer "f"\n', {}],
    ['C A p:v\n  provide Box = v\n    provide Deep = v\n      p "x"\n', {}],
  ];
  for (const [src, props] of cases) {
    const d = await differs(src, props, { main: 'A' });
    assert.equal(d, null, d && report(d));
  }
});

const domSkip = domAvailable ? false : 'jsdom is a devDependency — run npm install';

test('a compound component hands its own descendants the value', { skip: domSkip }, async () => {
  const app = await mountApp({
    entry: 'App.jsx',
    files: {
      'Tabs.jsx': compile('C Tabs p:labels s:active=0\n  memo api = { active, setActive }\n'
        + '  provide Tabs = api\n    .tabs\n      nav\n        *labels as l\n'
        + '          button.tab @click=setActive(i) "{l}"\n      {children}\n'
        + '\nC Panel p:index\n  use { active } = Tabs\n  ?active==index\n    .panel\n      {children}\n',
        'jsx', { main: 'Tabs' }),
      'App.jsx': compile('i Tabs ./Tabs\ni { Panel } from ./Tabs\n'
        + 'C App\n  Tabs labels={["one","two"]}\n'
        + '    Panel index=0\n      p "first body"\n'
        + '    Panel index=1\n      p "second body"\n', 'jsx', { main: 'App' }),
    },
  });
  assert.match(app.text, /first body/);
  assert.doesNotMatch(app.text, /second body/);
  await app.click(app.byText('button', 'two'));
  assert.match(app.text, /second body/, 'the panel re-rendered from the context');
  assert.doesNotMatch(app.text, /first body/);
  assert.deepEqual(app.console, []);
  app.unmount();
});

test('two instances each hand their own descendants their own value', { skip: domSkip }, async () => {
  // this is the whole point: an `S` provider is one for the app, a `provide` is one per instance
  const app = await mountApp({
    entry: 'App.jsx',
    files: {
      'Group.jsx': compile('C Group p:name s:n=0\n  provide Group = { name, n, setN }\n'
        + '    .group\n      {children}\n'
        + '\nC Bump\n  use { name, n, setN } = Group\n'
        + '  button.bump @click=setN(n + 1) "{name}:{n}"\n', 'jsx', { main: 'Group' }),
      'App.jsx': compile('i Group ./Group\ni { Bump } from ./Group\n'
        + 'C App\n  Group name="a"\n    Bump\n  Group name="b"\n    Bump\n', 'jsx', { main: 'App' }),
    },
  });
  assert.deepEqual(app.all('.bump').map(e => e.textContent), ['a:0', 'b:0']);
  await app.click(app.all('.bump')[0]);
  assert.deepEqual(app.all('.bump').map(e => e.textContent), ['a:1', 'b:0'],
    'each instance has its own context value');
  assert.deepEqual(app.console, []);
  app.unmount();
});

test('the nearest provider wins, and reading outside one throws by name', { skip: domSkip }, async () => {
  const app = await mountApp({
    entry: 'App.jsx',
    files: {
      'Box.jsx': compile('C Box p:v\n  provide Box = { v }\n    {children}\n'
        + '\nC Read\n  use { v } = Box\n  span.v "{v}"\n', 'jsx', { main: 'Box' }),
      'App.jsx': compile('i Box ./Box\ni { Read } from ./Box\n'
        + 'C App\n  Box v="outer"\n    Read\n    Box v="inner"\n      Read\n', 'jsx', { main: 'App' }),
    },
  });
  assert.deepEqual(app.all('.v').map(e => e.textContent), ['outer', 'inner']);
  assert.deepEqual(app.console, []);
  app.unmount();
});

test('reading a context with no provider above throws, naming the line to add', { skip: domSkip }, async () => {
  const app = await mountApp({
    entry: 'App.jsx',
    files: {
      'Box.jsx': compile('C Box p:v\n  provide Box = { v }\n    {children}\n'
        + '\nC Read\n  use { v } = Box\n  span.v "{v}"\n', 'jsx', { main: 'Box' }),
      // an error boundary, so the throw is caught where the test can read it
      'App.jsx': compile('i { Read } from ./Box\ni Oops ./Oops\n'
        + 'C App\n  Oops\n    Read\n', 'jsx', { main: 'App' }),
      'Oops.jsx': compile('C Oops catch\n  p.boom "{error.message}"\n', 'jsx', { main: 'Oops' }),
    },
  });
  assert.match(app.$('.boom').textContent, /useBox\(\) used outside a `provide Box`/);
  app.unmount();
});
