// The commands: `zaal build`, `zaal <file.zaal>`, and the static server behind `zaal dev`/`serve`.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { serve } from '../zaal.mjs';
import { projectDir, buildIn, read, has, cleanup } from './helpers/fixture.mjs';

after(cleanup);

const ZAAL = new URL('../zaal.mjs', import.meta.url).pathname;
const run = (root, args) => execFileSync(process.execPath, [ZAAL, ...args], { cwd: root, encoding: 'utf8' });

const DEMO = {
  'zaal/app.zaal': 'A Demo\n  t "Demo"\n  ui ./ui.zaal\n  / Home\n',
  'zaal/ui.zaal': 'D D\nt color\n  bg #fff\nk page main\n  bg $color.bg\n',
  'zaal/Home.zaal': 'C Home s:n=0\n  %page\n    h1 "hi {n}"\n    button @click=n++ "+"\n',
};

test('`zaal build` writes application/ and says what it did', () => {
  const root = projectDir(DEMO);
  const out = run(root, ['build']);
  assert.match(out, /Zaal Demo: 1 modules -> application\/, 1 routes, ui D/);
  assert.match(out, /application\/ is a standalone React app/);
  assert.ok(has(root, 'application/src/Home.jsx'));
  assert.ok(has(root, 'application/package.json'));
});

test('`zaal build` reports warnings without failing', () => {
  const root = projectDir({ ...DEMO, 'zaal/Home.zaal': 'C Home\n  .ghost "x"\n' });
  const out = execFileSync(process.execPath, [ZAAL, 'build'], { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  assert.match(out, /Zaal Demo/);
});

test('`zaal build` on a broken source exits non-zero and names the line', () => {
  const root = projectDir({ ...DEMO, 'zaal/Home.zaal': 'C Home\n  %page\n    %ghost "x"\n' });
  assert.throws(() => run(root, ['build']), e => {
    assert.equal(e.status, 1);
    assert.match(e.stderr, /error {2}zaal\/Home\.zaal:3 {2}%ghost is not in the UI kit/);
    return true;
  });
});

test('`zaal <file.zaal> <dir>` compiles one file against the app', () => {
  const root = projectDir(DEMO);
  const out = run(root, ['zaal/Home.zaal', 'out']);
  assert.match(out, /zaal\/Home\.zaal -> out\/Home\.js/);
  const code = readFileSync(join(root, 'out/Home.js'), 'utf8');
  assert.match(code, /createElement as h/);
  assert.match(code, /h\("main", \{ "className": "page" \}/, 'the design system came from app.zaal');
});

test('`zaal` with no arguments prints usage and exits 1', () => {
  const root = projectDir(DEMO);
  assert.throws(() => run(root, []), e => {
    assert.equal(e.status, 1);
    assert.match(e.stderr, /zaal — compile \.zaal sources into a React app/);
    return true;
  });
});

/* ---------- the preview server ---------- */

// node:http, not fetch: fetch normalises `..` out of the path, and this has to send it as written.
const get = (port, path) => new Promise((ok, bad) => {
  const req = request({ host: '127.0.0.1', port, path, headers: { connection: 'close' } }, res => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', c => { body += c; });
    res.on('end', () => ok({ status: res.statusCode, type: res.headers['content-type'], body }));
  });
  req.on('error', bad);
  req.end();
});

test('the preview server serves the build, falls back to the page and 404s assets', async () => {
  const root = projectDir(DEMO);
  buildIn(root, 'esm');
  const port = 8731;
  const server = serve(join(root, '.zaal-dev'), port, { live: true });
  try {
    const page = await get(port, '/');
    assert.equal(page.status, 200);
    assert.equal(page.type, 'text/html');
    assert.match(page.body, /<title>Demo<\/title>/);
    assert.match(page.body, /EventSource\('\/__zaal'\)/, 'live reload is injected');

    const mod = await get(port, '/src/main.js');
    assert.equal(mod.status, 200);
    assert.equal(mod.type, 'text/javascript');
    assert.match(mod.body, /createRoot/);

    const css = await get(port, '/src/styles/ui.css');
    assert.equal(css.type, 'text/css');

    const route = await get(port, '/about');
    assert.equal(route.status, 200, 'a route with no extension falls back to index.html');
    assert.match(route.body, /<div id="root">/);

    const missing = await get(port, '/src/Nope.js');
    assert.equal(missing.status, 404);
    assert.match(missing.body, /the last build did not generate it/);

    for (const path of ['/../../etc/passwd', '/%2e%2e/%2e%2e/etc/passwd', '/src/../../../etc/passwd']) {
      const escape = await get(port, path);
      assert.equal(escape.status, 403, `${path} must not reach outside the build`);
      assert.equal(escape.body, 'forbidden');
    }
  } finally { server.close(); }
});

test('`zaal <file>.zaal --vite` writes a jsx module instead', () => {
  const root = projectDir(DEMO);
  run(root, ['zaal/Home.zaal', 'out', '--vite']);
  const code = readFileSync(join(root, 'out/Home.jsx'), 'utf8');
  assert.match(code, /<main className="page">/);
  assert.doesNotMatch(code, /createElement/);
});

test('a single file compiles with no project around it', async () => {
  const root = projectDir({ 'lonely/Widget.zaal': 'C Widget p:n=1\n  p "n is {n}"\n' });
  const out = run(root, ['lonely/Widget.zaal', 'built']);
  assert.match(out, /-> built\/Widget\.js/);
  assert.match(readFileSync(join(root, 'built/Widget.js'), 'utf8'), /h\("p", null, `n is \$\{n\}`\)/);
});

test('`zaal build` reports packages, new dependencies and stale files', async () => {
  const root = projectDir({
    ...DEMO,
    'zaal/Home.zaal': 'i confetti canvas-confetti\nC Home\n  %page\n    button @click=confetti() "pop"\n',
    'zaal/app.zaal': 'A Demo\n  t "Demo"\n  ui ./ui.zaal\n  pkg canvas-confetti@1.9.3\n  / Home\n',
    'zaal/Extra.zaal': 'C Extra\n  p "e"\n',
  });
  const first = run(root, ['build']);
  assert.match(first, /1 package \(canvas-confetti@1\.9\.3\)/);
  assert.match(first, /\+ application\/package\.json: canvas-confetti@\^1\.9\.3/);
  assert.match(first, /\+ application\/package\.json, application\/vite\.config\.js, application\/\.gitignore/);
  const { rmSync } = await import('node:fs');
  rmSync(join(root, 'zaal/Extra.zaal'));
  const second = run(root, ['build']);
  assert.match(second, /- removed 1 stale file\(s\): src\/Extra\.jsx/);
  assert.doesNotMatch(second, /\+ application\/package\.json:/, 'the dependency is already there');
});

test('`zaal build` prints warnings on stderr and still succeeds', () => {
  const root = projectDir({ ...DEMO, 'zaal/Home.zaal': 'C Home\n  %page.ghost "x"\n' });
  const res = execFileSync(process.execPath, [ZAAL, 'build'], { cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  assert.match(res, /Zaal Demo: 1 modules/);
  assert.ok(has(root, 'application/src/Home.jsx'));
});

test('an unknown command prints usage and exits 1', () => {
  const root = projectDir(DEMO);
  assert.throws(() => run(root, ['frobnicate']), e => {
    assert.equal(e.status, 1);
    assert.match(e.stderr, /zaal — compile \.zaal sources into a React app/);
    return true;
  });
});

test('a build error inside a nested source names that file', () => {
  const root = projectDir({
    ...DEMO,
    'zaal/parts/Bad.zaal': 'C Bad\n  Missing\n',
  });
  assert.throws(() => run(root, ['build']), e => {
    assert.match(e.stderr, /error {2}zaal\/parts\/Bad\.zaal:2 {2}<Missing> is not in scope/);
    return true;
  });
});
