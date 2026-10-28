// The corners nothing else in the suite reaches.
//
// Two of them, found by reading what the suite had never executed rather than by thinking of a
// case: the branch of the `<head>` reader that handles a child which is not a tag at all, and
// the two places in the esm backend where a key or a text node cannot go where it usually goes.
// All three are paths a real page takes — an analytics snippet pasted into `index.html`, a list
// of interpolated strings, a row that forwards a spread — and none of them had a test.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { compile } from '../zaal.mjs';
import { headChildren, mergeHead } from '../packages/react/src/entry.mjs';
import { checkJsx } from './helpers/jsx-check.mjs';
import { diffAvailable, differs, report, cleanupDiff } from './helpers/differential.mjs';
import { projectDir, buildIn, read, cleanup } from './helpers/fixture.mjs';

after(cleanup);
after(cleanupDiff);

/* ---------- the <head> reader, on things that are not tags ---------- */

// The promise is that nothing a developer put in the `<head>` is lost. A child that is not a
// tag is the case the reader is least likely to have been written for, and the most likely to
// be there: a stray word, an unclosed comment half-pasted, a `<` in a snippet.
test('a head child that is not a tag is kept as it is', () => {
  assert.deepEqual(headChildren('<head><title>a</title>loose words<meta x="1"></head>'),
    ['<title>a</title>', 'loose words', '<meta x="1">']);
  // text before anything else, and the surrounding whitespace trimmed off it
  assert.deepEqual(headChildren('<head>  hello  <title>a</title></head>'),
    ['hello', '<title>a</title>']);
  // whitespace alone is not a child
  assert.deepEqual(headChildren('<head>\n   \n</head>'), []);
});

// Markup that never closes is what a half-finished paste looks like. The reader has to stop at
// the end of the head rather than run off it, and it has to keep what it found.
test('an unterminated comment or script is kept, not dropped or run past', () => {
  assert.deepEqual(headChildren('<head><!-- never closed</head>'), ['<!-- never closed']);
  assert.deepEqual(headChildren('<head><script>var a = 1;</head>'), ['<script>var a = 1;']);
  // a raw tag that closes itself holds no text, so the next child is its own
  assert.deepEqual(headChildren('<head><title/><meta x="1"></head>'), ['<title/>', '<meta x="1">']);
});

// The property behind all of the above, stated once: whatever the shape, every non-whitespace
// character between `<head>` and `</head>` comes back in some child. A reader that loses
// content silently is the failure that matters — the exact split between children does not.
test('no content between <head> and </head> is ever lost', () => {
  const heads = [
    '<title>a</title>loose words<meta x="1">',
    '5 < 6<meta x="1">',
    '<!-- a <link> in a comment --><link rel="icon" href=\'q"ote.ico\'>',
    '<script>if (a<b) go("</div>")</script>text<style>a{content:">"}</style>',
    '<meta content="a > b"><title>t</title>trailing',
    '<!-- unclosed',
    '<script>unclosed',
  ];
  const squash = s => s.replace(/\s+/g, '');
  for (const inner of heads) {
    const kids = headChildren(`<head>${inner}</head>`);
    assert.equal(squash(kids.join('')), squash(inner), `content lost in: ${inner}`);
  }
});

test('a head with attributes is read, and a page with no head or no close is not guessed at', () => {
  assert.deepEqual(headChildren('<head lang="en" data-x><title>t</title></head>'), ['<title>t</title>']);
  assert.equal(headChildren('<html><body></body></html>'), null);
  assert.equal(headChildren('<head><title>t</title>'), null, 'no </head>: nothing is claimed');
});

// End to end: the three kinds of hand edit at once, through a real rebuild. A stray text child
// is the one `mergeHead` had never been handed.
test('a hand-edited head survives a rebuild, stray text included', () => {
  const root = projectDir({
    'zaal/app.zaal': 'A D\n  t "T"\n  / Home\n',
    'zaal/pages/Home.zaal': 'C Home\n  h1 "hi"\n',
  });
  buildIn(root, 'jsx');
  const edited = read(root, 'application/index.html').replace('</head>',
    '  <!-- analytics -->\n    <meta name="x" content="1">\n    a stray note\n  </head>');
  writeFileSync(join(root, 'application/index.html'), edited);

  buildIn(root, 'jsx');
  const after = read(root, 'application/index.html');
  assert.match(after, /<!-- analytics -->/);
  assert.match(after, /<meta name="x" content="1">/);
  assert.match(after, /a stray note/);
  // and what the compiler owns is still there, exactly once
  assert.equal(after.match(/<title>T<\/title>/g).length, 1);
  assert.equal(after.match(/a stray note/g).length, 1, 'and the hand edit is not doubled');

  // a third build changes nothing further
  buildIn(root, 'jsx');
  assert.equal(read(root, 'application/index.html'), after);
});

/* ---------- the esm backend, where a key or a text node has nowhere usual to go ---------- */

// `createElement` takes the props object second, so a key is put *into* that object. When the
// second argument is not an object literal the key has nowhere to go, and the element is
// wrapped in a keyed fragment instead. The second argument is not a literal exactly when the
// element's only props are a spread — a row that forwards what it was given, which is an
// ordinary thing for a list item to be.
test('esm: a keyed element whose only props are a spread is wrapped in a keyed fragment', () => {
  const esm = compile('C A p:items p:extra\n  *items as x k=x.id\n    div ...extra\n', 'esm', { main: 'A' });
  assert.match(esm, /items\.map\(\(x, i\) => h\(F, \{ key: x\.id \}, h\("div", extra\)\)\)/);

  // with a prop beside the spread the second argument is an Object.assign, which is no more an
  // object literal than a bare name is, so the same wrapping applies
  const both = compile('C A p:items p:extra\n  *items as x k=x.id\n    div ...extra c="r"\n', 'esm', { main: 'A' });
  assert.match(both, /h\(F, \{ key: x\.id \}, h\("div", Object\.assign\(/);

  // and the ordinary case is still the key inside the props object, not a wrapper
  const plain = compile('C A p:items\n  *items as x k=x.id\n    div c="r"\n', 'esm', { main: 'A' });
  assert.match(plain, /h\("div", \{ key: x\.id, "className": "r" \}\)/);
  assert.doesNotMatch(plain, /h\(F, \{ key/, 'no fragment is needed when the key fits');
});

// A text node is normally written as the children of the element above it. A text node that is
// a component's whole body has no element above it, so its pieces — the literals and the
// interpolations — become the children of a fragment.
test('esm: an interpolated text node standing alone becomes a fragment of its pieces', () => {
  const root = compile('C A p:n\n  "a {n} b"\n', 'esm', { main: 'A' });
  assert.match(root, /return h\(F, null, "a ", n, " b"\);/);

  // the same node as a keyed list item carries the key on that fragment
  const item = compile('C A p:items\n  *items as x k=x.id\n    "a {x.t} b"\n', 'esm', { main: 'A' });
  assert.match(item, /h\(F, \{ key: x\.id \}, "a ", x\.t, " b"\)/);

  // a text node with no interpolation is one piece, so there is nothing for a fragment to
  // hold together: the component returns the string itself, which React renders the same way
  // the jsx backend's `<>plain</>` does (the differential test below is what says so).
  const flat = compile('C A\n  "plain"\n', 'esm', { main: 'A' });
  assert.match(flat, /return "plain";/);
  assert.doesNotMatch(flat, /h\(F/, 'no fragment for a single piece');
});

// All of which is only correct if it puts the same page up as the jsx backend does — where the
// key goes on the element itself and the text is JSX children. That is the actual promise; the
// spellings above are just how each backend keeps it.
test('both backends put the same page up for every one of these shapes', { skip: diffAvailable ? false : 'esbuild/react are devDependencies' }, async () => {
  const shapes = [
    'C A p:n\n  "a {n} b"\n',
    'C A\n  "plain"\n',
    'C A p:items\n  *items as x k=x.id\n    "a {x.t} b"\n',
    'C A p:items p:extra\n  *items as x k=x.id\n    div ...extra\n',
    'C A p:items p:extra\n  *items as x k=x.id\n    div ...extra c="r"\n',
    'C A p:items\n  *items as x k=x.id\n    div c="r"\n',
  ];
  const props = { n: 2, items: [{ id: 1, t: 'x' }, { id: 2, t: 'y' }], extra: { id: 'row' } };
  const found = [];
  for (const src of shapes) {
    const d = await differs(src, props, { main: 'A' });
    if (d) found.push(report(d));
  }
  assert.deepEqual(found, [], found.join('\n\n'));
});

test('and the jsx each of them writes is structurally valid', () => {
  const shapes = [
    'C A p:n\n  "a {n} b"\n',
    'C A p:items\n  *items as x k=x.id\n    "a {x.t} b"\n',
    'C A p:items p:extra\n  *items as x k=x.id\n    div ...extra\n',
  ];
  const bad = [];
  for (const src of shapes) bad.push(...checkJsx(compile(src, 'jsx', { main: 'A' }), src.split('\n')[0]));
  assert.deepEqual(bad, [], bad.join('\n'));
});
