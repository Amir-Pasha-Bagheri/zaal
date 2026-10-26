// The live-reload channel `zal dev` keeps open: its own file, because the test holds a streaming
// response and a timer while it waits for an event.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { once } from 'node:events';
import { join } from 'node:path';
import { serve } from '../zal.mjs';
import { projectDir, buildIn, cleanup } from './helpers/fixture.mjs';

after(cleanup);

const DEMO = {
  'zal/app.zal': 'A Demo\n  t "Demo"\n  / Home\n',
  'zal/Home.zal': 'C Home\n  h1 "hi"\n',
};

test('reload() pushes an event to a connected client', async () => {
  const root = projectDir(DEMO);
  buildIn(root, 'esm');
  const server = serve(join(root, '.zal-dev'), 0, { live: true });
  await once(server.server, 'listening');
  const port = server.server.address().port;
  const req = request({ host: '127.0.0.1', port, path: '/__zal' });
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
