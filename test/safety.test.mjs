// Mistakes that compile to running code and fail silently in the browser: state edited in
// place (nothing re-renders), a branch whose body never got indented, text whose braces JSX
// would read as an expression. Each one is a build error instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../zaal.mjs';

const jsx = (src, opts) => compile(src, 'jsx', opts);
const esm = (src, opts) => compile(src, 'esm', opts);
const throws = (src, re, opts) => assert.throws(() => jsx(src, opts), re, src);

test('editing state in place is an error, with the setter to use', () => {
  throws('C A s:o={}\n  cb bad() = o.a = 1\n  p "x"\n', /edits o in place.*setO/s);
  throws('C A s:xs=[]\n  button @click=xs.push(1) "x"\n', /xs\.push\(…\) edits xs in place/);
  throws('C A s:xs=[]\n  button @click=xs[0] = 2 "x"\n', /edits xs in place/);
  throws('C A s:xs=[]\n  fx xs.sort()\n  p "x"\n', /edits xs in place/);
  throws('C A s:n=0\n  cb bad() = n.count += 1\n  p "x"\n', /edits n in place/);
});

test('a store value may not be edited in place either', () => {
  const opts = { stores: new Map([['Cart', 'stores/Cart']]) };
  throws('C A\n  use { items } = Cart\n  button @click=items.push(1) "x"\n',
    /edits items in place.*store's actions/, opts);
});

test('the honest ways to update state still compile', () => {
  assert.match(jsx('C A s:xs=[]\n  button @click=xs=[...xs,1] "x"\n'), /setXs\(\[\.\.\.xs,1\]\)/);
  assert.match(jsx('C A s:xs=[]\n  memo sorted = [...xs].sort()\n  p "x"\n'), /\[\.\.\.xs\]\.sort\(\)/);
  assert.match(jsx('C A\n  ref box\n  fx box.current = 1\n  p "x"\n'), /box\.current = 1/);
  assert.match(jsx('C A p:form\n  button @click=form.reset() "x"\n'), /form\.reset\(\)/);
});

test('a branch or a map with nothing under it is an error, not an empty node', () => {
  throws('C A p:a\n  div\n    ?a\n', /\?a has nothing under it/);
  throws('C A p:a\n  div\n    ?a\n      p "x"\n    :\n', /: has nothing under it/);
  throws('C A p:xs\n  div\n    *xs as x\n', /\*xs has nothing under it/);
  assert.throws(() => esm('C A p:xs\n  div\n    *xs as x\n'), /nothing under it/, 'esm too');
});

test('braces in text that are not an expression are escaped, the same in both backends', () => {
  assert.match(jsx('C A\n  p "a { b"\n'), /<p>a \{'\{'\} b<\/p>/);
  assert.match(jsx('C A\n  p "a {} b"\n'), /<p>a \{'\{'\}\{'\}'\} b<\/p>/);
  assert.match(esm('C A\n  p "a { b"\n'), /h\("p", null, "a \{ b"\)/);
  assert.match(jsx('C A p:d\n  p "{d} stays"\n'), /<p>\{d\} stays<\/p>/);
});

// Two values for one attribute: JSX keeps the last silently. Classes are joined (that is what
// `%card c="wide"` means); anything else is a mistake.
test('classes from the kit and from c= are joined, statically or dynamically', () => {
  assert.match(jsx('C A\n  div.card c="wide" "x"\n'), /className="card wide"/);
  assert.match(jsx('C A p:x\n  div.card c=x "t"\n'), /className=\{`card \$\{x\}`\}/);
  assert.match(esm('C A p:x\n  div.card c=x "t"\n'), /"className": `card \$\{x\}`/);
  assert.match(jsx('C A p:on\n  div.card c="{on ? "on" : "off"}" "t"\n'),
    /className=\{`card \$\{on \? "on" : "off"\}`\}/);
});

test('any other attribute set twice is an error', () => {
  throws('C A\n  div#a id="b" "x"\n', /id is set twice on <div>/);
  throws('C A\n  input val="1" value="2"\n', /value is set twice on <input>/);
  throws('C A\n  button @click=a @click=b "x"\n', /onClick is set twice on <button>/);
  throws('C A\n  div @dblclick=a @doubleclick=b "x"\n', /onDoubleClick is set twice/);
});

test('a key from the `*` line and a key= attribute collide', () => {
  throws('C A p:xs\n  ul\n    *xs as x k=x.id\n      li key=x.other "t"\n', /already gets its key/);
  assert.throws(() => esm('C A p:xs\n  ul\n    *xs as x k=x.id\n      li key=x.other "t"\n'),
    /already gets its key/);
});

test('a slot filled twice is an error', () => {
  throws('i P ./P\nC A\n  P\n    slot head\n      i "1"\n    slot head\n      i "2"\n',
    /slot head is filled twice/);
});

// JSX text is not plain text: `<` opens a tag and `&amp;` is an entity. The esm backend prints
// both literally, so the jsx backend has to escape them to render the same string.
test('`<` and HTML entities in text are escaped for JSX', () => {
  assert.match(jsx('C A\n  p "a < b and 3 > 2"\n'), /<p>a \{'<'\} b and 3 > 2<\/p>/);
  assert.match(jsx('C A\n  p "a &amp; b"\n'), /<p>a \{'&amp;'\} b<\/p>/);
  assert.match(jsx('C A\n  p "Tom & Jerry"\n'), /<p>Tom & Jerry<\/p>/, 'a lone & is text in JSX');
  assert.match(esm('C A\n  p "a < b"\n'), /h\("p", null, "a < b"\)/);
});

// Names the generated module writes for itself. A source name that lands on one of them used
// to come back as `Identifier 'value' has already been declared`, in a file nobody wrote.
test('a store may not take a name the provider needs', () => {
  throws('S T s:value=1\n', /`value` is the context object the provider builds/);
  throws('S T s:children=1\n', /`children` is what the provider wraps/);
  throws('S T s:a=1\n  memo value = 2\n', /`value` is the context object/);
  throws('S T persist s:KEY=1\n', /`KEY` is the localStorage key/);
  throws('S T persist s:saved=1\n', /`saved` is what was read back/);
  assert.match(jsx('S T s:KEY=1\n'), /const \[KEY, setKEY\]/, 'KEY is free without persist');
});

test('a boundary may not take a name the class needs', () => {
  throws('C Oops catch p:error\n  p "x"\n', /`error` is the error the boundary caught/);
  throws('C Oops catch p:reset\n  p "x"\n', /`reset` is the boundary's own reset/);
  throws('C Oops catch p:children\n  p "x"\n', /`children` is what the boundary wraps/);
});

test('two states whose setters would collide', () => {
  throws('C A s:n=0 s:N=1\n  p "x"\n', /s:N and s:n both need `setN`/);
  throws('S T s:n=0 s:N=1\n', /both need `setN`/);
  throws('C A p:setN s:n=0\n  p "x"\n', /p:setN is also the setter that s:n needs/);
  assert.match(jsx('C A s:n=0 s:nn=1\n  p "{n}{nn}"\n'), /setNn/, 'near misses still work');
});
