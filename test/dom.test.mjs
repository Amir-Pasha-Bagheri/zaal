// The compiler's output under the real client renderer, in a real DOM. This is where React's
// development checks live — invalid nesting, a controlled field without a handler, a bad key —
// and where an effect, a ref and a cleanup actually run.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../zaal.mjs';
import { domAvailable, mountApp, cleanupDom } from './helpers/dom.mjs';

after(cleanupDom);
const skip = domAvailable ? false : 'jsdom is a devDependency — run npm install';

// Compile one component and mount it; `console` collects everything React complained about.
const mount = async (src, opts = {}) => mountApp({
  entry: 'App.jsx',
  files: { 'App.jsx': compile(src, 'jsx', opts.compile) },
  ...opts,
});

test('a component renders, updates and runs its effects', { skip }, async () => {
  const app = await mount(`C App p:label="Count" s:n=0
  fx document.title = "{label}: {n}"
  ref box
  fx! box.current?.focus()
  cb bump(by) = n+=by
  div
    h2 "{label}: {n}"
    button @click=bump(2) "+"
    input ref=box ph="focus me"
`);
  assert.match(app.text, /Count: 0/);
  assert.equal(app.window.document.title, 'Count: 0', 'the effect ran');
  assert.equal(app.window.document.activeElement, app.$('input'), 'the mount-only effect focused the ref');
  await app.click(app.byText('button', '+'));
  assert.match(app.text, /Count: 2/);
  assert.equal(app.window.document.title, 'Count: 2', 'and re-ran on the new state');
  assert.deepEqual(app.console, []);
  app.unmount();
});

test('a controlled input is controlled, and React does not complain', { skip }, async () => {
  const app = await mount(`C App s:q=""
  form
    input val=q @input=q=e.target.value ph="search"
    p "you typed: {q}"
`);
  await app.type(app.$('input'), 'pikachu');
  assert.equal(app.$('input').value, 'pikachu');
  assert.match(app.text, /you typed: pikachu/);
  assert.deepEqual(app.console, [], 'React accepts @input as the handler for a controlled field');
  app.unmount();
});

test('a keyed list reorders without a key warning', { skip }, async () => {
  const app = await mount(`C App s:xs=[{id:1,t:"a"},{id:2,t:"b"},{id:3,t:"c"}]
  div
    button @click=xs=[...xs].reverse() "flip"
    ul
      *xs as x k=x.id
        li "{x.t}"
`);
  assert.deepEqual(app.all('li').map(li => li.textContent), ['a', 'b', 'c']);
  await app.click(app.byText('button', 'flip'));
  assert.deepEqual(app.all('li').map(li => li.textContent), ['c', 'b', 'a']);
  assert.deepEqual(app.console, []);
  app.unmount();
});

// The checks that exist only on the client: proof the harness would catch them.
test('React\'s client-only warnings reach the console here', { skip }, async () => {
  const nested = await mount('C App\n  p\n    div "a block inside a paragraph"\n');
  assert.match(nested.console.join(' '), /cannot (be a descendant of|contain a nested)/i,
    'validateDOMNesting runs on the client and nowhere else');
  nested.unmount();

  const uncontrolled = await mountApp({
    entry: 'App.jsx',
    files: { 'App.jsx': 'export default function App() { return <input value="fixed" />; }' },
  });
  assert.match(uncontrolled.console.join(' '), /without an `onChange` handler/);
  uncontrolled.unmount();

  const unkeyed = await mountApp({
    entry: 'App.jsx',
    files: { 'App.jsx': 'export default function App() { return <ul>{["a","b"].map(x => <li>{x}</li>)}</ul>; }' },
  });
  assert.match(unkeyed.console.join(' '), /unique "key" prop/);
  unkeyed.unmount();
});

test('the markup the compiler writes nests legally', { skip }, async () => {
  const app = await mount(`C App p:rows=[{id:1,cells:["x","y"]}]
  main
    table
      tbody
        *rows as r k=r.id
          tr
            *r.cells as c k=c
              td "{c}"
    ul
      li
        a href="#/x" "link"
    form
      label
        span "name"
        input ph="n" @input=noop
`.replace('noop', '(() => {})'));
  assert.deepEqual(app.console, []);
  app.unmount();
});

// StrictMode renders everything twice and runs every effect twice; code that is not
// idempotent shows up here and nowhere else.
test('the output survives StrictMode double-rendering', { skip }, async () => {
  const app = await mount(`C App s:n=0 s:runs=0
  fx! setRuns(r => r + 1)
  cb bump() = n++
  div
    p "n={n}"
    button @click=bump "+"
`, { strict: true });
  await app.click(app.byText('button', '+'));
  assert.match(app.text, /n=1/, 'one click is one increment, twice-rendered or not');
  assert.deepEqual(app.console, []);
  app.unmount();
});

test('a store survives StrictMode, and its effects clean up', { skip }, async () => {
  const stores = new Map([['Count', 'Count']]);
  const files = {
    'Count.jsx': compile('S Count persist s:n=0\n  cb inc() = n++\n', 'jsx', { stores }),
    'App.jsx': compile('C App\n  use { n, inc } = Count\n  div\n    p "n={n}"\n    button @click=inc "+"\n',
      'jsx', { stores }).replace("from './Count.jsx'", "from './Count.jsx'"),
  };
  const app = await mountApp({
    entry: 'Wrap.jsx',
    files: {
      ...files,
      'Wrap.jsx': `import { CountProvider } from './Count.jsx';\nimport App from './App.jsx';\n`
        + `export default function Wrap() { return <CountProvider><App /></CountProvider>; }\n`,
    },
    strict: true,
  });
  await app.click(app.byText('button', '+'));
  assert.match(app.text, /n=1/);
  assert.deepEqual(app.console, []);
  assert.equal(app.window.localStorage.getItem('zaal:count'), '{"n":1}', 'persisted once, correctly');
  app.unmount();
});

// Scale, but running rather than compiling: the stress suite proves big sources compile, and
// this proves the result mounts, updates and stays quiet.
test('a five-hundred row keyed list mounts and updates in place', { skip }, async () => {
  const app = await mount(`C App s:rows=Array.from({length:500},(_, i) => ({id:i,t:"row "+i}))
  div
    button @click=rows=rows.map(r => r.id === 250 ? { ...r, t: "touched" } : r) "poke"
    ul
      *rows as r k=r.id
        li "{r.t}"
`);
  assert.equal(app.all('li').length, 500);
  const before = app.all('li')[250];
  await app.click(app.byText('button', 'poke'));
  assert.equal(app.all('li')[250].textContent, 'touched');
  assert.equal(app.all('li')[250], before, 'React reused the node — the keys are stable');
  assert.equal(app.all('li').length, 500);
  assert.deepEqual(app.console, []);
  app.unmount();
});

test('forty levels of nesting render', { skip }, async () => {
  let src = 'C App s:n=0\n  div\n';
  for (let i = 0; i < 40; i++) src += `${'  '.repeat(i + 2)}div.l${i}\n`;
  src += `${'  '.repeat(42)}button @click=n++ "deep {n}"\n`;
  const app = await mount(src);
  assert.match(app.text, /deep 0/);
  await app.click(app.$('button'));
  assert.match(app.text, /deep 1/);
  assert.equal(app.all('div.l39').length, 1);
  assert.deepEqual(app.console, []);
  app.unmount();
});

test('one store feeding a hundred consumers updates all of them', { skip }, async () => {
  const stores = new Map([['Tick', 'Tick']]);
  const kids = Array.from({ length: 100 }, (_, i) => `    Cell i=${i}`).join('\n');
  const app = await mountApp({
    entry: 'Wrap.jsx',
    files: {
      'Tick.jsx': compile('S Tick s:n=0\n  cb bump() = n++\n', 'jsx', { stores }),
      'Cell.jsx': compile('C Cell p:i\n  use { n } = Tick\n  span.cell "{i}:{n} "\n', 'jsx', { stores }),
      'App.jsx': compile(`i Cell ./Cell\nC App\n  use { bump } = Tick\n  div\n    button @click=bump "tick"\n${kids}\n`,
        'jsx', { stores }),
      'Wrap.jsx': `import { TickProvider } from './Tick.jsx';\nimport App from './App.jsx';\n`
        + `export default function Wrap() { return <TickProvider><App /></TickProvider>; }\n`,
    },
  });
  assert.equal(app.all('span.cell').length, 100);
  assert.equal(app.all('span.cell')[99].textContent.trim(), '99:0');
  await app.click(app.byText('button', 'tick'));
  assert.equal(app.all('span.cell')[0].textContent.trim(), '0:1');
  assert.equal(app.all('span.cell')[99].textContent.trim(), '99:1', 'every consumer saw it');
  assert.deepEqual(app.console, []);
  app.unmount();
});

test('an effect cleans up when its component goes away', { skip }, async () => {
  const app = await mount(`C App s:on=true
  div
    button @click=on=!on "toggle"
    ?on
      p "mounted"
`);
  assert.match(app.text, /mounted/);
  await app.click(app.byText('button', 'toggle'));
  assert.doesNotMatch(app.text, /mounted/);
  await app.click(app.byText('button', 'toggle'));
  assert.match(app.text, /mounted/, 'and comes back');
  assert.deepEqual(app.console, []);
  app.unmount();
});
