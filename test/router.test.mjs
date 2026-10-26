// The router the compiler generates, exercised as a module: patterns, params, Link, go and the
// fallback. It is dependency-free code the app ships, so it gets its own tests.
import './helpers/loader.mjs';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { projectDir, buildIn, cleanup } from './helpers/fixture.mjs';
import { installEnv } from './helpers/env.mjs';
import { mount, createElement as h, reset } from './helpers/tiny-react.mjs';

after(cleanup);

// One build, one router module, reused by every case below.
const root = projectDir({
  'zal/app.zal': 'A R\n  / Home\n',
  'zal/Home.zal': 'C Home\n  h1 "home"\n',
});
buildIn(root, 'esm');
const router = await import(join(root, '.zal-dev/src/router.js'));

const Page = name => props => h('p', null, `${name}:${JSON.stringify(props)}`);

const at = (hash, routes, fallback) => {
  reset();
  const env = installEnv({ hash });
  const app = mount(h(router.Router, { routes, fallback }));
  return { app, env };
};

test('a static path matches exactly', () => {
  const routes = [{ path: '/', component: Page('home') }, { path: '/about', component: Page('about') }];
  assert.match(at('#/', routes).app.html, /home:\{\}/);
  assert.match(at('#/about', routes).app.html, /about:\{\}/);
});

test('an empty hash is the root route', () => {
  const routes = [{ path: '/', component: Page('home') }];
  assert.match(at('', routes).app.html, /home/);
  assert.match(at('#', routes).app.html, /home/);
});

test('a :param is passed to the component as a prop', () => {
  const routes = [{ path: '/todo/:id', component: Page('todo') }];
  assert.match(at('#/todo/42', routes).app.html, /todo:\{"id":"42"\}/);
});

test('several params in one path', () => {
  const routes = [{ path: '/u/:user/post/:slug', component: Page('post') }];
  const html = at('#/u/ada/post/hello', routes).app.html;
  assert.match(html, /"user":"ada"/);
  assert.match(html, /"slug":"hello"/);
});

test('a param is URL-decoded', () => {
  const routes = [{ path: '/q/:term', component: Page('q') }];
  assert.match(at('#/q/a%20b', routes).app.html, /a b/);
});

test('segment count has to match, so a longer or shorter path falls through', () => {
  const routes = [{ path: '/a/:id', component: Page('one') }];
  assert.match(at('#/a/1/2', routes).app.html, /Not found: \/a\/1\/2/);
  assert.match(at('#/a', routes).app.html, /Not found: \/a/);
});

test('trailing slashes are ignored, and the first matching route wins', () => {
  const routes = [{ path: '/a', component: Page('first') }, { path: '/a', component: Page('second') }];
  assert.match(at('#/a/', routes).app.html, /first/);
});

test('no match renders the fallback, or a default message', () => {
  const routes = [{ path: '/', component: Page('home') }];
  assert.match(at('#/nope', routes).app.html, /<p>Not found: \/nope<\/p>/);
  assert.match(at('#/nope', routes, h('em', null, 'custom')).app.html, /<em>custom<\/em>/);
});

test('a hashchange re-renders the route', () => {
  const routes = [{ path: '/', component: Page('home') }, { path: '/x', component: Page('ex') }];
  const { app, env } = at('#/', routes);
  assert.match(app.html, /home/);
  env.navigate('/x');
  assert.match(app.html, /ex/);
  env.navigate('/');
  assert.match(app.html, /home/);
});

test('go() navigates by setting the hash', () => {
  const { env } = at('#/', [{ path: '/', component: Page('home') }]);
  router.go('/done');
  assert.equal(env.window.location.hash, '/done');
});

test('Link renders an anchor, marks the active route and forwards its own props', () => {
  reset();
  installEnv({ hash: '#/about' });
  const app = mount(h('nav', null,
    h(router.Link, { to: '/', children: 'Home' }),
    h(router.Link, { to: '/about', className: 'tab', title: 't', children: 'About' })));
  assert.match(app.html, /<a href="#\/">Home<\/a>/);
  assert.match(app.html, /<a href="#\/about" data-active="true" class="tab" title="t">About<\/a>/);
});

test('useRoute returns the current path and tracks changes', () => {
  reset();
  const env = installEnv({ hash: '#/one' });
  const Probe = () => h('p', null, router.useRoute());
  const app = mount(h(Probe, null));
  assert.match(app.html, /<p>\/one<\/p>/);
  env.navigate('/two');
  assert.match(app.html, /<p>\/two<\/p>/);
});

test('the listener is removed when the tree goes away', () => {
  reset();
  const env = installEnv({ hash: '#/' });
  const Probe = () => h('p', null, router.useRoute());
  mount(h(Probe, null));
  reset();                                  // unmount: effects are torn down
  assert.doesNotThrow(() => env.navigate('/x'));
});

/* ---------- the app's own route table ---------- */

test('a :param route and a lazy route coexist in one table', () => {
  const app = projectDir({
    'zal/app.zal': 'A R\n  / Home\n  /u/:name Profile\n  /heavy Heavy lazy\n',
    'zal/Home.zal': 'C Home\n  h1 "h"\n',
    'zal/Profile.zal': 'C Profile p:name\n  h1 "{name}"\n',
    'zal/Heavy.zal': 'C Heavy\n  h1 "big"\n',
  });
  buildIn(app, 'esm');
  const main = buildIn(app, 'jsx');
  assert.equal(main.app.routes.length, 3);
});
