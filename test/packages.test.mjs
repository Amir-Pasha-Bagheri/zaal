// `i` lines: local modules, packages, named and default imports, versions and stylesheets.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { compile } from '../zaal.mjs';
import { projectDir, buildIn, read, cleanup } from './helpers/fixture.mjs';

after(cleanup);

const bare = (src, target = 'jsx', opts = {}) => {
  const pkgs = new Map();
  const out = compile(src, target, { pkgs, ...opts });
  return { out, pkgs };
};

test('a local import gets the backend extension and keeps its path', () => {
  assert.match(compile('i Btn ./ui/Btn\nC A\n  Btn\n', 'jsx'), /import Btn from '\.\/ui\/Btn\.jsx';/);
  assert.match(compile('i Btn ./ui/Btn\nC A\n  Btn\n', 'esm'), /import Btn from '\.\/ui\/Btn\.js';/);
  assert.match(compile('i Btn ../Btn.jsx\nC A\n  Btn\n', 'jsx'), /import Btn from '\.\.\/Btn\.jsx';/);
});

test('a package import drops the version from the code and records it', () => {
  const { out, pkgs } = bare('i confetti canvas-confetti@1.9.3\nC A\n  button @click=confetti() "x"\n');
  assert.match(out, /import confetti from 'canvas-confetti';/);
  assert.equal(pkgs.get('canvas-confetti').version, '1.9.3');
});

test('named, default+named, subpath and `from` noise', () => {
  const { out } = bare(`i { motion } from framer-motion
i Chart,{ Line } from react-chartjs-2
i debounce lodash/debounce
C A
  motion.div
    Chart
    Line
`);
  assert.match(out, /import \{ motion \} from 'framer-motion';/);
  assert.match(out, /import Chart,\{ Line \} from 'react-chartjs-2';/);
  assert.match(out, /import debounce from 'lodash\/debounce';/);
});

test('a pin in app.zaal wins over an inline version and reports the clash', () => {
  const pkgs = new Map(), pins = new Map([['canvas-confetti', '1.9.3']]);
  compile('i c canvas-confetti@1.8.0\nC A\n  p "x"\n', 'esm', { pkgs, pins });
  const entry = pkgs.get('canvas-confetti');
  assert.equal(entry.version, '1.9.3');
  assert.match(entry.clash, /canvas-confetti@1\.8\.0 wanted, pinned 1\.9\.3/);
});

test('a scoped package keeps its scope', () => {
  const { out, pkgs } = bare('i { z } from @scope/thing@2.0.0/sub\nC A\n  p "{z}"\n');
  assert.match(out, /from '@scope\/thing\/sub';/);
  assert.equal(pkgs.get('@scope/thing/sub').pkg, '@scope/thing');
});

test('react is never treated as a package', () => {
  const { pkgs } = bare('i { createPortal } from react-dom\nC A\n  p "x"\n');
  assert.equal(pkgs.size, 0);
});

test('a side-effect stylesheet import: kept for the bundler, linked by the esm page', () => {
  const jsx = bare('i react-toastify/dist/ReactToastify.css\nC A\n  p "x"\n', 'jsx');
  assert.match(jsx.out, /import 'react-toastify\/dist\/ReactToastify\.css';/);
  assert.ok(jsx.pkgs.get('react-toastify/dist/ReactToastify.css').css);
  const esm = bare('i react-toastify/dist/ReactToastify.css\nC A\n  p "x"\n', 'esm');
  assert.doesNotMatch(esm.out, /ReactToastify\.css/);
});

test('a local stylesheet on an `i` line points at app.zaal instead', () => {
  assert.throws(() => compile('i ./styles/x.css\nC A\n  p "x"\n'), /belongs in app\.zaal/);
});

test('a build adds every package to application/package.json dependencies', () => {
  const root = projectDir({
    'zaal/app.zaal': 'A Demo\n  pkg canvas-confetti@1.9.3\n  / Home\n',
    'zaal/Home.zaal': 'i confetti canvas-confetti\ni debounce lodash/debounce\nC Home\n'
      + '  button @click=confetti() "{debounce}"\n',
  });
  const out = buildIn(root);
  const pkg = JSON.parse(read(root, 'application/package.json'));
  assert.equal(pkg.dependencies['canvas-confetti'], '^1.9.3');
  assert.equal(pkg.dependencies['lodash'], 'latest', 'an unpinned package resolves to latest');
  assert.ok(pkg.dependencies.react && pkg.dependencies['react-dom']);
  assert.ok(out.warnings.some(w => /lodash\/debounce is unpinned/.test(w)));
});

test('a second build does not duplicate or reorder dependencies', () => {
  const root = projectDir({
    'zaal/app.zaal': 'A Demo\n  pkg dayjs@1.11.0\n  / Home\n',
    'zaal/Home.zaal': 'i dayjs dayjs\nC Home\n  p "{dayjs()}"\n',
  });
  buildIn(root);
  const first = read(root, 'application/package.json');
  buildIn(root);
  assert.equal(read(root, 'application/package.json'), first);
});

test('hand edits to package.json and vite.config.js survive a rebuild', async () => {
  const root = projectDir({
    'zaal/app.zaal': 'A Demo\n  / Home\n',
    'zaal/Home.zaal': 'C Home\n  h1 "h"\n',
  });
  buildIn(root);
  const { writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const pkg = JSON.parse(read(root, 'application/package.json'));
  pkg.scripts.lint = 'eslint .';
  writeFileSync(join(root, 'application/package.json'), JSON.stringify(pkg, null, 2));
  writeFileSync(join(root, 'application/vite.config.js'), '// mine\n');
  const out = buildIn(root);
  assert.equal(JSON.parse(read(root, 'application/package.json')).scripts.lint, 'eslint .');
  assert.equal(read(root, 'application/vite.config.js'), '// mine\n');
  assert.deepEqual(out.scaffolded, []);
});

test('`pkg react@…` moves the React the app installs and the preview loads', () => {
  const root = projectDir({
    'zaal/app.zaal': 'A Demo\n  pkg react@19.2.0\n  pkg react-dom@19.2.0\n  / Home\n',
    'zaal/Home.zaal': 'C Home\n  h1 "h"\n',
  });
  buildIn(root);
  assert.equal(JSON.parse(read(root, 'application/package.json')).dependencies.react, '^19.2.0');
  buildIn(root, 'esm');
  assert.match(read(root, '.zaal-dev/index.html'), /"react": "https:\/\/esm\.sh\/react@19\.2\.0"/);
});

test('two files importing the same package at different versions warn once', () => {
  const root = projectDir({
    'zaal/app.zaal': 'A Demo\n  / Home\n',
    'zaal/Home.zaal': 'i d dayjs@1.11.0\nC Home\n  p "{d()}"\n',
    'zaal/Other.zaal': 'i d dayjs@1.10.0\nC Other\n  p "{d()}"\n',
  });
  const out = buildIn(root);
  assert.ok(out.warnings.some(w => /dayjs imported as both 1\.11\.0 and 1\.10\.0/.test(w)), out.warnings.join('|'));
});

/* ---------- more package plumbing ---------- */

test('a package stylesheet is linked from the CDN in the esm preview', () => {
  const root = projectDir({
    'zaal/app.zaal': 'A P\n  pkg react-toastify@10.0.5\n  / Home\n',
    'zaal/Home.zaal': 'i react-toastify/dist/ReactToastify.css\ni { toast } from react-toastify\n'
      + 'C Home\n  button @click=toast("hi") "toast"\n',
  });
  buildIn(root, 'esm');
  const html = read(root, '.zaal-dev/index.html');
  assert.match(html, /<link rel="stylesheet" href="https:\/\/esm\.sh\/react-toastify@10\.0\.5\/dist\/ReactToastify\.css" \/>/);
  assert.match(html, /"react-toastify": "https:\/\/esm\.sh\/react-toastify@10\.0\.5\?external=react,react-dom"/);
  assert.doesNotMatch(html.slice(html.indexOf('importmap')), /ReactToastify\.css/,
    'a stylesheet is not an import-map entry');
});

test('a package stylesheet still becomes a dependency for the bundler', () => {
  const root = projectDir({
    'zaal/app.zaal': 'A P\n  pkg react-toastify@10.0.5\n  / Home\n',
    'zaal/Home.zaal': 'i react-toastify/dist/ReactToastify.css\nC Home\n  p "x"\n',
  });
  buildIn(root);
  assert.equal(JSON.parse(read(root, 'application/package.json')).dependencies['react-toastify'], '^10.0.5');
  assert.match(read(root, 'application/src/Home.jsx'), /import 'react-toastify\/dist\/ReactToastify\.css';/);
});

test('a pin for a package nothing imports adds no dependency', () => {
  const root = projectDir({
    'zaal/app.zaal': 'A P\n  pkg dayjs@1.11.0\n  / Home\n',
    'zaal/Home.zaal': 'C Home\n  p "x"\n',
  });
  const out = buildIn(root);
  assert.deepEqual(out.deps, []);
  assert.equal(JSON.parse(read(root, 'application/package.json')).dependencies.dayjs, undefined);
});

test('two subpaths of one package: two import-map entries, one dependency', () => {
  const root = projectDir({
    'zaal/app.zaal': 'A P\n  pkg lodash@4.17.21\n  / Home\n',
    'zaal/Home.zaal': 'i debounce lodash/debounce\ni throttle lodash/throttle\n'
      + 'C Home\n  p "{debounce}{throttle}"\n',
  });
  const out = buildIn(root);
  assert.deepEqual(out.deps, ['lodash@^4.17.21']);
  assert.equal([...out.pkgs.keys()].length, 2);
  buildIn(root, 'esm');
  const html = read(root, '.zaal-dev/index.html');
  assert.match(html, /"lodash\/debounce": "https:\/\/esm\.sh\/lodash@4\.17\.21\/debounce\?external=react,react-dom"/);
  assert.match(html, /"lodash\/throttle": "https:\/\/esm\.sh\/lodash@4\.17\.21\/throttle\?external=react,react-dom"/);
});

test('one package imported two ways is one dependency', () => {
  const root = projectDir({
    'zaal/app.zaal': 'A P\n  pkg framer-motion@11.11.9\n  / Home\n',
    'zaal/Home.zaal': 'i { motion } from framer-motion\nC Home\n  motion.div "a"\n',
    'zaal/Other.zaal': 'i { AnimatePresence } from framer-motion\nC Other\n  AnimatePresence\n',
  });
  const out = buildIn(root);
  assert.deepEqual(out.deps, ['framer-motion@^11.11.9']);
  assert.deepEqual(out.warnings, []);
});

test('a scoped package lands in dependencies under its full name', () => {
  const root = projectDir({
    'zaal/app.zaal': 'A P\n  pkg @tanstack/react-query@5.59.0\n  / Home\n',
    'zaal/Home.zaal': 'i { useQuery } from @tanstack/react-query\n'
      + 'C Home\n  use q = useQuery({queryKey:["x"]})\n  p "{q.status}"\n',
  });
  const out = buildIn(root);
  assert.deepEqual(out.deps, ['@tanstack/react-query@^5.59.0']);
  assert.match(read(root, 'application/src/Home.jsx'), /from '@tanstack\/react-query';/);
});

test('a version range in a pin is passed through as written', () => {
  const root = projectDir({
    'zaal/app.zaal': 'A P\n  pkg dayjs@^1.11.0\n  / Home\n',
    'zaal/Home.zaal': 'i dayjs dayjs\nC Home\n  p "{dayjs()}"\n',
  });
  assert.deepEqual(buildIn(root).deps, ['dayjs@^1.11.0']);
});

test('react-dom/client is not a package either', () => {
  const { pkgs } = bare('i { createPortal } from react-dom\nC A\n  p "x"\n');
  assert.equal(pkgs.size, 0);
  const root = projectDir({
    'zaal/app.zaal': 'A P\n  / Home\n',
    'zaal/Home.zaal': 'i { createPortal } from react-dom\nC Home\n  p "x"\n',
  });
  assert.deepEqual(buildIn(root).deps, []);
});

// `i Heavy ./Heavy lazy` — fetched on first render instead of shipping in the main bundle.
test('a lazy import becomes React.lazy, local or package', () => {
  const out = compile('i Heavy ./Heavy lazy\nC A\n  Suspense fallback={null}\n    Heavy\n', 'jsx');
  assert.match(out, /import \{ lazy, Suspense \} from 'react';/);
  assert.match(out, /const Heavy = lazy\(\(\) => import\('\.\/Heavy\.jsx'\)\);/);
  assert.match(compile('i Chart react-chartjs-2 lazy\nC A\n  Chart\n', 'esm'),
    /const Chart = lazy\(\(\) => import\('react-chartjs-2'\)\);/);
});

test('a lazy import has to be one default name', () => {
  assert.throws(() => compile('i { Heavy } from ./Heavy lazy\nC A\n  Heavy\n', 'jsx'),
    /a lazy import is one default name/);
});
