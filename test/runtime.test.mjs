// Run what the compiler wrote. The esm backend's modules are imported against a tiny React
// (test/helpers/tiny-react.mjs), so these tests exercise the real generated code: hooks fire,
// stores persist, handlers mutate state, the router swaps pages.
import './helpers/loader.mjs';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { projectDir, exampleDir, runProject, buildIn, cleanup } from './helpers/fixture.mjs';
import { installEnv } from './helpers/env.mjs';

after(cleanup);
beforeEach(() => { globalThis.__pkgCalls = []; });

test('the example app renders its home page', async () => {
  const { app, env } = await runProject(exampleDir());
  assert.match(app.html, /<main class="page">/);
  assert.match(app.html, /Built with Zal — 0 open/);
  assert.match(app.html, /<h2>Clicks: 0<\/h2>/, 'the Counter got its label prop');
  assert.match(app.html, /<h2>Todo \(0\)<\/h2>/, 'the TodoList reads the Todos store');
  assert.match(app.html, /class="hint">nothing yet<\/p>/);
  assert.match(app.html, /class="hint">click \+<\/p>/);
  assert.equal(env.document.title, 'Clicks: 0', 'the fx effect ran');
  assert.match(app.html, /<a href="#\/" data-active="true">Home<\/a>/, 'Link marks the active route');
  assert.match(app.html, /<a href="#\/about">About<\/a>/);
});

test('Counter: state, step prop, effect and the package call', async () => {
  const { app, env } = await runProject(exampleDir());
  app.fire('+');
  assert.match(app.html, /<h2>Clicks: 2<\/h2>/, 'step=2 came through the cb');
  assert.match(app.html, /class="hint">keep going<\/p>/, 'the ?/: chain swapped branches');
  assert.equal(env.document.title, 'Clicks: 2', 'the title effect re-ran on the new state');
  assert.deepEqual(globalThis.__pkgCalls.map(c => c[0]), ['default'], 'confetti() was called');
  app.fire('+');
  assert.match(app.html, /Clicks: 4/);
  app.fire('-');
  assert.match(app.html, /Clicks: 2/);
  app.fire('-');
  app.fire('-');
  assert.match(app.html, /Clicks: -2<\/h2>/);
  assert.match(app.html, /class="hint">click \+<\/p>/);
});

test('TodoList: input, submit, the store action and the mapped list', async () => {
  const { app } = await runProject(exampleDir());
  const input = app.find(n => n.tag === 'input');
  assert.equal(input.props.value, '');
  assert.equal(input.props.placeholder, 'what next?');
  app.fire(input, 'onInput', { target: { value: 'buy milk' } });
  assert.match(app.find(n => n.tag === 'input').props.value, /buy milk/);
  app.fire(app.find(n => n.tag === 'form'), 'onSubmit');
  assert.match(app.html, /<li class="item"><span>buy milk<\/span>/);
  assert.match(app.html, /<h2>Todo \(1\)<\/h2>/, 'the store memo recomputed');
  assert.match(app.html, /Built with Zal — 1 open/, 'the page reads the same store');
  assert.equal(app.find(n => n.tag === 'input').props.value, '', 'the draft was cleared');
  assert.doesNotMatch(app.html, /nothing yet/);
});

test('Item: a component prop, a callback prop and removal', async () => {
  const { app } = await runProject(exampleDir());
  const add = text => {
    app.fire(app.find(n => n.tag === 'input'), 'onInput', { target: { value: text } });
    app.fire(app.find(n => n.tag === 'form'), 'onSubmit');
  };
  add('one');
  add('two');
  assert.equal(app.all(n => n.tag === 'li').length, 2, 'both Items rendered through the map');
  assert.match(app.html, /<span>one<\/span>[\s\S]*<span>two<\/span>/);
  assert.match(app.html, /Todo \(2\)/);
  assert.equal(app.all(n => n.tag === 'button' && n.text === 'x').length, 2,
    'each Item got its own onRemove button');

  // (the example's ids are Date.now(), so two todos added in the same millisecond share one —
  // remove from a single-item list to keep the assertion about the compiler, not about that)
  const { app: solo } = await runProject(exampleDir());
  solo.fire(solo.find(n => n.tag === 'input'), 'onInput', { target: { value: 'only' } });
  solo.fire(solo.find(n => n.tag === 'form'), 'onSubmit');
  assert.match(solo.html, /<span>only<\/span>/);
  solo.fire(solo.find(n => n.tag === 'button' && n.text === 'x'), 'onClick');
  assert.equal(solo.all(n => n.tag === 'li').length, 0, 'onRemove called the store action');
  assert.match(solo.html, /nothing yet/);
  assert.match(solo.html, /Todo \(0\)/);
});

test('the Todos store persists to localStorage and seeds back from it', async () => {
  const first = await runProject(exampleDir());
  first.app.fire(first.app.find(n => n.tag === 'input'), 'onInput', { target: { value: 'keep me' } });
  first.app.fire(first.app.find(n => n.tag === 'form'), 'onSubmit');
  assert.deepEqual(first.env.saved('zal:todos').items.map(t => t.text), ['keep me']);

  // A fresh load of the app, with that storage already in place: the store reads localStorage
  // when its module is evaluated, so the seed has to be there before the import.
  const root = exampleDir();
  buildIn(root, 'esm');
  const env = installEnv({ hash: '#/' });
  env.seed('zal:todos', { items: [{ id: 1, text: 'from storage' }] });
  const { mount, createElement } = await import('./helpers/tiny-react.mjs');
  const store = await import(`${root}/.zal-dev/src/stores/Todos.js`);
  const list = await import(`${root}/.zal-dev/src/components/TodoList.js`);
  const app = mount(createElement(store.TodosProvider, null, createElement(list.default, null)));
  assert.match(app.html, /<span>from storage<\/span>/);
  assert.match(app.html, /Todo \(1\)/);
});

test('the Theme store toggles, writes the data attribute and persists', async () => {
  const { app, env } = await runProject(exampleDir());
  assert.equal(env.document.documentElement.dataset.theme, 'light');
  assert.match(app.html, /☾/, 'the interpolated ternary in the button label');
  app.fire('☾');
  assert.equal(env.document.documentElement.dataset.theme, 'dark');
  assert.equal(env.saved('zal:theme').mode, 'dark');
  assert.match(app.html, /☀/);
  app.fire('☀');
  assert.equal(env.document.documentElement.dataset.theme, 'light');
});

test('the router renders the route for the hash, and navigation swaps pages', async () => {
  const { app, env } = await runProject(exampleDir(), { hash: '#/about' });
  assert.match(app.html, /Components live in \.zal files/);
  assert.match(app.html, /<a href="#\/about" data-active="true">About<\/a>/);
  assert.doesNotMatch(app.html, /Built with Zal/);
  env.navigate('/');
  assert.match(app.html, /Built with Zal/);
  assert.doesNotMatch(app.html, /Components live in/);
  env.navigate('/nope');
  assert.match(app.html, /<h1>404<\/h1>/, 'the `/* NotFound` catch-all rendered');
  assert.match(app.html, /no route for \/nope/);
});

test('Panel: {children} and a `slot` prop both render', async () => {
  const { app } = await runProject(exampleDir(), { hash: '#/about' });
  assert.match(app.html, /<section class="card"><h2>About<\/h2>/);
  assert.match(app.html, /<nav class="nav"><a href="#\/">back home<\/a><\/nav>/, 'the actions slot');
  assert.match(app.html, /renders whatever the caller nested/, 'the nested children');
  assert.match(app.html, /\{children\}/, 'escaped braces render as literal text');
});

/* ---------- features the example does not use ---------- */

const UI = 'D T\nk page main\n  p 0\nk card section\n  p 0\n';

test('an error boundary catches a child render error and reset recovers', async () => {
  const root = projectDir({
    'zal/app.zal': 'A Guard\n  ui ./ui.zal\n  / Home\n',
    'zal/ui.zal': UI,
    'zal/Boom.zal': 'C Boom p:bad\n  js if (bad) { throw new Error("kaboom") }\n  p "fine"\n',
    'zal/Oops.zal': 'C Oops catch p:title="Something broke"\n  %card\n    h2 "{title}"\n'
      + '    p "{error.message}"\n    button @click=reset "try again"\n',
    'zal/Home.zal': 'i Oops ./Oops\ni Boom ./Boom\nC Home s:bad=true\n  %page\n'
      + '    button @click=bad=false "fix"\n    Oops\n      Boom bad=bad\n',
  });
  const { app } = await runProject(root);
  assert.match(app.html, /<h2>Something broke<\/h2>/);
  assert.match(app.html, /<p>kaboom<\/p>/);
  app.fire('fix');                        // stop throwing, then let the boundary retry
  app.fire('try again');
  assert.match(app.html, /<p>fine<\/p>/);
  assert.doesNotMatch(app.html, /kaboom/);
});

test('a memo component, a lazy route and a rest-prop component all run', async () => {
  const root = projectDir({
    'zal/app.zal': 'A Mix\n  ui ./ui.zal\n  / Home\n  /heavy Heavy lazy\n',
    'zal/ui.zal': UI,
    'zal/Row.zal': 'C Row memo p:label\n  li "{label}"\n',
    'zal/Field.zal': 'C Field p:label\n  label\n    "{label}"\n    input ...rest\n',
    'zal/Heavy.zal': 'C Heavy\n  %page\n    h1 "heavy"\n',
    'zal/Home.zal': 'i Row ./Row\ni Field ./Field\nC Home s:rows=["a","b"]\n  %page\n'
      + '    ul\n      *rows as r k=r\n        Row label=r\n'
      + '    Field label="Name" placeholder="type" required\n',
  });
  const { app } = await runProject(root);
  assert.match(app.html, /<li>a<\/li><li>b<\/li>/);
  const input = app.find(n => n.tag === 'input');
  assert.equal(input.props.placeholder, 'type');
  assert.equal(input.props.required, true, 'a bare attribute became a boolean prop');
  assert.doesNotMatch(app.html, /heavy/, 'the lazy route is not rendered until visited');
});

test('a store reading another store, in the order app.zal pins', async () => {
  const root = projectDir({
    'zal/app.zal': 'A Chain\n  store Theme Prefs\n  / Home\n',
    'zal/stores/Theme.zal': 'S Theme s:mode="light"\n  cb toggle() = mode = mode == "dark" ? "light" : "dark"\n',
    'zal/stores/Prefs.zal': 'S Prefs s:size=1\n  use { mode } = Theme\n  memo summary = "{mode}@{size}"\n',
    'zal/Home.zal': 'C Home\n  use { summary } = Prefs\n  use { toggle } = Theme\n'
      + '  p "{summary}"\n  button @click=toggle "flip"\n',
  });
  const { app } = await runProject(root);
  assert.match(app.html, /<p>light@1<\/p>/);
  app.fire('flip');
  assert.match(app.html, /<p>dark@1<\/p>/, 'the outer store value flowed into the inner one');
});

test('an fx cleanup runs, and a ref survives re-renders', async () => {
  const root = projectDir({
    'zal/app.zal': 'A Fx\n  / Home\n',
    'zal/Home.zal': `C Home s:n=0
  ref seen
  fx!
    window.__mounted = (window.__mounted || 0) + 1
    off window.__torn = true
  fx[n] window.__runs = (window.__runs || 0) + 1
  cb bump() = seen.current = (seen.current || 0) + 1; n++
  p "{n}/{seen.current}"
  button @click=bump "tick"
`,
  });
  const { app } = await runProject(root);
  app.fire('tick');
  app.fire('tick');
  assert.match(app.html, /<p>2\/2<\/p>/, 'the ref survived both re-renders');
  assert.equal(globalThis.window.__mounted, 1, 'fx! ran once');
  assert.equal(globalThis.window.__runs, 3, 'fx[n] ran on mount and on each change');
  assert.ok(!globalThis.window.__torn, 'the cleanup has not run while mounted');
  const { reset } = await import('./helpers/tiny-react.mjs');
  reset();
  assert.ok(globalThis.window.__torn, '`off` became the effect teardown');
});
