// Elements, attributes, text, control flow, slots — both backends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../zal.mjs';

const jsx = (src, opts) => compile(src, 'jsx', opts);
const esm = (src, opts) => compile(src, 'esm', opts);

test('a bare selector is a div, classes and id become attributes', () => {
  const out = jsx('C A\n  .card#top\n');
  assert.match(out, /<div id="top" className="card" \/>/);
});

test('tag.class#id in any order, several classes', () => {
  assert.match(jsx('C A\n  section.a.b#x "hi"\n'),
    /<section id="x" className="a b">hi<\/section>/);
});

test('a capitalized tag is a component and keeps its name', () => {
  const out = jsx('i Item ./Item\nC A\n  Item todo=t\n');
  assert.match(out, /<Item todo=\{t\} \/>/);
  assert.match(out, /import Item from '\.\/Item\.jsx';/);
});

test('attribute forms: string, expression, boolean, braces, object literal', () => {
  const out = jsx('C A\n  input type="text" value=n disabled required={ok} style={color:"red"}\n');
  assert.match(out, /type="text"/);
  assert.match(out, /value=\{n\}/);
  assert.match(out, /disabled=\{true\}/);
  assert.match(out, /required=\{ok\}/);
  assert.match(out, /style=\{\{color:"red"\}\}/);
});

test('shorthand attribute names', () => {
  const out = jsx('C A\n  input c="field" val=v ph="type here"\n');
  assert.match(out, /className="field"/);
  assert.match(out, /value=\{v\}/);
  assert.match(out, /placeholder="type here"/);
});

test('event names map to React handlers, unknown ones get on-prefixed', () => {
  const out = jsx('C A s:n=0\n  button @click=n++ @key=go @drop=hit(e) "x"\n');
  assert.match(out, /onClick=\{\(\) => setN\(n \+ 1\)\}/);
  assert.match(out, /onKeyDown=\{go\}/);          // bare identifier passes by reference
  assert.match(out, /onDrop=\{\(e\) => hit\(e\)\}/);  // mentions `e` -> the event param appears
});

test('a handler with several statements becomes a block', () => {
  const out = jsx('C A s:n=0\n  button @click=n++; log("n is {n}") "x"\n');
  assert.match(out, /onClick=\{\(\) => \{ setN\(n \+ 1\); log\(`n is \$\{n\}`\) \}\}/);
});

test('text: inline, on its own line, interpolated, escaped braces', () => {
  const out = jsx('C A p:x\n  p "a {x} b"\n  p\n    "own line"\n  p "\\{literal\\}"\n');
  assert.match(out, /<p>a \{x\} b<\/p>/);
  assert.match(out, /<p>\n\s*own line\n\s*<\/p>/);
  assert.match(out, /\{'\{'\}literal\{'\}'\}/);
});

test('an expression child is braced, and {children} needs no p: line', () => {
  const out = jsx('C A\n  .n\n    {items.length}\n    {children}\n');
  assert.match(out, /function A\(\{ children \}\)/);
  assert.match(out, /\{items\.length\}/);
});

test('`children` inside a text node is not a prop', () => {
  const out = jsx('C A\n  p "children are nested"\n');
  assert.match(out, /function A\(\)/);
});

test('a condition may be written with spaces', () => {
  const out = jsx('C A p:xs s:n=0\n  div\n    ?xs.length > 2\n      p "many"\n    :?n == 0\n      p "zero"\n    :\n      p "few"\n');
  assert.match(out, /\{xs\.length > 2 \? \(/);
  assert.match(out, /\) : n == 0 \? \(/);
});

test('a handler may be written with spaces around its operators', () => {
  const out = jsx('C A s:mode="light"\n  button @click=mode = mode == "dark" ? "light" : "dark" "{mode}"\n');
  assert.match(out, /onClick=\{\(\) => setMode\(mode == "dark" \? "light" : "dark"\)\}/);
  assert.match(out, />\{mode\}</);
});

test('nested quotes inside an interpolation stay part of the expression', () => {
  const src = 'C A p:tone p:text\n  span.chip "{tone == "warn" ? "! " : ""}{text}"\n';
  assert.match(jsx(src), /<span className="chip">\{tone == "warn" \? "! " : ""\}\{text\}<\/span>/);
  assert.match(esm(src), /`\$\{tone == "warn" \? "! " : ""\}\$\{text\}`/);
});

test('?/:?/: compiles to one ternary chain, and so does ? alone', () => {
  const one = jsx('C A p:a\n  div\n    ?a\n      p "yes"\n');
  assert.match(one, /\{a \? \([\s\S]*\) : null\}/);
  const chain = jsx('C A p:a p:b\n  div\n    ?a\n      p "A"\n    :?b\n      p "B"\n    :\n      p "C"\n');
  assert.match(chain, /\{a \? \([\s\S]*\) : b \? \([\s\S]*\) : \(/);
});

test('an if-chain with no else ends in null', () => {
  const out = jsx('C A p:a p:b\n  div\n    ?a\n      p "A"\n    :?b\n      p "B"\n');
  assert.match(out, /: null\}/);
});

test('several children in a branch are wrapped in a fragment', () => {
  const out = jsx('C A p:a\n  div\n    ?a\n      p "one"\n      p "two"\n');
  assert.match(out, /<>\n[\s\S]*<\/>/);
});

test('* maps, key defaults to the index, `as` names the item', () => {
  const idx = jsx('C A p:xs\n  ul\n    *xs\n      li "{it}"\n');
  assert.match(idx, /xs\.map\(\(it, i\) => \(/);
  assert.match(idx, /<li key=\{i\}>/);
  const named = jsx('C A p:xs\n  ul\n    *xs as row k=row.id\n      li "{row.t}"\n');
  assert.match(named, /xs\.map\(\(row, i\) => \(/);
  assert.match(named, /key=\{row\.id\}/);
});

test('a map of several children keys the fragment', () => {
  const out = jsx('C A p:xs\n  ul\n    *xs as x k=x.id\n      li "{x.a}"\n      li "{x.b}"\n');
  assert.match(out, /<Fragment key=\{x\.id\}>/);
  assert.match(out, /import \{ Fragment \} from 'react';/);
});

test('a control-flow node may be the component root', () => {
  const out = jsx('C A p:a\n  ?a\n    p "yes"\n');
  assert.match(out, /\{a \? \(\n\s*<p>yes<\/p>/);
});

test('several root lines are wrapped in a fragment', () => {
  const out = jsx('C A\n  h1 "a"\n  p "b"\n');
  assert.match(out, /return \(\n\s*<>/);
});

test('slot passes markup as a prop', () => {
  const out = jsx('i Panel ./Panel\nC A\n  Panel title="x"\n    slot actions\n      Link to="/" "back"\n    p "kid"\n');
  assert.match(out, /actions=\{<Link to="\/">back<\/Link>\}/);
  assert.match(out, /<Panel title="x" actions=\{[\s\S]*\}>\n[\s\S]*<p>kid<\/p>/);
});

test('spread: a name in scope is forwarded, an unknown one becomes the rest prop', () => {
  const rest = jsx('C Field\n  input ...rest\n');
  assert.match(rest, /function Field\(\{ \.\.\.rest \}\)/);
  const known = jsx('C Field p:extra\n  input ...extra\n');
  assert.match(known, /function Field\(\{ extra \}\)/);
  assert.match(known, /\{\.\.\.extra\}/);
});

test('%kit entries take their tag from the kit and keep the class', () => {
  const ui = { kit: { btn: { el: 'button' }, card: { el: 'section' } }, known: new Set(['btn', 'card', 'primary']) };
  const out = jsx('C A\n  %card\n    %btn.primary "go"\n', { ui });
  assert.match(out, /<section className="card">/);
  assert.match(out, /<button className="btn primary">go<\/button>/);
});

test('the <i> element still works beside `i` imports', () => {
  const out = jsx('i X ./X\nC A\n  i "em"\n  i c="icon"\n');
  assert.match(out, /<i>em<\/i>/);
  assert.match(out, /<i className="icon" \/>/);
  assert.match(out, /import X from '\.\/X\.jsx';/);
});

test('js lines are emitted verbatim above the component', () => {
  const out = jsx('js const PI = 3\nC A\n  p "{PI}"\n');
  assert.match(out, /^const PI = 3\nexport default function A/m);
});

/* ---------- the esm backend says the same thing with createElement ---------- */

test('esm: createElement, template strings, fragments', () => {
  const out = esm('C A p:title\n  .card\n    h1 "{title}!"\n    p "plain"\n');
  assert.match(out, /import \{ createElement as h, Fragment as F \} from 'react';/);
  assert.match(out, /h\("div", \{ "className": "card" \}, h\("h1", null, `\$\{title\}!`\), h\("p", null, `plain`\)\)/);
});

test('esm: a lone {expr} string stays an expression, not a template', () => {
  assert.match(esm('C A\n  div\n    {children}\n'), /h\("div", null, children\)/);
});

test('esm: map keys land in the props object', () => {
  const out = esm('C A p:xs\n  ul\n    *xs as x k=x.id\n      li "{x.t}"\n');
  assert.match(out, /xs\.map\(\(x, i\) => h\("li", \{ key: x\.id \}, x\.t\)\)/);
});

test('esm: a single spread with no other props is passed straight through', () => {
  assert.match(esm('C A\n  input ...rest\n'), /h\("input", rest\)/);
});

test('esm: spread plus props uses Object.assign', () => {
  assert.match(esm('C A p:rest\n  input type="text" ...rest\n'), /Object\.assign\(\{"type": "text"\}, rest\)/);
});

// A dash in a tag can only be a custom element: no component or DOM tag has one.
test('a dashed tag is a custom element, classes and all', () => {
  assert.match(jsx('C A\n  my-widget.big val=1 "x"\n'), /<my-widget className="big" value=\{1\}>x<\/my-widget>/);
  assert.match(esm('C A\n  my-widget.big "x"\n'), /h\("my-widget", \{ "className": "big" \}, `x`\)/);
});
