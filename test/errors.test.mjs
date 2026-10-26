// Diagnostics: every mistake the compiler is supposed to catch, and the line it names.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../zal.mjs';
import { projectDir, buildIn, has, cleanup } from './helpers/fixture.mjs';

after(cleanup);

const UI = { kit: { card: { el: 'section' }, btn: { el: 'button' } }, known: new Set(['card', 'btn']) };
const throws = (src, re, opts) => assert.throws(() => compile(src, 'jsx', opts), re);

test('an unknown %kit entry is an error', () => {
  throws('C A\n  %nope "x"\n', /%nope is not in the UI kit/, { ui: UI });
});

test('a class with no kit entry is a warning, not an error', () => {
  const used = new Set();
  compile('C A\n  .mystery "x"\n', 'jsx', { ui: UI, used });
  assert.ok(used.has('mystery'));
  const root = projectDir({
    'zal/app.zal': 'A Demo\n  ui ./ui.zal\n  / Home\n',
    'zal/ui.zal': 'D T\nk card section\n  p 0\n',
    'zal/Home.zal': 'C Home\n  .mystery "x"\n',
  });
  const out = buildIn(root);
  assert.deepEqual(out.warnings, ['Home.zal: class .mystery is not in the UI kit']);
});

test('a component that is not in scope is an error with a fix', () => {
  throws('C A\n  Missing\n', /<Missing> is not in scope — no `C Missing` in zal\/, and no `i` line for it/);
});

test('a near-miss suggests the import line that would fix it', () => {
  const comps = new Map([['Panel', { file: 'components/Panel', named: false }]]);
  throws('C A\n  Pannel\n', /add `i Panel \.\.\/components\/Panel`/, { comps, dir: 'pages' });
  throws('C A\n  Panel\n', /add `i Panel \.\/components\/Panel`/, { comps });
});

test('a named export suggests the braced import form', () => {
  const comps = new Map([['Row', { file: 'Table', named: true }]]);
  throws('C A\n  Row\n', /add `i \{ Row \} from \.\/Table`/, { comps });
});

test('a hook line inside markup is an error', () => {
  throws('C A\n  div\n    fx log(1)\n', /hook lines must be direct children of `C`/);
});

test('`:` without a `?` above it is an error', () => {
  throws('C A\n  div\n    p "a"\n    :\n      p "b"\n', /needs a `\?` branch directly above it/);
});

test('`:` has to be the last branch', () => {
  throws('C A p:a\n  div\n    ?a\n      p "a"\n    :\n      p "b"\n    :?a\n      p "c"\n',
    /`:` is the last branch/);
});

test('a top-level line inside markup is an error', () => {
  throws('C A\n  div\n    C Nested\n      p "x"\n', /top-level line — it can't appear inside markup/);
});

test('slot needs a prop name, markup, and a component to land on', () => {
  throws('i P ./P\nC A\n  P\n    slot\n      p "x"\n', /expected `slot <propName>`/);
  throws('i P ./P\nC A\n  P\n    slot actions\n', /slot actions: nothing to pass/);
  throws('C A\n  div\n    slot actions\n      p "x"\n', /slot actions: <div> is not a component/);
});

test('two unknown spreads cannot both be the rest prop', () => {
  throws('C A\n  div ...a\n    input ...b\n', /only one of them can be the rest prop/);
});

test('an error boundary has no state and no hooks', () => {
  throws('C Oops catch s:n=0\n  p "x"\n', /an error boundary is a class, so it has no `s:` state/);
  throws('C Oops catch\n  fx log(1)\n  p "x"\n', /so it has no hooks/);
});

test('`fx a` is not a dependency list', () => {
  throws('C A p:a\n  fx a\n  p "x"\n', /is not a dep list — write `fx\[a\]`/);
});

test('an empty effect body is an error', () => {
  throws('C A\n  fx\n  p "x"\n', /fx: empty effect body/);
});

test('memo, cb and ctx need `name = expr`', () => {
  throws('C A\n  memo x\n  p "x"\n', /memo: expected `memo <name> = <expr>`/);
  throws('C A\n  cb f\n  p "x"\n', /cb: expected `cb <name> = <expr>`/);
  throws('C A\n  cb 1bad() = log(1)\n  p "x"\n', /cb: bad name/);
});

test('a hook name that is already taken is an error', () => {
  throws('C A s:n=0\n  memo n = 1\n  p "x"\n', /n is already a `s:` state/);
  throws('C A p:x\n  ref x\n  p "y"\n', /x is already a `p:` prop/);
  throws('C A\n  use id = useId()\n  memo id = 2\n  p "x"\n', /id is already declared by an earlier line/);
  throws('S B s:filter=""\n  cb setFilter(t) = filter=t\n', /setFilter is already the setter for `s:filter`/);
});

test('a non-identifier hook name is an error, not broken output', () => {
  throws('C A\n  cb 1bad() = log(1)\n  p "x"\n', /cb: bad name `1bad\(\)`/);
  throws('C A\n  ref 2x\n  p "x"\n', /ref: bad name `2x`/);
  throws('C A\n  memo 3y = 1\n  p "x"\n', /memo: bad name `3y`/);
});

test('a bad selector is an error', () => {
  throws('C A\n  div/oops "x"\n', /bad selector: div\/oops/);
});

test('errors name the file and line, and quote the line', () => {
  const root = projectDir({
    'zal/app.zal': 'A Demo\n  / Home\n',
    'zal/Home.zal': 'C Home\n  div\n    p "ok"\n    %ghost "x"\n',
  });
  assert.throws(() => buildIn(root), e => {
    assert.match(e.message, /^zal\/Home\.zal:4 {2}%ghost is not in the UI kit/);
    assert.match(e.message, /4 \| %ghost "x"/);
    return true;
  });
});

test('a failed build writes nothing, so the last good output stays', async () => {
  const root = projectDir({
    'zal/app.zal': 'A Demo\n  / Home\n',
    'zal/Home.zal': 'C Home\n  h1 "first"\n',
  });
  buildIn(root);
  const { writeFileSync, readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const before = readFileSync(join(root, 'application/src/Home.jsx'), 'utf8');
  writeFileSync(join(root, 'zal/Home.zal'), 'C Home\n  h1 "second"\n');
  writeFileSync(join(root, 'zal/Broken.zal'), 'C Broken\n  Nope\n');
  assert.throws(() => buildIn(root), /<Nope> is not in scope/);
  assert.equal(readFileSync(join(root, 'application/src/Home.jsx'), 'utf8'), before);
  assert.ok(!has(root, 'application/src/Broken.jsx'));
});
