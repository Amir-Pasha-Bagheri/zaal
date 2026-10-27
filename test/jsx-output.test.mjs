// The deliverable is `application/*.jsx`, and nothing in the suite parsed it: `node --check`
// only reads the esm preview, so a duplicate binding or an unescaped `<` reached the output
// unseen. Every .jsx the compiler writes — for the example, the other apps, and a corpus of
// awkward sources — goes through a structural check here.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '../zaal.mjs';
import { projectDir, buildIn, exampleDir, cleanup } from './helpers/fixture.mjs';
import { checkJsx } from './helpers/jsx-check.mjs';

after(cleanup);

const walk = (root, dir, out = []) => {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const next = `${dir}/${e.name}`;
    e.isDirectory() ? walk(root, next, out) : out.push(next);
  }
  return out;
};

const checkTree = root => {
  const problems = [];
  for (const f of walk(root, 'application/src').filter(f => f.endsWith('.jsx'))) {
    problems.push(...checkJsx(readFileSync(join(root, f), 'utf8'), f));
  }
  return problems;
};

test('the example app writes structurally valid JSX', () => {
  const root = exampleDir();
  buildIn(root, 'jsx');
  assert.deepEqual(checkTree(root), []);
});

test('the checked-in deliverable is valid too', () => {
  const root = new URL('../example/', import.meta.url).pathname;
  const problems = [];
  for (const f of walk(root, 'application/src').filter(f => f.endsWith('.jsx'))) {
    problems.push(...checkJsx(readFileSync(join(root, f), 'utf8'), f));
  }
  assert.deepEqual(problems, []);
});

test('every golden snapshot of a jsx module is valid', () => {
  const dir = new URL('./golden/', import.meta.url).pathname;
  const problems = [];
  for (const f of readdirSync(dir).filter(f => f.endsWith('.jsx.txt'))) {
    problems.push(...checkJsx(readFileSync(join(dir, f), 'utf8'), f));
  }
  assert.deepEqual(problems, []);
});

// A corpus of the shapes that have gone wrong before, plus the ones most likely to: every
// one is compiled and checked rather than eyeballed.
const CORPUS = [
  'C A p:a p:b=1 s:n=0\n  div.card#main c="x" title="{a} items"\n    p "a & b <c> {n}"\n',
  'C A p:xs\n  ul\n    *xs as x k=x.id\n      li\n        ?x.on\n          b "{x.t}"\n        :\n          i "{x.t}"\n',
  'i P ./P\nC A p:xs\n  P title="t"\n    slot head\n      span "h"\n    *xs as x k=x\n      p "{x}"\n',
  'C A s:q=""\n  form @submit=go\n    input val=q @input=q=e.target.value ph="search"\n    button type="submit" disabled "go"\n',
  'C Oops catch p:title="broke"\n  section\n    h2 "{title}"\n    p "{error.message}"\n    button @click=reset "retry"\n',
  'S T persist s:items=[]\n  memo n = items.length\n  cb add(x) = items=[...items,x]\n',
  'C A p:style p:cls\n  div style="color: {style}; --x: 1px" c=cls\n    svg viewbox="0 0 2 2"\n      path d="M0 0" strokewidth=2\n',
  'js const Tag = "em"\nC A p:n\n  p\n    "count:"\n    "{n} of 10"\n',
  'i { motion } from framer-motion\nC A\n  motion.div.sheet animate={opacity:1}\n    p "x"\n',
  'C A p:rest\n  input ...rest tabindex=0 readonly\n',
  'C A p:a\n  {a}\n',
  'C A\n  my-widget.big text="x"\n',
];

test('a corpus of awkward sources compiles to valid JSX', () => {
  for (const [i, src] of CORPUS.entries()) {
    const out = compile(src, 'jsx', { stores: new Map([['T', 'stores/T']]) });
    assert.deepEqual(checkJsx(out, `corpus[${i}]`), [], `${src}\n${out}`);
  }
});

test('the same corpus is valid JavaScript through the esm backend', async () => {
  const { execFileSync } = await import('node:child_process');
  const { writeFileSync, mkdtempSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'zaal-esm-'));
  for (const [i, src] of CORPUS.entries()) {
    const file = join(dir, `c${i}.mjs`);
    writeFileSync(file, compile(src, 'esm', { stores: new Map([['T', 'stores/T']]) }));
    execFileSync(process.execPath, ['--check', file]);
  }
});

// The checker has to fail on what it is for, or it is decoration.
test('the checker catches the mistakes it exists for', () => {
  const bad = {
    'export default function A({ a, a = 1 }) { return <p>x</p>; }': /bound twice/,
    'const x = 1;\nconst x = 2;\n': /declared twice/,
    'export default function A() { return <p>a < b</p>; }': /bare `<`/,
    'export default function A() { return <p>{}</p>; }': /empty `\{\}`/,
    'export default function A() { return <div id="a" id="b">x</div>; }': /sets id twice/,
    'export default function A() { return <div><p>x</div>; }': /closes <p>/,
  };
  for (const [src, re] of Object.entries(bad)) assert.match(checkJsx(src).join('; '), re, src);
  assert.deepEqual(checkJsx('export default function A({n}) { return <p>{n < 2 ? "a" : "b"}</p>; }'), [],
    'a comparison inside an expression is not a bare `<`');
});

// The second oracle: the test React now refuses what real React only warns about, so a
// regression in attribute or event naming fails a test instead of a console nobody reads.
test('the strict harness refuses what React refuses', async () => {
  const { mount, createElement: h, reset } = await import('./helpers/tiny-react.mjs');
  const { installEnv } = await import('./helpers/env.mjs');
  const render = el => { reset(); installEnv({}); return mount(el); };
  const refuses = (el, re) => assert.throws(() => render(el), re);

  refuses(h('div', { style: 'color: red' }, 'x'), /React wants an object, not a string/);
  refuses(h('input', { onKeyup: () => {} }), /React has no such event/);
  refuses(h('div', { class: 'card' }, 'x'), /React spells it className/);
  refuses(h('input', { tabindex: 0 }), /React spells it tabIndex/);

  assert.doesNotThrow(() => render(h('div', { className: 'card', style: { color: 'red' } }, 'x')));
  assert.doesNotThrow(() => render(h('input', { onKeyUp: () => {}, tabIndex: 0 })));
  assert.doesNotThrow(() => render(h('zal-badge', { text: 'x', tabindex: 0 })), 'custom elements');
  assert.doesNotThrow(() => render(h('div', { 'data-x': 1, 'aria-label': 'y' }, 'z')));
});
