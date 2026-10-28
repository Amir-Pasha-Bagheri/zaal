// SPEC.md and README.md, compiled.
//
// The documentation is the only statement of what the language is, and until now nothing ran
// it. Every Zaal snippet in it is a promise that the compiler accepts that shape, and the
// `js`/`jsx` block printed under one is a promise about what it writes — so a snippet that
// stopped compiling, or an output listing that drifted from the generator, was invisible. The
// sweeps below read the documents themselves, so a new example is checked the day it is
// written and a renamed directive fails the test that documents it.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { blocks, KIT, KNOWN, asModule } from './helpers/docs.mjs';
import { checkJsx } from './helpers/jsx-check.mjs';
import { available, parseJsx, cleanupReal } from './helpers/real-react.mjs';
import { compile, parseApp, parseUI, uiCss } from '../zaal.mjs';

after(cleanupReal);

const DOCS = ['SPEC.md', 'README.md'];
const all = DOCS.flatMap(blocks);

const scope = {
  ui: parseUI(KIT),
  stores: new Map(KNOWN.stores.map(n => [n, `stores/${n}`])),
  comps: new Map(KNOWN.comps.map(n => [n, { file: `components/${n}` }])),
  hooks: new Map(KNOWN.hooks.map(n => [n, { file: `hooks/${n}` }])),
};

// Every block the sweeps below compile, as source ready for `compile`.
const sources = all
  .filter(b => b.kind === 'module' || b.kind === 'markup')
  .map(b => ({ ...b, src: b.kind === 'markup' ? asModule(b.body) : b.body, main: 'Spec' }));

const where = b => `${b.file} block #${b.at}`;

// The sweeps are only worth what the extraction found. A heading rewritten, a fence given a
// language, the regex outgrown — any of those would quietly empty the list and leave every
// test below passing over nothing, which is the one failure a sweep cannot report itself.
test('the documents still yield the examples these tests sweep', () => {
  const count = k => all.filter(b => b.kind === k).length;
  assert.ok(sources.length >= 14, `only ${sources.length} Zaal examples extracted`);
  assert.ok(count('app') >= 3, `only ${count('app')} app.zaal examples extracted`);
  assert.ok(count('ui') >= 2, `only ${count('ui')} ui.zaal examples extracted`);
  assert.ok(count('output') >= 4, `only ${count('output')} documented output blocks extracted`);
  // nothing fell through the classifier into a bucket that is never checked
  assert.deepEqual(all.filter(b => b.kind === 'other').map(where), [],
    'a fenced block the classifier could not place');
});

test('every Zaal example in the documentation compiles, both backends', () => {
  const bad = [];
  for (const b of sources) {
    for (const target of ['jsx', 'esm']) {
      try { compile(b.src, target, { ...scope, main: b.main }); }
      catch (e) { bad.push(`${where(b)} (${target}): ${e.message.split('\n')[0]}`); }
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

// `C Clock …` and the `js` block under it are one example in two halves: the second says what
// the first compiles to. They were written by hand and could drift from the generator a line
// at a time, so every line of the documented output has to appear in the module the compiler
// actually writes. Two allowances, both about layout rather than code: a listing may put a
// short body on one line where the generator breaks it over three, so both sides are compared
// with their whitespace collapsed; and `…` is prose standing in for the rest, so it skips.
test('the output each example documents is the output the compiler writes', () => {
  const pairs = [];
  for (const doc of DOCS) {
    const bs = blocks(doc);
    for (let i = 0; i + 1 < bs.length; i++) {
      if (bs[i].kind === 'module' && bs[i + 1].kind === 'output') pairs.push([bs[i], bs[i + 1]]);
    }
  }
  assert.ok(pairs.length >= 4, `only ${pairs.length} example/output pairs found`);

  const flat = s => s.replace(/\s+/g, ' ');
  const bad = [];
  for (const [zaal, out] of pairs) {
    // the block a documented listing belongs to: its first `C`/`S`/`H` name
    const main = /^[CSH]\s+([^\s]+)/m.exec(zaal.body)?.[1];
    let code;
    try { code = compile(zaal.body, 'jsx', { ...scope, main }); }
    catch (e) { bad.push(`${where(zaal)}: ${e.message.split('\n')[0]}`); continue; }
    const got = flat(code);
    for (const line of out.body.split('\n')) {
      const want = flat(line).trim();
      if (!want || want.includes('…')) continue;        // prose elision, not code
      if (!got.includes(want)) {
        bad.push(`${where(out)} documents a line ${where(zaal)} does not produce:`
          + `\n    documented: ${want}\n    compiled:\n${code.replace(/^/gm, '      ')}`);
      }
    }
  }
  assert.deepEqual(bad, [], bad.join('\n\n'));
});

// The deliverable is JSX, and a snippet in the spec is as entitled to valid output as a source
// in the example app. These two are what the rest of the suite runs over its own fixtures.
test('every example writes structurally valid JSX', () => {
  const bad = [];
  for (const b of sources) {
    const code = compile(b.src, 'jsx', { ...scope, main: b.main });
    bad.push(...checkJsx(code, where(b)));
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('every example parses as real JSX', { skip: available ? false : 'esbuild is a devDependency' }, () => {
  const bad = [];
  for (const b of sources) {
    const err = parseJsx(compile(b.src, 'jsx', { ...scope, main: b.main }), where(b));
    if (err) bad.push(err);
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

// `A Demo` blocks: the spec lists every directive an app declaration takes, and an unknown one
// is an error by design — so a directive the spec shows and the parser dropped fails here.
test('every app.zaal example in the documentation parses', () => {
  const bad = [];
  for (const b of all.filter(x => x.kind === 'app')) {
    try { parseApp(b.body); } catch (e) { bad.push(`${where(b)}: ${e.message.split('\n')[0]}`); }
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

// The design-system examples, through to CSS. A `D` header is the one line the spec's fragments
// leave off, since the prose has already said which file they are in.
test('every ui.zaal example in the documentation compiles to CSS', () => {
  const bad = [];
  for (const b of all.filter(x => x.kind === 'ui')) {
    const src = /^D\s/m.test(b.body) ? b.body : `D Spec\n${b.body}`;
    try {
      const css = uiCss(parseUI(src));
      if (!css.trim()) bad.push(`${where(b)}: compiled to nothing`);
    } catch (e) { bad.push(`${where(b)}: ${e.message.split('\n')[0]}`); }
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

// "`i`, `js`, `slot`, `portal`, `provide`, `ret`, `fx`, `memo`, `cb`, `ref`, `ctx` and `use`
// are reserved heads, so no element may be named one." The promise is about the *tag*: each
// line is read as the construct it names, never as a `<portal>` or an `<fx>` on the page. So
// the line either is rejected or means its construct — and either way nothing of that name
// reaches the output as an element.
test('no element is ever named a head the spec reserves', () => {
  // the list the spec gives, minus `i`, which is the documented exception below
  const reserved = ['js', 'slot', 'portal', 'provide', 'ret', 'fx', 'memo', 'cb', 'ref', 'ctx', 'use'];
  const bad = [];
  for (const head of reserved) {
    // every shape an element can take: bare, with children, with text, with an attribute
    for (const src of [
      `C A\n  div\n    ${head}\n      p "x"\n`,
      `C A\n  div\n    ${head} "text"\n`,
      `C A\n  div\n    ${head} c="x"\n`,
      `C A\n  ${head}\n`,
    ]) {
      let code = null;
      try { code = compile(src, 'jsx', { main: 'A' }); } catch { continue; }  // rejected: fine
      // compiled, so it has to have meant its construct — not an element of that name
      if (new RegExp(`</?${head}[ />]`).test(code)) {
        bad.push(`\`${head}\` reached the output as an element:\n${code.replace(/^/gm, '    ')}`);
      }
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'));

  // `i` is the exception the spec calls out: `i "text"` and `i c="…"` stay the <i> element,
  // while `i X ./X` is the import.
  assert.match(compile('C A\n  p\n    i "text"\n', 'jsx', { main: 'A' }), /<i>text<\/i>/);
  assert.match(compile('C A\n  p\n    i c="em" "t"\n', 'jsx', { main: 'A' }), /<i className="em">t<\/i>/);
  assert.match(compile('i X ./X\nC A\n  X\n', 'jsx', { main: 'A' }), /^import X from '\.\/X\.jsx';/m);
});
