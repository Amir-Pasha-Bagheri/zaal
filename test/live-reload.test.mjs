// The live-reload channel `zaal dev` keeps open: its own file, because the test holds a streaming
// response and a timer while it waits for an event.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { once } from 'node:events';
import { join } from 'node:path';
import { serve } from '../zaal.mjs';
import { projectDir, buildIn, cleanup } from './helpers/fixture.mjs';

after(cleanup);

const DEMO = {
  'zaal/app.zaal': 'A Demo\n  t "Demo"\n  / Home\n',
  'zaal/Home.zaal': 'C Home\n  h1 "hi"\n',
};

test('reload() pushes an event to a connected client', async () => {
  const root = projectDir(DEMO);
  buildIn(root, 'esm');
  const server = serve(join(root, '.zaal-dev'), 0, { live: true });
  await once(server.server, 'listening');
  const port = server.server.address().port;
  const req = request({ host: '127.0.0.1', port, path: '/__zaal' });
  // The event stream's headers only reach the client with the first event, so keep nudging
  // reload() until one lands — a real browser is in the same position after a save.
  const ticker = setInterval(() => server.reload(), 20);
  try {
    req.end();
    const [res] = await once(req, 'response');
    assert.equal(res.headers['content-type'], 'text/event-stream');
    const chunk = await new Promise(ok => res.once('data', c => ok(String(c))));
    assert.match(chunk, /data: reload/);
  } finally {
    clearInterval(ticker);
    req.destroy();
    server.close();
  }
});

// The preview serves whatever a build copied into it, assets included: a stylesheet answered
// as text/plain would not apply and an SVG would not render.
test('every file the build writes is served with its own media type', async () => {
  const root = projectDir({
    'zaal/app.zaal': 'A D\n  ui ./ui.zaal\n  / Home\n',
    'zaal/ui.zaal': 'D U\nk page main\n  p 0\n',
    'zaal/pages/Home.zaal': 'i logo ../img/logo.svg\nC Home\n  %page\n    img src=logo\n',
    'zaal/img/logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
  });
  buildIn(root, 'esm');
  const server = serve(join(root, '.zaal-dev'), 0);
  await once(server.server, 'listening');
  const port = server.server.address().port;
  const type = async path => (await fetch(`http://127.0.0.1:${port}${path}`)).headers.get('content-type');
  try {
    assert.equal(await type('/'), 'text/html');
    assert.equal(await type('/src/main.js'), 'text/javascript');
    assert.equal(await type('/src/styles/ui.css'), 'text/css');
    assert.equal(await type('/src/img/logo.svg'), 'image/svg+xml');
  } finally { server.close(); }
});
