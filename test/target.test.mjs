// Target resolution — how `zaal` finds the package that generates the code.
//
// Nothing tested this, and it is the hinge the whole plugin story turns on: `zaal` depends on
// nothing and knows no framework, so a `target` line in app.zaal is the only thing that says
// whose compiler to load. The promises are that the default is React, that a target is resolved
// from the *project* before anywhere else (a globally installed `zaal` has to find the one the
// project asked for), that a name with a slash is taken as written, and that a missing one says
// how to install it rather than failing as a module-resolution error.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadTarget, APP_FILE } from '../zaal.mjs';
import { projectDir, cleanup } from './helpers/fixture.mjs';

after(cleanup);

// A package inside the project's own node_modules, which is where `zaal` has to look first.
const pkg = (name, body) => ({
  [`node_modules/${name}/package.json`]:
    JSON.stringify({ name, version: '1.0.0', type: 'module', main: 'index.mjs' }),
  [`node_modules/${name}/index.mjs`]: body,
  // resolution starts from the project's package.json, so the project has to have one
  'package.json': JSON.stringify({ name: 'app', version: '1.0.0' }),
});

// A minimal thing that satisfies "is a Zaal target": the backends map is what `build` reads.
const TARGET = `export default {
  name: 'fake', default: 'a', preview: 'a',
  backends: { a: { ext: '.a', outDir: 'out' } },
};`;

test('with no app.zaal at all, the target is React', async () => {
  const target = await loadTarget(projectDir({}), APP_FILE);
  assert.equal(target.name, 'react');
  assert.deepEqual(Object.keys(target.backends), ['jsx', 'esm']);
});

test('an app.zaal with no target line is React too, and `target react` says so explicitly', async () => {
  for (const app of ['A D\n  t "x"\n  / Home\n', 'A D\n  target react\n  / Home\n']) {
    const target = await loadTarget(projectDir({ 'zaal/app.zaal': app }), APP_FILE);
    assert.equal(target.name, 'react', app);
  }
});

// The spec: "It is the one directive read before anything else is parsed — `zaal` itself has no
// framework in it, and must know whose compiler to load before it can read the rest of the
// file." So the line is found by a text scan, and nothing else in app.zaal can stop it.
test('the target line is read without parsing the rest of app.zaal', async () => {
  const root = projectDir({
    // everything after the target line is nonsense no parser would accept
    'zaal/app.zaal': 'A D\n  target wholly-made-up\n  ))) not a directive (((\n  @@@\n',
  });
  await assert.rejects(() => loadTarget(root, APP_FILE), e => {
    // it got as far as *naming the target*, which it could only do by reading that one line
    assert.match(e.message, /no target `wholly-made-up`/);
    return true;
  });
});

test('a target that is not installed says how to install it', async () => {
  const root = projectDir({ 'zaal/app.zaal': 'A D\n  target svelte\n' });
  await assert.rejects(() => loadTarget(root, APP_FILE), e => {
    assert.match(e.message, /no target `svelte`/);
    assert.match(e.message, /npm i -D @zaal\/svelte/, 'the bare name becomes a @zaal package');
    assert.match(e.message, /the default is `react`/, 'and the message says what the default is');
    return true;
  });
});

// "a name with a slash is taken as written, so a target outside the scope works too"
test('a target name with a slash is a package name as written', async () => {
  const root = projectDir({ 'zaal/app.zaal': 'A D\n  target my-org/zaal-svelte\n' });
  await assert.rejects(() => loadTarget(root, APP_FILE), e => {
    assert.match(e.message, /npm i -D my-org\/zaal-svelte/);
    assert.doesNotMatch(e.message, /@zaal\/my-org/, 'it is not prefixed with the scope');
    return true;
  });
});

// The reason resolution starts at the project rather than at `zaal`'s own location: `npm i -g
// zaal` puts the command outside every project, and the target belongs to the project.
test('a target is resolved from the project that asked for it', async () => {
  const root = projectDir({
    'zaal/app.zaal': 'A D\n  target fake\n',
    ...pkg('@zaal/fake', TARGET),
  });
  const target = await loadTarget(root, APP_FILE);
  assert.equal(target.name, 'fake');
  assert.deepEqual(Object.keys(target.backends), ['a']);
});

test('a slash-named target is resolved from the project too', async () => {
  const root = projectDir({
    'zaal/app.zaal': 'A D\n  target my-org/zaal-fake\n',
    ...pkg('my-org/zaal-fake', TARGET),
  });
  assert.equal((await loadTarget(root, APP_FILE)).name, 'fake');
});

// A target may export itself as `target` rather than as the default, which is what @zaal/react
// does alongside its default export.
test('a target may be the named export `target` instead of the default', async () => {
  const root = projectDir({
    'zaal/app.zaal': 'A D\n  target fake\n',
    ...pkg('@zaal/fake', TARGET.replace('export default', 'export const target =')),
  });
  assert.equal((await loadTarget(root, APP_FILE)).name, 'fake');
});

// A package of that name existing is not enough: it has to actually be a target, or `build`
// would fail later with something about `backends` being undefined.
test('a package that is not a Zaal target is not accepted as one', async () => {
  const root = projectDir({
    'zaal/app.zaal': 'A D\n  target fake\n',
    ...pkg('@zaal/fake', 'export default { nope: true };'),
  });
  await assert.rejects(() => loadTarget(root, APP_FILE), e => {
    // it falls through to the same advice, rather than crashing inside the build
    assert.match(e.message, /no target `fake`/);
    return true;
  });
});

// `target` is a directive like any other, so the parser has to know it as well — otherwise an
// app.zaal that named one would be rejected by the very file that is meant to declare it.
test('the target line is also a directive the app parser accepts', async () => {
  const root = projectDir({
    'zaal/app.zaal': 'A D\n  target react\n  t "T"\n  / Home\n',
    'zaal/pages/Home.zaal': 'C Home\n  h1 "hi"\n',
  });
  const { build } = await import('../zaal.mjs');
  const out = build({ root, target: 'jsx' });
  assert.equal(out.app.name, 'D');
  assert.match(readFileSync(join(root, 'application/index.html'), 'utf8'), /<title>T<\/title>/);
});

// The other side of the plugin boundary: `zaal` knows no framework, so the pipeline refuses to
// run without one rather than failing somewhere deeper with `undefined`. These are the messages
// the author of a new target sees first, so they have to name what is missing and who supplies
// it — a target package wired up wrongly is the whole audience for them.
test('the pipeline refuses to run without the pieces a target has to supply', async () => {
  const { project: coreProject, build: coreBuild } = await import('zaal');
  const react = (await import('@zaal/react')).default;
  const root = projectDir({ 'zaal/app.zaal': 'A D\n  / Home\n' });

  // `project` needs both parsers: what an app declaration and a design system *are* belongs to
  // the web layer, not to `zaal`.
  for (const opts of [{}, { parseApp: react.parseApp }, { parseUI: react.parseUI }]) {
    assert.throws(() => coreProject({ root, ...opts }), /needs `parseApp` and `parseUI`/,
      `missing parsers: ${Object.keys(opts).join(',') || 'none'}`);
  }

  assert.throws(() => coreBuild({ root }), /no target — pass `framework`/);
  // a backend the target does not have, with the ones it does in the message
  assert.throws(() => coreBuild({ root, framework: react, backend: 'svelte' }), e => {
    assert.match(e.message, /unknown backend: svelte/);
    assert.match(e.message, /react has jsx, esm/, 'and it lists what the target does have');
    return true;
  });
});

// Whitespace around the directive, and the letters a package name may hold.
test('the scan reads the line however it is spaced, and only a whole line', async () => {
  const named = async app => {
    const root = projectDir({ 'zaal/app.zaal': app });
    try { return (await loadTarget(root, APP_FILE)).name; }
    catch (e) { return /no target `([^`]+)`/.exec(e.message)?.[1] ?? e.message; }
  };
  assert.equal(await named('A D\n\ttarget made-up\n'), 'made-up', 'a tab indent');
  assert.equal(await named('A D\n      target made-up   \n'), 'made-up', 'trailing spaces');
  assert.equal(await named('A D\n  target @scope/pkg\n'), '@scope/pkg', 'a scoped package name');
  // not a target line: a word before it, or a second word after it
  assert.equal(await named('A D\n  // target made-up\n'), 'react', 'a comment is not a directive');
  assert.equal(await named('A D\n  target made-up extra\n'), 'react', 'two names is not one target');
});
