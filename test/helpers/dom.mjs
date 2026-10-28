// A real DOM and the real client renderer. `react-dom/server` skips the checks that only run
// on the client — invalid nesting (`<p><div>`), a controlled field with no handler, a bad
// `key` — so this is the only place they can fail a test.
//
// Sources are compiled, bundled by esbuild and evaluated in jsdom, which is as close to a
// browser as the suite can get without one.
import { buildSync } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dropDir } from './scratch.mjs';
import { join } from 'node:path';

let jsdom = null, ok = true;
try { jsdom = await import('jsdom'); } catch { ok = false; }
export const domAvailable = ok && Boolean(jsdom);

const DIR = new URL(`../../node_modules/.zaal-dom/p${process.pid}/`, import.meta.url).pathname;
export const cleanupDom = () => dropDir(DIR);

let n = 0;

// Mount `files` (a {path: source} map with an `entry`) and return the window plus whatever
// React wrote to the console.
export async function mountApp({ entry, files, hash = '#/', strict = false }) {
  mkdirSync(DIR, { recursive: true });
  const dir = join(DIR, `app${n++}`);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(dir, path.split('/').slice(0, -1).join('/')), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
  const main = `import { createRoot } from 'react-dom/client';
import { StrictMode, createElement } from 'react';
import App from './${entry}';
const root = createRoot(document.getElementById('root'));
root.render(${strict ? `createElement(StrictMode, null, createElement(App))` : `createElement(App)`});
globalThis.__unmount = () => root.unmount();
`;
  writeFileSync(join(dir, '__main.jsx'), main);
  const { outputFiles } = buildSync({
    entryPoints: [join(dir, '__main.jsx')],
    bundle: true, write: false, format: 'iife', jsx: 'automatic',
    absWorkingDir: new URL('../../', import.meta.url).pathname,
    define: { 'process.env.NODE_ENV': '"development"' },
    loader: { '.png': 'dataurl', '.svg': 'dataurl', '.css': 'empty' },
  });

  const console_ = [];
  const vc = new jsdom.VirtualConsole();
  vc.on('jsdomError', e => console_.push(`error ${e.message.split('\n')[0]}`));
  for (const level of ['error', 'warn']) {
    vc.on(level, (...a) => console_.push(`${level} ${a.map(String).join(' ').split('\n')[0]}`));
  }
  const dom = new jsdom.JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',
    { runScripts: 'outside-only', url: `http://localhost/${hash}`, pretendToBeVisual: true, virtualConsole: vc });
  // React reads these off the global during render.
  dom.window.IS_REACT_ACT_ENVIRONMENT = false;
  dom.window.eval(outputFiles[0].text);
  await tick(dom.window);

  const win = dom.window;
  return {
    window: win,
    console: console_,
    get text() { return win.document.getElementById('root').textContent.replace(/\s+/g, ' ').trim(); },
    get html() { return win.document.getElementById('root').innerHTML; },
    $: sel => win.document.querySelector(sel),
    all: sel => [...win.document.querySelectorAll(sel)],
    byText: (sel, text) => [...win.document.querySelectorAll(sel)].find(e => e.textContent.trim() === text),
    async click(el) { el.dispatchEvent(new win.MouseEvent('click', { bubbles: true })); await tick(win); },
    async type(el, value) {
      const set = Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value').set;
      set.call(el, value);
      el.dispatchEvent(new win.Event('input', { bubbles: true }));
      await tick(win);
    },
    async submit(form) {
      form.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
      await tick(win);
    },
    async go(to) {
      win.location.hash = to;
      win.dispatchEvent(new win.HashChangeEvent('hashchange'));
      await tick(win);
    },
    unmount() { win.__unmount?.(); dom.window.close(); },
  };
}

// React 19 flushes passive effects through a MessageChannel, which in jsdom lands a turn or
// two after the render. One short timeout is not enough — an effect would look like it never
// ran, which is a harness bug that reads exactly like a compiler bug.
const tick = async win => {
  for (let i = 0; i < 4; i++) await new Promise(r => win.setTimeout(r, 5));
};
