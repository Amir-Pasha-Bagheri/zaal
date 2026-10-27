// The compiler's output, parsed by a real parser and rendered by real React. React warns about
// what it will not do — an attribute it drops, a missing key — and throws at what it cannot do;
// both are invisible to a hand-written harness, and both are failures here.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { available, parseJsx, renderZaal, cleanupReal } from './helpers/real-react.mjs';
import { projectDir, buildIn, exampleDir, cleanup } from './helpers/fixture.mjs';
import { compile } from '../zaal.mjs';

after(() => { cleanupReal(); cleanup(); });

const skip = available ? false : 'esbuild/react are devDependencies — run npm install';
const CORPUS = JSON.parse(readFileSync(new URL('./corpus.json', import.meta.url), 'utf8'));
const walk = (root, dir, out = []) => {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const next = `${dir}/${e.name}`;
    e.isDirectory() ? walk(root, next, out) : out.push(next);
  }
  return out;
};

test('every .jsx the example build writes parses as real JSX', { skip }, () => {
  const root = exampleDir();
  buildIn(root, 'jsx');
  const problems = walk(root, 'application/src')
    .filter(f => f.endsWith('.jsx'))
    .map(f => parseJsx(readFileSync(join(root, f), 'utf8'), f))
    .filter(Boolean);
  assert.deepEqual(problems, []);
});

test('every golden snapshot parses too', { skip }, () => {
  const dir = new URL('./golden/', import.meta.url).pathname;
  const problems = readdirSync(dir).filter(f => f.endsWith('.jsx.txt'))
    .map(f => parseJsx(readFileSync(join(dir, f), 'utf8'), f)).filter(Boolean);
  assert.deepEqual(problems, []);
});

test('the awkward corpus parses', { skip }, () => {
  const opts = { stores: new Map([['T', 'stores/T']]) };
  const problems = CORPUS
    .map((src, i) => parseJsx(compile(src, 'jsx', opts), `corpus[${i}]`))
    .filter(Boolean);
  assert.deepEqual(problems, []);
});

// --- rendering through React -------------------------------------------------------------

const clean = async (name, src, props, opts) => {
  const { html, warnings, threw } = await renderZaal(src, props, opts);
  assert.equal(threw, null, `${name} threw: ${threw}`);
  assert.deepEqual(warnings, [], `${name} warned`);
  return html;
};

test('attributes reach React under the names it accepts', { skip }, async () => {
  assert.equal(await clean('attrs', 'C A\n  label class="f" for="e" tabindex=0 "Email"\n'),
    '<label class="f" for="e" tabindex="0">Email</label>');
  assert.equal(await clean('input', 'C A\n  input readonly maxlength=5 value="x" @change=(() => {})\n'),
    '<input readOnly="" maxLength="5" value="x"/>');
  assert.equal(await clean('svg', 'C A\n  svg viewbox="0 0 4 4"\n    path d="M0 0" strokewidth=2\n'),
    '<svg viewBox="0 0 4 4"><path d="M0 0" stroke-width="2"></path></svg>');
});

test('a string style becomes the object React demands', { skip }, async () => {
  assert.equal(await clean('style', 'C A\n  div style="color: red; font-size: 12px" "x"\n'),
    '<div style="color:red;font-size:12px">x</div>');
});

test('text, entities and consecutive lines render as written', { skip }, async () => {
  assert.equal(await clean('entities', 'C A\n  p "Tom & Jerry < 2"\n'), '<p>Tom &amp; Jerry &lt; 2</p>');
  assert.equal(await clean('two lines', 'C A\n  p\n    "total:"\n    "5 items"\n'), '<p>total: 5 items</p>',
    'the esm backend spaces these the same way');
  assert.equal(await clean('escaped', 'C A\n  p "a \\{b\\} c"\n'), '<p>a {b} c</p>');
});

test('a map keys its items, so React does not warn', { skip }, async () => {
  assert.equal(await clean('keys', 'C A p:xs\n  ul\n    *xs as x k=x\n      li "{x}"\n', { xs: ['a', 'b'] }),
    '<ul><li>a</li><li>b</li></ul>');
  assert.equal(await clean('nested', 'C A p:rows\n  div\n    *rows as r k=r.id\n      ul\n        *r.cells as c k=c\n          li "{c}"\n',
    { rows: [{ id: 1, cells: ['x', 'y'] }] }), '<div><ul><li>x</li><li>y</li></ul></div>');
});

test('control flow, fragments and custom elements render', { skip }, async () => {
  assert.equal(await clean('chain', 'C A p:n\n  div\n    ?n > 1\n      b "big"\n    :?n == 1\n      i "one"\n    :\n      s "none"\n', { n: 1 }),
    '<div><i>one</i></div>');
  assert.equal(await clean('lone ?', 'C A p:total\n  div\n    ?total\n      b "{total}"\n', { total: 0 }),
    '<div></div>', 'a falsy number renders nothing, not a stray 0');
  assert.equal(await clean('fragment', 'C A\n  h1 "a"\n  p "b"\n'), '<h1>a</h1><p>b</p>');
  assert.equal(await clean('custom', 'js void 0\nC A\n  zal-badge.b text="hi"\n'),
    '<zal-badge class="b" text="hi"></zal-badge>');
});

// The oracle has to fail on what it is for, or it proves nothing.
test('React would catch these, and the harness surfaces it', { skip }, async () => {
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { createElement: h } = await import('react');
  const warned = el => {
    const out = [];
    const real = console.error;
    console.error = (...a) => out.push(a.map(String).join(' '));
    try { renderToStaticMarkup(el); } catch (e) { out.push(e.message); } finally { console.error = real; }
    return out.join(' ');
  };
  assert.match(warned(h('input', { readonly: true })), /Invalid DOM property/, 'the HTML spelling');
  assert.match(warned(h('div', { style: 'color: red' })), /expects a mapping from style properties/);
  assert.match(warned(h('ul', null, [h('li', null, 'a'), h('li', null, 'b')])), /unique "key" prop/);
});
