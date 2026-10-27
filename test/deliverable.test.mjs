// The claim this whole project rests on: `application/` is an ordinary React app that a
// developer installs, builds with Vite and deploys. Nothing used to check it — every other
// spec runs the esm preview against a stand-in React. These run the real toolchain.
//
// They need `cd example/application && npm install` (67 packages, not committed), so they
// skip when it is absent rather than forcing it on anyone running `npm test`.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const APP = new URL('../example/application/', import.meta.url).pathname;
const installed = existsSync(join(APP, 'node_modules/vite'));
const skip = installed ? false : 'run `cd example/application && npm install` to exercise the real build';

const dist = () => readdirSync(join(APP, 'dist'), { recursive: true }).map(String);

test('the deliverable builds with Vite, from a clean dist', { skip }, () => {
  rmSync(join(APP, 'dist'), { recursive: true, force: true });
  const out = execFileSync('npm', ['run', 'build'], { cwd: APP, encoding: 'utf8', stdio: 'pipe' });
  assert.match(out, /built in/);
  assert.doesNotMatch(out, /\[vite\]: Rollup failed|error during build/);
  assert.ok(existsSync(join(APP, 'dist/index.html')));
});

test('the bundle is split the way the routes asked', { skip }, () => {
  const files = dist();
  const js = files.filter(f => f.endsWith('.js'));
  assert.ok(js.some(f => /index-.*\.js$/.test(f)), 'the main chunk');
  assert.ok(js.some(f => /Stats-.*\.js$/.test(f)), '`/stats Stats lazy` is its own chunk');
  assert.ok(js.some(f => /Sparkline-.*\.js$/.test(f)), '`i Sparkline … lazy` is its own chunk');
  assert.ok(files.some(f => /\.css$/.test(f)), 'the design system was emitted');
  assert.ok(files.some(f => /logo-.*\.png$/.test(f)), 'the imported asset went through the bundler');
});

test('index.html points at the hashed bundle, not at src/', { skip }, () => {
  const html = readFileSync(join(APP, 'dist/index.html'), 'utf8');
  // relative, so `dist/` can be served from a subdirectory or opened from disk
  assert.match(html, /<script type="module" crossorigin src="\.\/assets\/index-[\w-]+\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" crossorigin href="\.\/assets\/index-[\w-]+\.css">/);
  assert.doesNotMatch(html, /src="\/assets|href="\/assets/, 'no absolute asset URLs');
  assert.doesNotMatch(html, /src\/main\.jsx/, 'the source entry is gone from the built page');
  assert.match(html, /<title>Zaal Demo<\/title>/);
});

test('the built bundle carries the app, not the compiler', { skip }, () => {
  const main = dist().find(f => /index-.*\.js$/.test(f));
  const code = readFileSync(join(APP, 'dist/assets', main.replace('assets/', '')), 'utf8');
  assert.match(code, /Built with Zaal/, 'the markup is in there');
  assert.doesNotMatch(code, /zaal\.mjs|packages\/zaal/, 'nothing of the compiler ships');
  assert.ok(code.length > 50_000, 'React and the app are bundled');
});

test('the deliverable declares the packages it imports', { skip: false }, () => {
  const pkg = JSON.parse(readFileSync(join(APP, 'package.json'), 'utf8'));
  for (const dep of ['react', 'react-dom', 'canvas-confetti', 'framer-motion']) {
    assert.ok(pkg.dependencies[dep], `${dep} is a dependency of the app itself`);
  }
  assert.ok(pkg.devDependencies.vite && pkg.devDependencies['@vitejs/plugin-react']);
  assert.equal(pkg.scripts.build, 'vite build');
});

test('nothing in the deliverable reaches back into the compiler', { skip: false }, () => {
  const walk = (dir, out = []) => {
    for (const e of readdirSync(join(APP, dir), { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist') continue;
      const next = `${dir}/${e.name}`;
      e.isDirectory() ? walk(next, out) : out.push(next);
    }
    return out;
  };
  // (an app may of course *name* anything it likes — the example has a `zaal-badge` custom
  // element. What must not appear is a dependency on the toolchain.)
  for (const f of walk('src').concat(['index.html', 'vite.config.js', 'package.json'])) {
    const body = readFileSync(join(APP, f), 'utf8');
    assert.doesNotMatch(body, /from ['"]@?zaal|zaal\.mjs|packages\/(zaal|react)/,
      `${f} depends on the compiler`);
  }
});
