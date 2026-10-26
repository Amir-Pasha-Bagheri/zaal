// More of the generated app, running: forms and events, `use` hooks, rest props, boundaries,
// cross-store writes, persistence corner cases and navigation from code.
import './helpers/loader.mjs';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { projectDir, buildIn, runProject, cleanup } from './helpers/fixture.mjs';
import { installEnv } from './helpers/env.mjs';
import { mount, createElement as h, reset } from './helpers/tiny-react.mjs';

after(cleanup);
beforeEach(() => { globalThis.__pkgCalls = []; });

const app = (files, opts) => runProject(projectDir({ 'zal/app.zal': 'A T\n  / Home\n', ...files }), opts);

test('a form with several fields: values, change events and submit', async () => {
  const { app: ui } = await app({
    'zal/Home.zal': `C Home s:name="" s:size="m" s:saved=null
  cb submit(e) = e.preventDefault(); saved="{name}/{size}"
  form @submit=submit
    input val=name @input=name=e.target.value placeholder="name"
    select val=size @change=size=e.target.value
      option value="s" "small"
      option value="m" "medium"
    button type="submit" "save"
    ?saved
      p "{saved}"
`,
  });
  const field = () => ui.find(n => n.tag === 'input');
  ui.fire(field(), 'onInput', { target: { value: 'ada' } });
  assert.equal(field().props.value, 'ada');
  ui.fire(ui.find(n => n.tag === 'select'), 'onChange', { target: { value: 's' } });
  assert.equal(ui.find(n => n.tag === 'select').props.value, 's');
  ui.fire(ui.find(n => n.tag === 'form'), 'onSubmit');
  assert.match(ui.html, /<p>ada\/s<\/p>/);
});

test('preventDefault is called on the event the handler receives', async () => {
  const { app: ui } = await app({
    'zal/Home.zal': 'C Home s:n=0\n  form @submit=e.preventDefault(); n++\n    button type="submit" "go"\n  p "{n}"\n',
  });
  let stopped = false;
  ui.fire(ui.find(n => n.tag === 'form'), 'onSubmit', { preventDefault: () => { stopped = true; } });
  assert.ok(stopped);
  assert.match(ui.html, /<p>1<\/p>/);
});

test('a keydown handler reads the event', async () => {
  const { app: ui } = await app({
    'zal/Home.zal': 'C Home s:last=""\n  input @key=last=e.key\n  p "{last}"\n',
  });
  ui.fire(ui.find(n => n.tag === 'input'), 'onKeyDown', { key: 'Enter' });
  assert.match(ui.html, /<p>Enter<\/p>/);
});

test('`use` with useState and useReducer run as themselves', async () => {
  const { app: ui } = await app({
    'zal/Home.zal': `js const reduce = (n, step) => n + step
C Home
  use [n, setN] = useState(1)
  use [total, add] = useReducer(reduce, 0)
  div
    button @click=setN(n*2) "double"
    button @click=add(n) "add"
    p "{n}/{total}"
`,
  });
  assert.match(ui.html, /<p>1\/0<\/p>/);
  ui.fire('double');
  assert.match(ui.html, /<p>2\/0<\/p>/);
  ui.fire('add');
  assert.match(ui.html, /<p>2\/2<\/p>/);
  ui.fire('add');
  assert.match(ui.html, /<p>2\/4<\/p>/);
});

test('rest props reach the DOM node they are spread onto', async () => {
  const { app: ui } = await app({
    'zal/Field.zal': 'C Field p:label\n  label\n    "{label}"\n    input ...rest\n',
    'zal/Home.zal': 'i Field ./Field\nC Home\n  Field label="Name" placeholder="type" maxLength=10 required\n',
  });
  const input = ui.find(n => n.tag === 'input');
  assert.equal(input.props.placeholder, 'type');
  assert.equal(input.props.maxLength, 10);
  assert.equal(input.props.required, true);
  assert.equal(input.props.label, undefined, 'the named prop was consumed, not forwarded');
  assert.match(ui.html, /<label>Name<input/);
});

test('a memo component still re-renders when its props change', async () => {
  const { app: ui } = await app({
    'zal/Row.zal': 'C Row memo p:label\n  li "{label}"\n',
    'zal/Home.zal': 'i Row ./Row\nC Home s:n=0\n  ul\n    Row label="n={n}"\n  button @click=n++ "+"\n',
  });
  assert.match(ui.html, /<li>n=0<\/li>/);
  ui.fire('+');
  assert.match(ui.html, /<li>n=1<\/li>/);
});

test('an error boundary recovers twice, and keeps its own props', async () => {
  const { app: ui } = await app({
    'zal/Boom.zal': 'C Boom p:bad\n  js if (bad) { throw new Error("bang " + bad) }\n  p "ok"\n',
    'zal/Guard.zal': 'C Guard catch p:title="caught"\n  div\n    h2 "{title}"\n    p "{error.message}"\n    button @click=reset "again"\n',
    'zal/Home.zal': `i Guard ./Guard
i Boom ./Boom
C Home s:n=1
  div
    button @click=n=0 "fix"
    button @click=n=n+1 "break"
    Guard title="oops"
      Boom bad=n
`,
  });
  assert.match(ui.html, /<h2>oops<\/h2>/);
  assert.match(ui.html, /<p>bang 1<\/p>/);
  ui.fire('fix');
  ui.fire('again');
  assert.match(ui.html, /<p>ok<\/p>/);
  ui.fire('break');          // throws again
  ui.fire('again');
  assert.match(ui.html, /<p>bang 1<\/p>/);
  ui.fire('fix');
  ui.fire('again');
  assert.match(ui.html, /<p>ok<\/p>/);
});

test('a component may call a store setter directly', async () => {
  const { app: ui, env } = await app({
    'zal/stores/Count.zal': 'S Count persist s:n=0\n  memo doubled = n * 2\n',
    'zal/Home.zal': 'C Home\n  use { n, setN, doubled } = Count\n  div\n'
      + '    button @click=setN(n+5) "bump"\n    p "{n}/{doubled}"\n',
  });
  assert.match(ui.html, /<p>0\/0<\/p>/);
  ui.fire('bump');
  assert.match(ui.html, /<p>5\/10<\/p>/);
  assert.equal(env.saved('zal:count').n, 5);
});

test('one store writes another store through its setter', async () => {
  const { app: ui } = await app({
    'zal/app.zal': 'A T\n  store Theme Prefs\n  / Home\n',
    'zal/stores/Theme.zal': 'S Theme s:mode="light"\n  cb toggle() = mode = mode == "dark" ? "light" : "dark"\n',
    'zal/stores/Prefs.zal': 'S Prefs s:density=1\n  use { mode, setMode } = Theme\n'
      + '  cb compact() = density=2; setMode("dark")\n',
    'zal/Home.zal': 'C Home\n  use { mode } = Theme\n  use { density, compact } = Prefs\n'
      + '  div\n    button @click=compact "compact"\n    p "{mode}/{density}"\n',
  });
  assert.match(ui.html, /<p>light\/1<\/p>/);
  ui.fire('compact');
  assert.match(ui.html, /<p>dark\/2<\/p>/);
});

test('a persisted store survives corrupt storage', async () => {
  const root = projectDir({
    'zal/app.zal': 'A T\n  / Home\n',
    'zal/stores/Count.zal': 'S Count persist s:n=7\n  cb up() = n++\n',
    'zal/Home.zal': 'C Home\n  use { n, up } = Count\n  div\n    button @click=up "+"\n    p "{n}"\n',
  });
  buildIn(root, 'esm');
  reset();
  const env = installEnv();
  env.window.localStorage.setItem('zal:count', '{not json');
  const store = await import(join(root, '.zal-dev/src/stores/Count.js'));
  const home = await import(join(root, '.zal-dev/src/Home.js'));
  const ui = mount(h(store.CountProvider, null, h(home.default, null)));
  assert.match(ui.html, /<p>7<\/p>/, 'the initial value is used when the saved value cannot be read');
  ui.fire('+');
  assert.equal(env.saved('zal:count').n, 8);
});

test('two persisted stores keep their own keys', async () => {
  const { app: ui, env } = await app({
    'zal/stores/A1.zal': 'S A1 persist s:a=1\n  cb up() = a++\n',
    'zal/stores/B1.zal': 'S B1 persist=my:b s:b=2\n  cb up() = b++\n',
    'zal/Home.zal': 'C Home\n  use { a, up } = A1\n  use { b, up: upB } = B1\n'
      + '  div\n    button @click=up "a"\n    button @click=upB "b"\n    p "{a}{b}"\n',
  });
  ui.fire('a');
  ui.fire('b');
  assert.match(ui.html, /<p>23<\/p>/);
  assert.equal(env.saved('zal:a1').a, 2);
  assert.equal(env.saved('my:b').b, 3);
  assert.equal(env.saved('zal:b1'), null);
});

test('an if-chain walks through every arm as state changes', async () => {
  const { app: ui } = await app({
    'zal/Home.zal': `C Home s:n=0
  div
    button @click=n++ "next"
    ?n == 0
      p "zero"
    :?n == 1
      p "one"
    :?n == 2
      p "two"
    :
      p "many"
`,
  });
  for (const word of ['zero', 'one', 'two', 'many']) {
    assert.match(ui.html, new RegExp(`<p>${word}</p>`), word);
    ui.fire('next');
  }
});

test('a lone `?` over a number renders nothing, not a stray 0', async () => {
  const { app: ui } = await app({
    'zal/Home.zal': 'C Home s:items=[]\n  div\n    ?items.length\n      p "some"\n',
  });
  assert.match(ui.html, /<div><\/div>/, 'the ternary skips the branch — React would render `0` for `&&`');
});

test('a nested table of rows and cells renders and updates in place', async () => {
  const { app: ui } = await app({
    'zal/Home.zal': `C Home s:rows=[{id:1,cells:[{id:1,v:"a"},{id:2,v:"b"}]},{id:2,cells:[{id:3,v:"c"}]}]
  div
    button @click=rows=[...rows,{id:3,cells:[{id:4,v:"d"}]}] "add row"
    table
      *rows as r k=r.id
        tr
          *r.cells as c k=c.id
            td "{c.v}"
`,
  });
  assert.equal(ui.all(n => n.tag === 'tr').length, 2);
  assert.equal(ui.all(n => n.tag === 'td').length, 3);
  ui.fire('add row');
  assert.equal(ui.all(n => n.tag === 'tr').length, 3);
  assert.match(ui.html, /<td>d<\/td>/);
});

test('slots pass markup through two levels', async () => {
  const { app: ui } = await app({
    'zal/Panel.zal': 'C Panel p:head=null\n  section\n    ?head\n      header\n        {head}\n    {children}\n',
    'zal/Home.zal': `i Panel ./Panel
C Home
  Panel
    slot head
      Panel
        slot head
          b "inner"
        p "inner body"
    p "outer body"
`,
  });
  assert.match(ui.html, /<header><section><header><b>inner<\/b><\/header><p>inner body<\/p><\/section><\/header>/);
  assert.match(ui.html, /<p>outer body<\/p>/);
});

test('go() from a cb navigates, and the route follows', async () => {
  const { app: ui, env } = await app({
    'zal/app.zal': 'A T\n  / Home\n  /done Done\n',
    'zal/Home.zal': 'C Home\n  cb finish() = go("/done")\n  button @click=finish "finish"\n',
    'zal/Done.zal': 'C Done\n  h1 "done"\n',
  });
  ui.fire('finish');
  assert.equal(env.window.location.hash, '/done');
  env.window.dispatch('hashchange');
  assert.match(ui.html, /<h1>done<\/h1>/);
});

test('useRoute on a `use` line tracks the path', async () => {
  const { app: ui, env } = await app({
    'zal/app.zal': 'A T\n  / Home\n  /x Home\n',
    'zal/Home.zal': 'C Home\n  use path = useRoute()\n  p "at {path}"\n',
  });
  assert.match(ui.html, /at \//);
  env.navigate('/x');
  assert.match(ui.html, /at \/x/);
});

test('text is escaped the way React escapes it', async () => {
  const { app: ui } = await app({
    'zal/Home.zal': 'C Home\n  p "a & b < c"\n',
  });
  assert.match(ui.html, /<p>a &amp; b &lt; c<\/p>/);
});

test('an effect with a cleanup re-runs when its deps change', async () => {
  const { app: ui } = await app({
    'zal/Home.zal': `C Home s:n=0
  fx[n]
    window.__started = (window.__started || 0) + 1
    off window.__stopped = (window.__stopped || 0) + 1
  button @click=n++ "tick"
`,
  });
  assert.equal(globalThis.window.__started, 1);
  assert.equal(globalThis.window.__stopped, undefined);
  ui.fire('tick');
  assert.equal(globalThis.window.__started, 2);
  assert.equal(globalThis.window.__stopped, 1, 'the previous effect was torn down first');
});

test('a ref holds a value across renders without causing one', async () => {
  const { app: ui } = await app({
    'zal/Home.zal': `C Home s:shown=0
  ref clicks
  cb hit() = clicks.current = (clicks.current || 0) + 1
  div
    button @click=hit "hit"
    button @click=shown=clicks.current "show"
    p "{shown}"
`,
  });
  ui.fire('hit');
  ui.fire('hit');
  assert.match(ui.html, /<p>0<\/p>/, 'writing a ref did not re-render');
  ui.fire('show');
  assert.match(ui.html, /<p>2<\/p>/);
});

test('a package default export is called with the arguments written', async () => {
  const { app: ui } = await app({
    'zal/Home.zal': 'i confetti canvas-confetti\nC Home\n  button @click=confetti({count: 3}) "pop"\n',
  });
  ui.fire('pop');
  assert.deepEqual(globalThis.__pkgCalls, [['default', [{ count: 3 }]]]);
});

test('a component with several root lines renders them all, in order', async () => {
  const { app: ui } = await app({
    'zal/Home.zal': 'C Home\n  h1 "one"\n  p "two"\n  footer "three"\n',
  });
  assert.match(ui.html, /^<h1>one<\/h1><p>two<\/p><footer>three<\/footer>$/);
});
