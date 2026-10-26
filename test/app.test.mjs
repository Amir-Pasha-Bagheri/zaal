// app.zaal: title, mount, routes, store order, package pins, cdn — and what they produce in
// index.html and src/main.*.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseApp } from '../zaal.mjs';
import { projectDir, buildIn, read, has, cleanup } from './helpers/fixture.mjs';
import { after } from 'node:test';

after(cleanup);

const UI = 'D T\nt color\n  bg #fff\nk page main\n  p 0\nk card section\n  p 0\n';

test('parseApp reads every directive', () => {
  const app = parseApp(`A Demo
  t "Zaal Demo"
  m #app
  ui ./ui.zaal
  css ./styles/extra.css
  css https://cdn.test/x.css
  store Theme Todos
  pkg canvas-confetti@1.9.3
  cdn https://esm.sh/
  / Home
  /about About
  /todo/:id Detail
  /heavy Heavy lazy
`);
  assert.equal(app.name, 'Demo');
  assert.equal(app.title, 'Zaal Demo');
  assert.equal(app.mount, 'app');
  assert.equal(app.ui, './ui.zaal');
  assert.deepEqual(app.css, ['./styles/extra.css', 'https://cdn.test/x.css']);
  assert.deepEqual(app.storeOrder, ['Theme', 'Todos']);
  assert.equal(app.pins.get('canvas-confetti'), '1.9.3');
  assert.equal(app.cdn, 'https://esm.sh', 'a trailing slash is trimmed');
  assert.deepEqual(app.routes.map(r => [r.path, r.component, r.lazy]), [
    ['/', 'Home', false], ['/about', 'About', false],
    ['/todo/:id', 'Detail', false], ['/heavy', 'Heavy', true],
  ]);
});

test('an app file with no A block is an error', () => {
  assert.throws(() => parseApp('t "x"\n'), /no `A <Name>` block/);
});

test('a build writes the router, main, index.html and the design system', () => {
  const root = projectDir({
    'zaal/app.zaal': 'A Demo\n  t "T"\n  ui ./ui.zaal\n  / Home\n',
    'zaal/ui.zaal': UI,
    'zaal/Home.zaal': 'C Home\n  %page\n    h1 "hi"\n',
  });
  const out = buildIn(root);
  assert.deepEqual(out.made, ['src/Home.jsx']);
  for (const f of ['application/src/router.jsx', 'application/src/main.jsx', 'application/index.html',
    'application/src/styles/ui.css', 'application/package.json', 'application/vite.config.js',
    'application/.gitignore']) assert.ok(has(root, f), f);
  const html = read(root, 'application/index.html');
  assert.match(html, /<title>T<\/title>/);
  assert.match(html, /<div id="root"><\/div>/);
  assert.match(html, /<link rel="stylesheet" href="\.\/src\/styles\/ui\.css" \/>/);
  assert.match(html, /<script type="module" src="\.\/src\/main\.jsx"><\/script>/);
  assert.doesNotMatch(html, /importmap/, 'the bundler resolves imports, not the page');
});

test('main.jsx imports each route component once and builds the table', () => {
  const root = projectDir({
    'zaal/app.zaal': 'A Demo\n  / Home\n  /about About\n  /x Home\n',
    'zaal/Home.zaal': 'C Home\n  h1 "h"\n',
    'zaal/About.zaal': 'C About\n  h1 "a"\n',
  });
  buildIn(root);
  const main = read(root, 'application/src/main.jsx');
  assert.equal((main.match(/import Home from/g) || []).length, 1);
  assert.match(main, /const routes = \[\n  \{ path: '\/', component: Home \},\n  \{ path: '\/about', component: About \},\n  \{ path: '\/x', component: Home \},\n\];/);
  assert.match(main, /createRoot\(document\.getElementById\('root'\)\)\.render\(/);
  assert.match(main, /<React\.StrictMode>[\s\S]*<Router routes=\{routes\} \/>/);
});

test('a lazy route is code-split and wrapped in Suspense', () => {
  const root = projectDir({
    'zaal/app.zaal': 'A Demo\n  / Home\n  /heavy Heavy lazy\n',
    'zaal/Home.zaal': 'C Home\n  h1 "h"\n',
    'zaal/Heavy.zaal': 'C Heavy\n  h1 "big"\n',
  });
  buildIn(root);
  const main = read(root, 'application/src/main.jsx');
  assert.match(main, /const Heavy = lazy\(\(\) => import\('\.\/Heavy\.jsx'\)\);/);
  assert.match(main, /import React, \{ lazy, Suspense \} from 'react';/);
  assert.match(main, /<Suspense fallback=\{null\}>/);
});

test('providers nest in the order app.zaal gives, outermost first', () => {
  const root = projectDir({
    'zaal/app.zaal': 'A Demo\n  store Theme Todos\n  / Home\n',
    'zaal/Home.zaal': 'C Home\n  h1 "h"\n',
    'zaal/stores/Theme.zaal': 'S Theme s:mode="light"\n  cb t() = mode="dark"\n',
    'zaal/stores/Todos.zaal': 'S Todos s:items=[]\n  cb add(x) = items=[...items,x]\n',
  });
  buildIn(root);
  const main = read(root, 'application/src/main.jsx');
  assert.ok(main.indexOf('<ThemeProvider>') < main.indexOf('<TodosProvider>'));
  assert.match(main, /import \{ ThemeProvider \} from '\.\/stores\/Theme\.jsx';/);
  assert.match(main, /<\/ThemeProvider>\n\s*<\/React\.StrictMode>|<\/ThemeProvider>/);
});

test('a store not named in `store` is still mounted', () => {
  const root = projectDir({
    'zaal/app.zaal': 'A Demo\n  / Home\n',
    'zaal/Home.zaal': 'C Home\n  h1 "h"\n',
    'zaal/Zed.zaal': 'S Zed s:n=0\n  cb up() = n++\n',
  });
  buildIn(root);
  assert.match(read(root, 'application/src/main.jsx'), /<ZedProvider>/);
});

test('`store X` naming no store is an error', () => {
  const root = projectDir({
    'zaal/app.zaal': 'A Demo\n  store Nope\n  / Home\n',
    'zaal/Home.zaal': 'C Home\n  h1 "h"\n',
  });
  assert.throws(() => buildIn(root), /store Nope: no `S Nope`/);
});

test('a route with no component in zaal/ is an error', () => {
  const root = projectDir({ 'zaal/app.zaal': 'A Demo\n  / Missing\n', 'zaal/Home.zaal': 'C Home\n  h1 "h"\n' });
  assert.throws(() => buildIn(root), /route \/: no `C Missing`/);
});

test('a route component has to be its own file default export', () => {
  const root = projectDir({
    'zaal/app.zaal': 'A Demo\n  / Home\n  /row Row\n',
    'zaal/Home.zaal': 'C Home\n  Row\nC Row\n  tr\n',
  });
  assert.throws(() => buildIn(root), /belongs in a file named Row\.zaal/);
});

test('local stylesheets are copied beside ui.css and linked', () => {
  const root = projectDir({
    'zaal/app.zaal': 'A Demo\n  ui ./ui.zaal\n  css ./styles/extra.css\n  / Home\n',
    'zaal/ui.zaal': UI,
    'zaal/styles/extra.css': '.x { color: red }\n',
    'zaal/Home.zaal': 'C Home\n  h1 "h"\n',
  });
  buildIn(root);
  assert.equal(read(root, 'application/src/styles/extra.css'), '.x { color: red }\n');
  const html = read(root, 'application/index.html');
  assert.ok(html.indexOf('ui.css') < html.indexOf('extra.css'), 'the design system is linked first');
});

test('the esm preview lands in .zaal-dev with an import map and plain .js modules', () => {
  const root = projectDir({
    'zaal/app.zaal': 'A Demo\n  pkg canvas-confetti@1.9.3\n  / Home\n',
    'zaal/Home.zaal': 'i confetti canvas-confetti\nC Home\n  button @click=confetti() "pop"\n',
  });
  const out = buildIn(root, 'esm');
  assert.equal(out.outDir, '.zaal-dev');
  assert.ok(has(root, '.zaal-dev/src/Home.js'));
  assert.ok(!has(root, '.zaal-dev/package.json'), 'the preview installs nothing');
  const html = read(root, '.zaal-dev/index.html');
  assert.match(html, /<script type="importmap">/);
  assert.match(html, /"react": "https:\/\/esm\.sh\/react@19\.1\.0"/);
  assert.match(html, /"canvas-confetti": "https:\/\/esm\.sh\/canvas-confetti@1\.9\.3\?external=react,react-dom"/);
  assert.match(read(root, '.zaal-dev/src/main.js'), /createElement\(StrictMode, null, createElement\(Router/);
});

test('`cdn` moves where the preview resolves packages', () => {
  const root = projectDir({
    'zaal/app.zaal': 'A Demo\n  cdn https://cdn.test\n  pkg dayjs@1.11.0\n  / Home\n',
    'zaal/Home.zaal': 'i dayjs dayjs\nC Home\n  p "{dayjs()}"\n',
  });
  buildIn(root, 'esm');
  assert.match(read(root, '.zaal-dev/index.html'), /"dayjs": "https:\/\/cdn\.test\/dayjs@1\.11\.0\?external=react,react-dom"/);
});

test('`m #id` moves the mount node in both the page and main', () => {
  const root = projectDir({
    'zaal/app.zaal': 'A Demo\n  m #app\n  / Home\n',
    'zaal/Home.zaal': 'C Home\n  h1 "h"\n',
  });
  buildIn(root);
  assert.match(read(root, 'application/index.html'), /<div id="app"><\/div>/);
  assert.match(read(root, 'application/src/main.jsx'), /getElementById\('app'\)/);
});

test('the generated router exports what the app uses', () => {
  const root = projectDir({ 'zaal/app.zaal': 'A Demo\n  / Home\n', 'zaal/Home.zaal': 'C Home\n  h1 "h"\n' });
  buildIn(root);
  const r = read(root, 'application/src/router.jsx');
  for (const name of ['export function useRoute', 'export const go', 'export function Link',
    'export function Router']) assert.ok(r.includes(name), name);
  assert.match(r, /data-active/);
});

test('a missing app file names the layout instead of ENOENT', () => {
  const root = projectDir({ 'src/app.zaal': 'A Demo\n  / Home\n' });
  assert.throws(() => buildIn(root), /no zaal\/app\.zaal[\s\S]*rename src\/ to zaal\//);
});
