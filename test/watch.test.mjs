// `zaal dev` — the watcher, end to end, as a developer runs it.
//
// `watchAndServe` was the one command with no test: it returns no handle, so a test that called
// it in process could never shut the watcher or the server down and the run would hang. It is
// driven here the way a developer drives it — the real `zaal` binary in a child process, real
// file saves, the live-reload stream read over HTTP — which also covers the `dev` branch of the
// CLI that chooses it. A child process is killable, so nothing leaks into the rest of the suite.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, utimesSync, rmSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { once } from 'node:events';
import { dirname, join } from 'node:path';
import { projectDir, cleanup } from './helpers/fixture.mjs';

after(cleanup);

const BIN = new URL('../packages/zaal/bin/zaal', import.meta.url).pathname;

// A port each test can have to itself. `zaal dev 0` will not do: the CLI reads the port as
// `Number(arg) || 5173`, so a literal 0 is falsy and becomes the default — and these tests run
// in one process, where two servers on the default port is the second one exiting on EADDRINUSE.
const freePort = () => new Promise((ok, no) => {
  const probe = createServer();
  probe.on('error', no);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => ok(port));
  });
});

const DEMO = {
  'zaal/app.zaal': 'A Watch\n  t "Watch"\n  ui ./ui.zaal\n  css ./styles/extra.css\n  / Home\n',
  'zaal/ui.zaal': 'D W\nt color\n  fg #111\nk page main\n  fg $color.fg\n',
  'zaal/styles/extra.css': '.extra { color: red }\n',
  'zaal/pages/Home.zaal': 'C Home\n  %page\n    h1 "first"\n',
};

// A running `zaal dev`, with its output captured so a test can wait for a line of it.
function dev(root, port, args = []) {
  const child = spawn(process.execPath, [BIN, 'dev', String(port), ...args], { cwd: root });
  const lines = [];
  let text = '';
  const waiters = [];
  const feed = chunk => {
    text += chunk;
    for (const line of String(chunk).split('\n')) if (line.trim()) lines.push(line);
    for (const w of waiters.slice()) {
      if (w.re.test(text)) { waiters.splice(waiters.indexOf(w), 1); w.ok(text); }
    }
  };
  child.stdout.on('data', feed);
  child.stderr.on('data', feed);

  // Wait for a line the server prints. Everything this test observes is something `zaal dev`
  // says or serves, so there is no sleep anywhere: a timeout is a failure, not a flake.
  const until = (re, why, ms = 20000) => new Promise((ok, no) => {
    if (re.test(text)) return ok(text);
    const t = setTimeout(() => no(new Error(`timed out waiting for ${why}\n--- output:\n${text}`)), ms);
    waiters.push({ re, ok: v => (clearTimeout(t), ok(v)) });
  });

  return {
    child, lines, until,
    get text() { return text; },
    // the port it is on, once it says so: the url it prints is the signal that it is listening
    async port() {
      await until(new RegExp(`http://localhost:${port}\\b`), 'the server to print its url');
      return port;
    },
    stop() { child.kill('SIGKILL'); },
  };
}

// A save the watcher cannot miss: fs.watch reports a change, and the mtime moves even when the
// bytes happen to be identical.
const save = (root, path, body) => {
  const full = join(root, path);
  mkdirSync(dirname(full), { recursive: true });       // a new source may be a new directory too
  writeFileSync(full, body);
  const now = new Date();
  utimesSync(full, now, now);
};

const started = [];
after(() => { for (const s of started) s.stop(); });

const start = async root => {
  const s = dev(root, await freePort());
  started.push(s);
  return s;
};

test('zaal dev builds the preview, serves it and reports what it found', async () => {
  const root = projectDir(DEMO);
  const s = await start(root);
  const port = await s.port();
  // the banner says what was built, before any change
  assert.match(s.text, /Zaal\s+Watch/, 'the banner names the app');
  assert.match(s.text, /routes/, 'and says how many routes it found');
  assert.match(s.text, /watching for changes/, 'and that it is watching');

  const page = await (await fetch(`http://127.0.0.1:${port}/`)).text();
  assert.match(page, /<title>Watch<\/title>/);
  // served with the live-reload client injected, which is what `{ live: true }` is for
  assert.match(page, /__zaal/, 'the page carries the reload client');
  const home = await (await fetch(`http://127.0.0.1:${port}/src/pages/Home.js`)).text();
  assert.match(home, /first/);
});

test('saving a source rebuilds it and pushes a reload to the open page', async () => {
  const root = projectDir(DEMO);
  const s = await start(root);
  const port = await s.port();

  // A browser sitting on the live-reload stream, as one is while the page is open. The response
  // is not awaited first: an event stream's headers are buffered until its first event, so a
  // client that waits for them before causing one waits forever.
  const req = request({ host: '127.0.0.1', port, path: '/__zaal' });
  req.end();
  const event = once(req, 'response')
    .then(([res]) => new Promise(ok => res.once('data', c => ok({ res, chunk: String(c) }))));

  // Saving until the event lands, rather than once: the stream may still be connecting when the
  // first rebuild pushes, and an event sent before this client arrived is one it never sees —
  // which is a race in the test, not in the server. A real browser reconnects for the same reason.
  let n = 0;
  const ticker = setInterval(() => save(root, 'zaal/pages/Home.zaal',
    `C Home\n  %page\n    h1 "second"\n    p "${n++}"\n`), 300);
  try {
    save(root, 'zaal/pages/Home.zaal', 'C Home\n  %page\n    h1 "second"\n');
    await s.until(/rebuilt/, 'the rebuild');
    const { res, chunk } = await event;
    assert.equal(res.headers['content-type'], 'text/event-stream');
    assert.match(chunk, /data: reload/, 'the open page is told to reload');
  } finally {
    clearInterval(ticker);
    req.destroy();
  }

  // and the module on disk is the new one, not the one the first build wrote
  const home = readFileSync(join(root, '.zaal-dev/src/pages/Home.js'), 'utf8');
  assert.match(home, /second/);
  assert.doesNotMatch(home, /first/);
});

// The watcher is deliberately narrow about what counts as a change: an editor's swap file, a
// backup copy and a dotfile all land in the source tree while you type, and rebuilding on each
// one would rebuild constantly and reload the page out from under you.
test('an editor scratch file is not a change', async () => {
  const root = projectDir(DEMO);
  const s = await start(root);
  await s.port();
  const before = s.lines.length;

  for (const noise of ['zaal/.Home.zaal.swp', 'zaal/pages/Home.zaal~', 'zaal/pages/.hidden.zaal',
    'zaal/pages/Home.zaal.tmp']) {
    save(root, noise, 'junk\n');
  }
  // a real save afterwards proves the watcher is still live and that the quiet was the filter,
  // not a watcher that had stopped reporting: only this one rebuild may appear.
  save(root, 'zaal/pages/Home.zaal', 'C Home\n  %page\n    h1 "third"\n');
  await s.until(/rebuilt/, 'the rebuild after the ignored saves');

  const rebuilds = s.lines.filter(l => /rebuilt/.test(l));
  assert.equal(rebuilds.length, 1, `one rebuild, not ${rebuilds.length}:\n${s.text}`);
  assert.match(rebuilds[0], /Home\.zaal/, 'and it names the file that actually changed');
  assert.ok(s.lines.length > before, 'the watcher did report something');
});

// A half-typed source is the normal state of a file being edited, so a broken save must not
// take the dev server down with it: the error is printed, the last good output stays on disk,
// and fixing the file rebuilds as if nothing happened.
test('a broken save is reported and the watcher survives it', async () => {
  const root = projectDir(DEMO);
  const s = await start(root);
  const port = await s.port();
  const good = readFileSync(join(root, '.zaal-dev/src/pages/Home.js'), 'utf8');

  save(root, 'zaal/pages/Home.zaal', 'C Home\n  %nosuchentry\n    h1 "broken"\n');
  await s.until(/error/, 'the error for the broken source');
  assert.match(s.text, /nosuchentry/, 'the message names what is wrong');

  // nothing was written: the page a browser still has open keeps working
  assert.equal(readFileSync(join(root, '.zaal-dev/src/pages/Home.js'), 'utf8'), good);
  assert.equal((await fetch(`http://127.0.0.1:${port}/`)).status, 200);

  save(root, 'zaal/pages/Home.zaal', 'C Home\n  %page\n    h1 "fixed"\n');
  await s.until(/rebuilt/, 'the rebuild after the fix');
  assert.match(readFileSync(join(root, '.zaal-dev/src/pages/Home.js'), 'utf8'), /fixed/);
});

// `ui.zaal` and a raw stylesheet are sources too — the look of the app is edited as often as
// its markup, and a design change that needed a restart to show up would be the thing you
// notice first.
test('the design system and a raw stylesheet are watched as well', async () => {
  const root = projectDir(DEMO);
  const s = await start(root);
  await s.port();

  save(root, 'zaal/ui.zaal', 'D W\nt color\n  fg #222\nk page main\n  fg $color.fg\n  p 2rem\n');
  await s.until(/rebuilt \(ui\.zaal\)/, 'the rebuild for ui.zaal');
  assert.match(readFileSync(join(root, '.zaal-dev/src/styles/ui.css'), 'utf8'), /padding: 2rem/);

  save(root, 'zaal/styles/extra.css', '.extra { color: blue }\n');
  await s.until(/rebuilt \(styles[\\/]extra\.css\)/, 'the rebuild for the stylesheet');
  assert.match(readFileSync(join(root, '.zaal-dev/src/styles/extra.css'), 'utf8'), /blue/);
});

// A file created and a file deleted are both changes, and the second has to sweep: a module
// left behind for a source that is gone is a page importing something that no longer exists.
// Both happen while the dev server runs — a new component, a page you thought better of.
test('a source created is picked up, and a source deleted has its module swept', async () => {
  const root = projectDir(DEMO);
  const s = await start(root);
  await s.port();
  assert.ok(!existsSync(join(root, '.zaal-dev/src/components/Extra.js')),
    'the component does not exist yet');

  // created: a component that was not there when the server started
  save(root, 'zaal/components/Extra.zaal', 'C Extra\n  %page\n    h1 "extra"\n');
  await s.until(/rebuilt \(components[\\/]Extra\.zaal\)/, 'the rebuild for the new component');
  assert.match(readFileSync(join(root, '.zaal-dev/src/components/Extra.js'), 'utf8'), /extra/);

  // deleted: the source goes, so its module has to go with it
  rmSync(join(root, 'zaal/components/Extra.zaal'));
  await s.until(/removed/, 'the sweep after the delete');
  assert.ok(!existsSync(join(root, '.zaal-dev/src/components/Extra.js')),
    'the module for the deleted source is gone');
  // and the emptied directory goes too, rather than being left behind
  assert.ok(!existsSync(join(root, '.zaal-dev/src/components')),
    'the directory it was the only file in is gone');
  assert.match(s.text, /removed .*Extra/, 'and the watcher said what it removed');
});

// Several saves in a row — a formatter touching a directory, a branch switch — are one
// rebuild, not one per file: the watcher waits for the writes to stop before building.
test('a burst of saves is coalesced into one rebuild', async () => {
  const root = projectDir({ ...DEMO,
    'zaal/components/A.zaal': 'C A\n  p "a"\n',
    'zaal/components/B.zaal': 'C B\n  p "b"\n',
    'zaal/components/C.zaal': 'C C\n  p "c"\n',
  });
  const s = await start(root);
  await s.port();

  for (const n of ['A', 'B', 'C']) save(root, `zaal/components/${n}.zaal`, `C ${n}\n  p "${n}!"\n`);
  await s.until(/rebuilt/, 'the coalesced rebuild');
  // give any second rebuild the chance to appear before counting
  await new Promise(r => setTimeout(r, 400));

  const rebuilds = s.lines.filter(l => /rebuilt/.test(l));
  assert.equal(rebuilds.length, 1, `three saves became ${rebuilds.length} rebuilds:\n${s.text}`);
  for (const n of ['A', 'B', 'C']) {
    assert.match(readFileSync(join(root, `.zaal-dev/src/components/${n}.js`), 'utf8'), new RegExp(`${n}!`));
  }
});
