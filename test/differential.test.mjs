// The two backends are two spellings of one program. Hand-written tests compare them a case
// at a time, which is how two divergences survived for weeks; this generates programs instead,
// compiles each one both ways, renders both with the same React, and compares what lands on
// the page. A difference is a bug in one of them, and the seed reproduces it exactly.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { generate } from './helpers/generate.mjs';
import { diffAvailable, differs, renderBoth, report, cleanupDiff } from './helpers/differential.mjs';
import { compile } from '../zaal.mjs';

after(cleanupDiff);
const skip = diffAvailable ? false : 'esbuild/react are devDependencies — run npm install';
const OPTS = { main: 'App' };

// `differs` reads a source both backends reject as "not a difference", which is right for a
// hand-written case and wrong for a generated one: a generator that emits an invalid program
// quietly stops testing anything. Nothing else would say so.
test('every generated program compiles', () => {
  const seeds = Number(process.env.ZAAL_DIFF_SEEDS ?? 300);
  const bad = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const src = generate(seed);
    for (const target of ['jsx', 'esm']) {
      try { compile(src, target, OPTS); } catch (e) { bad.push(`seed ${seed} (${target}): ${e.message}`); }
    }
    if (bad.length >= 3) break;
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('generated programs render identically through both backends', { skip }, async () => {
  const seeds = Number(process.env.ZAAL_DIFF_SEEDS ?? 300);
  const found = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const d = await differs(generate(seed), {}, OPTS);
    if (d) found.push(`seed ${seed}: ${report(d)}`);
    if (found.length >= 3) break;
  }
  assert.deepEqual(found, [], found.join('\n\n'));
});

// What the generator found the first time it ran. Both are about how React reads children,
// which a template literal cannot reproduce.
test('a non-string in text renders as React renders it, not as a string', { skip }, async () => {
  const same = async src => {
    const d = await differs(src, {}, OPTS);
    assert.equal(d, null, d && report(d));
  };
  await same('C App s:flag=true\n  p "alpha {flag} omega"\n');
  await same('C App s:x=null\n  p "a {x} b"\n');
  await same('C App s:n=0\n  p "zero {n} here"\n');
  await same('C App s:e=""\n  p "empty {e} here"\n');
  await same('C App s:u=undefined\n  p "gone {u} here"\n');
});

test('two text lines space the way Babel joins them', { skip }, async () => {
  const same = async src => {
    const d = await differs(src, {}, OPTS);
    assert.equal(d, null, d && report(d));
  };
  // both lines literal: one JSXText node, the newline collapses to a space
  await same('C App\n  p\n    "total:"\n    "5 items"\n');
  // the first ends in an expression: a new text node starts, and its newline is stripped
  await same('C App s:n=3\n  p\n    "ok {n}"\n    "total"\n');
  // the second begins with one: same again
  await same('C App s:n=3\n  p\n    "total:"\n    "{n} items"\n');
  await same('C App s:n=3\n  p "a" "b"\n');
});

// The comparison has to fail when the two really differ, or the suite above proves nothing.
test('the comparison catches a planted difference', { skip }, async () => {
  const jsx = 'export default function App() { return <p>a b</p>; }';
  const esm = `import { createElement as h } from 'react';
export default function App() { return h("p", null, "ab"); }`;
  const d = await renderBoth(jsx, esm);
  assert.equal(d?.why, 'different markup');
  assert.equal(d.jsx, '<p>a b</p>');
  assert.equal(d.esm, '<p>ab</p>');
  const agreeing = `import { createElement as h } from 'react';
export default function App() { return h("p", null, "a", ' ', "b"); }`;
  assert.equal(await renderBoth(jsx, agreeing), null, 'and stays quiet when they agree');
});
