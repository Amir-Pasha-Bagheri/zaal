// The shape of the language itself: indentation, comments, line endings, tokens, selectors and
// the odd corners of each head line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile, parseUI, parseApp } from '../zaal.mjs';

const jsx = (src, opts) => compile(src, 'jsx', opts);
const esm = (src, opts) => compile(src, 'esm', opts);

test('indentation nests to any depth', () => {
  const src = 'C A\n' + Array.from({ length: 8 }, (_, i) => `${'  '.repeat(i + 1)}div.l${i}`).join('\n') + '\n';
  const out = jsx(src);
  for (let i = 0; i < 8; i++) assert.match(out, new RegExp(`className="l${i}"`));
  assert.match(out, /<div className="l0">\n[\s\S]*<div className="l7" \/>/);
});

test('the indent width only has to be consistent, and tabs work too', () => {
  const spaces3 = jsx('C A\n   div\n      p "deep"\n');
  const tabs = jsx('C A\n\tdiv\n\t\tp "deep"\n');
  assert.equal(spaces3, tabs);
  assert.match(tabs, /<div>\n\s*<p>deep<\/p>\n\s*<\/div>/);
});

test('dedenting by several levels closes every block', () => {
  const out = jsx('C A\n  div.one\n    div.two\n      p "x"\n  div.sibling\n');
  assert.match(out, /<div className="one">[\s\S]*<\/div>\n\s*<div className="sibling" \/>/);
});

test('blank lines and comment lines are ignored anywhere', () => {
  const out = jsx('// head\n\nC A\n\n  // about the div\n  div\n\n    p "x"\n\n');
  assert.match(out, /<div>\n\s*<p>x<\/p>\n\s*<\/div>/);
  assert.doesNotMatch(out, /about the div/);
});

test('a comment marker inside a string is text, not a comment', () => {
  assert.match(jsx('C A\n  p "https://example.com // not a comment"\n'),
    /<p>https:\/\/example\.com \/\/ not a comment<\/p>/);
});

test('CRLF sources compile the same as LF', () => {
  const lf = 'C A p:x\n  h1 "hi {x}"\n  p "b"\n';
  assert.equal(jsx(lf.replace(/\n/g, '\r\n')), jsx(lf));
  assert.deepEqual(parseUI('D X\r\nt color\r\n  bg #fff\r\n').tokens,
    parseUI('D X\nt color\n  bg #fff\n').tokens);
  assert.equal(parseApp('A D\r\n  t "T"\r\n  / Home\r\n').title, 'T');
});

test('a file of only comments compiles to nothing', () => {
  assert.equal(jsx('// nothing here\n').trim(), '');
});

test('trailing spaces on a line do not change nesting', () => {
  assert.equal(jsx('C A   \n  div   \n    p "x"  \n'), jsx('C A\n  div\n    p "x"\n'));
});

/* ---------- tokens ---------- */

test('spaces inside quotes, parens, brackets and braces stay inside the token', () => {
  const out = jsx('C A p:f\n  input onPaste=f(1, 2) data-x=[1, 2] style={a: 1, b: 2} title="a b c"\n');
  assert.match(out, /onPaste=\{f\(1, 2\)\}/);
  assert.match(out, /data-x=\{\[1, 2\]\}/);
  assert.match(out, /style=\{\{a: 1, b: 2\}\}/);
  assert.match(out, /title="a b c"/);
});

test('an arrow function in an attribute keeps its body', () => {
  const out = jsx('i Item ./Item\nC A p:drop\n  Item onRemove=()=>drop(1) onPick=(x) => drop(x)\n');
  assert.match(out, /onRemove=\{\(\)=>drop\(1\)\}/);
  assert.match(out, /onPick=\{\(x\) => drop\(x\)\}/);
});

test('an escaped quote inside a string does not end it', () => {
  assert.match(jsx('C A\n  p "say \\"hi\\" twice"\n'), /<p>say \\"hi\\" twice<\/p>/);
});

/* ---------- selectors ---------- */

test('selector shapes: tag only, classes only, id only, dashes and $ in names', () => {
  assert.match(jsx('C A\n  section\n'), /<section \/>/);
  assert.match(jsx('C A\n  .a.b.c\n'), /<div className="a b c" \/>/);
  assert.match(jsx('C A\n  #only\n'), /<div id="only" \/>/);
  assert.match(jsx('C A\n  .is-active.x-2\n'), /className="is-active x-2"/);
  assert.match(jsx('C A\n  div.$sel\n'), /className="\$sel"/);
});

test('two ids: the first one wins', () => {
  assert.match(jsx('C A\n  div#a#b\n'), /<div id="a" \/>/);
});

test('a component tag may carry classes', () => {
  assert.match(jsx('i Card ./Card\nC A\n  Card.wide\n'), /<Card className="wide" \/>/);
});

test('an attribute value may contain an = sign', () => {
  assert.match(jsx('C A\n  a href="/x?a=1&b=2" "go"\n'), /href="\/x\?a=1&b=2"/);
  assert.match(jsx('C A p:n\n  input value=n==1?"a":"b"\n'), /value=\{n==1\?"a":"b"\}/);
});

/* ---------- head lines ---------- */

test('several blocks in one file, in source order', () => {
  const out = jsx('C Table\n  Row\nC Row\n  tr\nS Rows s:all=[]\n  cb add(x) = all=[...all,x]\n', { main: 'Table' });
  const order = ['function Table', 'function Row', 'RowsContext'].map(s => out.indexOf(s));
  assert.ok(order.every(i => i >= 0));
  assert.deepEqual(order, [...order].sort((a, b) => a - b));
});

test('the default export is the block named after the file, whatever its position', () => {
  const src = 'C Row\n  tr\nC Table\n  Row\n';
  assert.match(jsx(src, { main: 'Table' }), /export default function Table/);
  assert.match(jsx(src, { main: 'Table' }), /export function Row/);
  assert.match(jsx(src, { main: 'Row' }), /export default function Row/);
});

test('with no name match the first block is the default export', () => {
  assert.match(jsx('C Alpha\n  p "a"\nC Beta\n  p "b"\n', { main: 'Nothing' }), /export default function Alpha/);
});

test('`i` forms: rename, braces with several names, no `from`', () => {
  assert.match(jsx('i { a as b } from pkg\nC A\n  p "{b}"\n'), /import \{ a as b \} from 'pkg';/);
  assert.match(jsx('i { x, y } from pkg\nC A\n  p "{x}{y}"\n'), /import \{ x, y \} from 'pkg';/);
  assert.match(jsx('i Btn ./Btn\nC A\n  Btn\n'), /import Btn from '\.\/Btn\.jsx';/);
});

test('`from` is accepted in any position', () => {
  assert.equal(jsx('i { m } from framer-motion\nC A\n  p "{m}"\n'),
    jsx('i { m } framer-motion\nC A\n  p "{m}"\n'));
});

test('a top-level js block keeps its child lines (which have to stay indented)', () => {
  const out = jsx('js function helper(a) {\n  return a + 1\n  }\nC A\n  p "{helper(1)}"\n');
  assert.match(out, /function helper\(a\) \{\nreturn a \+ 1\n\}/);
  assert.match(out, /\{helper\(1\)\}/);
});

test('a dedented line is a new top-level line, not part of the js block', () => {
  assert.throws(() => jsx('js function helper(a) {\n  return a + 1\n}\nC A\n  p "x"\n'),
    /bad selector: \}/);
});

test('a component declared by a js line counts as in scope', () => {
  const out = jsx('js const Badge = () => null\nC A\n  Badge\n');
  assert.match(out, /<Badge \/>/);
});

test('a component with hooks but no markup still compiles', () => {
  for (const target of ['jsx', 'esm']) {
    const out = compile('C A s:n=0\n  fx log(n)\n', target);
    assert.match(out, /useEffect/);
    assert.ok(out.includes('return'), `${target} returns something`);
  }
});

test('an expression child may be any expression JSX needs braces for', () => {
  const out = jsx('C A p:a p:b p:items\n  div\n    {items.length}\n    {a ? b : null}\n    {null}\n');
  assert.match(out, /\{items\.length\}/);
  assert.match(out, /\{a \? b : null\}/);
  assert.match(out, /\{null\}/);
});

test('`*` accepts a space before the list and defaults the item name to `it`', () => {
  const out = jsx('C A p:xs\n  ul\n    * xs\n      li "{it}"\n');
  assert.match(out, /xs\.map\(\(it, i\) => \(/);
});

test('`?` accepts a space before the condition', () => {
  assert.match(jsx('C A p:a\n  div\n    ? a\n      p "x"\n'), /\{a \? \(/);
});

test('`A`, `C` and `S` names may hold digits and $', () => {
  assert.match(jsx('C Box2\n  p "x"\n', { main: 'Box2' }), /function Box2/);
  assert.match(parseApp('A App2\n  / Home\n').name, /App2/);
});

test('esm: an empty component body is still valid JavaScript', () => {
  const out = esm('C A s:n=0\n  fx log(n)\n');
  assert.doesNotMatch(out, /h\(F, null, ,/);
});

// A trailing `//` comment, anywhere a line can be written.
test('a trailing comment is stripped, in markup and in directives', () => {
  assert.match(jsx('C A s:n=0   // state\n  p "x"   // a note\n'), /<p>x<\/p>/);
  assert.doesNotMatch(jsx('C A\n  p "x"  // a note\n'), /note/);
});

test('a `//` inside a string or a URL is not a comment', () => {
  assert.match(jsx('C A\n  a href="https://x.dev" "https://x.dev // keep"\n'),
    /<a href="https:\/\/x\.dev">https:\/\/x\.dev \/\/ keep<\/a>/);
});
