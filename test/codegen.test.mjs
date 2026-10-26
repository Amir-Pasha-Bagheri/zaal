// How markup turns into code once the pieces combine: nested control flow, keys, fragments,
// slots beside children, and the two backends agreeing with each other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../zaal.mjs';

const jsx = (src, opts) => compile(src, 'jsx', opts);
const esm = (src, opts) => compile(src, 'esm', opts);

const ROWS = `C A p:rows
  table
    *rows as r k=r.id
      tr
        *r.cells as c k=c.id
          ?c.bold
            td
              b "{c.v}"
          :
            td "{c.v}"
`;

test('a map inside a map keys both levels', () => {
  const out = jsx(ROWS);
  assert.match(out, /rows\.map\(\(r, i\) => \(\n\s*<tr key=\{r\.id\}>/);
  assert.match(out, /r\.cells\.map\(\(c, i\) => \(\n\s*<Fragment key=\{c\.id\}>/);
  assert.match(esm(ROWS), /rows\.map\(\(r, i\) => h\("tr", \{ key: r\.id \}, r\.cells\.map\(\(c, i\) => h\(F, \{ key: c\.id \}/);
});

test('an if-chain is the whole body of a map item', () => {
  const out = jsx(ROWS);
  assert.match(out, /\{c\.bold \? \([\s\S]*\) : \(\n\s*<td>\{c\.v\}<\/td>\n\s*\)\}/);
});

test('a map inside a branch, with a sibling after it', () => {
  const src = 'C A p:a p:xs\n  div\n    ?a\n      *xs as x\n        p "{x}"\n      p "after"\n';
  assert.match(jsx(src), /\{a \? \(\n\s*<>\n\s*\{xs\.map\(\(x, i\) => \(/);
  assert.match(esm(src), /a \? h\(F, null, xs\.map\(\(x, i\) => h\("p", \{ key: i \}, x\)\), h\("p", null, `after`\)\) : null/);
});

test('a branch inside a branch', () => {
  const out = jsx('C A p:a p:b\n  div\n    ?a\n      ?b\n        p "both"\n      :\n        p "only a"\n');
  assert.match(out, /\{a \? \(\n\s*<>\n\s*\{b \? \(/);
});

// A lone `?` is a ternary, not `&&`: `?items.length` over an empty list would otherwise
// render React's stray `0`.
test('a lone `?` is a ternary in both backends', () => {
  const src = 'C A p:items\n  div\n    ?items.length\n      p "some"\n';
  assert.match(jsx(src), /\{items\.length \? \(/);
  assert.match(esm(src), /items\.length \? h\("p", null, `some`\) : null/);
});

test('an else-if chain with four arms becomes one nested ternary', () => {
  const out = jsx('C A p:a p:b p:c\n  div\n    ?a\n      p "a"\n    :?b\n      p "b"\n    :?c\n      p "c"\n    :\n      p "d"\n');
  assert.match(out, /\{a \? \([\s\S]*\) : b \? \([\s\S]*\) : c \? \([\s\S]*\) : \(/);
  assert.equal((out.match(/<p>/g) || []).length, 4);
});

test('two separate if-chains side by side do not merge', () => {
  const out = jsx('C A p:a p:b\n  div\n    ?a\n      p "a"\n    :\n      p "not a"\n    ?b\n      p "b"\n');
  assert.match(out, /\{a \? \([\s\S]*\) : \([\s\S]*\)\}\n\s*\{b \? \(/);
});

test('a map at the component root, and a map of components', () => {
  const out = jsx('i Row ./Row\nC A p:rows\n  *rows as r k=r.id\n    Row row=r\n');
  assert.match(out, /return \(\n\s*<>\n\s*\{rows\.map\(\(r, i\) => \(\n\s*<Row key=\{r\.id\} row=\{r\} \/>/);
});

test('a map over a bare expression or text child keys a fragment, in both backends', () => {
  for (const body of ['{r.label}', '"{r.label}"']) {
    const src = `C A p:rows\n  div\n    *rows as r k=r.id\n      ${body}\n`;
    assert.match(jsx(src), /<Fragment key=\{r\.id\}>\n\s*\{r\.label\}\n\s*<\/Fragment>/, body);
    assert.match(jsx(src), /import \{ Fragment \} from 'react';/);
    assert.match(esm(src), /h\(F, \{ key: r\.id \}, r\.label\)/, body);
  }
});

test('text and elements as siblings keep their order', () => {
  const out = jsx('C A p:n\n  p\n    "count: "\n    b "{n}"\n    " items"\n');
  assert.match(out, /count: \n\s*<b>\{n\}<\/b>\n\s*items/);
});

test('inline text plus nested children both render, text first', () => {
  const out = jsx('C A\n  label "Name"\n    input\n');
  assert.match(out, /<label>\n\s*Name\n\s*<input \/>\n\s*<\/label>/);
});

test('several slots on one component, beside ordinary children', () => {
  const out = jsx('i Panel ./Panel\nC A\n  Panel\n    slot head\n      h1 "t"\n    slot foot\n      p "f"\n    p "body"\n');
  assert.match(out, /head=\{<h1>t<\/h1>\}/);
  assert.match(out, /foot=\{<p>f<\/p>\}/);
  assert.match(out, /<p>body<\/p>/);
});

test('a slot holding several lines is wrapped in a fragment', () => {
  const out = jsx('i Panel ./Panel\nC A\n  Panel\n    slot head\n      h1 "t"\n      p "sub"\n');
  assert.match(out, /head=\{<>\n[\s\S]*<\/>\}/);
  assert.match(esm('i Panel ./Panel\nC A\n  Panel\n    slot head\n      h1 "t"\n      p "sub"\n'),
    /"head": h\(F, null, h\("h1", null, `t`\), h\("p", null, `sub`\)\)/);
});

test('a slot holding a map', () => {
  const out = jsx('i Panel ./Panel\nC A p:xs\n  Panel\n    slot items\n      *xs as x k=x.id\n        li "{x.t}"\n');
  assert.match(out, /items=\{[\s\S]*xs\.map\(\(x, i\) => \(/);
});

test('a component with no children renders self-closing in both backends', () => {
  assert.match(jsx('i Row ./Row\nC A\n  Row\n'), /<Row \/>/);
  assert.match(esm('i Row ./Row\nC A\n  Row\n'), /h\(Row, null\)/);
});

test('attribute order is preserved, with id and className first', () => {
  const out = jsx('C A p:f\n  input.field#name type="text" @input=f required\n');
  assert.match(out, /<input id="name" className="field" type="text" onInput=\{f\} required=\{true\} \/>/);
});

test('a spread lands after the named props', () => {
  assert.match(jsx('C A p:rest\n  input type="text" ...rest\n'), /<input type="text" \{\.\.\.rest\} \/>/);
});

test('several spreads on one element', () => {
  const out = jsx('C A p:a p:b\n  input ...a ...b\n');
  assert.match(out, /<input \{\.\.\.a\} \{\.\.\.b\} \/>/);
  assert.match(esm('C A p:a p:b\n  input ...a ...b\n'), /Object\.assign\(\{\}, a, b\)/);
});

test('a key on a map item merges with its other props', () => {
  assert.match(esm('i Row ./Row\nC A p:xs\n  *xs as x k=x.id\n    Row row=x open\n'),
    /h\(Row, \{ key: x\.id, "row": x, "open": true \}\)/);
});

test('the jsx backend indents consistently as nesting deepens', () => {
  const out = jsx('C A\n  div\n    div\n      div\n        p "deep"\n');
  assert.match(out, /\n {4}<div>\n {6}<div>\n {8}<div>\n {10}<p>deep<\/p>/);
});

test('both backends agree on which imports a file needs', () => {
  const src = 'i Row ./Row\nC A s:n=0\n  use { items } = Cart\n  memo big = items.length > 3\n  Row n=n big=big\n';
  const stores = new Map([['Cart', 'stores/Cart']]);
  const a = jsx(src, { stores }), b = esm(src, { stores });
  assert.match(a, /import \{ useState, useMemo \} from 'react';/);
  assert.match(b, /import \{ useState, useMemo, createElement as h, Fragment as F \} from 'react';/);
  assert.match(a, /import \{ useCart \} from '\.\/stores\/Cart\.jsx';/);
  assert.match(b, /import \{ useCart \} from '\.\/stores\/Cart\.js';/);
});

test('Fragment is imported only when a keyed fragment is emitted', () => {
  assert.doesNotMatch(jsx('C A\n  h1 "a"\n  p "b"\n'), /import .*Fragment/);
  assert.match(jsx('C A p:xs\n  *xs as x k=x.id\n    h1 "a"\n    p "b"\n'), /import \{ Fragment \} from 'react';/);
});

test('a handler that only names a function passes it by reference', () => {
  assert.match(jsx('C A p:save\n  button @click=save "s"\n'), /onClick=\{save\}/);
  assert.match(jsx('C A p:save\n  button @click=save() "s"\n'), /onClick=\{\(\) => save\(\)\}/);
});

test('an event param appears only when the body mentions `e`', () => {
  assert.match(jsx('C A p:f\n  input @input=f(e.target.value)\n'), /onInput=\{\(e\) => f\(e\.target\.value\)\}/);
  assert.match(jsx('C A p:f\n  input @input=f(1)\n'), /onInput=\{\(\) => f\(1\)\}/);
});

test('state updates inside a handler: ++, --, +=, -=, = and a plain call', () => {
  const out = jsx('C A s:n=0 s:t=""\n  div\n    button @click=n++ "a"\n    button @click=n-- "b"\n'
    + '    button @click=n+=2 "c"\n    button @click=n-=2 "d"\n    button @click=t="x" "e"\n'
    + '    button @click=n=n*2 "f"\n');
  assert.match(out, /setN\(n \+ 1\)/);
  assert.match(out, /setN\(n - 1\)/);
  assert.match(out, /setN\(n \+ \(2\)\)/);
  assert.match(out, /setN\(n - \(2\)\)/);
  assert.match(out, /setT\("x"\)/);
  assert.match(out, /setN\(n\*2\)/);
});

test('an assignment to something that is not state is left alone', () => {
  assert.match(jsx('C A p:box\n  button @click=box.current=null "x"\n'), /onClick=\{\(\) => box\.current=null\}/);
});

test('esm: a text node that is one whole interpolation is not a template string', () => {
  assert.match(esm('C A p:x\n  p "{x}"\n'), /h\("p", null, x\)/);
  assert.match(esm('C A p:x\n  p "{x} "\n'), /h\("p", null, `\$\{x\} `\)/);
});

test('esm: backticks inside text are escaped', () => {
  assert.match(esm('C A\n  p "use `npm i` first"\n'), /`use \\`npm i\\` first`/);
});

// An expression in a JSX expression position — a `return`, a branch arm, a slot prop — has to
// keep its fragment: `return ( {x} )` is an object literal and `return ( hi )` an identifier.
test('a lone expression root keeps its fragment', () => {
  assert.match(jsx('C A p:x\n  {x}\n'), /return \(\n\s*<>\n\s*\{x\}\n\s*<\/>\n\s*\);/);
  assert.match(esm('C A p:x\n  {x}\n'), /return x;/);
});

test('a lone text root keeps its fragment', () => {
  assert.match(jsx('C A\n  "hi"\n'), /return \(\n\s*<>\n\s*hi\n\s*<\/>\n\s*\);/);
});

test('a lone element root still collapses', () => {
  assert.match(jsx('C A\n  p "x"\n'), /return \(\n\s*<p>x<\/p>\n\s*\);/);
});

test('an expression alone in a branch arm keeps its fragment', () => {
  const out = jsx('C A p:c p:x\n  div\n    ?c\n      {x}\n');
  assert.match(out, /\{c \? \(\n\s*<>\n\s*\{x\}\n\s*<\/>\n\s*\) : null\}/);
});

test('an expression alone in a slot keeps its fragment', () => {
  const out = jsx('i Panel ./Panel\nC A p:x\n  Panel\n    slot head\n      {x}\n');
  assert.match(out, /head=\{<>\n\s*\{x\}\n\s*<\/>\}/);
});

test('a boundary whose fallback is one expression keeps its fragment', () => {
  assert.match(jsx('C Oops catch\n  {error.message}\n'), /return \(\n\s*<>\n\s*\{error\.message\}\n\s*<\/>\n\s*\);/);
});

// A dotted tag is a member of a name the module has — `motion.div` — and a tag with classes
// otherwise. Nothing else distinguishes `div.card` from `motion.div`.
test('a dotted tag whose base is imported is a member tag', () => {
  const src = 'i { motion } from framer-motion\nC A\n  motion.div c="box" "hi"\n';
  assert.match(jsx(src), /<motion\.div className="box">hi<\/motion\.div>/);
  assert.match(esm(src), /h\(motion\.div, \{ "className": "box" \}, `hi`\)/);
});

test('a dotted tag whose base is not in scope is still tag plus classes', () => {
  assert.match(jsx('C A\n  div.card\n'), /<div className="card" \/>/);
  assert.match(esm('C A\n  div.card\n'), /h\("div", \{ "className": "card" \}\)/);
});

test('a member tag declared by a js line works too', () => {
  const src = 'js const ui = {}\nC A\n  ui.Row "x"\n';
  assert.match(jsx(src), /<ui\.Row>x<\/ui\.Row>/);
});

test('a member tag reports its base name when nothing brings it in', () => {
  assert.throws(() => jsx('C A\n  Dialog.Panel\n'), /<Dialog> is not in scope/);
});

test('a lower-case class on an imported component stays a class', () => {
  const src = 'i Card ./Card\nC A\n  Card.wide "x"\n';
  assert.match(jsx(src), /<Card className="wide">x<\/Card>/);
});

test('`memo=eq` hands React the comparator', () => {
  const src = 'js const eq = (a, b) => a.x === b.x\nC A memo=eq p:x\n  p "{x}"\n';
  assert.match(jsx(src), /memo\(function A\(\{ x \}\) \{[\s\S]*\}, eq\);/);
  assert.match(jsx('C A memo p:x\n  p "{x}"\n'), /memo\(function A\(\{ x \}\) \{[\s\S]*\}\);/);
});

test('an unknown part on C, S or a boundary is reported', () => {
  assert.throws(() => jsx('C A momo\n  p "x"\n'), /unknown `momo`/);
  assert.throws(() => jsx('S T stash s:a=1\n'), /unknown `stash`/);
  assert.throws(() => jsx('C A catch memo\n  p "x"\n'), /boundary takes p: props only/);
});

test('a class after a member tag is still a class', () => {
  const src = 'i { motion } from framer-motion\nC A\n  motion.div.sheet "x"\n';
  assert.match(jsx(src), /<motion\.div className="sheet">x<\/motion\.div>/);
});

// The esm backend's `createElement as h` is a name a component may want for itself.
test('esm: the createElement alias steps aside for a prop of the same name', () => {
  const out = esm('C Spark p:h=48 p:w=240\n  svg width=w height=h\n');
  assert.match(out, /import \{ createElement as _h, Fragment as F \} from 'react';/);
  assert.match(out, /_h\("svg", \{ "width": w, "height": h \}\)/);
  assert.doesNotMatch(out, /(?<![\w$_])h\(/);
});

test('esm: the fragment alias does the same', () => {
  const out = esm('js const F = 1\nC A\n  p "a"\n  p "b"\n');
  assert.match(out, /Fragment as _F/);
  assert.match(out, /h\(_F, null/);
});
