// Dynamic and polymorphic tags (ROADMAP F2): `{Tag}` as an element, and `as=` as the tag.
// Before this, a `{expr}` head with anything after it dropped the rest of the line without a
// word, and `as=section` compiled to `as={section}` — a ReferenceError in the browser. A
// wrapper that renders what it is told to render could only be hand-written JSX.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../zaal.mjs';
import { parseUI } from '../packages/react/src/ui.mjs';
import { checkJsx } from './helpers/jsx-check.mjs';
import { domAvailable, mountApp, cleanupDom } from './helpers/dom.mjs';
import { available, renderZaal, parseJsx, cleanupReal } from './helpers/real-react.mjs';
import { diffAvailable, differs, report, cleanupDiff } from './helpers/differential.mjs';

after(cleanupDom);
after(cleanupReal);
after(cleanupDiff);

const jsx = (src, opts) => compile(src, 'jsx', opts);
const esm = (src, opts) => compile(src, 'esm', opts);
const err = (src, opts) => { try { jsx(src, opts); return null; } catch (e) { return e.message; } };

const KIT = parseUI('D d\nk btn button\n  bg red\nk card\n  p 1rem\n');
const ui = { ui: KIT, used: new Set() };

/* ---------- `{Tag}` as an element ---------- */

test('a `{Tag}` head with attributes is the element, not an expression child', () => {
  const out = jsx('C A p:Tag\n  {Tag} c="row" "hi"\n');
  assert.match(out, /<Tag className="row">hi<\/Tag>/);
});

test('a `{Tag}` head with children under it is the element too', () => {
  const out = jsx('C A p:Tag\n  {Tag}\n    p "hi"\n');
  assert.match(out, /<Tag>\n\s*<p>hi<\/p>\n\s*<\/Tag>/);
});

test('a bare `{expr}` line is still an expression child', () => {
  const out = jsx('C Panel p:title\n  .card\n    h2 "{title}"\n    {children}\n');
  assert.match(out, /\{children\}/);
  assert.doesNotMatch(out, /createElement/);
  assert.match(out, /function Panel\(\{ title, children \}\)/);
});

test('a dotted dynamic tag is written as JSX names it', () => {
  const out = jsx('i icons ./icons\nC A\n  {icons.Star} size=16\n');
  assert.match(out, /<icons\.Star size=\{16\} \/>/);
});

test('an expression JSX cannot name goes through createElement, which is imported', () => {
  const out = jsx('C Box p:as="div"\n  {as} c="box"\n    {children}\n');
  assert.match(out, /import \{ createElement \} from 'react';/);
  assert.match(out, /createElement\(as, \{ "className": "box" \}, children\)/);
});

test('createElement is imported only where it is used', () => {
  assert.doesNotMatch(jsx('C A p:Tag\n  {Tag} "x"\n'), /createElement/);
  assert.doesNotMatch(jsx('C A\n  p "x"\n'), /createElement/);
});

test('a ternary, a call and an index are all tags', () => {
  const out = jsx('C A p:big p:name p:kinds\n  .card as={big ? "section" : "div"} "a"\n'
    + '  {kinds[name]} c="b"\n  {pick(name)} c="c"\n');
  assert.match(out, /createElement\(big \? "section" : "div", \{ "className": "card" \}, "a"\)/);
  assert.match(out, /createElement\(kinds\[name\], \{ "className": "b" \}\)/);
  assert.match(out, /createElement\(pick\(name\), \{ "className": "c" \}\)/);
});

test('the esm backend writes the expression where the tag goes', () => {
  const out = esm('C Box p:as="div"\n  {as} c="box"\n    {children}\n');
  assert.match(out, /h\(as, \{ "className": "box" \}, children\)/);
  assert.doesNotMatch(out, /h\("as"/, 'the tag is the value, not the string "as"');
});

test('a dynamic tag forwards a rest prop the way a static one does', () => {
  assert.match(jsx('C Box p:as="div"\n  {as} c="box" ...rest\n    {children}\n'),
    /createElement\(as, Object\.assign\(\{"className": "box"\}, rest\), children\)/);
  assert.match(jsx('C Box p:as="div"\n  {as} ...rest\n    {children}\n'),
    /createElement\(as, rest, children\)/);
});

test('an empty `{}` tag is a build error rather than an empty expression', () => {
  assert.match(err('C A\n  {} c="x"\n'), /`\{\}` is not a tag/);
});

test('a dynamic tag is an expression, so it is not resolved as a component', () => {
  assert.equal(err('C A p:Tag\n  {Tag} "x"\n'), null);
  // and a tag written out as a name still is
  assert.match(err('C A\n  Pannel "x"\n'), /<Pannel> is not in scope/);
});

/* ---------- `as=` ---------- */

test('as= on a DOM element is the tag, keeping the classes', () => {
  assert.match(jsx('C A\n  .card as=section "hi"\n'), /<section className="card">hi<\/section>/);
  assert.match(jsx('C A\n  .card as="section" "hi"\n'), /<section className="card">hi<\/section>/);
  assert.doesNotMatch(jsx('C A\n  .card as=section "hi"\n'), /as=/);
});

test('as= takes a component, which is then in scope on sight', () => {
  const out = jsx('C A\n  .nav as=Link to="/" "home"\n');
  assert.match(out, /<Link className="nav" to="\/">home<\/Link>/);
  assert.match(out, /import \{ Link \} from '\.\/router\.jsx';/);
  assert.match(err('C A\n  .nav as=Pannel "x"\n'), /<Pannel> is not in scope/);
});

test('as= on a kit entry replaces the kit tag and keeps the kit class', () => {
  const out = jsx('C A\n  %btn as=a href="/x" "go"\n', ui);
  assert.match(out, /<a className="btn" href="\/x">go<\/a>/);
  assert.match(jsx('C A\n  %btn.wide c="pad" as=a "go"\n', ui), /<a className="btn wide pad">/);
});

test('as={expr} is a dynamic tag', () => {
  assert.match(jsx('C A p:tag\n  .card as={tag} "hi"\n'),
    /createElement\(tag, \{ "className": "card" \}, "hi"\)/);
  assert.match(esm('C A p:tag\n  .card as={tag} "hi"\n'), /h\(tag, \{ "className": "card" \}, "hi"\)/);
});

test('as= stays an ordinary prop on a component, a member tag and a dynamic tag', () => {
  // styled-components, Radix and most of npm read `as` themselves — taking it would break them
  assert.match(jsx('i Btn ./Btn\nC A\n  Btn as="a" "x"\n'), /<Btn as="a">x<\/Btn>/);
  assert.match(jsx('i motion framer-motion\nC A\n  motion.div as="section" "x"\n'),
    /<motion\.div as="section">x<\/motion\.div>/);
  assert.match(jsx('C A p:Tag\n  {Tag} as="a" "x"\n'), /<Tag as="a">x<\/Tag>/);
});

test('as= with nothing to be, or a value that is not a tag name, is an error', () => {
  assert.match(err('C A\n  .card as=\n'), /as=: nothing to be/);
  assert.match(err('C A\n  .card as="not a tag"\n'), /as="not a tag": not a tag name/);
});

test('as= twice is an error, the way any repeated attribute is', () => {
  // the first one won and the second became a prop — `<section as={article}>`
  assert.match(err('C A\n  div as=section as=article "hi"\n'), /as is set twice on <div>/);
});

test('an element with no attributes and no children is `div as=`', () => {
  // a bare `{as}` line is an expression child, as `{children}` has to be: this is how the
  // same element is written with nothing in it
  assert.match(jsx('C A p:as\n  div as={as}\n'), /createElement\(as, null\)/);
  assert.match(jsx('C A p:as\n  {as}\n'), /\{as\}/, 'and the bare line is still the expression');
});

/* ---------- the rest of the language, on a dynamic tag ---------- */

test('HTML attribute spellings still translate on a dynamic tag', () => {
  const out = jsx('C A p:as\n  {as} class="x" tabindex=0 for="y" @keyup=go\n');
  assert.match(out, /"className": "x"/);
  assert.match(out, /"tabIndex": 0/);
  assert.match(out, /"htmlFor": "y"/);
  assert.match(out, /"onKeyUp": go/);
});

test('a dynamic tag inside a map carries the key, in both backends', () => {
  const src = 'C A p:rows p:as\n  ul\n    *rows as r k=r.id\n      {as} c="row" "{r.label}"\n';
  assert.match(jsx(src), /createElement\(as, \{ key: r\.id, "className": "row" \}, r\.label\)/);
  assert.match(esm(src), /h\(as, \{ key: r\.id, "className": "row" \}, r\.label\)/);
});

test('a branch or a map under a dynamic tag is one fragment argument', () => {
  const out = jsx('C A p:as p:ok\n  {as}\n    ?ok\n      p "yes"\n    :\n      p "no"\n');
  assert.match(out, /createElement\(as, null,\n\s*<>\n\s*\{ok \? \(/);
  assert.deepEqual(checkJsx(out), []);
});

test('a slot fills a prop on a dynamic tag, which may be a component', () => {
  assert.match(jsx('C A p:as\n  {as}\n    slot head\n      p "h"\n    p "b"\n'),
    /createElement\(as, \{ "head": <p>h<\/p> \}/);
  // a tag `as=` wrote out as a name is a DOM element, and a slot on one is still an error
  assert.match(err('C A\n  .x as=section\n    slot head\n      p "h"\n'), /is not a component/);
});

test('`as` is still a name a component may take, and a handler may set', () => {
  const out = jsx('C A s:as="div"\n  button @click=as="section" "swap"\n  {as} c="box" "hi"\n');
  assert.match(out, /setAs\("section"\)/);
  assert.match(out, /createElement\(as, \{ "className": "box" \}, "hi"\)/);
});

test('every shape writes structurally valid JSX', () => {
  const srcs = [
    'C A p:Tag\n  {Tag} c="row" "hi"\n',
    'C Box p:as="div"\n  {as} c="box" ...rest\n    {children}\n',
    'C A p:as p:rows\n  {as}\n    *rows as r k=r.id\n      {as} "{r.t}"\n',
    'C A p:as p:ok\n  {as} c="x"\n    ?ok\n      p "y"\n    :\n      span "n"\n',
    'C A p:as\n  {as}\n    slot head\n      p "h"\n    p "b"\n',
    'C A\n  .card as=section "a < b"\n',
    'C A p:big\n  .card as={big ? "section" : "div"}\n    "one"\n    "two"\n',
  ];
  for (const src of srcs) assert.deepEqual(checkJsx(jsx(src), src), [], src);
});

test('a tag expression holding a comma and a null still takes the key', () => {
  // the esm backend put the key into the element it had already written by matching
  // `h(<tag>, null` — and `h(f(r, null, 1), null, …)` holds both of those inside the tag
  const src = 'C A p:rows p:f\n  *rows as r k=r.id\n    {f(r, null, 1)} "{r.t}"\n';
  assert.match(esm(src), /h\(f\(r, null, 1\), \{ key: r\.id \}, r\.t\)/);
  assert.match(esm('C A p:rows p:f\n  *rows as r k=r.id\n    {f(r, null, 1)} c="x" "{r.t}"\n'),
    /h\(f\(r, null, 1\), \{ key: r\.id, "className": "x" \}, r\.t\)/);
});

/* ---------- the oracles ---------- */

const realSkip = available ? false : 'esbuild/react are devDependencies — run npm install';

test('real JSX, and real React with no warnings', { skip: realSkip }, async () => {
  const wrapper = 'C Box p:as="div" p:label\n  {as} c="box" ...rest\n    "{label}"\n';
  for (const [src, props, expect] of [
    [wrapper, { label: 'hi' }, '<div class="box">hi</div>'],
    [wrapper, { as: 'section', label: 'hi' }, '<section class="box">hi</section>'],
    [wrapper, { as: 'a', href: '/x', label: 'go' }, '<a class="box" href="/x">go</a>'],
    ['C A p:as="ul" p:rows=[]\n  {as}\n    *rows as r k=r\n      li "{r}"\n',
      { rows: ['a', 'b'] }, '<ul><li>a</li><li>b</li></ul>'],
    ['C A p:big\n  .card as={big ? "section" : "div"} "x"\n', { big: true },
      '<section class="card">x</section>'],
    ['C A\n  .card as=section "x"\n', {}, '<section class="card">x</section>'],
  ]) {
    const r = await renderZaal(src, props);
    assert.equal(r.threw, null, r.threw);
    assert.deepEqual(r.warnings, [], `${src}\n${r.jsx}`);
    assert.equal(r.html, expect, src);
    assert.equal(parseJsx(r.jsx), null);
  }
});

const diffSkip = diffAvailable ? false : 'esbuild/react are devDependencies — run npm install';

test('both backends render a dynamic tag identically', { skip: diffSkip }, async () => {
  const srcs = [
    'C App s:as="section"\n  {as} c="box"\n    "one"\n    "two"\n',
    'C App s:as="ul" s:rows=["a","b"]\n  {as}\n    *rows as r k=r\n      li "{r}"\n',
    'C App s:as="div" s:ok=false\n  {as} c="x"\n    ?ok\n      p "y"\n    :\n      span "n"\n',
    'C App s:big=true\n  .card as={big ? "section" : "div"} "x"\n',
    'C App s:as="p"\n  {as} "a {as} b"\n',
    'C App s:as="div"\n  {as}\n    "total:"\n    "5 items"\n',
  ];
  for (const src of srcs) {
    const d = await differs(src, {}, { main: 'App' });
    assert.equal(d, null, d && report(d));
  }
});

const domSkip = domAvailable ? false : 'jsdom is a devDependency — run npm install';

test('a polymorphic wrapper renders, swaps its tag and keeps its children', { skip: domSkip }, async () => {
  const app = await mountApp({
    entry: 'App.jsx',
    files: {
      'Box.jsx': compile('C Box p:as="div"\n  {as} c="box" ...rest\n    {children}\n', 'jsx',
        { main: 'Box' }),
      'App.jsx': compile('i Box ./Box\nC App s:as="div"\n  Box as={as} id="b"\n    "inside"\n'
        + '  button @click=as="section" "swap"\n', 'jsx', { main: 'App' }),
    },
  });
  assert.equal(app.$('#b').tagName, 'DIV');
  assert.equal(app.$('#b').className, 'box');
  assert.match(app.text, /inside/);
  await app.click(app.byText('button', 'swap'));
  assert.equal(app.$('#b').tagName, 'SECTION');
  assert.match(app.text, /inside/);
  assert.deepEqual(app.console, []);
  app.unmount();
});

test('a dynamic tag keyed in a list reorders without a React complaint', { skip: domSkip }, async () => {
  const app = await mountApp({
    entry: 'App.jsx',
    files: {
      'App.jsx': compile('C App s:as="li" s:rows=[{id:1,t:"a"},{id:2,t:"b"},{id:3,t:"c"}]\n'
        + '  ul\n    *rows as r k=r.id\n      {as} c="row" "{r.t}"\n'
        + '  button @click=rows=[...rows].reverse() "flip"\n', 'jsx', { main: 'App' }),
    },
  });
  assert.deepEqual(app.all('li.row').map(e => e.textContent), ['a', 'b', 'c']);
  await app.click(app.byText('button', 'flip'));
  assert.deepEqual(app.all('li.row').map(e => e.textContent), ['c', 'b', 'a']);
  assert.deepEqual(app.console, []);
  app.unmount();
});
