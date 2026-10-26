// A second large app, shaped differently from test/complex.test.mjs: a shop with a catalog, a
// cart, a reducer, interpolated attributes, a shared js helper, a boundary around a lazy route
// and a timer with a cleanup. Compiled both ways, syntax-checked, then run.
import './helpers/loader.mjs';
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { projectDir, buildIn, read, runProject, cleanup } from './helpers/fixture.mjs';

after(cleanup);
beforeEach(() => { globalThis.__pkgCalls = []; });

const SHOP = {
  'zaal/app.zaal': `A Shop
  t "Zaal Shop"
  m #shop
  ui ./ui.zaal
  css ./styles/print.css
  pkg canvas-confetti@1.9.3
  store Cart
  / Catalog
  /p/:id Product
  /basket Basket
  /stats Stats lazy
`,
  'zaal/ui.zaal': `D Shop
t color
  bg #fff
  fg #111
  line #ddd
  accent #0a7
  bad #c33
t space
  1 .25rem
  2 .5rem
  4 1rem
t radius
  sm 4px
scheme dark
  color.bg #111
  color.fg #eee
e body
  m 0
  bg $color.bg
  fg $color.fg
k page main
  px $space.4
k grid div
  display grid
  gap $space.2
k card article
  border 1px solid $color.line
  radius $radius.sm
  p $space.2
  & h3
    m 0
k btn button
  p $space.1 $space.2
  radius $radius.sm
  v buy
    bg $color.accent
  v flat
    border none
k field label
  display block
k err p
  fg $color.bad
k row div
  display flex
  gap $space.2
k tag span
  fg $color.accent
`,
  'zaal/styles/print.css': '@media print { .btn { display: none } }\n',

  // a plain module of helpers, shared by components
  'zaal/lib/money.zaal': `js export const price = cents => "$" + (cents / 100).toFixed(2)
js export const sum = items => items.reduce((n, i) => n + i.cents * i.qty, 0)
`,

  'zaal/stores/Cart.zaal': `S Cart persist=shop:cart.v1 s:lines=[]
  memo count = lines.reduce((n, l) => n + l.qty, 0)
  memo cents = lines.reduce((n, l) => n + l.cents * l.qty, 0)
  cb add(item) = lines=lines.some(l => l.id === item.id) ? lines.map(l => l.id === item.id ? { ...l, qty: l.qty + 1 } : l) : [...lines, { ...item, qty: 1 }]
  cb drop(id) = lines=lines.filter(l => l.id !== id)
  cb clear() = lines=[]
`,

  'zaal/components/Price.zaal': `i { price } from ../lib/money
C Price memo p:cents p:label="price"
  %tag title="{label}: {cents} cents" "{price(cents)}"
`,
  'zaal/components/Tile.zaal': `i Price ./Price
C Tile p:item p:onAdd
  %card data-id=item.id aria-label="{item.name}"
    h3 "{item.name}"
    Price cents=item.cents
    ?item.stock == 0
      %err "sold out"
    :?item.stock < 3
      %err "only {item.stock} left"
    :
      %btn.buy @click=onAdd(item) "add"
`,
  'zaal/components/Shell.zaal': `C Shell p:title p:nav=null p:aside=null
  %page
    header
      h1 "{title}"
      ?nav
        {nav}
    %row
      div
        {children}
      ?aside
        aside
          {aside}
`,
  'zaal/components/Guard.zaal': `C Guard catch p:where="the page"
  %card
    h3 "{where} failed"
    p "{error.message}"
    button @click=reset "retry"
`,
  'zaal/components/Form.zaal': `i { createContext } from react
C Form p:onSubmit s:email="" s:errors=[]
  cb check(e) = e.preventDefault(); errors=email.includes("@") ? [] : ["bad email"]; onSubmit(email.includes("@") ? email : null)
  form @submit=check
    %field
      "Email"
      input val=email @input=email=e.target.value placeholder="you@example.com" ...rest
    *errors as msg k=msg
      %err "{msg}"
    %btn type="submit" "sign up"
`,
  'zaal/pages/Catalog.zaal': `i Tile ../components/Tile
i Shell ../components/Shell
i Guard ../components/Guard
i Form ../components/Form
i confetti canvas-confetti
C Catalog s:query="" s:signed=null
  use { add, count } = Cart
  js const ITEMS = [{id:"a",name:"Mug",cents:900,stock:5,cat:"home"},{id:"b",name:"Tee",cents:2500,stock:2,cat:"wear"},{id:"c",name:"Cap",cents:1800,stock:0,cat:"wear"}]
  memo shown = ITEMS.filter(i => !query || i.cat == query)
  cb buy(item) = add(item); confetti()
  cb signUp(email) = signed=email
  Shell title="Catalog ({count})"
    slot nav
      Link to="/basket" "basket"
      Link to="/stats" "stats"
    slot aside
      Form onSubmit=signUp
      ?signed
        p "thanks {signed}"
    %row
      %btn.flat @click=query="" "all"
      %btn.flat @click=query="wear" "wear"
      %btn.flat @click=query="home" "home"
    %grid
      *shown as item k=item.id
        Guard where="{item.name}"
          Tile item=item onAdd=buy
`,
  'zaal/pages/Product.zaal': `i Price ../components/Price
i Shell ../components/Shell
C Product p:id
  use { add } = Cart
  ref views
  fx[id]
    views.current = (views.current || 0) + 1
    off window.__left = id
  Shell title="Product {id}"
    Price cents=1000 label="each"
    %btn @click=add({id:id,name:id,cents:1000}) "add {id}"
`,
  'zaal/pages/Basket.zaal': `i { price, sum } from ../lib/money
i Shell ../components/Shell
C Basket
  use { lines, cents, drop, clear } = Cart
  js const reduce = (n, step) => n + step
  use [clicks, bumped] = useReducer(reduce, 0)
  Shell title="Basket"
    ?lines.length
      ul
        *lines as l k=l.id
          li
            span "{l.name} x{l.qty}"
            button @click=drop(l.id); bumped(1) "remove"
      p "total {price(cents)} after {clicks} removals"
      ?cents != sum(lines)
        %err "mismatch"
      button @click=clear "empty"
    :
      p "nothing in the basket"
`,
  'zaal/pages/Stats.zaal': `C Stats
  use { count, cents } = Cart
  p "{count} items worth {cents}"
`,
};

test('the shop compiles for both backends, with no warnings', () => {
  const root = projectDir(SHOP);
  const jsx = buildIn(root, 'jsx');
  assert.deepEqual(jsx.warnings, []);
  assert.equal(jsx.made.length, 11);
  assert.deepEqual(jsx.deps, ['canvas-confetti@^1.9.3']);
  const esm = buildIn(root, 'esm');
  for (const f of esm.made) {
    execFileSync(process.execPath, ['--check', join(root, '.zaal-dev', f.replace(/\.jsx$/, '.js'))], { stdio: 'pipe' });
  }
});

test('a `js`-only file is a plain module of exports', () => {
  const root = projectDir(SHOP);
  buildIn(root);
  const money = read(root, 'application/src/lib/money.jsx');
  assert.match(money, /export const price = cents => "\$" \+ \(cents \/ 100\)\.toFixed\(2\)/);
  assert.match(money, /export const sum = items =>/);
  assert.doesNotMatch(money, /function/, 'no component was invented for it');
  assert.match(read(root, 'application/src/components/Price.jsx'),
    /import \{ price \} from '\.\.\/lib\/money\.jsx';/);
});

test('interpolated attributes, data-* and aria-* all come out as expressions', () => {
  const root = projectDir(SHOP);
  buildIn(root);
  const tile = read(root, 'application/src/components/Tile.jsx');
  assert.match(tile, /<article className="card" data-id=\{item\.id\} aria-label=\{item\.name\}>/);
  const price = read(root, 'application/src/components/Price.jsx');
  assert.match(price, /title=\{`\$\{label\}: \$\{cents\} cents`\}/);
});

test('a `persist=` key may hold dots and colons', () => {
  const root = projectDir(SHOP);
  buildIn(root);
  assert.match(read(root, 'application/src/stores/Cart.jsx'), /const KEY = "shop:cart\.v1";/);
});

test('the lazy route is split and the rest are imported directly', () => {
  const root = projectDir(SHOP);
  buildIn(root);
  const main = read(root, 'application/src/main.jsx');
  assert.match(main, /const Stats = lazy\(\(\) => import\('\.\/pages\/Stats\.jsx'\)\);/);
  assert.match(main, /import Catalog from '\.\/pages\/Catalog\.jsx';/);
  assert.match(main, /import Basket from '\.\/pages\/Basket\.jsx';/);
  assert.match(main, /<CartProvider>/);
  assert.match(main, /<Suspense fallback=\{null\}>/);
});

test('the shop runs: catalog, filters, cart and totals', async () => {
  const { app: ui, env } = await runProject(projectDir(SHOP));
  assert.match(ui.html, /<h1>Catalog \(0\)<\/h1>/);
  assert.equal(ui.all(n => n.tag === 'article').length, 3);
  assert.match(ui.html, /<span class="tag" title="price: 900 cents">\$9\.00<\/span>/);
  assert.match(ui.html, /class="err">sold out<\/p>/, 'the first arm of the chain');
  assert.match(ui.html, /class="err">only 2 left<\/p>/, 'the middle arm');
  assert.equal(ui.all(n => n.tag === 'button' && n.text === 'add').length, 1, 'only the in-stock item');

  // filter by category: the memo recomputes
  ui.fire('wear');
  assert.equal(ui.all(n => n.tag === 'article').length, 2);
  ui.fire('home');
  assert.equal(ui.all(n => n.tag === 'article').length, 1);
  assert.match(ui.html, /Mug/);
  ui.fire('all');
  assert.equal(ui.all(n => n.tag === 'article').length, 3);

  // add the mug twice: the store merges the line and the counts follow
  ui.fire('add');
  assert.match(ui.html, /<h1>Catalog \(1\)<\/h1>/);
  ui.fire('add');
  assert.match(ui.html, /<h1>Catalog \(2\)<\/h1>/);
  assert.deepEqual(globalThis.__pkgCalls.map(c => c[0]), ['default', 'default']);
  assert.equal(env.saved('shop:cart.v1').lines.length, 1);
  assert.equal(env.saved('shop:cart.v1').lines[0].qty, 2);
});

test('the sign-up form validates, and the slot it lives in renders', async () => {
  const { app: ui } = await runProject(projectDir(SHOP));
  const email = () => ui.find(n => n.tag === 'input');
  ui.fire(email(), 'onInput', { target: { value: 'nope' } });
  ui.fire(ui.find(n => n.tag === 'form'), 'onSubmit');
  assert.match(ui.html, /class="err">bad email<\/p>/);
  assert.doesNotMatch(ui.html, /thanks/);
  ui.fire(email(), 'onInput', { target: { value: 'me@example.com' } });
  ui.fire(ui.find(n => n.tag === 'form'), 'onSubmit');
  assert.doesNotMatch(ui.html, /bad email/);
  assert.match(ui.html, /<p>thanks me@example\.com<\/p>/);
});

test('the basket page reads the cart, removes lines and keeps a reducer count', async () => {
  const root = projectDir(SHOP);
  const { app: ui, env } = await runProject(root);
  ui.fire('add');                                  // one Mug
  env.navigate('/basket');
  assert.match(ui.html, /<h1>Basket<\/h1>/);
  assert.match(ui.html, /<span>Mug x1<\/span>/);
  assert.match(ui.html, /total \$9\.00 after 0 removals/);
  assert.doesNotMatch(ui.html, /mismatch/, 'the store total agrees with the helper');
  ui.fire('remove');
  assert.match(ui.html, /<p>nothing in the basket<\/p>/);
  assert.equal(env.saved('shop:cart.v1').lines.length, 0);
});

test('a :param page runs its effect once per id and cleans up', async () => {
  const { app: ui, env } = await runProject(projectDir(SHOP), { hash: '#/p/mug' });
  assert.match(ui.html, /<h1>Product mug<\/h1>/);
  assert.match(ui.html, /title="each: 1000 cents"/);
  ui.fire('add mug');
  assert.equal(env.saved('shop:cart.v1').lines[0].name, 'mug');
  env.navigate('/p/cap');
  assert.match(ui.html, /<h1>Product cap<\/h1>/);
  assert.equal(globalThis.window.__left, 'mug', 'the previous effect was cleaned up with its id');
});

test('a boundary inside a map catches one item without losing the others', async () => {
  const broken = {
    ...SHOP,
    'zaal/components/Tile.zaal': `i Price ./Price
C Tile p:item p:onAdd
  js if (item.stock === 0) { throw new Error("no stock for " + item.name) }
  %card
    h3 "{item.name}"
    Price cents=item.cents
    %btn.buy @click=onAdd(item) "add"
`,
  };
  const { app: ui } = await runProject(projectDir(broken));
  assert.match(ui.html, /no stock for Cap/);
  assert.match(ui.html, /Cap failed/, 'the boundary got its interpolated prop');
  assert.match(ui.html, /<h3>Mug<\/h3>/, 'the siblings still rendered');
  assert.match(ui.html, /<h3>Tee<\/h3>/);
  assert.equal(ui.all(n => n.tag === 'button' && n.text === 'retry').length, 1);
});

test('the shop rebuilds byte-for-byte and sweeps a removed page', async () => {
  const root = projectDir(SHOP);
  buildIn(root);
  const before = read(root, 'application/src/pages/Catalog.jsx');
  buildIn(root);
  assert.equal(read(root, 'application/src/pages/Catalog.jsx'), before);
  const { rmSync, writeFileSync } = await import('node:fs');
  rmSync(join(root, 'zaal/pages/Stats.zaal'));
  writeFileSync(join(root, 'zaal/app.zaal'), SHOP['zaal/app.zaal'].replace('  /stats Stats lazy\n', ''));
  writeFileSync(join(root, 'zaal/pages/Catalog.zaal'),
    SHOP['zaal/pages/Catalog.zaal'].replace('      Link to="/stats" "stats"\n', ''));
  const out = buildIn(root);
  assert.deepEqual(out.stale, ['src/pages/Stats.jsx']);
  assert.doesNotMatch(read(root, 'application/src/main.jsx'), /Stats|lazy|Suspense/);
});
