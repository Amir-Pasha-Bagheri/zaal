// Who owns which file in `application/`. The output is generated, but it is also handed to a
// developer who installs, runs and commits it — so a Dockerfile, a CI workflow, a hand-written
// helper and an edit to index.html's `<head>` all have to survive every rebuild, while a module
// whose source was deleted still has to go. See ROADMAP Part 1g (G13, G14).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { projectDir, buildIn, read, has, cleanup } from './helpers/fixture.mjs';
import { headChildren, mergeHead } from '../packages/react/src/entry.mjs';

after(cleanup);

const APP = {
  'zaal/app.zaal': 'A Shop\n  t "Shop"\n  / Home\n',
  'zaal/Home.zaal': 'C Home\n  h1 "hi"\n',
};

// Edit the generated page the way a developer would, then rebuild.
const edit = (root, head) => {
  const page = join(root, 'application/index.html');
  writeFileSync(page, readFileSync(page, 'utf8').replace('  </head>', head + '\n  </head>'));
};

/* ---------- G13: a hand-edited <head> survives ---------- */

test('head children the compiler did not write are carried across a rebuild', () => {
  const root = projectDir(APP);
  buildIn(root);
  edit(root, '    <meta property="og:title" content="Mine" />\n'
    + '    <link rel="icon" href="./favicon.ico" />\n'
    + '    <!-- analytics -->\n'
    + '    <script>window.q = 1;</script>');
  buildIn(root);
  const page = read(root, 'application/index.html');
  assert.match(page, /<meta property="og:title" content="Mine" \/>/);
  assert.match(page, /<link rel="icon" href=".\/favicon.ico" \/>/);
  assert.match(page, /<!-- analytics -->/);
  assert.match(page, /<script>window\.q = 1;<\/script>/);
  // ...and they are still inside the head, after what the compiler generates
  const [, inner] = /<head>([\s\S]*?)<\/head>/.exec(page);
  assert.ok(inner.indexOf('og:title') > inner.indexOf('<title>'));
  assert.ok(!/<\/head>[\s\S]*og:title/.test(page));
});

test('a preserved child survives any number of rebuilds', () => {
  const root = projectDir(APP);
  buildIn(root);
  edit(root, '    <meta name="mine" content="1" />');
  for (let i = 0; i < 4; i++) buildIn(root);
  assert.equal(read(root, 'application/index.html').match(/name="mine"/g).length, 1,
    'carried across, and not duplicated once per build');
});

test('what the compiler generates still tracks app.zaal', () => {
  const root = projectDir(APP);
  buildIn(root);
  edit(root, '    <meta name="mine" content="1" />');
  writeFileSync(join(root, 'zaal/app.zaal'), 'A Shop\n  t "Renamed"\n  m app\n  / Home\n');
  buildIn(root);
  const page = read(root, 'application/index.html');
  assert.match(page, /<title>Renamed<\/title>/);
  assert.doesNotMatch(page, /<title>Shop<\/title>/, 'the old title is replaced, not kept beside');
  assert.match(page, /<div id="app"><\/div>/);
  assert.match(page, /name="mine"/, 'the hand edit is untouched by either change');
});

test('a stylesheet the build stops emitting goes, and a hand-added one stays', () => {
  const root = projectDir({ ...APP,
    'zaal/app.zaal': 'A Shop\n  t "Shop"\n  css ./extra.css\n  / Home\n',
    'zaal/extra.css': '.x{}',
  });
  buildIn(root);
  edit(root, '    <link rel="stylesheet" href="https://fonts.example/x.css" />');
  assert.match(read(root, 'application/index.html'), /styles\/extra\.css/);
  writeFileSync(join(root, 'zaal/app.zaal'), 'A Shop\n  t "Shop"\n  / Home\n');
  const out = buildIn(root);
  const page = read(root, 'application/index.html');
  assert.doesNotMatch(page, /extra\.css/, 'it was in the manifest, so it is the compiler\'s to drop');
  assert.match(page, /fonts\.example/, 'it never was, so it is the developer\'s to keep');
  assert.deepEqual(out.stale, ['src/styles/extra.css']);
});

test('the no-install preview is regenerated whole', () => {
  const root = projectDir(APP);
  buildIn(root, 'esm');
  const page = join(root, '.zaal-dev/index.html');
  writeFileSync(page, readFileSync(page, 'utf8').replace('  </head>', '    <meta name="mine" />\n  </head>'));
  buildIn(root, 'esm');
  assert.doesNotMatch(read(root, '.zaal-dev/index.html'), /name="mine"/,
    '.zaal-dev/ is ephemeral — nothing in it is hand-written');
});

test('without a manifest, the generator still owns the head it is known to write', () => {
  const root = projectDir(APP);
  buildIn(root);
  edit(root, '    <meta name="mine" content="1" />\n'
    + '    <link rel="stylesheet" href="./src/styles/gone.css" />');
  rmSync(join(root, '.zaal'), { recursive: true });        // as if built by an older Zaal
  buildIn(root);
  const page = read(root, 'application/index.html');
  assert.match(page, /name="mine"/, 'an unrecognised child is the developer\'s');
  assert.doesNotMatch(page, /gone\.css/, 'a link into the generated styles directory is not');
  assert.equal(page.match(/<meta charset/g).length, 1, 'and the metas are not doubled');
  assert.equal(page.match(/<title>/g).length, 1);
});

/* ---------- splitting a <head> is not a full HTML parse, but it has to hold ---------- */

test('head children split on the awkward cases', () => {
  const kids = headChildren(`<!doctype html><html><head>
    <meta name="a" content="x > y" />
    <!-- a <link> inside a comment -->
    <script>if (1 > 0) { f("</scr" + "ipt>"); }</script>
    <title>T</title>
    <style>a { content: ">"; }</style>
    <link rel="icon" href='q"ote.ico'>
  </head><body></body></html>`);
  assert.equal(kids.length, 6);
  assert.match(kids[0], /^<meta name="a" content="x > y" \/>$/);
  assert.match(kids[1], /^<!-- a <link> inside a comment -->$/);
  assert.ok(kids[2].startsWith('<script>') && kids[2].endsWith('</script>'));
  assert.equal(kids[3], '<title>T</title>');
  assert.ok(kids[4].startsWith('<style>') && kids[4].endsWith('</style>'));
  assert.match(kids[5], /q"ote\.ico/);
});

test('a page with no head is left generated rather than guessed at', () => {
  const generated = '<!doctype html>\n<html>\n  <head>\n    <title>A</title>\n  </head>\n  <body></body>\n</html>\n';
  assert.equal(headChildren('<html><body>no head</body></html>'), null);
  assert.equal(mergeHead(generated, '<html><body>no head</body></html>', null).html, generated);
  assert.equal(mergeHead(generated, null, null).html, generated);
  assert.deepEqual(mergeHead(generated, null, null).head, ['<title>A</title>']);
});

/* ---------- G14: the sweep goes by what the last build wrote ---------- */

test('files that are not the compiler\'s survive a rebuild, whatever they are called', () => {
  const root = projectDir(APP);
  buildIn(root);
  const own = {
    'application/Dockerfile': 'FROM node:20\n',
    'application/.npmrc': 'registry=https://example.com\n',
    'application/.github/workflows/ci.yml': 'name: ci\n',
    'application/public/robots.txt': 'ok\n',
    'application/src/helpers.js': '// mine\n',
    'application/src/mine.css': '.mine{}\n',
    'application/src/lib/deep/thing.jsx': '// also mine\n',
  };
  for (const [path, body] of Object.entries(own)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  const out = buildIn(root);
  assert.deepEqual(out.stale, []);
  for (const [path, body] of Object.entries(own)) assert.equal(read(root, path), body, path);
});

test('a deleted source still has its module and emptied directory swept', () => {
  const root = projectDir({ ...APP, 'zaal/widgets/Card.zaal': 'C Card\n  div "c"\n' });
  buildIn(root);
  assert.ok(has(root, 'application/src/widgets/Card.jsx'));
  rmSync(join(root, 'zaal/widgets'), { recursive: true });
  const out = buildIn(root);
  assert.deepEqual(out.stale, ['src/widgets/Card.jsx']);
  assert.ok(!has(root, 'application/src/widgets'));
});

test('an asset that stops being imported is swept too', () => {
  const root = projectDir({ ...APP,
    'zaal/Home.zaal': 'i logo ./logo.png\nC Home\n  img src={logo}\n',
    'zaal/logo.png': 'png',
  });
  buildIn(root);
  assert.ok(has(root, 'application/src/logo.png'));
  writeFileSync(join(root, 'zaal/Home.zaal'), 'C Home\n  h1 "hi"\n');
  const out = buildIn(root);
  assert.deepEqual(out.stale, ['src/logo.png'],
    'the manifest knows the build copied it, so an extension no longer decides');
  assert.ok(!has(root, 'application/src/logo.png'));
});

test('the write-once project files are never swept and never rewritten', () => {
  const root = projectDir(APP);
  const first = buildIn(root);
  assert.deepEqual(first.scaffolded, ['package.json', 'vite.config.js', '.gitignore']);
  const tweaked = read(root, 'application/vite.config.js') + '\n// my plugin\n';
  writeFileSync(join(root, 'application/vite.config.js'), tweaked);
  const second = buildIn(root);
  assert.deepEqual(second.scaffolded, [], 'written once, then left alone');
  assert.deepEqual(second.stale, []);
  assert.equal(read(root, 'application/vite.config.js'), tweaked);
});

/* ---------- the manifest is build state, and stays out of the deliverable ---------- */

test('the manifest lives at the project root, not in the output', () => {
  const root = projectDir(APP);
  const out = buildIn(root);
  const manifest = JSON.parse(read(root, '.zaal/manifest.json'));
  assert.equal(manifest.version, 1);
  assert.ok(manifest.outputs.application.files.includes('index.html'));
  assert.ok(manifest.outputs.application.files.includes('src/main.jsx'));
  assert.ok(manifest.outputs.application.head.some(c => /<title>/.test(c)));
  // Nothing the compiler writes into `application/` names it: a developer can `git init` in
  // there and it reads as a React project they wrote by hand.
  assert.ok(!manifest.outputs.application.files.some(f => /zaal/i.test(f)));
  for (const f of ['.zaal', 'manifest.json', '.zaal/manifest.json']) {
    assert.ok(!existsSync(join(root, out.outDir, f)), `${f} is not in ${out.outDir}/`);
  }
});

test('each output directory sweeps against its own entry', () => {
  const root = projectDir({ ...APP, 'zaal/Extra.zaal': 'C Extra\n  div "e"\n' });
  buildIn(root);
  buildIn(root, 'esm');
  rmSync(join(root, 'zaal/Extra.zaal'));
  assert.deepEqual(buildIn(root).stale, ['src/Extra.jsx']);
  assert.deepEqual(buildIn(root, 'esm').stale, ['src/Extra.js']);
  const manifest = JSON.parse(read(root, '.zaal/manifest.json'));
  assert.deepEqual(Object.keys(manifest.outputs).sort(), ['.zaal-dev', 'application']);
  assert.ok(!manifest.outputs['.zaal-dev'].head, 'the preview has no head to preserve');
});

test('a mangled manifest is not an error', () => {
  const root = projectDir(APP);
  buildIn(root);
  writeFileSync(join(root, '.zaal/manifest.json'), '{ truncated');
  const out = buildIn(root);
  assert.deepEqual(out.stale, []);
  assert.ok(has(root, 'application/index.html'));
  assert.equal(JSON.parse(read(root, '.zaal/manifest.json')).version, 1, 'and is rewritten');
});

/* ---------- G13: the merge against a file an editor, not the compiler, last wrote ---------- */

test('preserved children keep their order', () => {
  const root = projectDir(APP);
  buildIn(root);
  edit(root, '    <meta name="a" />\n    <!-- b -->\n    <meta name="c" />');
  buildIn(root);
  const [, inner] = /<head>([\s\S]*?)<\/head>/.exec(read(root, 'application/index.html'));
  assert.ok(inner.indexOf('name="a"') < inner.indexOf('<!-- b -->'));
  assert.ok(inner.indexOf('<!-- b -->') < inner.indexOf('name="c"'));
});

test('CRLF line endings and a reflowed tag still match what was generated', () => {
  const root = projectDir(APP);
  buildIn(root);
  const page = join(root, 'application/index.html');
  // What an editor on Windows, or a formatter with a narrow column, leaves behind.
  writeFileSync(page, readFileSync(page, 'utf8')
    .replace('<meta name="viewport" content="width=device-width, initial-scale=1" />',
      '<meta\n        name="viewport"\n        content="width=device-width, initial-scale=1"\n    />')
    .replace('  </head>', '        <meta name="mine" />\n  </head>')
    .replace(/\n/g, '\r\n'));
  const merged = (buildIn(root), read(root, 'application/index.html'));
  assert.equal(merged.match(/name="viewport"/g).length, 1,
    'the reflowed generated tag is recognised, not preserved beside the new one');
  assert.equal(merged.match(/name="mine"/g).length, 1, 'and the hand edit still comes across');
});

test('a <head> carrying an attribute is still read', () => {
  const root = projectDir(APP);
  buildIn(root);
  const page = join(root, 'application/index.html');
  writeFileSync(page, readFileSync(page, 'utf8')
    .replace('<head>', '<head data-env="staging">')
    .replace('  </head>', '    <meta name="mine" />\n  </head>'));
  buildIn(root);
  const merged = read(root, 'application/index.html');
  assert.match(merged, /name="mine"/, 'its children are found');
  assert.match(merged, /<head>/, 'but the tag itself is generated — only children are preserved');
});

test('a hand-added copy of a generated child is not doubled', () => {
  const root = projectDir(APP);
  buildIn(root);
  edit(root, '    <meta charset="UTF-8" />\n    <title>Shop</title>');
  buildIn(root);
  const merged = read(root, 'application/index.html');
  assert.equal(merged.match(/<meta charset/g).length, 1);
  assert.equal(merged.match(/<title>/g).length, 1);
});

test('a preserved module script does not disturb the generated entry script', () => {
  const root = projectDir(APP);
  buildIn(root);
  edit(root, '    <script type="module" src="./analytics.js"></script>');
  buildIn(root);
  const merged = read(root, 'application/index.html');
  assert.equal(merged.match(/src="\.\/src\/main\.jsx"/g).length, 1, 'still exactly one entry');
  assert.match(merged, /src="\.\/analytics\.js"/);
  const [, head] = /<head>([\s\S]*?)<\/head>/.exec(merged);
  assert.match(head, /analytics/, 'the preserved script stays in the head');
  assert.doesNotMatch(head, /main\.jsx/, 'and the entry stays in the body');
});

/* ---------- G14: the manifest against a tree something else has moved ---------- */

test('a stale entry the developer already deleted is not reported', () => {
  const root = projectDir({ ...APP, 'zaal/Extra.zaal': 'C Extra\n  div "e"\n' });
  buildIn(root);
  rmSync(join(root, 'zaal/Extra.zaal'));
  rmSync(join(root, 'application/src/Extra.jsx'));        // and they removed the output too
  const out = buildIn(root);
  assert.deepEqual(out.stale, [], 'it was in the manifest, but there is nothing left to sweep');
});

test('a source moved between directories sweeps the path it left', () => {
  const root = projectDir({ ...APP, 'zaal/widgets/Card.zaal': 'C Card\n  div "c"\n' });
  buildIn(root);
  mkdirSync(join(root, 'zaal/panels'), { recursive: true });
  writeFileSync(join(root, 'zaal/panels/Card.zaal'), 'C Card\n  div "c"\n');
  rmSync(join(root, 'zaal/widgets'), { recursive: true });
  const out = buildIn(root);
  assert.deepEqual(out.stale, ['src/widgets/Card.jsx']);
  assert.ok(!has(root, 'application/src/widgets'), 'the emptied directory goes with it');
  assert.ok(has(root, 'application/src/panels/Card.jsx'));
});

test('a path that becomes generated is taken over by the compiler', () => {
  const root = projectDir(APP);
  buildIn(root);
  writeFileSync(join(root, 'application/src/About.jsx'), '// mine, for now\n');
  writeFileSync(join(root, 'zaal/About.zaal'), 'C About\n  h1 "about"\n');
  const out = buildIn(root);
  assert.ok(out.made.includes('src/About.jsx'));
  assert.match(read(root, 'application/src/About.jsx'), /about/,
    'a source now claims that path, so the compiler is its author from here on');
});
