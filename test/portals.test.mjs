// `portal` (ROADMAP F3) — markup that renders somewhere else in the document. Before this, a
// modal meant a hand-written `{createPortal(…)}` expression child, with the import, the target
// and the JSX all written out by hand: the one escape hatch left in markup.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../zaal.mjs';
import { checkJsx } from './helpers/jsx-check.mjs';
import { domAvailable, mountApp, cleanupDom } from './helpers/dom.mjs';
import { available, parseJsx, cleanupReal } from './helpers/real-react.mjs';

after(cleanupDom);
after(cleanupReal);

const jsx = (src, opts) => compile(src, 'jsx', opts);
const esm = (src, opts) => compile(src, 'esm', opts);
const err = (src, opts) => { try { jsx(src, opts); return null; } catch (e) { return e.message; } };

const MODAL = 'C A s:open=false\n  button @click=open=true "open"\n  ?open\n    portal\n'
  + '      .scrim\n        p "hi"\n';

/* ---------- what it generates ---------- */

test('portal with no target renders on document.body', () => {
  const out = jsx(MODAL);
  assert.match(out, /createPortal\(\n\s*<div className="scrim">[\s\S]*?<\/div>,\n\s*document\.body\n\s*\)/);
});

test('createPortal comes from react-dom, not from react', () => {
  const out = jsx(MODAL);
  assert.match(out, /import \{ createPortal \} from 'react-dom';/);
  assert.match(out, /import \{ useState \} from 'react';/);
  assert.doesNotMatch(out, /import \{[^}]*createPortal[^}]*\} from 'react';/);
  // and only where it is used
  assert.doesNotMatch(jsx('C A\n  p "x"\n'), /react-dom/);
});

test('a quoted target is a selector, anything else is the expression', () => {
  assert.match(jsx('C A\n  portal "#overlay"\n    p "x"\n'),
    /document\.querySelector\("#overlay"\)/);
  assert.match(jsx('C A\n  ref host\n  div ref=host\n  portal host.current\n    p "x"\n'),
    /createPortal\(\n\s*<p>x<\/p>,\n\s*host\.current\n\s*\)/);
  assert.match(jsx('C A p:to\n  portal {to ?? document.body}\n    p "x"\n'),
    /to \?\? document\.body/);
});

test('the esm backend writes the same call', () => {
  const out = esm('C A\n  portal "#overlay"\n    .scrim\n      p "hi"\n');
  assert.match(out, /createPortal\(h\("div", \{ "className": "scrim" \}, h\("p", null, "hi"\)\), document\.querySelector\("#overlay"\)\)/);
  assert.match(out, /import \{ createPortal \} from 'react-dom';/);
});

test('a portal at the root is the return value, with no fragment around it', () => {
  const out = jsx('C A\n  portal\n    .modal "x"\n');
  assert.match(out, /return \(\n\s*createPortal\(/);
  assert.doesNotMatch(out, /<>/);
  assert.match(esm('C A\n  portal\n    .modal "x"\n'), /return createPortal\(/);
});

test('a portal among children is braced, as any expression is', () => {
  const out = jsx('C A\n  div\n    p "before"\n    portal\n      p "away"\n');
  assert.match(out, /\{createPortal\(/);
  assert.deepEqual(checkJsx(out), []);
});

test('a portal in a map takes the key as createPortal\'s third argument', () => {
  const src = 'C A p:rows\n  *rows as r k=r.id\n    portal\n      p "{r.t}"\n';
  assert.match(jsx(src), /createPortal\(\n\s*<p>\{r\.t\}<\/p>,\n\s*document\.body,\n\s*r\.id\n\s*\)/);
  assert.match(esm(src), /createPortal\(h\("p", null, r\.t\), document\.body, r\.id\)/);
  // never a keyed fragment wrapped around it — the two backends take the same route
  assert.doesNotMatch(esm(src), /h\(F,/);
});

test('several roots, a portal among them, and a portal holding a branch', () => {
  const out = jsx('C A p:ok\n  h1 "page"\n  portal\n    ?ok\n      p "y"\n    :\n      p "n"\n');
  assert.match(out, /\{createPortal\(\n\s*<>\n\s*\{ok \? \(/);
  assert.deepEqual(checkJsx(out), []);
});

test('a module that binds createPortal itself keeps its own', () => {
  const out = jsx('js const createPortal = mine\nC A\n  portal\n    p "x"\n');
  assert.doesNotMatch(out, /from 'react-dom'/);
  assert.deepEqual(checkJsx(out), []);
});

test('a portal is markup, so a component may pass one as a slot or as children', () => {
  const out = jsx('i Panel ./Panel\nC A\n  Panel\n    slot overlay\n      portal\n        p "x"\n');
  assert.match(out, /overlay=\{createPortal\(/);
  assert.deepEqual(checkJsx(out), []);
});

test('an error boundary may portal its fallback, and a block may portal twice', () => {
  const out = jsx('C Oops catch\n  portal\n    .scrim\n      p "{error.message}"\n'
    + '      button @click=reset "retry"\n');
  assert.match(out, /if \(!error\) return children;\n\s*return \(\n\s*createPortal\(/);
  assert.deepEqual(checkJsx(out), []);
  const two = jsx('C A\n  portal\n    p "one"\n  portal "#b"\n    p "two"\n');
  assert.equal(two.match(/createPortal\(/g).length, 2);
  assert.match(two, /document\.body/);
  assert.match(two, /document\.querySelector\("#b"\)/);
  assert.deepEqual(checkJsx(two), []);
});

/* ---------- what it reports ---------- */

test('a portal with nothing under it is an error', () => {
  assert.match(err('C A\n  portal\n'), /portal has nothing under it/);
  assert.match(err('C A\n  portal "#x"\n'), /portal has nothing under it/);
});

test('two targets, and an empty selector, are errors', () => {
  assert.match(err('C A\n  portal a b\n    p "x"\n'), /portal: one target/);
  assert.match(err('C A\n  portal ""\n    p "x"\n'), /portal "": a target selector/);
});

test('a hook block and a store have no markup, so neither has a portal', () => {
  assert.match(err('H useX\n  portal\n    p "x"\n', { main: 'useX' }), /a hook has no markup/);
  assert.match(err('S T s:n=0\n  portal\n    p "x"\n', { main: 'T' }), /a store has no markup/);
});

test('the lines a portal may not hold are reported as they are anywhere else', () => {
  assert.match(err('C A\n  portal\n    slot head\n      p "x"\n'), /a slot fills a prop/);
  assert.match(err('C A\n  portal\n    fx go()\n'), /hook lines must be direct children/);
});

/* ---------- the oracles ---------- */

test('every shape writes structurally valid JSX', () => {
  const srcs = [
    MODAL,
    'C A\n  portal "#overlay"\n    .scrim\n      p "a < b"\n',
    'C A p:rows\n  *rows as r k=r.id\n    portal\n      p "{r.t}"\n',
    'C A p:as p:to\n  portal {to}\n    {as} c="box"\n      {children}\n',
    'C A\n  portal\n    portal "#deep"\n      p "nested"\n',
  ];
  for (const src of srcs) assert.deepEqual(checkJsx(jsx(src), src), [], src);
});

const realSkip = available ? false : 'esbuild/react are devDependencies — run npm install';

test('the output parses as real JSX', { skip: realSkip }, () => {
  // (react-dom/server has no portals and no document, so rendering one is the DOM spec below)
  for (const src of [MODAL, 'C A p:rows\n  *rows as r k=r.id\n    portal "#o"\n      p "{r.t}"\n']) {
    assert.equal(parseJsx(jsx(src), src), null);
  }
});

const domSkip = domAvailable ? false : 'jsdom is a devDependency — run npm install';

test('a portal puts its markup on the body, outside the app root', { skip: domSkip }, async () => {
  const app = await mountApp({
    entry: 'App.jsx',
    files: {
      'Dialog.jsx': compile('C Dialog p:title p:onClose\n  portal\n    .scrim @click=onClose\n'
        + '      .card @click=e.stopPropagation()\n        h2 "{title}"\n        {children}\n',
        'jsx', { main: 'Dialog' }),
      'App.jsx': compile('i Dialog ./Dialog\nC App s:open=false\n  main\n'
        + '    button @click=open=true "open"\n    ?open\n      Dialog title="Hi" @close=open=false\n'
        + '        p "inside the portal"\n', 'jsx', { main: 'App' }),
    },
  });
  assert.equal(app.$('.scrim'), null, 'nothing portalled yet');
  await app.click(app.byText('button', 'open'));
  const scrim = app.$('.scrim');
  assert.ok(scrim, 'the portal rendered');
  assert.equal(scrim.parentElement, app.window.document.body, 'onto document.body');
  assert.doesNotMatch(app.html, /scrim/, 'and not inside #root, where it was written');
  assert.match(scrim.textContent, /Hi/);
  assert.match(scrim.textContent, /inside the portal/);
  // the click handler on the scrim closes it, and the one on the card does not bubble through
  await app.click(app.$('.card'));
  assert.ok(app.$('.scrim'), 'stopPropagation kept it open');
  await app.click(app.$('.scrim'));
  assert.equal(app.$('.scrim'), null, 'and the backdrop closed it');
  assert.deepEqual(app.console, []);
  app.unmount();
});

test('a portal to a selector, and one per item in a list', { skip: domSkip }, async () => {
  const app = await mountApp({
    entry: 'App.jsx',
    files: {
      'App.jsx': compile('C App s:rows=[{id:1,t:"a"},{id:2,t:"b"}]\n  main\n'
        + '    *rows as r k=r.id\n      portal "body"\n        p.row "{r.t}"\n'
        + '    button @click=rows=[...rows].reverse() "flip"\n', 'jsx', { main: 'App' }),
    },
  });
  assert.deepEqual(app.all('body > p.row').map(e => e.textContent), ['a', 'b']);
  await app.click(app.byText('button', 'flip'));
  // React's own behaviour, worth knowing: each portal appends into the container on its own, so
  // sibling portals sharing one container are *not* reordered — the keys keep each item's own
  // node and its own content, and the DOM order stays the order they were inserted in.
  assert.deepEqual(app.all('body > p.row').map(e => e.textContent), ['a', 'b']);
  assert.deepEqual(app.console, [], 'keyed by the `*` line, so React has no complaint');
  app.unmount();
});

test('a selector target has to be in the page already', { skip: domSkip }, async () => {
  // The selector runs while the component renders, so a host the same tree is about to render
  // is not there yet — a `#modal-root` belongs in index.html, and `portal` with no target
  // (document.body) is the one that always works. React says so, loudly:
  const app = await mountApp({
    entry: 'App.jsx',
    files: {
      'App.jsx': compile('C App\n  main\n    div#host\n    portal "#host"\n      p "x"\n',
        'jsx', { main: 'App' }),
    },
  });
  assert.ok(app.console.some(c => /Target container is not a DOM element/.test(c)), app.console.join('|'));
});

test('a portal unmounts with the component that wrote it', { skip: domSkip }, async () => {
  const app = await mountApp({
    entry: 'App.jsx',
    files: {
      'App.jsx': compile('C App s:on=true\n  main\n    button @click=on=false "hide"\n    ?on\n'
        + '      portal\n        p.away "still here"\n', 'jsx', { main: 'App' }),
    },
  });
  assert.ok(app.$('p.away'));
  await app.click(app.byText('button', 'hide'));
  assert.equal(app.$('p.away'), null, 'React removed the portalled node too');
  assert.deepEqual(app.console, []);
  app.unmount();
});
