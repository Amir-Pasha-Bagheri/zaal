// Size and repetition: deep nesting, long files, many blocks, and the same work done over and
// over. These guard against stack overflows, quadratic blowups and state leaking between runs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { compile, parseUI, uiCss } from '../zaal.mjs';
import { projectDir, buildIn, cleanup } from './helpers/fixture.mjs';

after(cleanup);

test('thirty levels of nesting compile in both backends', () => {
  const src = 'C A\n' + Array.from({ length: 30 }, (_, i) => `${'  '.repeat(i + 1)}div.d${i}`).join('\n') + '\n';
  const jsx = compile(src, 'jsx');
  assert.match(jsx, /className="d29"/);
  assert.equal((jsx.match(/<div/g) || []).length, 30);
  const esm = compile(src, 'esm');
  assert.equal((esm.match(/h\("div"/g) || []).length, 30);
});

test('a map nested four deep keys every level', () => {
  const src = `C A p:a
  ul
    *a as b k=b.id
      li
        *b.cs as c k=c.id
          span
            *c.ds as d k=d.id
              em
                *d.es as e2 k=e2.id
                  i "{e2.v}"
`;
  const out = compile(src, 'jsx');
  for (const k of ['b.id', 'c.id', 'd.id', 'e2.id']) assert.ok(out.includes(`key={${k}}`), k);
});

test('a twenty-arm if-chain becomes one ternary', () => {
  const arms = Array.from({ length: 19 }, (_, i) =>
    `    ${i === 0 ? '?' : ':?'}n == ${i}\n      p "${i}"`).join('\n');
  const out = compile(`C A s:n=0\n  div\n${arms}\n    :\n      p "many"\n`, 'jsx');
  assert.equal((out.match(/ \? \(/g) || []).length, 19);
  assert.equal((out.match(/<p>/g) || []).length, 20);
});

test('fifty attributes on one element all come through', () => {
  const attrs = Array.from({ length: 50 }, (_, i) => `data-k${i}="v${i}"`).join(' ');
  const out = compile(`C A\n  div ${attrs}\n`, 'jsx');
  for (let i = 0; i < 50; i++) assert.ok(out.includes(`data-k${i}="v${i}"`), `attr ${i}`);
});

test('a long text node with many interpolations', () => {
  const words = Array.from({ length: 40 }, (_, i) => `w${i} {n}`).join(' ');
  const out = compile(`C A s:n=0\n  p "${words}"\n`, 'esm');
  assert.equal((out.match(/, n,|, n\)/g) || []).length, 40, 'forty expression children');
});

test('a file with three hundred elements and forty blocks compiles', () => {
  const blocks = Array.from({ length: 40 }, (_, b) => {
    const kids = Array.from({ length: 7 }, (_, i) => `    li.row "item ${i} of ${b}"`).join('\n');
    return `C B${b} p:x=${b}\n  ul\n${kids}`;
  }).join('\n');
  const src = `${blocks}\n`;
  const out = compile(src, 'jsx', { main: 'B0' });
  assert.equal((out.match(/function B\d+/g) || []).length, 40);
  assert.equal((out.match(/<li/g) || []).length, 280);
  assert.equal((out.match(/export default/g) || []).length, 1);
});

test('a design system with two hundred kit entries compiles', () => {
  const kit = Array.from({ length: 200 }, (_, i) =>
    `k e${i} div\n  p $space.1\n  v v${i}\n    bg $color.c${i % 7}\n`).join('');
  const tokens = 't space\n  1 4px\nt color\n' + Array.from({ length: 7 }, (_, i) => `  c${i} #00${i}\n`).join('');
  const ui = parseUI(tokens + kit);
  const css = uiCss(ui);
  assert.equal(Object.keys(ui.kit).length, 200);
  assert.equal((css.match(/^\.e\d+ \{$/gm) || []).length, 200);
  assert.equal((css.match(/^\.e\d+\.v\d+ \{$/gm) || []).length, 200);
  assert.doesNotMatch(css, /\$(space|color)\./);
});

test('a hundred and twenty sources build, and the modules parse', () => {
  const files = {
    'zaal/app.zaal': 'A Big\n  ui ./ui.zaal\n  store Hub\n  / Home\n',
    'zaal/ui.zaal': 'D B\nt color\n  bg #fff\nk page main\n  bg $color.bg\nk card section\n  p 0\n',
    'zaal/stores/Hub.zaal': 'S Hub persist s:open=[]\n  memo count = open.length\n'
      + '  cb toggle(id) = open=open.includes(id) ? open.filter(x => x !== id) : [...open, id]\n',
  };
  const names = Array.from({ length: 118 }, (_, i) => `P${i}`);
  for (const [i, n] of names.entries()) {
    files[`zaal/parts/d${i % 10}/${n}.zaal`] = `C ${n} p:id="${n}"
  use { open, toggle } = Hub
  memo mine = open.includes(id)
  %card
    h3 "${n}"
    ?mine
      p "open"
    :
      button @click=toggle(id) "open"
`;
  }
  files['zaal/Home.zaal'] = names.map((n, i) => `i ${n} ./parts/d${i % 10}/${n}`).join('\n')
    + '\nC Home\n  use { count } = Hub\n  %page\n    h1 "{count} open"\n'
    + names.map(n => `    ${n}`).join('\n') + '\n';
  const root = projectDir(files);
  const started = Date.now();
  const out = buildIn(root);
  assert.equal(out.made.length, 120);
  assert.deepEqual(out.warnings, []);
  assert.ok(Date.now() - started < 20000, `build took ${Date.now() - started}ms`);
  const esm = buildIn(root, 'esm');
  for (const f of ['src/Home.js', 'src/parts/d0/P0.js', 'src/parts/d9/P99.js', 'src/stores/Hub.js', 'src/main.js']) {
    execFileSync(process.execPath, ['--check', join(root, '.zaal-dev', f)], { stdio: 'pipe' });
  }
  assert.equal(esm.made.length, 120);
});

test('compiling the same file five hundred times is stable and fast', () => {
  const src = `C Row p:item p:onPick
  use { items, add } = Cart
  memo total = items.length
  cb pick() = onPick(item); add(item)
  %card
    h3 "{item.name} ({total})"
    ?item.stock
      button @click=pick "pick"
    :
      p "gone"
`;
  const opts = { stores: new Map([['Cart', 'stores/Cart']]),
    ui: { kit: { card: { el: 'section' } }, known: new Set(['card']) }, main: 'Row' };
  const first = compile(src, 'jsx', opts);
  const started = Date.now();
  for (let i = 0; i < 500; i++) assert.equal(compile(src, 'jsx', opts), first);
  assert.ok(Date.now() - started < 10000, `500 compiles took ${Date.now() - started}ms`);
});

test('a thrown error leaves nothing behind for the next compile', () => {
  const good = 'C A s:n=0\n  button @click=n++ "x"\n';
  const before = compile(good, 'jsx');
  for (const bad of ['C B\n  Missing\n', 'C C\n  %ghost "x"\n', 'C D\n  memo x\n  p "y"\n',
    'C E p:1x\n  p "y"\n', 'C F\n  div\n    fx log(1)\n']) {
    assert.throws(() => compile(bad, 'jsx', { ui: { kit: {}, known: new Set() } }));
  }
  assert.equal(compile(good, 'jsx'), before);
});

test('a source with CRLF, tabs and trailing spaces at size', () => {
  const lines = Array.from({ length: 200 }, (_, i) => `\tp.row "line ${i}"   `);
  const src = ['C A', ...lines].join('\r\n') + '\r\n';
  const out = compile(src, 'jsx');
  assert.equal((out.match(/<p className="row">/g) || []).length, 200);
  assert.doesNotMatch(out, /\r/);
});
