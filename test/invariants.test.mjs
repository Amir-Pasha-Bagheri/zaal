// Properties that have to hold for *every* source, rather than for a case someone thought of.
//
// The rest of the suite checks what the compiler does with particular inputs. These check the
// shape of the whole mapping: that layout a developer is free to choose (indent width, tabs,
// line endings, blank lines, trailing comments) cannot change a single byte of the output, that
// the two backends disagree about nothing but React itself, and that no input at all — valid,
// half-typed or corrupted — produces an error without a line number or an error from inside
// the compiler instead of about the source. They are run over the awkward corpus, the generated
// programs and the example app together, so a regression anywhere is caught by all of them.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compile, parseUI, uiCss, inFile } from '../zaal.mjs';
import { generate, rng } from './helpers/generate.mjs';
import { exampleDir, cleanup, read } from './helpers/fixture.mjs';

after(cleanup);

const file = p => readFileSync(new URL(`../${p}`, import.meta.url).pathname, 'utf8');

const corpus = JSON.parse(file('test/corpus.json'));
const ui = parseUI(file('example/zaal/ui.zaal'));
const UI_SRC = file('example/zaal/ui.zaal');

// Three populations, because each finds different things: the corpus is the awkward shapes a
// person wrote down, the generator is the combinations nobody would, and the example app is
// the only one that is a whole program.
const SEEDS = Number(process.env.ZAAL_INVARIANT_SEEDS ?? 60);
const sources = [
  ...corpus.map((src, i) => ({ id: `corpus ${i}`, src, opts: { ui, main: 'A' } })),
  ...Array.from({ length: SEEDS }, (_, i) => ({ id: `seed ${i + 1}`, src: generate(i + 1), opts: { main: 'App' } })),
];

// Every source that compiles, so a reformatting test never reports "it threw" for a source that
// was never going to compile in the first place.
const valid = [];
for (const s of sources) {
  try { valid.push({ ...s, jsx: compile(s.src, 'jsx', s.opts), esm: compile(s.src, 'esm', s.opts) }); }
  catch { /* an invalid source belongs to the fuzz below, not here */ }
}

test('the populations these properties are checked over are not empty', () => {
  assert.ok(corpus.length >= 10, `the corpus has only ${corpus.length} sources`);
  assert.ok(valid.length >= 50, `only ${valid.length} of ${sources.length} sources compile`);
});

// ---------- layout is not meaning ----------

// Indentation nests, so how *wide* it is cannot matter; nor can tabs, the line ending a
// developer's editor writes, a blank line between two blocks, a trailing space a save left
// behind, or a comment. Each of these is a thing a formatter, a git checkout on another
// platform or a second person on the project will change, and none may move the output.
const reformat = {
  'an indent of four spaces': src => src.split('\n')
    .map(l => '    '.repeat(((/^ */.exec(l)[0].length) / 2) | 0) + l.trimStart()).join('\n'),
  'an indent of tabs': src => src.split('\n')
    .map(l => '\t'.repeat(((/^ */.exec(l)[0].length) / 2) | 0) + l.trimStart()).join('\n'),
  'CRLF line endings': src => src.replace(/\n/g, '\r\n'),
  'a blank line after every line': src => src.split('\n').map(l => (l.trim() ? l + '\n' : l)).join('\n'),
  'trailing whitespace': src => src.split('\n').map(l => (l.trim() ? l + '   \t ' : l)).join('\n'),
  'a trailing comment on every line': src => src.split('\n')
    .map(l => (l.trim() ? l + '  // a note' : l)).join('\n'),
  'a leading byte-order mark': src => '\uFEFF' + src,
};

for (const [what, rewrite] of Object.entries(reformat)) {
  test(`${what} changes nothing about the output`, () => {
    const bad = [];
    for (const s of valid) {
      // a `js` line is verbatim JavaScript, so a comment appended to one is part of the code
      if (what.includes('comment') && /^\s*js\s/m.test(s.src)) continue;
      for (const target of ['jsx', 'esm']) {
        let got;
        try { got = compile(rewrite(s.src), target, s.opts); }
        catch (e) { bad.push(`${s.id} (${target}): threw — ${e.message.split('\n')[0]}`); continue; }
        if (got !== s[target]) {
          bad.push(`${s.id} (${target}): output changed\n  source:\n${s.src.replace(/^/gm, '    ')}`
            + `\n  before:\n${s[target].replace(/^/gm, '    ')}\n  after:\n${got.replace(/^/gm, '    ')}`);
        }
      }
      if (bad.length >= 3) break;
    }
    assert.deepEqual(bad, [], bad.join('\n\n'));
  });
}

// The design system is a second parser, with its own comment stripping and its own notion of a
// line — so it needs the property proved separately. It did not hold: `//.*$` cannot match a
// CRLF line, because `.` does not match `\r`, so a comment survived the strip and read as a
// directive (or, on a value line, as part of the value).
test('the same is true of the design system', () => {
  const base = uiCss(parseUI(UI_SRC));
  const bad = [];
  for (const [what, rewrite] of Object.entries(reformat)) {
    let got;
    try { got = uiCss(parseUI(rewrite(UI_SRC))); }
    catch (e) { bad.push(`${what}: threw — ${e.message.split('\n')[0]}`); continue; }
    if (got !== base) bad.push(`${what}: the compiled CSS changed`);
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

// ---------- the two backends are one program ----------

// `jsx` and `esm` are two spellings of the same module, and the only thing they may disagree
// about is React itself: the esm backend always binds `createElement` and `Fragment`, which JSX
// needs no import for. Every *other* import — a local module, a package, a store, a context, a
// stylesheet — has to be the same set in both, or one of the backends is reaching for something
// the other does not, which is how a module that works in the preview fails in the deliverable.
test('both backends import exactly the same modules, React aside', () => {
  const specs = code => [...code.matchAll(/from '([^']+)'|import '([^']+)'/g)]
    .map(m => (m[1] ?? m[2]).replace(/\.(jsx|js)$/, ''))
    .filter(s => s !== 'react' && s !== 'react-dom')
    .sort();
  const bad = [];
  for (const s of valid) {
    const a = specs(s.jsx), b = specs(s.esm);
    if (a.join() !== b.join()) {
      bad.push(`${s.id}:\n  jsx: ${a.join(', ')}\n  esm: ${b.join(', ')}`
        + `\n  source:\n${s.src.replace(/^/gm, '    ')}`);
    }
  }
  assert.deepEqual(bad, [], bad.join('\n\n'));
});

// Whatever the backend, a module declares every name it is given and no name twice — the one
// mistake that makes a module fail to parse rather than fail to run.
test('no module declares a name twice, in either backend', () => {
  const bad = [];
  for (const s of valid) {
    for (const target of ['jsx', 'esm']) {
      const seen = new Map();
      for (const [, kind, name] of s[target]
        .matchAll(/^(?:export\s+)?(const|let|var|function|class)\s+([\w$]+)/gm)) {
        if (seen.has(name)) bad.push(`${s.id} (${target}): ${name} declared as ${seen.get(name)} and ${kind}`);
        seen.set(name, kind);
      }
    }
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

// ---------- every error names its line ----------

// "Every error names the line that caused it — `zaal/Home.zaal:7  message` plus the line itself
// — so the message alone is enough to fix the mistake." That is a promise about *all* of them,
// and the only way to check it is to break sources on purpose, in the ways a half-finished edit
// breaks them: a line deleted, a quote or a brace dropped, indentation shifted, a head
// misspelled. One error did not keep it (`bad package specifier`, thrown raw rather than
// through `fail`), which is what this found.
const MUTATE = [
  (src, at) => { const l = src.split('\n'); l.splice(at % l.length, 1); return l.join('\n'); },
  src => src.replace(/"/, ''),
  src => src.replace(/=/, ''),
  src => src.replace(/\{/, ''),
  src => src.replace(/\}/, ''),
  src => src.replace(/\(/, ''),
  (src, at) => { const l = src.split('\n'); const i = at % l.length; l[i] = '  ' + l[i]; return l.join('\n'); },
  (src, at) => { const l = src.split('\n'); const i = at % l.length; l[i] = l[i].trimStart(); return l.join('\n'); },
  src => src.replace(/\bC /, 'X '),
  src => src.replace(/(\w)/, '$1@'),
  src => src.replace(/\*/, ':'),
  src => src.replace(/\?/, '*'),
  src => src.replace(/p:/, 'p'),
  src => src.replace(/s:/, 's'),
  src => src + '  zzz "x"\n',
  src => '  ' + src,
  src => src.replace(/\n/, '\n  '),
];

// A corrupted source is rejected or compiled — either is fine. What is not fine is being told
// about it in a way that does not say where, or being told about the compiler's own internals.
test('no source, however broken, produces an error that fails to name its line', () => {
  const r = rng(20251028);
  const unlocated = [], internal = [];
  let errors = 0;
  for (let n = 0; n < 4000; n++) {
    const s = sources[Math.floor(r() * sources.length)];
    const mutate = MUTATE[Math.floor(r() * MUTATE.length)];
    const broken = mutate(s.src, Math.floor(r() * 40));
    for (const target of ['jsx', 'esm']) {
      let e = null;
      try { inFile(broken, 'f.zaal', () => compile(broken, target, s.opts)); } catch (err) { e = err; }
      if (!e) continue;
      errors++;
      const report = `[${target}] ${e.message.split('\n')[0]}\n  source:\n${broken.replace(/^/gm, '    ')}`;
      // `f.zaal:<line>  <message>` is the shape `located` promises
      if (!/^f\.zaal:\d+ {2}/.test(e.message) && unlocated.length < 5) unlocated.push(report);
      // a TypeError from inside the compiler is a crash wearing an error's clothes
      if (/Cannot read|is not a function|is not iterable|undefined is not|Maximum call stack/.test(e.message)
        && internal.length < 5) internal.push(report);
    }
  }
  assert.ok(errors > 500, `only ${errors} of the mutated sources were rejected — are they mutating?`);
  assert.deepEqual(internal, [], `the compiler crashed instead of reporting:\n${internal.join('\n\n')}`);
  assert.deepEqual(unlocated, [], `an error that does not name its line:\n${unlocated.join('\n\n')}`);
});

// And the line it names is quoted in the message, which is what makes the message enough on its
// own. A line number alone still costs a trip back to the file.
test('an error quotes the line it names, and names the file it came from', () => {
  const cases = [
    ['C A\n  %nope\n', /nope/],
    ['C A\n  div\n    fx x\n', /fx x/],
    ['C A s:n=0\n  button @click=n.push(1) "x"\n', /n\.push/],
    ['i { x from pkg\nC A\n  p "x"\n', /from pkg/],
  ];
  for (const [src, quoted] of cases) {
    assert.throws(() => inFile(src, 'zaal/pages/Home.zaal', () => compile(src, 'jsx', {})), e => {
      assert.match(e.message, /^zaal\/pages\/Home\.zaal:\d+ {2}/, `names the file and line: ${src}`);
      assert.match(e.message, /\n\s+\d+ \| /, `and quotes it: ${e.message}`);
      assert.match(e.message, quoted, `with the offending text: ${e.message}`);
      return true;
    });
  }
});

// ---------- the example app, as a whole program ----------

// The one source tree that is a real app rather than a fixture: the same reformatting applied
// to every file of it at once, through a whole build, so the property is checked on the
// interactions between files too — imports, the store order, the swept output.
test('reformatting every source of the example app rebuilds it byte for byte', async () => {
  const { buildIn } = await import('./helpers/fixture.mjs');
  const { readdirSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');

  const base = exampleDir();
  buildIn(base, 'jsx');
  const files = [];
  const walk = dir => {
    for (const e of readdirSync(join(base, dir), { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(dir, e.name));
      else if (/\.(jsx|js|css|html)$/.test(e.name)) files.push(join(dir, e.name));
    }
  };
  walk('application');
  assert.ok(files.length > 10, `the example built only ${files.length} files`);
  const before = new Map(files.map(f => [f, read(base, f)]));

  // every .zaal source rewritten to tabs and CRLF, which is the pair most likely to differ
  const other = exampleDir();
  const rewrite = dir => {
    for (const e of readdirSync(join(other, dir), { withFileTypes: true })) {
      if (e.isDirectory()) { rewrite(join(dir, e.name)); continue; }
      if (!/\.zaal$/.test(e.name)) continue;
      const src = read(other, join(dir, e.name));
      writeFileSync(join(other, dir, e.name),
        reformat['an indent of tabs'](src).replace(/\n/g, '\r\n'));
    }
  };
  rewrite('zaal');
  buildIn(other, 'jsx');

  const bad = [];
  for (const [f, want] of before) {
    const got = read(other, f);
    if (got !== want) bad.push(f);
  }
  assert.deepEqual(bad, [], `these outputs differ after reformatting the sources: ${bad.join(', ')}`);
});
